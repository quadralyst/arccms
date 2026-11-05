/**
 * What a read back from the provider does to a record (rules 4, 5, 7), and getting the result
 * to the app once.
 *
 * The only code that can say paid. It takes the provider's answer, never an event's, and
 * compares amount, currency, reference and system with the app's own record: any difference
 * is held for a person. Paid and held never change here; a cancelled or failed payment can
 * still become paid, because the money is real, and the app hears it as a late result.
 */
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { clearAccountProblem, paymentHooks, raiseAccountAlert } from './alerts.js';
import { connectorFor } from './connectors/index.js';
import { ACCOUNTS, PAYMENTS, readAccount, readAccountKeys, type AccountDoc, type PaymentRecord, type PendingResult } from './store.js';
import type { ConnectorError, ConnectorRead, PaymentResult } from './types.js';

/** How long a provider call may take. */
export const CALL_TIMEOUT_MS = 20_000;
/** Between the sweep's reads: 2 minutes, doubling, at most this. */
const MAX_CHECK_GAP_MS = 15 * 60_000;
const FIRST_CHECK_GAP_MS = 2 * 60_000;
/** After a page closes, the provider has this long to say what became of it. */
export const CLOSE_GRACE_MS = 10 * 60_000;
/** A claim on a delivery older than this was a crash. */
const CLAIM_MS = 5 * 60_000;
export const MAX_DELIVERY_ATTEMPTS = 10;
/** This many payments in a row found finished by the sweep with no event: the webhook looks off. */
export const SILENT_FINISHES_ALERT = 3;

export function checkGapMs(checks: number): number {
    return Math.min(MAX_CHECK_GAP_MS, FIRST_CHECK_GAP_MS * 2 ** Math.min(checks, 8));
}

/** What did not match, in words an app can show. Empty: this is the app's payment. */
export function mismatches(record: Pick<PaymentRecord, 'amountMinor' | 'currency' | 'reference' | 'mode'>, read: ConnectorRead): string[] {
    const reasons: string[] = [];
    if (read.amountMinor !== record.amountMinor) reasons.push('amount');
    if (read.currency !== record.currency) reasons.push('currency');
    if (read.reference !== record.reference) reasons.push('reference');
    if (read.mode !== record.mode) reasons.push('mode');
    return reasons;
}

export interface Decision {
    fields: Partial<PaymentRecord>;
    pending?: PendingResult;
}

/** What a read means for a record. No fields: nothing changes. */
export function decide(record: PaymentRecord, read: ConnectorRead): Decision {
    const fields: Partial<PaymentRecord> = { providerStatus: read.providerStatus };
    // A buyer's second try may be the one that paid, and a refund must go to it.
    if (read.providerPaymentId && (read.state === 'paid' || !record.providerPaymentId)) fields.providerPaymentId = read.providerPaymentId;
    if (read.method) fields.method = read.method;
    // Paid never goes back, and a held payment waits for its person.
    if (record.status === 'paid' || record.status === 'held' || record.status === 'starting') return { fields };
    if (read.state === 'paid') {
        const reasons = mismatches(record, read);
        const said = { ...(read.amountMinor !== undefined ? { paidMinor: read.amountMinor } : {}), ...(read.currency !== undefined ? { paidCurrency: read.currency } : {}) };
        // The app has already heard this one failed or was cancelled.
        const late = record.status === 'cancelled' || record.status === 'failed';
        if (reasons.length) return { fields: { ...fields, ...said, status: 'held', heldReasons: reasons, late }, pending: { status: 'held', late } };
        return { fields: { ...fields, ...said, status: 'paid', late }, pending: { status: 'paid', late } };
    }
    if (record.status !== 'open') return { fields };
    if (read.state === 'unclear') return { fields: { ...fields, status: 'held', heldReasons: ['provider-status'] }, pending: { status: 'held', late: false } };
    if (read.state === 'failed') return { fields: { ...fields, status: 'failed' }, pending: { status: 'failed', late: false } };
    if (read.state === 'cancelled') return { fields: { ...fields, status: 'cancelled' }, pending: { status: 'cancelled', late: false } };
    return { fields };
}

/** Writes what a read means, in one transaction; answers the record as it now is, and whether it changed. */
export async function applyRead(paymentId: string, read: ConnectorRead, nowMs = Date.now()): Promise<{ record: PaymentRecord; finished: boolean } | null> {
    const ref = db.collection(PAYMENTS).doc(paymentId);
    const answer = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const record = snap.data() as PaymentRecord;
        const { fields, pending } = decide(record, read);
        const update = withPending(record, { ...fields, lastReadAtMs: nowMs }, pending, nowMs);
        tx.update(ref, update);
        return { record: { ...record, ...fields } as PaymentRecord, finished: !!pending && record.status === 'open' };
    });
    return answer;
}

