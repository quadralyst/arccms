/**
 * Starting, reading and ending a payment, and refunding one. The browser names the account
 * through the app's own function and nothing more: the server reads the account's keys itself
 * (rule 1), and an account missing or half set up is refused with a plain reason, with no
 * default to fall back on (rule 6).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { featureOff, goodAccountId } from './accounts.js';
import { connectorFor, offeredModes } from './connectors/index.js';
import { pretendAllowed, PRETEND_ID } from './connectors/pretend.js';
import { applyRead, CALL_TIMEOUT_MS, checkGapMs, checkPayment, deliverPending, noteKeyRefused, withPending } from './settle.js';
import { PAYMENTS, paymentIdFor, readAccount, readAccountKeys, type PaymentRecord } from './store.js';
import type { PaymentConnector, PaymentFailure, PaymentFailureReason, PaymentKeys, PaymentMode, PaymentView, StartedPayment, StartPaymentInput } from './types.js';

const REFERENCE = /^[\w.:-]+$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_AMOUNT = 999_999_999_999;
const LANGUAGE = /^[a-zA-Z]{2}([_-][a-zA-Z]{2})?$/;
/** A record stuck at `starting` longer than this was a crash. */
export const STARTING_MS = 2 * 60_000;

function refuse(reason: PaymentFailureReason, detail: string): PaymentFailure {
    return { ok: false, reason, detail };
}

/** The address a buyer is sent to is on the provider's own domain, and its right system (rules 6, 11). */
export function pageAddressProblem(pageUrl: unknown, connector: PaymentConnector, context: { mode: PaymentMode; keys: PaymentKeys }): string | null {
    if (typeof pageUrl !== 'string' || pageUrl.length > 2000) return 'no address';
    let url: URL;
    try {
        url = new URL(pageUrl);
    } catch {
        return 'not an address';
    }
    if (url.protocol !== 'https:') return 'not https';
    if (url.username || url.password || url.port) return 'an address with credentials or a port';
    const hostname = url.hostname.toLowerCase();
    const host = connector.pageHost(context).toLowerCase();
    const onDomain = host.startsWith('.') ? hostname.endsWith(host) && hostname.length > host.length : hostname === host;
    if (!onDomain) return 'on another domain';
    if (connector.pageOnWrongSystem?.(hostname, context.mode)) return 'on the provider\'s other system';
    return null;
}

function returnUrlProblem(value: unknown, connector: PaymentConnector): string | null {
    if (typeof value !== 'string' || value.length > 1000) return 'The return address is missing.';
    try {
        const url = new URL(value);
        const local = connector.info.id === PRETEND_ID && pretendAllowed() && url.protocol === 'http:' && url.hostname === 'localhost';
        if (url.protocol !== 'https:' && !local) return 'The return address must be https.';
        if (url.username || url.password) return 'The return address must not hold a name or password.';
    } catch {
        return 'The return address is not an address.';
    }
    return null;
}

function view(record: PaymentRecord, checked: boolean, detail?: string): PaymentView {
    return {
        ok: true,
        paymentId: record.paymentId,
        accountId: record.accountId,
        reference: record.reference,
        status: record.status,
        amountMinor: record.amountMinor,
        currency: record.currency,
        mode: record.mode,
        provider: record.provider,
        providerId: record.providerId,
        late: record.late,
        heldReasons: record.heldReasons ?? [],
        refundedMinor: record.refundedMinor ?? 0,
        ...(record.refundingMinor ? { refundingMinor: record.refundingMinor } : {}),
        closesAtIso: new Date(record.closesAtMs).toISOString(),
        ...(record.providerStatus ? { providerStatus: record.providerStatus } : {}),
        ...(record.method ? { method: record.method } : {}),
        eventSeen: record.eventSeen ?? false,
        checked,
        ...(detail ? { detail } : {}),
    };
}

/**
 * Start a payment on the account's provider, in the account's mode. The same reference again
 * gives back the same open page, and nothing else: a different amount or a finished payment is
 * refused. Anything not named here, such as a key in the input, is never read.
 */
