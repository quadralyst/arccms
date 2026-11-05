/**
 * One account for each customer of the app, named by the app's own id. Server helpers only,
 * in the app kit: the app's own function wraps them, so the app decides who may connect (its
 * owner, Arc's fresh code). No page of Arc's.
 *
 * Keys are typed once and sent once: they go to the provider in a test call, then to a
 * collection no browser can read, and never come back (rule 1). A key the provider turns down
 * is not saved.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { isFeatureOn } from '../feature-flags.js';
import { db } from '../init.js';
import { clearAccountProblem } from './alerts.js';
import { connectorFor, offeredModes } from './connectors/index.js';
import { ACCOUNT_KEYS, ACCOUNTS, newWebhookId, PAYMENTS, readAccount, readAccountKeys, WEBHOOKS, webhookAddress, type AccountDoc, type PaymentRecord } from './store.js';
import { CALL_TIMEOUT_MS, holdPayment } from './settle.js';
import type { ConnectPaymentAccountInput, PaymentConnector, PaymentFailure, PaymentKeys, PaymentMode, PublicAccountAnswer, PublicPaymentAccount } from './types.js';

/** One word, and not what Firestore keeps for itself: `.`, `..` or `__name__`. */
const ACCOUNT_ID = /^(?!\.\.?$)(?!__.*__$)[^/\s]{1,200}$/;

export function featureOff(): PaymentFailure | null {
    return isFeatureOn('merchant-payments') ? null : { ok: false, reason: 'off', detail: 'Merchant payments are off for this app. Add merchant-payments to "on" in src/custom/features.ts.' };
}

export function goodAccountId(accountId: unknown): accountId is string {
    return typeof accountId === 'string' && ACCOUNT_ID.test(accountId);
}

/** What a page may read, with the address built, and nothing of Arc's bookkeeping. */
export function publicView(account: AccountDoc): PublicPaymentAccount {
    const { webhookId, alertsSaid: _said, silentFinishes: _silent, ...open } = account;
    return { ...open, problems: account.problems ?? {}, webhookAddress: webhookAddress(webhookId) };
}

/** The values a connector asks for, each checked; anything else given is dropped. A problem names the field, never its value. */
export function cleanFields(connector: PaymentConnector, given: Record<string, unknown>): { ok: true; keys: PaymentKeys } | PaymentFailure {
    const keys: PaymentKeys = {};
    for (const field of connector.info.fields) {
        const raw = given?.[field.id];
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) {
            if (field.required) return { ok: false, reason: 'bad-field', detail: `${field.label} is needed.` };
            continue;
        }
        if (value.length > 1000 || (field.pattern && !field.pattern.test(value))) return { ok: false, reason: 'bad-field', detail: `${field.label} does not look right.` };
        keys[field.id] = value;
    }
    return { ok: true, keys };
}

function publicParts(connector: PaymentConnector, keys: PaymentKeys): { publicName: string; last4: string; keyExpiresOn?: string } {
    const named = connector.info.fields.find((f) => f.publicName);
    const preview = connector.info.fields.find((f) => f.preview);
    const expiry = connector.info.fields.find((f) => f.expiry);
    return {
        publicName: named ? keys[named.id] ?? '' : '',
        last4: preview ? (keys[preview.id] ?? '').slice(-4) : '',
        ...(expiry && keys[expiry.id] ? { keyExpiresOn: keys[expiry.id] } : {}),
    };
}

function modeRefusal(connector: PaymentConnector, mode: unknown): PaymentFailure | null {
    if (mode !== 'test' && mode !== 'live') return { ok: false, reason: 'bad-input', detail: 'The mode must be test or live.' };
    if (!connector.info.modes.includes(mode)) return { ok: false, reason: 'mode-not-supported', detail: `${connector.info.name} has no ${mode} mode.` };
    if (!offeredModes(connector).includes(mode)) return { ok: false, reason: 'not-offered', detail: `${connector.info.name} is not offered in ${mode} mode here: it has not been proven on the provider's own test account.` };
    return null;
}