/** A record's fields with one more thing waiting for the app, and the sweep's checks stopped when nothing more can change. */
export function withPending(record: PaymentRecord, fields: Record<string, unknown>, pending: PendingResult | undefined, nowMs: number): Record<string, unknown> {
    const update: Record<string, unknown> = { ...fields };
    const status = (fields['status'] as PaymentRecord['status'] | undefined) ?? record.status;
    if (status === 'paid' || status === 'held') update['nextCheckAtMs'] = FieldValue.delete();
    if (pending) {
        update['pending'] = [...(record.pending ?? []), pending];
        update['deliveryNextAtMs'] = nowMs;
    }
    return update;
}

export type CheckAnswer = { ok: true; record: PaymentRecord; read: ConnectorRead } | (ConnectorError & { record?: PaymentRecord });

/**
 * Read one payment back from the provider and apply it. `hint` is the provider's payment id
 * from an event. `via` is what prompted it: the sweep counts payments no event told it about.
 */
export async function checkPayment(paymentId: string, options: { hint?: string; via: 'event' | 'sweep' | 'app'; nowMs?: number }): Promise<CheckAnswer> {
    const nowMs = options.nowMs ?? Date.now();
    const snap = await db.collection(PAYMENTS).doc(paymentId).get();
    if (!snap.exists) return { ok: false, failure: 'not-found', detail: 'There is no such payment.' };
    const record = snap.data() as PaymentRecord;
    const connector = connectorFor(record.provider);
    const keysDoc = await readAccountKeys(record.accountId);
    const keys = keysDoc?.provider === record.provider ? keysDoc.modes[record.mode] : undefined;
    if (!connector || !keys) return { ok: false, failure: 'no-keys', detail: 'The account that made this payment no longer has its keys.', record };

    const read = await connector.read({ mode: record.mode, keys, timeoutMs: CALL_TIMEOUT_MS }, {
        providerId: record.providerId,
        providerPaymentId: record.providerPaymentId ?? options.hint ?? record.eventHint,
        reference: record.reference,
    });
    if (!read.ok) {
        if (read.failure === 'key-refused') await noteKeyRefused(record.accountId, read.detail);
        return { ...read, record };
    }
    await clearAccountProblem(record.accountId, 'key-refused');
    const applied = await applyRead(paymentId, read, nowMs);
    if (!applied) return { ok: false, failure: 'not-found', detail: 'There is no such payment.' };
    if (applied.finished) await noteFinished(applied.record, options.via, nowMs);
    await deliverPending(paymentId, nowMs);
    return { ok: true, record: applied.record, read };
}

/**
 * Hold a payment for a person, if it can still become money: only what is unfinished right
 * now, against the record as it is now, never a snapshot read earlier (rules 4, 7).
 */
export async function holdPayment(paymentId: string, reasons: string[], nowMs = Date.now()): Promise<boolean> {
    const ref = db.collection(PAYMENTS).doc(paymentId);
    const held = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const record = snap.exists ? (snap.data() as PaymentRecord) : null;
        if (!record || !['open', 'failed', 'cancelled'].includes(record.status)) return false;
        const late = record.status !== 'open';
        tx.update(ref, withPending(record, { status: 'held', heldReasons: reasons, late }, { status: 'held', late }, nowMs));
        return true;
    });
    if (held) await deliverPending(paymentId, nowMs);
    return held;
}

/** A key was refused while being used: the app hears it now, before more payments fail (rule 10). */
export async function noteKeyRefused(accountId: string, detail: string): Promise<void> {
    const account = await readAccount(accountId);
    if (account) await raiseAccountAlert(account, { type: 'key-refused', detail }, 'refused');
}

/**
 * The account's last payment update, and whether events are arriving at all (rule 10). A
 * payment finished with no event yet counts towards a silent webhook, whoever found it: an app
 * reading every payment itself finishes them before any sweep does. An event arriving resets
 * the count, even a moment later for a payment already final (noteEventArrived).
 */