export async function startPayment(input: StartPaymentInput): Promise<StartedPayment | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    if (!goodAccountId(input?.accountId)) return refuse('bad-input', 'The account id must be one word with no slash.');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > MAX_AMOUNT) return refuse('bad-input', 'The amount must be a whole number of minor units, above 0.');
    if (typeof input.currency !== 'string' || !CURRENCY.test(input.currency)) return refuse('bad-input', 'The currency must be three upper case letters, such as CHF.');
    if (typeof input.reference !== 'string' || !REFERENCE.test(input.reference)) return refuse('bad-input', 'The reference must be letters, digits, and . _ : or -.');
    if (input.language !== undefined && !LANGUAGE.test(input.language)) return refuse('bad-input', 'The language must look like de or de_CH.');

    const account = await readAccount(input.accountId);
    if (!account) return refuse('no-account', 'This account is not connected, so it cannot take payments.');
    const connector = connectorFor(account.provider);
    const keysDoc = await readAccountKeys(input.accountId);
    const keys = keysDoc?.provider === account.provider ? keysDoc.modes[account.mode] : undefined;
    if (!connector || !keys) return refuse('account-incomplete', 'This account has no keys for its mode, so it cannot take payments. Connect it again.');
    const missing = connector.info.fields.find((field) => field.required && !keys[field.id]);
    if (missing) return refuse('account-incomplete', `This account has no ${missing.label}. Connect it again.`);
    if (!offeredModes(connector).includes(account.mode)) return refuse('not-offered', `${connector.info.name} is not offered in ${account.mode} mode here.`);
    if (input.reference.length > connector.info.maxReferenceLength) return refuse('bad-input', `${connector.info.name} takes a reference of at most ${connector.info.maxReferenceLength} characters.`);
    const returnProblem = returnUrlProblem(input.returnUrl, connector);
    if (returnProblem) return refuse('bad-input', returnProblem);

    const life = connector.info.pageLife;
    let lifeMinutes: number | undefined;
    if (life.settable) {
        lifeMinutes = input.lifeMinutes ?? life.defaultMinutes;
        if (!Number.isInteger(lifeMinutes) || lifeMinutes < 1 || lifeMinutes > life.maxMinutes) return refuse('bad-input', `The page's life must be from 1 to ${life.maxMinutes} minutes.`);
    }

    const paymentId = paymentIdFor(input.accountId, input.reference);
    const ref = db.collection(PAYMENTS).doc(paymentId);
    const nowMs = Date.now();
    const claim: PaymentRecord = {
        paymentId,
        accountId: input.accountId,
        reference: input.reference,
        provider: connector.info.id,
        mode: account.mode,
        status: 'starting',
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerId: '',
        pageUrl: '',
        late: false,
        heldReasons: [],
        refundedMinor: 0,
        createdAtMs: nowMs,
        closesAtMs: nowMs,
        nextCheckAtMs: nowMs + STARTING_MS,
        checks: 0,
        eventSeen: false,
        pending: [],
        deliveryAttempts: 0,
    };
    const taken = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            const existing = snap.data() as PaymentRecord;
            if (existing.status !== 'starting' || nowMs - existing.createdAtMs < STARTING_MS) return existing;
        }
        tx.set(ref, claim);
        return null;
    });
    if (taken) {
        const same = taken.amountMinor === input.amountMinor && taken.currency === input.currency;
        if (taken.status === 'starting' && same) return refuse('busy', 'This payment is being started. Try again in a moment.');
        // Never a page on the other system after a switch, nor one that has closed (rule 6).
        if (taken.status === 'open' && same && taken.mode === account.mode && taken.closesAtMs > nowMs) {
            return { ok: true, paymentId, pageUrl: taken.pageUrl, providerId: taken.providerId, closesAtIso: new Date(taken.closesAtMs).toISOString(), lifeFixedByProvider: !life.settable, existing: true, mode: taken.mode };
        }
        return refuse('reference-used', 'This reference was used for another payment.');
    }

    const context = { mode: account.mode, keys, timeoutMs: CALL_TIMEOUT_MS };
    const started = await connector.start(context, { paymentId, amountMinor: input.amountMinor, currency: input.currency, reference: input.reference, returnUrl: input.returnUrl, ...(lifeMinutes !== undefined ? { lifeMinutes } : {}), ...(input.language ? { language: input.language } : {}) });
    if (!started.ok) {
        await ref.delete();
        if (started.failure === 'key-refused') await noteKeyRefused(input.accountId, started.detail);
        return refuse(started.failure, started.detail);
    }
    const problem = pageAddressProblem(started.pageUrl, connector, context);
    if (problem) {
        await connector.end(context, { providerId: started.providerId, reference: input.reference }).catch(() => undefined);
        await ref.delete();
        return refuse('bad-page-address', `The provider's page address is ${problem}, so it was not used.`);
    }
    const closesAtMs = nowMs + started.lifeMinutes * 60_000;
    // Only over this instance's own claim: a stalled one must not write over what came after it.
    const stillMine = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data() as PaymentRecord) : null;
        if (current?.status !== 'starting' || current.createdAtMs !== nowMs) return false;
        tx.update(ref, { status: 'open', providerId: started.providerId, pageUrl: started.pageUrl, closesAtMs, nextCheckAtMs: nowMs + checkGapMs(0) });
        return true;
    });
    if (!stillMine) {
        await connector.end(context, { providerId: started.providerId, reference: input.reference }).catch(() => undefined);
        return refuse('busy', 'This payment was started again elsewhere. Read it to see where it stands.');
    }
    return { ok: true, paymentId, pageUrl: started.pageUrl, providerId: started.providerId, closesAtIso: new Date(closesAtMs).toISOString(), lifeFixedByProvider: !life.settable, existing: false, mode: account.mode };
}