async function openPayments(accountId: string): Promise<PaymentRecord[]> {
    const snap = await db.collection(PAYMENTS).where('accountId', '==', accountId).where('status', '==', 'open').limit(50).get();
    return snap.docs.map((doc) => doc.data() as PaymentRecord);
}

/**
 * Connect, or replace the keys of the mode named. Calls the provider first, and saves nothing
 * if it refuses. The account then runs in that mode. A different provider replaces the old one
 * and all its keys, and is refused while a payment on the old one is open.
 */
export async function connectPaymentAccount(input: ConnectPaymentAccountInput): Promise<PublicAccountAnswer | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    if (!goodAccountId(input?.accountId)) return { ok: false, reason: 'bad-input', detail: 'The account id must be one word with no slash.' };
    if (typeof input.by !== 'string' || !input.by) return { ok: false, reason: 'bad-input', detail: 'Say who is connecting: by.' };
    const connector = connectorFor(input.provider);
    if (!connector) return { ok: false, reason: 'not-offered', detail: 'There is no such provider.' };
    const refused = modeRefusal(connector, input.mode);
    if (refused) return refused;
    const cleaned = cleanFields(connector, input.fields);
    if (!cleaned.ok) return cleaned;

    const before = await readAccountKeys(input.accountId);
    const sameProvider = before?.provider === connector.info.id;
    // Another provider, or another merchant on this one: the open payments could no longer be read.
    const named = connector.info.fields.find((field) => field.publicName);
    const anotherMerchant = sameProvider && named && before?.modes[input.mode] && before.modes[input.mode]?.[named.id] !== cleaned.keys[named.id];
    if (before && (!sameProvider || anotherMerchant) && (await openPayments(input.accountId)).length) {
        return { ok: false, reason: 'open-payments', detail: 'Payments on the present account are still open. End them first, or wait for them to finish.' };
    }

    const test = await connector.testKeys({ mode: input.mode, keys: cleaned.keys, timeoutMs: CALL_TIMEOUT_MS });
    if (!test.ok) return { ok: false, reason: test.failure, detail: test.detail };

    const webhookId = sameProvider && before?.webhookId ? before.webhookId : newWebhookId();
    const nowIso = new Date().toISOString();
    const existing = await readAccount(input.accountId);
    const modes = {
        ...(sameProvider ? before?.modes : {}),
        [input.mode]: cleaned.keys,
        // One set of keys for both modes, where the provider has only one.
        ...(connector.info.separateKeys ? {} : Object.fromEntries(connector.info.modes.map((mode) => [mode, cleaned.keys]))),
    } as Partial<Record<PaymentMode, PaymentKeys>>;
    const account: AccountDoc = {
        accountId: input.accountId,
        provider: connector.info.id,
        mode: input.mode,
        ...publicParts(connector, cleaned.keys),
        modesWithKeys: Object.keys(modes).sort() as PaymentMode[],
        connectedAtIso: sameProvider && existing ? existing.connectedAtIso : nowIso,
        connectedBy: sameProvider && existing ? existing.connectedBy : input.by,
        updatedAtIso: nowIso,
        updatedBy: input.by,
        webhookId,
        problems: {},
        alertsSaid: {},
        silentFinishes: 0,
        ...(sameProvider && existing?.lastPaymentAtIso ? { lastPaymentAtIso: existing.lastPaymentAtIso, lastPaymentStatus: existing.lastPaymentStatus } : {}),
    };
    const batch = db.batch();
    batch.set(db.collection(ACCOUNT_KEYS).doc(input.accountId), { provider: connector.info.id, webhookId, modes, setAtIso: nowIso, setBy: input.by });
    batch.set(db.collection(ACCOUNTS).doc(input.accountId), account);
    batch.set(db.collection(WEBHOOKS).doc(webhookId), { accountId: input.accountId, provider: connector.info.id });
    if (before?.webhookId && before.webhookId !== webhookId) batch.delete(db.collection(WEBHOOKS).doc(before.webhookId));
    await batch.commit();
    return { ok: true, account: publicView(account) };
}