async function noteFinished(record: PaymentRecord, via: 'event' | 'sweep' | 'app', nowMs: number): Promise<void> {
    const ref = db.collection(ACCOUNTS).doc(record.accountId);
    const silent = via !== 'event' && !record.eventSeen;
    // In one transaction, as the sweep finishes several of an account's payments at once.
    const account = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const current = snap.data() as AccountDoc;
        const silentFinishes = silent ? (current.silentFinishes ?? 0) + 1 : 0;
        tx.update(ref, { lastPaymentAtIso: new Date(nowMs).toISOString(), lastPaymentStatus: record.status, silentFinishes });
        return { ...current, silentFinishes };
    });
    if (account && silent && account.silentFinishes >= SILENT_FINISHES_ALERT) {
        await raiseAccountAlert(account, { type: 'webhook-silent', detail: `${account.silentFinishes} payments finished with no event from the provider: its webhook may be missing or switched off.` }, 'silent');
    }
}

/**
 * Hand what waits to the app, oldest first. One instance at a time, by a claim in a
 * transaction. A hook that fails is tried again by the sweep with the same resultId; a crash
 * after the hook ran is the one way it can hear something twice, which the resultId covers.
 */
export async function deliverPending(paymentId: string, nowMs = Date.now()): Promise<void> {
    const ref = db.collection(PAYMENTS).doc(paymentId);
    for (let i = 0; i < 8; i++) {
        const claimed = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const record = snap.exists ? (snap.data() as PaymentRecord) : null;
            if (!record?.pending?.length) return null;
            // The clock now, not the caller's: a sweep's moment can be minutes old.
            const claimAt = Date.now();
            if (record.deliveryClaimedAtMs && claimAt - record.deliveryClaimedAtMs < CLAIM_MS) return null;
            tx.update(ref, { deliveryClaimedAtMs: claimAt });
            return record;
        });
        if (!claimed) return;
        const item = claimed.pending[0];
        try {
            await sendToApp(claimed, item);
        } catch {
            logger.warn('merchant-payments: the app did not take a result', { provider: claimed.provider, status: item.status });
            await noteDeliveryFailed(claimed, nowMs);
            return;
        }
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const record = snap.data() as PaymentRecord;
            // By what was delivered, not by position.
            const pending = record.pending ?? [];
            const rest = pending[0]?.status === item.status ? pending.slice(1) : pending;
            tx.update(ref, { pending: rest, deliveryClaimedAtMs: FieldValue.delete(), deliveryAttempts: 0, deliveryNextAtMs: rest.length ? nowMs : FieldValue.delete() });
        });
    }
}

export function resultFrom(record: PaymentRecord, item: PendingResult): PaymentResult {
    return {
        resultId: `${record.paymentId}.${item.status}`,
        paymentId: record.paymentId,
        accountId: record.accountId,
        reference: record.reference,
        status: item.status as PaymentResult['status'],
        amountMinor: item.status === 'paid' ? record.paidMinor ?? record.amountMinor : record.amountMinor,
        currency: item.status === 'paid' ? record.paidCurrency ?? record.currency : record.currency,
        provider: record.provider,
        providerId: record.providerId,
        mode: record.mode,
        late: item.late,
        ...(item.resolvedBy ? { resolvedBy: item.resolvedBy } : {}),
    };
}

async function sendToApp(record: PaymentRecord, item: PendingResult): Promise<void> {
    const hooks = await paymentHooks();
    if (item.status === 'held') {
        await hooks.onAlert?.({
            type: 'payment-held',
            accountId: record.accountId,
            provider: record.provider,
            mode: record.mode,
            reference: record.reference,
            reasons: record.heldReasons,
            detail: `The payment ${record.reference} is held for a person: ${record.heldReasons.join(', ')} did not match.`,
        });
        return;
    }
    await hooks.onResult?.(resultFrom(record, item));
}

async function noteDeliveryFailed(record: PaymentRecord, nowMs: number): Promise<void> {
    const attempts = (record.deliveryAttempts ?? 0) + 1;
    const gap = Math.min(60, 2 ** attempts) * 60_000;
    await db.collection(PAYMENTS).doc(record.paymentId).update({ deliveryAttempts: attempts, deliveryClaimedAtMs: FieldValue.delete(), deliveryNextAtMs: nowMs + gap });
    if (attempts === MAX_DELIVERY_ATTEMPTS) {
        try {
            const hooks = await paymentHooks();
            await hooks.onAlert?.({
                type: 'delivery-failed',
                accountId: record.accountId,
                provider: record.provider,
                mode: record.mode,
                reference: record.reference,
                detail: `The app's onResult has failed ${attempts} times for ${record.reference}. Arc goes on trying every hour.`,
            });
        } catch {
            logger.warn('merchant-payments: an alert did not reach the app', { type: 'delivery-failed', provider: record.provider });
        }
    }
}