async function recordFor(accountId: unknown, reference: unknown): Promise<PaymentRecord | null> {
    if (!goodAccountId(accountId) || typeof reference !== 'string') return null;
    const snap = await db.collection(PAYMENTS).doc(paymentIdFor(accountId, reference)).get();
    return snap.exists ? (snap.data() as PaymentRecord) : null;
}

/** A payment's status, read back from the provider now. When the provider cannot answer, what Arc last knew, with `checked: false`. */
export async function readPayment(input: { accountId: string; reference: string }): Promise<PaymentView | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    const record = await recordFor(input?.accountId, input?.reference);
    if (!record || record.status === 'starting') return refuse('not-found', 'There is no such payment.');
    const checked = await checkPayment(record.paymentId, { via: 'app' });
    if (checked.ok) return view(checked.record, true);
    return view(checked.record ?? record, false, checked.detail);
}

/** Reads, then ends the page. False when the provider would not. The record is then cancelled unless the money has come. */
export async function endOpenPayment(record: PaymentRecord): Promise<boolean> {
    const connector = connectorFor(record.provider);
    const keysDoc = await readAccountKeys(record.accountId);
    const keys = keysDoc?.provider === record.provider ? keysDoc.modes[record.mode] : undefined;
    if (!connector || !keys || !connector.info.canEndPage) return false;
    // Read first: ending a page may leave nothing to read, and the money may have come.
    const checked = await checkPayment(record.paymentId, { via: 'app' });
    if (checked.ok && checked.record.status !== 'open') return true;
    const known = checked.ok ? checked.record : record;
    const ended = await connector.end({ mode: record.mode, keys, timeoutMs: CALL_TIMEOUT_MS }, { providerId: record.providerId, providerPaymentId: known.providerPaymentId, reference: record.reference });
    if (!ended.ok) return false;
    const nowMs = Date.now();
    await applyRead(record.paymentId, { ok: true, state: 'cancelled', providerStatus: 'ended by the app' }, nowMs);
    await deliverPending(record.paymentId, nowMs);
    return true;
}

/**
 * End an open page, where the provider allows it. A buyer can already be paying, so the sweep
 * goes on reading until the page's life is over: money that still comes reaches the app as a
 * paid result with `late` set, never lost.
 */
export async function endPayment(input: { accountId: string; reference: string }): Promise<PaymentView | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    const record = await recordFor(input?.accountId, input?.reference);
    if (!record || record.status === 'starting') return refuse('not-found', 'There is no such payment.');
    const connector = connectorFor(record.provider);
    if (connector && !connector.info.canEndPage) return refuse('unsupported', `${connector.info.name} cannot end a page.`);
    if (record.status === 'open' && !(await endOpenPayment(record))) return refuse('unavailable', 'The provider did not end the page. Try again.');
    const snap = await db.collection(PAYMENTS).doc(record.paymentId).get();
    return view(snap.data() as PaymentRecord, record.status === 'open');
}

/** A person decides a held payment. The app hears it as a result, with `resolvedBy`. */
export async function resolveHeldPayment(input: { accountId: string; reference: string; as: 'paid' | 'failed' | 'cancelled'; by: string }): Promise<PaymentView | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    if (!['paid', 'failed', 'cancelled'].includes(input?.as) || typeof input.by !== 'string' || !input.by) return refuse('bad-input', 'Say what it becomes (paid, failed or cancelled) and who decided.');
    const record = await recordFor(input.accountId, input.reference);
    if (!record) return refuse('not-found', 'There is no such payment.');
    const ref = db.collection(PAYMENTS).doc(record.paymentId);
    const nowMs = Date.now();
    const updated = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data() as PaymentRecord;
        if (current.status !== 'held') return null;
        const fields = { status: input.as, resolvedBy: input.by };
        tx.update(ref, { ...withPending(current, fields, { status: input.as, late: current.late, resolvedBy: input.by }, nowMs), nextCheckAtMs: FieldValue.delete() });
        return { ...current, ...fields } as PaymentRecord;
    });
    if (!updated) return refuse('not-held', 'This payment is not held.');
    await deliverPending(record.paymentId, nowMs);
    return view(updated, false);
}