/** Switch between test and live, with keys already held for that mode; they are tried first. New keys go through connectPaymentAccount. */
export async function switchPaymentMode(input: { accountId: string; mode: PaymentMode; by: string }): Promise<PublicAccountAnswer | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    const account = goodAccountId(input?.accountId) ? await readAccount(input.accountId) : null;
    const keysDoc = account ? await readAccountKeys(account.accountId) : null;
    const connector = account ? connectorFor(account.provider) : null;
    if (!account || !keysDoc || !connector) return { ok: false, reason: 'no-account', detail: 'This account is not connected.' };
    const refused = modeRefusal(connector, input.mode);
    if (refused) return refused;
    const keys = keysDoc.modes[input.mode];
    if (!keys) return { ok: false, reason: 'no-keys-for-mode', detail: `No keys are held for ${input.mode} mode. Connect with them first.` };
    const test = await connector.testKeys({ mode: input.mode, keys, timeoutMs: CALL_TIMEOUT_MS });
    if (!test.ok) return { ok: false, reason: test.failure, detail: test.detail };
    const updated: AccountDoc = { ...account, ...publicParts(connector, keys), mode: input.mode, updatedAtIso: new Date().toISOString(), updatedBy: input.by };
    await db.collection(ACCOUNTS).doc(account.accountId).update({ ...publicParts(connector, keys), keyExpiresOn: publicParts(connector, keys).keyExpiresOn ?? FieldValue.delete(), mode: input.mode, updatedAtIso: updated.updatedAtIso, updatedBy: input.by });
    await clearAccountProblem(account.accountId, 'key-refused');
    await clearAccountProblem(account.accountId, 'key-expiring');
    return { ok: true, account: publicView({ ...updated, problems: {} }) };
}

/**
 * Remove the keys and the webhook address. A payment still open would be lost from sight, so
 * Arc first tries to end each one, and refuses with `open-payments` if any stays open. With
 * `force`, what stays open is held for a person instead: the money may still come, and only
 * the provider's own account will show it.
 */
export async function disconnectPaymentAccount(input: { accountId: string; by: string; force?: boolean }): Promise<{ ok: true; heldOpen: number } | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    const account = goodAccountId(input?.accountId) ? await readAccount(input.accountId) : null;
    if (!account) return { ok: false, reason: 'no-account', detail: 'This account is not connected.' };
    const { endOpenPayment } = await import('./payments.js');
    const stillOpen: PaymentRecord[] = [];
    for (const record of await openPayments(account.accountId)) {
        const ended = await endOpenPayment(record);
        if (!ended) stillOpen.push(record);
    }
    if (stillOpen.length && !input.force) return { ok: false, reason: 'open-payments', detail: `${stillOpen.length} open payments could not be ended. Try again, or say force to hold them for a person.` };
    for (const record of stillOpen) await holdPayment(record.paymentId, ['disconnected']);
    // A payment still payable beyond these is held by the sweep, which finds it has no keys.
    const batch = db.batch();
    batch.delete(db.collection(ACCOUNT_KEYS).doc(account.accountId));
    batch.delete(db.collection(ACCOUNTS).doc(account.accountId));
    batch.delete(db.collection(WEBHOOKS).doc(account.webhookId));
    await batch.commit();
    return { ok: true, heldOpen: stillOpen.length };
}

/** What a page may read of an account, for an app that serves it from a function. */
export async function readPaymentAccount(accountId: string): Promise<PublicPaymentAccount | null> {
    if (!goodAccountId(accountId)) return null;
    const account = await readAccount(accountId);
    return account ? publicView(account) : null;
}