/**
 * Refund a paid payment, whole or in part, through the provider. Whole means what is left to
 * refund. With no answer from the provider the amount stays set aside, as it may have gone
 * through, and a further refund is refused until a person has looked at the provider's account.
 */
export async function refundPayment(input: { accountId: string; reference: string; amountMinor?: number; by: string }): Promise<({ ok: true; refundId: string; providerStatus: string; refundedMinor: number }) | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    if (typeof input?.by !== 'string' || !input.by) return refuse('bad-input', 'Say who is refunding: by.');
    if (input.amountMinor !== undefined && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)) return refuse('bad-input', 'The amount must be a whole number of minor units, above 0.');
    const record = await recordFor(input.accountId, input.reference);
    if (!record) return refuse('not-found', 'There is no such payment.');
    const connector = connectorFor(record.provider);
    const keysDoc = await readAccountKeys(record.accountId);
    const keys = keysDoc?.provider === record.provider ? keysDoc.modes[record.mode] : undefined;
    if (!connector || !keys) return refuse('account-incomplete', 'The account that took this payment no longer has its keys.');
    if (!connector.info.canRefund) return refuse('unsupported', `${connector.info.name} does not refund through Arc.`);

    const ref = db.collection(PAYMENTS).doc(record.paymentId);
    const claim = await db.runTransaction(async (tx): Promise<PaymentFailure | { amount: number; count: number; current: PaymentRecord }> => {
        const snap = await tx.get(ref);
        const current = snap.data() as PaymentRecord;
        if (current.status !== 'paid') return refuse('not-paid', 'Only a paid payment can be refunded.');
        if (current.refundingMinor) return refuse('busy', 'An earlier refund has no answer yet. Check the provider\'s own account.');
        const paid = current.paidMinor ?? current.amountMinor;
        const left = paid - (current.refundedMinor ?? 0);
        const amount = input.amountMinor ?? left;
        if (amount <= 0 || amount > left) return refuse('too-much', `At most ${left} minor units are left to refund.`);
        if (amount < paid && !connector.info.canRefundPart) return refuse('unsupported', `${connector.info.name} refunds only the whole amount.`);
        const count = (current.refundCount ?? 0) + 1;
        tx.update(ref, { refundingMinor: amount, refundCount: count });
        return { amount, count, current };
    });
    if ('ok' in claim) return claim;

    const answer = await connector.refund({ mode: record.mode, keys, timeoutMs: CALL_TIMEOUT_MS }, { providerId: claim.current.providerId, providerPaymentId: claim.current.providerPaymentId, reference: record.reference }, {
        amountMinor: claim.amount,
        currency: claim.current.paidCurrency ?? claim.current.currency,
        reference: `${record.reference.slice(0, 26)}-r${claim.count}`,
        paymentId: `${record.paymentId}-r${claim.count}`,
    });
    if (!answer.ok) {
        // Refused outright: nothing moved. No answer: it may have, so the amount stays set aside.
        if (answer.failure !== 'timeout' && answer.failure !== 'unavailable') await ref.update({ refundingMinor: FieldValue.delete() });
        return refuse(answer.failure, answer.detail);
    }
    const refundedMinor = (claim.current.refundedMinor ?? 0) + claim.amount;
    await ref.update({ refundedMinor, refundingMinor: FieldValue.delete(), lastRefundBy: input.by });
    return { ok: true, refundId: answer.refundId, providerStatus: answer.providerStatus, refundedMinor };
}

/**
 * A refund left with no answer: a person has looked in the provider's own account and says
 * whether it went through. Until then the amount stays set aside and no further refund goes.
 */
export async function settleRefund(input: { accountId: string; reference: string; went: boolean; by: string }): Promise<PaymentView | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    if (typeof input?.went !== 'boolean' || typeof input.by !== 'string' || !input.by) return refuse('bad-input', 'Say whether it went through, and who looked.');
    const record = await recordFor(input.accountId, input.reference);
    if (!record) return refuse('not-found', 'There is no such payment.');
    const ref = db.collection(PAYMENTS).doc(record.paymentId);
    const updated = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data() as PaymentRecord;
        if (!current.refundingMinor) return null;
        const refundedMinor = (current.refundedMinor ?? 0) + (input.went ? current.refundingMinor : 0);
        tx.update(ref, { refundedMinor, refundingMinor: FieldValue.delete(), lastRefundBy: input.by });
        const { refundingMinor: _settled, ...rest } = current;
        return { ...rest, refundedMinor } as PaymentRecord;
    });
    if (!updated) return refuse('not-found', 'No refund is waiting on this payment.');
    return view(updated, false);
}
