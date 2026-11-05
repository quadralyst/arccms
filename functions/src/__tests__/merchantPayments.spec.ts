/**
 * Merchant payments, against the pretend connector with no network: each describe is one of
 * the rules that must always hold (docs/app/merchant-payments.html#rules). Worldline's and
 * Payrexx's own behaviour is in merchantPaymentConnectors.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore() };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({ onRequest: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_options: unknown, handler: unknown) => handler }));

import { logger } from 'firebase-functions/v2';
import { db as initDb } from '../init.js';
import { capturePaymentHooks } from '../merchant-payments/alerts.js';
import { connectPaymentAccount, disconnectPaymentAccount, readPaymentAccount, switchPaymentMode } from '../merchant-payments/accounts.js';
import { runAccountCheck, expiryWord } from '../merchant-payments/checkAccounts.js';
import { connectorFor, offeredModes, paymentConnectors, replaceConnectorForTest, triedModes } from '../merchant-payments/connectors/index.js';
import { PRETEND_KEY_ID_HEADER, PRETEND_REFUSED_KEY, PRETEND_SIGNATURE_HEADER, pretendConnector, pretendSignature } from '../merchant-payments/connectors/pretend.js';
import { processPaymentEvent } from '../merchant-payments/onEvent.js';
import { endPayment, pageAddressProblem, readPayment, refundPayment, resolveHeldPayment, settleRefund, STARTING_MS, startPayment } from '../merchant-payments/payments.js';
import { pretendPayment } from '../merchant-payments/pretendControl.js';
import { holdPayment, MAX_DELIVERY_ATTEMPTS, SILENT_FINISHES_ALERT } from '../merchant-payments/settle.js';
import { paymentIdFor } from '../merchant-payments/store.js';
import { runPaymentSweep, sweepPayment, UNFINISHED_LIMIT_MS } from '../merchant-payments/sweep.js';
import { refusedReason } from '../search/refused.js';
import type { PaymentAlert, PaymentConnector, PaymentResult } from '../merchant-payments/types.js';
import { answerInTime, receivePaymentEvent } from '../merchant-payments/webhook.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';
import { ACCOUNT, connectPretend, everythingButKeys, pretendFields, SECRET, startPretend, WEBHOOK_KEY_ID, WEBHOOK_SECRET } from './helpers/merchantPayments.js';

const db = initDb as unknown as MemoryFirestore;

let results: PaymentResult[];
let alerts: PaymentAlert[];
let hooks: { stop(): void };

/** All events waiting for the trigger, run as it would. */
async function runTrigger(nowMs?: number) {
    for (const { data } of db.all('MerchantPaymentEvents')) await processPaymentEvent(data, nowMs);
}

/** A delivery signed with whatever is given, from these exact bytes. */
function signedRequest(webhookId: string, body: object | string, secret = WEBHOOK_SECRET, keyId = WEBHOOK_KEY_ID) {
    const rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    return { method: 'POST', path: `/${webhookId}`, rawBody, headers: { [PRETEND_SIGNATURE_HEADER]: pretendSignature(rawBody, secret), [PRETEND_KEY_ID_HEADER]: keyId } };
}

const record = (reference = 'order-1') => db.read('MerchantPayments', paymentIdFor(ACCOUNT, reference)) as Record<string, any>;

beforeEach(() => {
    db.store.clear();
    results = [];
    alerts = [];
    hooks = capturePaymentHooks({ onResult: (r) => void results.push(r), onAlert: (a) => void alerts.push(a) });
    vi.clearAllMocks();
});

afterEach(() => {
    hooks.stop();
    replaceConnectorForTest(null);
    vi.unstubAllEnvs();
});

describe('the whole way: connect, start, the buyer pays, the app hears', () => {
    it('reaches the handler with everything the brief names', async () => {
        const account = await connectPretend();
        const started = await startPretend();
        expect(started.pageUrl).toMatch(/^https:\/\/pretend-pay\.arccms\.invalid\/pay\//);
        expect(started.providerId).toBeTruthy();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        expect(results).toEqual([{
            resultId: `${started.paymentId}.paid`,
            paymentId: started.paymentId,
            accountId: ACCOUNT,
            reference: 'order-1',
            status: 'paid',
            amountMinor: 1250,
            currency: 'CHF',
            provider: 'pretend',
            providerId: started.providerId,
            mode: 'test',
            late: false,
        }]);
        expect((await readPaymentAccount(ACCOUNT))?.lastPaymentStatus).toBe('paid');
        expect(account.webhookAddress).toContain('/arccms-merchantPaymentWebhook/');
    });

    it.each(['failed', 'cancelled'] as const)('a %s payment reaches the handler once, and nothing says paid', async (outcome) => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome, processNow: true });
        expect(results.map((r) => r.status)).toEqual([outcome]);
    });

    it('rule 6: the same reference never hands back a test page after a switch to live, nor a closed page', async () => {
        const both: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'both', modes: ['test', 'live'] } };
        replaceConnectorForTest(both);
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'test', fields: pretendFields(), by: 'o' });
        expect(await startPretend()).toMatchObject({ mode: 'test', existing: false });
        expect(await startPretend()).toMatchObject({ mode: 'test', existing: true });
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'live', fields: pretendFields(), by: 'o' });
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'reference-used' });
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'test', fields: pretendFields(), by: 'o' });
        record().closesAtMs = Date.now() - 1;
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'reference-used' });
    });

    it('a stalled start does not write over what came after it: it ends its page and says so', async () => {
        const end = vi.fn(async () => ({ ok: true as const }));
        replaceConnectorForTest({
            ...pretendConnector,
            end,
            start: async (context, input) => {
                const answer = await pretendConnector.start(context, input);
                // While it stalls, a retry takes over and the buyer pays.
                Object.assign(db.read('MerchantPayments', input.paymentId)!, { status: 'paid', createdAtMs: 1 });
                return answer;
            },
        });
        await connectPretend();
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'busy' });
        expect(record().status).toBe('paid');
        expect(end).toHaveBeenCalledOnce();
    });

    it('a start older than the claim can be taken over, a younger one cannot', async () => {
        await connectPretend();
        const id = paymentIdFor(ACCOUNT, 'order-1');
        db.seed('MerchantPayments', id, { paymentId: id, status: 'starting', amountMinor: 100, currency: 'CHF', createdAtMs: Date.now() });
        const input = { accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' };
        expect(await startPayment(input)).toMatchObject({ ok: false, reason: 'busy' });
        db.seed('MerchantPayments', id, { paymentId: id, status: 'starting', amountMinor: 100, currency: 'CHF', createdAtMs: Date.now() - STARTING_MS - 1 });
        expect(await startPayment(input)).toMatchObject({ ok: true, existing: false });
    });

    it('the same reference gives the same open page; another amount or a finished one is refused', async () => {
        await connectPretend();
        const first = await startPretend();
        const again = await startPretend();
        expect(again).toMatchObject({ existing: true, pageUrl: first.pageUrl, providerId: first.providerId });
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 999, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'reference-used' });
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'reference-used' });
    });

    it('takes the page life where the provider allows it, and says when it does not', async () => {
        await connectPretend();
        const answer = await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r2', returnUrl: 'https://a.example/x', lifeMinutes: 15 });
        expect(answer).toMatchObject({ ok: true, lifeFixedByProvider: false });
        if (answer.ok) expect(Date.parse(answer.closesAtIso) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r3', returnUrl: 'https://a.example/x', lifeMinutes: 0 })).toMatchObject({ ok: false, reason: 'bad-input' });
    });

    it.each<[Record<string, unknown>, string]>([
        [{ amountMinor: 12.5 }, 'a fraction'],
        [{ amountMinor: 0 }, 'zero'],
        [{ currency: 'chf' }, 'lower case currency'],
        [{ reference: 'a/b' }, 'a slash in the reference'],
        [{ returnUrl: 'http://a.example/x' }, 'a plain http return'],
        [{ returnUrl: 'https://user:pw@a.example/x' }, 'a return with a password'],
    ])('refuses %j (%s)', async (over) => {
        await connectPretend();
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x', ...over })).toMatchObject({ ok: false, reason: 'bad-input' });
        expect(db.all('MerchantPayments')).toEqual([]);
    });
});

describe('rule 1: no browser ever holds a key', () => {
    it('nothing a page can read holds a secret; it holds the last 4 and who connected', async () => {
        const account = await connectPretend();
        expect(JSON.stringify(account)).not.toContain(SECRET);
        expect(JSON.stringify(account)).not.toContain(WEBHOOK_SECRET);
        expect(JSON.stringify(account)).not.toContain(WEBHOOK_KEY_ID);
        expect(account).toMatchObject({ provider: 'pretend', mode: 'test', publicName: 'My shop', last4: '1234', connectedBy: 'owner-1', problems: {} });
        expect(JSON.stringify(db.read('MerchantAccounts', ACCOUNT))).not.toContain(SECRET);
        expect(JSON.stringify(await readPaymentAccount(ACCOUNT))).not.toContain(SECRET);
    });

    it('a key the provider turns down is not saved', async () => {
        const answer = await connectPaymentAccount({ accountId: ACCOUNT, provider: 'pretend', mode: 'test', fields: pretendFields({ secretKey: PRETEND_REFUSED_KEY }), by: 'o' });
        expect(answer).toMatchObject({ ok: false, reason: 'key-refused' });
        expect(db.read('MerchantAccountKeys', ACCOUNT)).toBeUndefined();
        expect(db.read('MerchantAccounts', ACCOUNT)).toBeUndefined();
    });

    it('a refused replacement leaves the old keys as they were', async () => {
        await connectPretend();
        const answer = await connectPaymentAccount({ accountId: ACCOUNT, provider: 'pretend', mode: 'test', fields: pretendFields({ secretKey: PRETEND_REFUSED_KEY }), by: 'o' });
        expect(answer.ok).toBe(false);
        expect((db.read('MerchantAccountKeys', ACCOUNT) as any).modes.test.secretKey).toBe(SECRET);
    });

    it('a bad field names the field, never the value', async () => {
        const answer = await connectPaymentAccount({ accountId: ACCOUNT, provider: 'pretend', mode: 'test', fields: pretendFields({ secretKey: 'has spaces CANARY' }), by: 'o' });
        expect(answer).toMatchObject({ ok: false, reason: 'bad-field' });
        expect(JSON.stringify(answer)).not.toContain('CANARY');
    });

    it('starting a payment never reads a key from the caller: the server uses its own', async () => {
        await connectPretend();
        const spy = vi.spyOn(pretendConnector, 'start');
        await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x', keys: { secretKey: 'FROM-BROWSER' }, secretKey: 'FROM-BROWSER', fields: { secretKey: 'FROM-BROWSER' } } as never);
        expect(spy.mock.calls[0][0].keys['secretKey']).toBe(SECRET);
        expect(JSON.stringify(spy.mock.calls[0])).not.toContain('FROM-BROWSER');
        spy.mockRestore();
    });

    it('the connector list gives a screen what it needs and no value', () => {
        const pretend = paymentConnectors().find((c) => c.id === 'pretend')!;
        expect(pretend.fields.find((f) => f.id === 'secretKey')).toMatchObject({ secret: true, required: true });
        expect(pretend).toMatchObject({ modes: ['test'], webhookByHand: false, signsEvents: true });
    });
});

describe('rule 2: no secret in an address, and no account named by the sender alone', () => {
    it('the webhook address holds only a random id, which names no account and no key', async () => {
        const { webhookAddress } = await connectPretend();
        const id = webhookAddress.split('/').pop()!;
        expect(id).toMatch(/^[a-f0-9]{32}$/);
        for (const secret of [SECRET, WEBHOOK_SECRET, WEBHOOK_KEY_ID, ACCOUNT]) expect(webhookAddress).not.toContain(secret);
    });

    it('an event signed with a secret of the sender\'s own is refused, and nothing is written', async () => {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        const before = everythingButKeys(db);
        const id = webhookAddress.split('/').pop()!;
        const body = { id: 'evt_forged', type: 'payment.paid', reference: 'order-1' };
        expect((await receivePaymentEvent(signedRequest(id, body, 'MY-OWN-SECRET-123'))).status).toBe(401);
        expect((await receivePaymentEvent(signedRequest(id, body, 'MY-OWN-SECRET-123', 'MY-OWN-KEY-ID'))).status).toBe(401);
        expect((await receivePaymentEvent({ method: 'POST', path: `/${id}`, rawBody: Buffer.from(JSON.stringify(body)), headers: {} })).status).toBe(401);
        expect(everythingButKeys(db)).toBe(before);
        expect(record().status).toBe('open');
    });

    it('another merchant\'s key does not sign for this account', async () => {
        const mine = await connectPretend();
        await connectPretend('business-2', { webhookKeyId: 'KEY-TWO-000', webhookSecret: 'SECRET-TWO-0000' });
        await startPretend();
        const request = signedRequest(mine.webhookAddress.split('/').pop()!, { id: 'e', type: 'x', reference: 'order-1' }, 'SECRET-TWO-0000', 'KEY-TWO-000');
        expect((await receivePaymentEvent(request)).status).toBe(401);
    });

    it('an address no account has is not found', async () => {
        expect((await receivePaymentEvent(signedRequest('0'.repeat(32), { id: 'e', reference: 'r' }))).status).toBe(404);
        expect((await receivePaymentEvent(signedRequest('../MerchantAccountKeys/x', { id: 'e', reference: 'r' }))).status).toBe(404);
    });

    it('a disconnected account\'s address stops working', async () => {
        const { webhookAddress } = await connectPretend();
        await disconnectPaymentAccount({ accountId: ACCOUNT, by: 'o' });
        expect((await receivePaymentEvent(signedRequest(webhookAddress.split('/').pop()!, { id: 'e', reference: 'r' }))).status).toBe(404);
    });
});

describe('rule 3: the signature is over the exact bytes, before anything is read', () => {
    async function ready() {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        return webhookAddress.split('/').pop()!;
    }

    it('one changed byte is refused, and the body is not even parsed', async () => {
        const id = await ready();
        const request = signedRequest(id, { id: 'e1', type: 'payment.paid', reference: 'order-1' });
        request.rawBody = Buffer.from(request.rawBody.toString().replace('order-1', 'order-2'));
        const parse = vi.spyOn(pretendConnector, 'parseEvent');
        expect((await receivePaymentEvent(request)).status).toBe(401);
        expect(parse).not.toHaveBeenCalled();
        parse.mockRestore();
        expect(db.all('MerchantPaymentEvents')).toEqual([]);
    });

    it('bytes a parser would change still pass: spaces and key order are the signer\'s', async () => {
        const id = await ready();
        const odd = `{ "reference":"order-1",\n  "type" : "payment.paid", "id":"e2" }`;
        expect((await receivePaymentEvent(signedRequest(id, odd))).status).toBe(200);
        expect(db.all('MerchantPaymentEvents')).toHaveLength(1);
    });

    it('with no raw bytes nothing is put back together: refused', async () => {
        const id = await ready();
        const verify = vi.spyOn(pretendConnector, 'verifyEvent' as keyof PaymentConnector as 'parseEvent');
        expect((await receivePaymentEvent({ method: 'POST', path: `/${id}`, headers: {} })).status).toBe(400);
        expect(verify).not.toHaveBeenCalled();
        verify.mockRestore();
    });
});

describe('rule 4: an event is never enough to say paid', () => {
    it('a properly signed "paid" with the provider saying otherwise changes nothing', async () => {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        const request = signedRequest(webhookAddress.split('/').pop()!, { id: 'e1', type: 'payment.paid', reference: 'order-1' });
        expect((await receivePaymentEvent(request)).status).toBe(200);
        await runTrigger();
        expect(record().status).toBe('open');
        expect(results).toEqual([]);
    });

    it.each([
        ['wrong-amount', ['amount']],
        ['wrong-currency', ['currency']],
        ['wrong-reference', ['reference']],
    ] as const)('%s: held for a person, never paid, and the app is told once', async (outcome, reasons) => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome, processNow: true });
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(reasons);
        expect(results).toEqual([]);
        expect(alerts).toEqual([expect.objectContaining({ type: 'payment-held', reference: 'order-1', reasons })]);
        expect(await readPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ status: 'held', heldReasons: reasons });
        // A later read, or the sweep, changes nothing and says nothing twice.
        await runPaymentSweep(Date.now() + 3_600_000);
        expect(record().status).toBe('held');
        expect(alerts).toHaveLength(1);
    });

    it('paid with no amount, currency or reference read back is held, not believed', async () => {
        const silent: PaymentConnector = { ...pretendConnector, read: async () => ({ ok: true, state: 'paid', providerStatus: 'paid', mode: 'test' }) };
        replaceConnectorForTest(silent);
        await connectPretend();
        await startPretend();
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['amount', 'currency', 'reference']);
    });

    it('a person decides a held payment; the app hears who', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'wrong-amount', processNow: true });
        expect(await resolveHeldPayment({ accountId: ACCOUNT, reference: 'order-1', as: 'paid', by: 'owner-1' })).toMatchObject({ status: 'paid' });
        expect(results).toEqual([expect.objectContaining({ status: 'paid', amountMinor: 1251, resolvedBy: 'owner-1' })]);
        expect(await resolveHeldPayment({ accountId: ACCOUNT, reference: 'order-1', as: 'cancelled', by: 'owner-1' })).toMatchObject({ ok: false, reason: 'not-held' });
    });
});

describe('rule 5: paid means the money is secured', () => {
    it.each(['waiting', 'waiting-approval', 'authorized'] as const)('%s is not paid', async (outcome) => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome, processNow: true });
        expect(record().status).toBe('open');
        expect(results).toEqual([]);
    });

    it('a charge taken back on an open payment is held for a person', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'charged-back', processNow: true });
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['provider-status']);
    });

    it('neither real connector is on the list before its proof', () => {
        expect(connectorFor('worldline-connect')?.info.proven).toBe(false);
        expect(connectorFor('payrexx')?.info.proven).toBe(false);
    });
});

describe('rule 6: no fallback, ever', () => {
    it('a merchant with no keys is refused with a plain reason', async () => {
        expect(await startPayment({ accountId: 'nobody', amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'no-account', detail: expect.stringContaining('not connected') });
        expect(db.all('MerchantPayments')).toEqual([]);
    });

    it.each(['.', '..', '__reserved__', 'a/b', 'has space', ''])('an account id Firestore could not hold is refused: "%s"', async (accountId) => {
        expect(await connectPaymentAccount({ accountId, provider: 'pretend', mode: 'test', fields: pretendFields(), by: 'o' })).toMatchObject({ ok: false, reason: 'bad-input' });
        expect(await startPayment({ accountId, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'bad-input' });
    });

    it('half an account is refused: account with no keys, a required field missing', async () => {
        await connectPretend();
        await db.collection('MerchantAccountKeys').doc(ACCOUNT).delete();
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'account-incomplete' });
        await connectPretend();
        const keys = db.read('MerchantAccountKeys', ACCOUNT) as any;
        delete keys.modes.test.webhookSecret;
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'account-incomplete' });
    });

    it('keys of one mode never serve the other', async () => {
        const live: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'both', modes: ['test', 'live'], fields: pretendConnector.info.fields } };
        replaceConnectorForTest(live);
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'test', fields: pretendFields(), by: 'o' });
        expect(await switchPaymentMode({ accountId: ACCOUNT, mode: 'live', by: 'o' })).toMatchObject({ ok: false, reason: 'no-keys-for-mode' });
        (db.read('MerchantAccounts', ACCOUNT) as any).mode = 'live';
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'account-incomplete' });
    });

    it('an open payment reads with its own mode\'s keys after the account switches', async () => {
        const both: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'both', modes: ['test', 'live'] }, read: vi.fn(async () => ({ ok: true as const, state: 'open' as const, providerStatus: 'waiting' })) };
        replaceConnectorForTest(both);
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'test', fields: pretendFields({ secretKey: 'TESTKEY-00001' }), by: 'o' });
        await startPretend();
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'live', fields: pretendFields({ secretKey: 'LIVEKEY-00001' }), by: 'o' });
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        const context = vi.mocked(both.read).mock.calls[0][0];
        expect(context.mode).toBe('test');
        expect(context.keys['secretKey']).toBe('TESTKEY-00001');
    });

    it('a payment read back from the other system is held, never counted as money', async () => {
        const both: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'both', modes: ['test', 'live'] }, read: async () => ({ ok: true, state: 'paid', providerStatus: 'paid', amountMinor: 1250, currency: 'CHF', reference: 'order-1', mode: 'test' }) };
        replaceConnectorForTest(both);
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'live', fields: pretendFields(), by: 'o' });
        await startPretend();
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['mode']);
        expect(results).toEqual([]);
    });

    it('the pretend provider cannot be live, and is not there unless allowed', async () => {
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'pretend', mode: 'live', fields: pretendFields(), by: 'o' })).toMatchObject({ ok: false, reason: 'mode-not-supported' });
        expect(offeredModes(pretendConnector, {})).toEqual([]);
        expect(offeredModes(pretendConnector, { ARC_PAYMENTS_PRETEND: 'on' })).toEqual(['test']);
        expect(offeredModes(pretendConnector, { FUNCTIONS_EMULATOR: 'true' })).toEqual(['test']);
        expect(paymentConnectors({}).map((c) => c.id)).toEqual([]);
    });

    it('an unproven connector cannot be picked; a project trying one gets only the mode it names', async () => {
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'worldline-connect', mode: 'test', fields: {}, by: 'o' })).toMatchObject({ ok: false, reason: 'not-offered' });
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'nobody', mode: 'test', fields: {}, by: 'o' })).toMatchObject({ ok: false, reason: 'not-offered' });
        const worldline = connectorFor('worldline-connect')!;
        const payrexx = connectorFor('payrexx')!;
        expect(offeredModes(worldline, { ARC_PAYMENTS_TRY: 'worldline-connect' })).toEqual(['test']);
        expect(offeredModes(worldline, { ARC_PAYMENTS_TRY: 'worldline-connect:live' })).toEqual(['live']);
        expect(offeredModes(worldline, { ARC_PAYMENTS_TRY: 'payrexx:live' })).toEqual([]);
        expect(offeredModes(payrexx, { ARC_PAYMENTS_TRY: 'payrexx' })).toEqual([]);
        expect(offeredModes(payrexx, { ARC_PAYMENTS_TRY: ' worldline-connect , payrexx:live ' })).toEqual(['live']);
        expect(triedModes('payrexx', { ARC_PAYMENTS_TRY: 'payrexx:staging' })).toEqual([]);
        expect(paymentConnectors({ ARC_PAYMENTS_TRY: 'worldline-connect' })).toEqual([expect.objectContaining({ id: 'worldline-connect', modes: ['test'], trying: true })]);
    });

    it('taking a project off the trial stops new payments on it', async () => {
        await db.collection('MerchantAccounts').doc(ACCOUNT).set({ accountId: ACCOUNT, provider: 'worldline-connect', mode: 'test' });
        await db.collection('MerchantAccountKeys').doc(ACCOUNT).set({ provider: 'worldline-connect', modes: { test: { merchantId: '1', apiKeyId: 'aaaa', secretApiKey: 'bbbbbbbb', webhookKeyId: 'cccc', webhookSecret: 'dddddddd', pageSubdomain: 'x', countryCode: 'CH' } } });
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'not-offered' });
    });

    it('a test result always says test', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        expect(results[0].mode).toBe('test');
    });
});

describe('rule 7: once, in any order', () => {
    it('the same event twice is written once and heard once', async () => {
        await connectPretend();
        await startPretend();
        const answer = await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'twice', processNow: true });
        expect(answer).toMatchObject({ ok: true, answers: [{ status: 200, body: 'Received' }, { status: 200, body: 'Already received' }] });
        expect(db.all('MerchantPaymentEvents')).toHaveLength(1);
        await runTrigger();
        await runPaymentSweep(Date.now() + 3_600_000);
        expect(results).toHaveLength(1);
    });

    it('paid never goes back: failed, cancelled or still-open reads after paid change nothing', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        for (const outcome of ['failed', 'cancelled', 'waiting'] as const) {
            await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome, processNow: true });
            await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
            expect(record().status).toBe('paid');
        }
        expect(results.map((r) => r.status)).toEqual(['paid']);
        expect(record().nextCheckAtMs).toBeUndefined();
    });

    it('events out of order settle on what the provider says now', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        const { webhookAddress } = (await readPaymentAccount(ACCOUNT))!;
        const id = webhookAddress.split('/').pop()!;
        await receivePaymentEvent(signedRequest(id, { id: 'e-newer', type: 'payment.paid', reference: 'order-1' }));
        await receivePaymentEvent(signedRequest(id, { id: 'e-older', type: 'payment.created', reference: 'order-1' }));
        await runTrigger();
        expect(results.map((r) => r.status)).toEqual(['paid']);
    });

    it('a late event for a payment already final records no event', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        const count = db.all('MerchantPaymentEvents').length;
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid' });
        expect(db.all('MerchantPaymentEvents')).toHaveLength(count);
    });

    it('a late event says an event arrived, once, however many come', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        expect(record().eventSeen).toBe(false);

        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid' });
        expect(record().eventSeen).toBe(true);
        expect(await readPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ status: 'paid', eventSeen: true });

        // Each doc() is a new object, so every one is watched: a further event writes nothing to the record.
        const written: string[] = [];
        const realDoc = db.doc.bind(db);
        const watched = vi.spyOn(db, 'doc').mockImplementation((name: string, id: string) => {
            const ref = realDoc(name, id);
            return { ...ref, update: (data: Record<string, unknown>) => (written.push(name), ref.update(data)) };
        });
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid' });
        watched.mockRestore();
        expect(written).not.toContain('MerchantPayments');
        expect(results.map((r) => r.status)).toEqual(['paid']);
    });

    it('a handler that throws hears it again from the sweep, with the same resultId, and the sweep stops once it took it', async () => {
        hooks.stop();
        const seen: string[] = [];
        let fail = true;
        hooks = capturePaymentHooks({ onResult: (r) => { seen.push(r.resultId); if (fail) throw new Error('app down'); } });
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        expect(seen).toHaveLength(1);
        expect(record().pending).toHaveLength(1);
        expect(record().deliveryAttempts).toBe(1);
        fail = false;
        await runPaymentSweep(Date.now() + 3_600_000);
        expect(seen).toHaveLength(2);
        expect(seen[0]).toBe(seen[1]);
        expect(record().pending).toEqual([]);
        expect(record().deliveryNextAtMs).toBeUndefined();
        await runPaymentSweep(Date.now() + 7_200_000);
        expect(seen).toHaveLength(2);
    });

    it('a handler that goes on failing raises an alert, once', async () => {
        hooks.stop();
        const told: PaymentAlert[] = [];
        hooks = capturePaymentHooks({ onResult: () => { throw new Error('app down'); }, onAlert: (a) => void told.push(a) });
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        for (let i = 1; i <= MAX_DELIVERY_ATTEMPTS + 1; i++) await runPaymentSweep(Date.now() + i * 2 * 3_600_000);
        expect(told.filter((a) => a.type === 'delivery-failed')).toHaveLength(1);
        expect(record().pending).toHaveLength(1);
    });

    it('two instances never deliver at once: a fresh claim makes the second stop', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        record().deliveryClaimedAtMs = Date.now();
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        expect(results).toEqual([]);
        expect(record().pending).toHaveLength(1);
    });
});

describe('flooding with unsigned events', () => {
    const unsigned = () => {
        replaceConnectorForTest({ ...pretendConnector, verifyEvent: undefined, info: { ...pretendConnector.info, signsEvents: false } });
    };

    it('prompts one read at a time, and the next waits for the sweep', async () => {
        unsigned();
        await connectPretend();
        await startPretend();
        const read = vi.spyOn(connectorFor('pretend')!, 'read');
        const event = { paymentId: record().paymentId, accountId: ACCOUNT };
        const now = Date.now();
        await processPaymentEvent(event, now);
        await processPaymentEvent(event, now + 1000);
        await processPaymentEvent(event, now + 2000);
        expect(read).toHaveBeenCalledOnce();
        expect(record().nextCheckAtMs).toBe(now + 32_000);
        await processPaymentEvent(event, now + 31_000);
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('a signed provider\'s events are read every time: they cannot be forged', async () => {
        await connectPretend();
        await startPretend();
        const read = vi.spyOn(pretendConnector, 'read');
        const event = { paymentId: record().paymentId, accountId: ACCOUNT };
        await processPaymentEvent(event);
        await processPaymentEvent(event);
        expect(read).toHaveBeenCalledTimes(2);
        read.mockRestore();
    });

    it('old event records all go, however many', async () => {
        await connectPretend();
        for (let i = 0; i < 1000; i++) db.seed('MerchantPaymentEvents', `e${i}`, { receivedAtMs: 0 });
        expect((await runAccountCheck()).eventsCleared).toBe(1000);
    });
});

describe('collections an admin\'s search settings can never sample', () => {
    it.each(['AiKeys', 'MerchantAccountKeys', 'MerchantWebhooks', 'MerchantAccounts', 'MerchantPayments', 'MerchantPaymentEvents', 'MerchantPretendPayments'])('%s', (collection) => {
        expect(refusedReason(collection)).toBeTruthy();
    });
});

describe('rule 8: answer inside 10 seconds, record first', () => {
    it('the webhook answers without calling the provider or the app', async () => {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        const read = vi.spyOn(pretendConnector, 'read');
        await db.collection('MerchantPretendPayments').doc((record().providerId as string)).set({ providerStatus: 'paid' }, { merge: true });
        const answer = await receivePaymentEvent(signedRequest(webhookAddress.split('/').pop()!, { id: 'e1', type: 'x', reference: 'order-1' }));
        expect(answer.status).toBe(200);
        expect(read).not.toHaveBeenCalled();
        expect(results).toEqual([]);
        expect(db.all('MerchantPaymentEvents')).toHaveLength(1);
        read.mockRestore();
    });

    it('a database that hangs gets a 503 in time, so the provider sends it again', async () => {
        const collection = vi.spyOn(db, 'collection').mockImplementation((() => ({ doc: () => ({ get: () => new Promise(() => undefined) }) })) as never);
        const started = Date.now();
        const answer = await answerInTime({ method: 'POST', path: `/${'a'.repeat(32)}`, headers: {}, rawBody: Buffer.from('{}') }, 30);
        collection.mockRestore();
        expect(answer.status).toBe(503);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('a database failure answers 503, not 200: the event is not lost', async () => {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        const request = signedRequest(webhookAddress.split('/').pop()!, { id: 'e1', type: 'x', reference: 'order-1' });
        const real = db.collection.bind(db);
        const collection = vi.spyOn(db, 'collection').mockImplementation(((name: string) => {
            if (name !== 'MerchantPaymentEvents') return real(name);
            return { doc: () => ({ create: async () => { throw Object.assign(new Error('down'), { code: 14 }); } }) };
        }) as never);
        expect((await answerInTime(request)).status).toBe(503);
        collection.mockRestore();
    });
});

describe('rule 9: nothing secret or personal in a log or a record', () => {
    it('after a whole life of a payment, no secret is outside the keys\' own collection, nor in any log or hook', async () => {
        const seen: unknown[] = [];
        hooks.stop();
        hooks = capturePaymentHooks({ onResult: (r) => void seen.push(r), onAlert: (a) => void seen.push(a) });
        const { webhookAddress } = await connectPretend();
        await startPretend();
        await receivePaymentEvent(signedRequest(webhookAddress.split('/').pop()!, { id: 'bad', reference: 'order-1' }, 'WRONG-SECRET-0000'));
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' });
        await runAccountCheck();
        const logged = JSON.stringify([vi.mocked(logger.warn).mock.calls, vi.mocked(logger.error).mock.calls, vi.mocked(logger.info).mock.calls]);
        for (const text of [everythingButKeys(db), logged, JSON.stringify(seen)]) {
            for (const secret of [SECRET, WEBHOOK_SECRET, WEBHOOK_KEY_ID]) expect(text).not.toContain(secret);
        }
    });

    it('an event record keeps only what finding the payment needs, no raw event', async () => {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        await receivePaymentEvent(signedRequest(webhookAddress.split('/').pop()!, { id: 'e1', type: 'payment.paid', reference: 'order-1', customer: { email: 'buyer@example.com', card: '4111111111111111' } }));
        const [{ data }] = db.all('MerchantPaymentEvents');
        expect(Object.keys(data).sort()).toEqual(['accountId', 'paymentId', 'provider', 'receivedAtMs', 'type']);
        expect(everythingButKeys(db)).not.toContain('buyer@example.com');
        expect(everythingButKeys(db)).not.toContain('4111111111111111');
    });

    it('event records are cleared after 7 days', async () => {
        const { webhookAddress } = await connectPretend();
        await startPretend();
        await receivePaymentEvent(signedRequest(webhookAddress.split('/').pop()!, { id: 'e1', type: 'x', reference: 'order-1' }));
        expect((await runAccountCheck(Date.now() + 6 * 86_400_000)).eventsCleared).toBe(0);
        expect((await runAccountCheck(Date.now() + 8 * 86_400_000)).eventsCleared).toBe(1);
        expect(db.all('MerchantPaymentEvents')).toEqual([]);
    });
});

describe('rule 10: a key can expire, and the app is told', () => {
    const day = 86_400_000;
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    it('warns at 30, 7 and 1 days and when it has ended, each once', async () => {
        const now = Date.parse('2026-11-05T06:00:00Z');
        await connectPretend(ACCOUNT, { keyExpiresOn: iso(now + 40 * day) });
        await runAccountCheck(now);
        expect(alerts).toEqual([]);
        // The key ends on day 40: 31 days left on day 10, then down through each warning.
        for (const offset of [10, 11, 12, 34, 35, 40, 41, 42]) await runAccountCheck(now + offset * day);
        const words = alerts.filter((a) => a.type === 'key-expiring').map((a) => a.daysLeft);
        expect(words).toEqual([30, 7, 1, 0]);
        expect((await readPaymentAccount(ACCOUNT))?.problems['key-expiring']).toContain('ended');
    });

    it('reads a date only if it is one', () => {
        expect(expiryWord('not-a-date', Date.now())).toBeNull();
        expect(expiryWord('2026-12-31', Date.parse('2026-01-01'))).toBeNull();
    });

    it('a key the provider now refuses is told once by the daily check, and cleared by new keys', async () => {
        await connectPretend();
        (db.read('MerchantAccountKeys', ACCOUNT) as any).modes.test.secretKey = PRETEND_REFUSED_KEY;
        await runAccountCheck();
        await runAccountCheck();
        expect(alerts.filter((a) => a.type === 'key-refused')).toHaveLength(1);
        expect((await readPaymentAccount(ACCOUNT))?.problems['key-refused']).toBeTruthy();
        await connectPretend();
        expect((await readPaymentAccount(ACCOUNT))?.problems).toEqual({});
    });

    it('a key refused while starting a payment tells the app at once', async () => {
        await connectPretend();
        (db.read('MerchantAccountKeys', ACCOUNT) as any).modes.test.secretKey = PRETEND_REFUSED_KEY;
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'key-refused' });
        expect(alerts).toEqual([expect.objectContaining({ type: 'key-refused', accountId: ACCOUNT })]);
        expect(db.all('MerchantPayments')).toEqual([]);
    });

    it('an alert the app could not take is said again next time', async () => {
        hooks.stop();
        let fail = true;
        const told: string[] = [];
        hooks = capturePaymentHooks({ onAlert: (a) => { told.push(a.type); if (fail) throw new Error('down'); } });
        await connectPretend();
        (db.read('MerchantAccountKeys', ACCOUNT) as any).modes.test.secretKey = PRETEND_REFUSED_KEY;
        await runAccountCheck();
        fail = false;
        await runAccountCheck();
        await runAccountCheck();
        expect(told).toEqual(['key-refused', 'key-refused']);
    });

    it(`a webhook that has gone silent: ${SILENT_FINISHES_ALERT} payments found finished by the sweep, told once; an event clears it`, async () => {
        const later = Date.now() + 3_600_000;
        const { webhookAddress } = await connectPretend();
        for (let i = 1; i <= SILENT_FINISHES_ALERT + 1; i++) {
            await startPretend(`order-${i}`);
            await pretendPayment({ accountId: ACCOUNT, reference: `order-${i}`, outcome: 'paid', deliver: 'none' });
            await runPaymentSweep(later);
        }
        expect(alerts.filter((a) => a.type === 'webhook-silent')).toHaveLength(1);
        expect((await readPaymentAccount(ACCOUNT))?.problems['webhook-silent']).toBeTruthy();
        await startPretend('order-next');
        await receivePaymentEvent(signedRequest(webhookAddress.split('/').pop()!, { id: 'e-back', type: 'x', reference: 'order-next' }));
        await runTrigger(later);
        expect((await readPaymentAccount(ACCOUNT))?.problems['webhook-silent']).toBeUndefined();
    });
});

describe('rule 10: a webhook that is off, when the app reads every payment itself', () => {
    const finishByPolling = async (reference: string) => {
        await startPretend(reference);
        await pretendPayment({ accountId: ACCOUNT, reference, outcome: 'paid', deliver: 'none' });
        await readPayment({ accountId: ACCOUNT, reference });
    };

    it(`is noticed after ${SILENT_FINISHES_ALERT}, as an app reading payments itself finishes them before any sweep`, async () => {
        await connectPretend();
        for (const reference of ['a', 'b', 'c']) await finishByPolling(reference);
        expect(alerts.filter((a) => a.type === 'webhook-silent')).toHaveLength(1);
    });

    it('a working webhook whose event comes after the app already read paid raises nothing, and clears what was said', async () => {
        await connectPretend();
        for (const reference of ['a', 'b', 'c', 'd', 'e']) {
            await finishByPolling(reference);
            // Its event arrives a moment later, for a payment already final.
            expect(await pretendPayment({ accountId: ACCOUNT, reference, outcome: 'paid' })).toMatchObject({ ok: true, answers: [{ status: 200 }] });
        }
        expect(alerts.filter((a) => a.type === 'webhook-silent')).toEqual([]);
        expect((db.read('MerchantAccounts', ACCOUNT) as any).silentFinishes).toBe(0);
    });

    it('an event for a final payment still clears a silence already told', async () => {
        await connectPretend();
        for (const reference of ['a', 'b', 'c']) await finishByPolling(reference);
        expect((await readPaymentAccount(ACCOUNT))?.problems['webhook-silent']).toBeTruthy();
        await pretendPayment({ accountId: ACCOUNT, reference: 'c', outcome: 'paid' });
        expect((await readPaymentAccount(ACCOUNT))?.problems['webhook-silent']).toBeUndefined();
    });
});

describe('rule 11: the payment page is on the provider\'s own domain', () => {
    const context = { mode: 'live' as const, keys: { instance: 'myshop' } };
    const payrexx = () => connectorFor('payrexx')!;
    const worldline = () => connectorFor('worldline-connect')!;

    it.each([
        ['https://myshop.payrexx.com/de/?payment=abc', null],
        ['https://MYSHOP.payrexx.com/de/?payment=abc', null],
        ['https://other.payrexx.com/?payment=abc', 'on another domain'],
        ['https://myshop.payrexx.com.evil.example/', 'on another domain'],
        ['https://evil.example/myshop.payrexx.com', 'on another domain'],
        ['http://myshop.payrexx.com/', 'not https'],
        ['https://user:pw@myshop.payrexx.com/', 'an address with credentials or a port'],
        ['https://myshop.payrexx.com:8443/', 'an address with credentials or a port'],
        ['javascript:alert(1)', 'not https'],
        ['not an address', 'not an address'],
        [undefined, 'no address'],
    ])('Payrexx: %s', (url, problem) => {
        expect(pageAddressProblem(url, payrexx(), context)).toBe(problem);
    });

    it.each([
        ['https://pay.pay1.checkout.worldline-solutions.com/checkout/1', 'live', null],
        ['https://pay.pay1.preprod.checkout.worldline-solutions.com/checkout/1', 'test', null],
        ['https://pay.pay1.preprod.checkout.worldline-solutions.com/checkout/1', 'live', 'on the provider\'s other system'],
        ['https://worldline-solutions.com.evil.example/', 'live', 'on another domain'],
        ['https://evilworldline-solutions.com/', 'live', 'on another domain'],
    ] as const)('Worldline: %s in %s', (url, mode, problem) => {
        expect(pageAddressProblem(url, worldline(), { mode, keys: {} })).toBe(problem);
    });

    it('a page on another domain is refused, ended, and leaves no record, and the reference can be tried again', async () => {
        const end = vi.fn(async () => ({ ok: true as const }));
        const start = vi.fn(async () => ({ ok: true as const, providerId: 'p1', pageUrl: 'https://evil.example/pay', lifeMinutes: 15 }));
        replaceConnectorForTest({ ...pretendConnector, start, end });
        await connectPretend();
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'bad-page-address' });
        expect(end).toHaveBeenCalledOnce();
        expect(db.all('MerchantPayments')).toEqual([]);
    });
});

describe('reading and ending', () => {
    it('reads the provider now, and says when it could not', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        expect(await readPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ status: 'paid', checked: true });
        expect(await readPayment({ accountId: ACCOUNT, reference: 'nope' })).toMatchObject({ ok: false, reason: 'not-found' });

        replaceConnectorForTest({ ...pretendConnector, read: async () => ({ ok: false, failure: 'unavailable', detail: 'down' }) });
        await startPretend('order-2');
        expect(await readPayment({ accountId: ACCOUNT, reference: 'order-2' })).toMatchObject({ status: 'open', checked: false, detail: 'down' });
    });

    it('ending a page cancels it, and the app hears', async () => {
        await connectPretend();
        await startPretend();
        expect(await endPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ status: 'cancelled' });
        expect(results.map((r) => r.status)).toEqual(['cancelled']);
    });

    it('ending a page the buyer just paid says paid, not cancelled', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        expect(await endPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ status: 'paid' });
        expect(results.map((r) => r.status)).toEqual(['paid']);
    });

    it('paid after failed is late too, as the app has already heard failed', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'failed', processNow: true });
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        expect(results.map((r) => [r.status, r.late])).toEqual([['failed', false], ['paid', true]]);
    });

    it('a late payment held for a mismatch stays late when a person decides it', async () => {
        await connectPretend();
        await startPretend();
        await endPayment({ accountId: ACCOUNT, reference: 'order-1' });
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'wrong-amount', processNow: true });
        await resolveHeldPayment({ accountId: ACCOUNT, reference: 'order-1', as: 'paid', by: 'o' });
        expect(results.map((r) => [r.status, r.late])).toEqual([['cancelled', false], ['paid', true]]);
    });

    it('the try that paid is the one a refund goes to', async () => {
        const reads = [{ id: 'try-1', status: 'waiting' }, { id: 'try-2', status: 'paid' }];
        let at = 0;
        replaceConnectorForTest({
            ...pretendConnector,
            read: async () => {
                const r = reads[Math.min(at++, 1)];
                return { ok: true, state: r.status === 'paid' ? 'paid' : 'open', providerStatus: r.status, amountMinor: 1250, currency: 'CHF', reference: 'order-1', mode: 'test', providerPaymentId: r.id };
            },
        });
        await connectPretend();
        await startPretend();
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        expect(record().providerPaymentId).toBe('try-1');
        await readPayment({ accountId: ACCOUNT, reference: 'order-1' });
        expect(record().providerPaymentId).toBe('try-2');
    });

    it('money that comes after the page was ended reaches the app as late, not lost', async () => {
        await connectPretend();
        await startPretend();
        await endPayment({ accountId: ACCOUNT, reference: 'order-1' });
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        await runPaymentSweep(Date.now() + 5 * 60_000);
        expect(results.map((r) => [r.status, r.late])).toEqual([['cancelled', false], ['paid', true]]);
        expect(results[1].resultId).not.toBe(results[0].resultId);
        expect(await readPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ status: 'paid', late: true });
    });
});

describe('the sweep', () => {
    it('a lost webhook recovers with no browser', async () => {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        const swept = await runPaymentSweep(Date.now() + 3 * 60_000);
        expect(swept.read).toBe(1);
        expect(results.map((r) => r.status)).toEqual(['paid']);
        expect(record().nextCheckAtMs).toBeUndefined();
    });

    it('does not read before a payment is due, and reads further apart each time', async () => {
        const start = Date.now();
        await connectPretend();
        await startPretend();
        expect((await runPaymentSweep(start)).read).toBe(0);
        await runPaymentSweep(start + 3 * 60_000);
        const first = record().nextCheckAtMs - (start + 3 * 60_000);
        await runPaymentSweep(record().nextCheckAtMs);
        const at = record().checks;
        expect(at).toBe(2);
        expect(first).toBe(4 * 60_000);
    });

    it('a page whose life is over and that nobody paid is closed, and the app hears cancelled', async () => {
        await connectPretend();
        const started = await startPretend();
        const closes = Date.parse(started.closesAtIso);
        await runPaymentSweep(closes + 11 * 60_000);
        expect(record().status).toBe('cancelled');
        expect(results.map((r) => r.status)).toEqual(['cancelled']);
        expect(record().nextCheckAtMs).toBeUndefined();
    });

    it('goes on trying while the provider cannot answer, past the page\'s life', async () => {
        replaceConnectorForTest({ ...pretendConnector, read: async () => ({ ok: false, failure: 'unavailable', detail: 'down' }) });
        await connectPretend();
        const started = await startPretend();
        await runPaymentSweep(Date.parse(started.closesAtIso) + 3_600_000);
        expect(record().status).toBe('open');
        expect(record().nextCheckAtMs).toBeGreaterThan(0);
    });

    it('a payment under way at the close is not closed as unpaid: read on, then held for a person', async () => {
        await connectPretend();
        const started = await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'authorized', deliver: 'none' });
        const closes = Date.parse(started.closesAtIso);
        await runPaymentSweep(closes + 11 * 60_000);
        expect(record().status).toBe('open');
        expect(results).toEqual([]);
        // The money comes through a day later, with the webhook lost: nothing is missed.
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        await runPaymentSweep(closes + 86_400_000);
        expect(results.map((r) => [r.status, r.late])).toEqual([['paid', false]]);
    });

    it('still under way after the limit: held, not cancelled', async () => {
        await connectPretend();
        const started = await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'authorized', deliver: 'none' });
        await runPaymentSweep(Date.parse(started.closesAtIso) + UNFINISHED_LIMIT_MS + 60_000);
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['provider-status']);
        expect(results).toEqual([]);
    });

    it('a provider unreadable past the limit: held, not left open for ever', async () => {
        replaceConnectorForTest({ ...pretendConnector, read: async () => ({ ok: false, failure: 'unavailable', detail: 'down' }) });
        await connectPretend();
        const started = await startPretend();
        await runPaymentSweep(Date.parse(started.closesAtIso) + UNFINISHED_LIMIT_MS + 60_000);
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['provider-unread']);
    });

    it('an ended page the provider can no longer read is read on until its life is over, and late money found', async () => {
        await connectPretend();
        const started = await startPretend();
        await endPayment({ accountId: ACCOUNT, reference: 'order-1' });
        await runPaymentSweep(Date.now() + 5 * 60_000);
        expect(record().nextCheckAtMs).toBeGreaterThan(0);
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        await runPaymentSweep(Date.now() + 40 * 60_000);
        expect(results.map((r) => [r.status, r.late])).toEqual([['cancelled', false], ['paid', true]]);
        expect(Date.parse(started.closesAtIso)).toBeGreaterThan(0);
    });

    it('a cancelled payment read past its close goes on while the provider cannot answer', async () => {
        await connectPretend();
        const started = await startPretend();
        await endPayment({ accountId: ACCOUNT, reference: 'order-1' });
        replaceConnectorForTest({ ...pretendConnector, read: async () => ({ ok: false, failure: 'unavailable', detail: 'down' }) });
        const later = Date.parse(started.closesAtIso) + 3_600_000;
        await runPaymentSweep(later);
        expect(record().nextCheckAtMs).toBeGreaterThan(later);
        replaceConnectorForTest(null);
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', deliver: 'none' });
        await runPaymentSweep(later + 3_600_000);
        expect(record().status).toBe('paid');
    });

    it('a stale look at a crashed start deletes nothing that has since opened', async () => {
        await connectPretend();
        await startPretend();
        const stale = { ...record(), status: 'starting' as const, createdAtMs: 0 };
        await sweepPayment(stale as never, Date.now());
        expect(record().status).toBe('open');
    });

    it('a start that crashed is cleared', async () => {
        await connectPretend();
        const id = paymentIdFor(ACCOUNT, 'crashed');
        db.seed('MerchantPayments', id, { paymentId: id, accountId: ACCOUNT, reference: 'crashed', provider: 'pretend', status: 'starting', createdAtMs: 0, closesAtMs: 0, nextCheckAtMs: 1 });
        await runPaymentSweep(Date.now());
        expect(db.read('MerchantPayments', id)).toBeUndefined();
    });
});

describe('replace, switch and disconnect', () => {
    it('replacing keeps the address the owner already added; a new provider gets a new one', async () => {
        const first = await connectPretend();
        const replaced = await connectPretend(ACCOUNT, { secretKey: 'NEWSECRET-9999' });
        expect(replaced.webhookAddress).toBe(first.webhookAddress);
        expect(replaced.last4).toBe('9999');
        const other: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'other' } };
        replaceConnectorForTest(other);
        const moved = await connectPaymentAccount({ accountId: ACCOUNT, provider: 'other', mode: 'test', fields: pretendFields(), by: 'o' });
        expect(moved.ok && moved.account.webhookAddress).not.toBe(first.webhookAddress);
        expect(db.all('MerchantWebhooks')).toHaveLength(1);
    });

    it('a new provider is refused while a payment on the old one is open', async () => {
        await connectPretend();
        await startPretend();
        replaceConnectorForTest({ ...pretendConnector, info: { ...pretendConnector.info, id: 'other' } });
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'other', mode: 'test', fields: pretendFields(), by: 'o' })).toMatchObject({ ok: false, reason: 'open-payments' });
    });

    it('switching tries the held keys first', async () => {
        const both: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'both', modes: ['test', 'live'] } };
        replaceConnectorForTest(both);
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'live', fields: pretendFields({ accountName: 'Live' }), by: 'o' });
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'test', fields: pretendFields({ accountName: 'Test' }), by: 'o' });
        expect(await switchPaymentMode({ accountId: ACCOUNT, mode: 'live', by: 'o2' })).toMatchObject({ ok: true, account: { mode: 'live', publicName: 'Live', updatedBy: 'o2' } });
        (db.read('MerchantAccountKeys', ACCOUNT) as any).modes.test.secretKey = PRETEND_REFUSED_KEY;
        expect(await switchPaymentMode({ accountId: ACCOUNT, mode: 'test', by: 'o2' })).toMatchObject({ ok: false, reason: 'key-refused' });
        expect((db.read('MerchantAccounts', ACCOUNT) as any).mode).toBe('live');
    });

    it('disconnecting ends open pages and removes every key', async () => {
        await connectPretend();
        await startPretend();
        expect(await disconnectPaymentAccount({ accountId: ACCOUNT, by: 'o' })).toEqual({ ok: true, heldOpen: 0 });
        expect(db.read('MerchantAccountKeys', ACCOUNT)).toBeUndefined();
        expect(db.read('MerchantAccounts', ACCOUNT)).toBeUndefined();
        expect(db.all('MerchantWebhooks')).toEqual([]);
        expect(record().status).toBe('cancelled');
        expect(await startPayment({ accountId: ACCOUNT, amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'no-account' });
    });

    it('a page that will not end stops the disconnect, unless forced, when a person is told', async () => {
        replaceConnectorForTest({ ...pretendConnector, end: async () => ({ ok: false, failure: 'unavailable', detail: 'down' }) });
        await connectPretend();
        await startPretend();
        expect(await disconnectPaymentAccount({ accountId: ACCOUNT, by: 'o' })).toMatchObject({ ok: false, reason: 'open-payments' });
        expect(db.read('MerchantAccountKeys', ACCOUNT)).toBeDefined();
        expect(await disconnectPaymentAccount({ accountId: ACCOUNT, by: 'o', force: true })).toEqual({ ok: true, heldOpen: 1 });
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['disconnected']);
        await runPaymentSweep(Date.now());
        expect(alerts).toEqual([expect.objectContaining({ type: 'payment-held', reasons: ['disconnected'] })]);
    });

    it('a page ended by disconnecting could still be paid, and nothing can read it now: held for a person', async () => {
        await connectPretend();
        await startPretend();
        await disconnectPaymentAccount({ accountId: ACCOUNT, by: 'o' });
        expect(record().status).toBe('cancelled');
        await runPaymentSweep(Date.now() + 5 * 60_000);
        expect(record().status).toBe('held');
        expect(record().heldReasons).toEqual(['disconnected']);
        expect(record().late).toBe(true);
        expect(record().nextCheckAtMs).toBeUndefined();
        expect(alerts).toEqual([expect.objectContaining({ type: 'payment-held', reasons: ['disconnected'] })]);
    });

    it('a payment whose page has closed and whose account has gone is simply left', async () => {
        await connectPretend();
        const started = await startPretend();
        await endPayment({ accountId: ACCOUNT, reference: 'order-1' });
        await disconnectPaymentAccount({ accountId: ACCOUNT, by: 'o' });
        await runPaymentSweep(Date.parse(started.closesAtIso) + 11 * 60_000);
        expect(record().status).toBe('cancelled');
        expect(record().nextCheckAtMs).toBeUndefined();
    });

    it('moving to another provider holds a page still payable on the old one', async () => {
        await connectPretend();
        await startPretend();
        await endPayment({ accountId: ACCOUNT, reference: 'order-1' });
        replaceConnectorForTest({ ...pretendConnector, info: { ...pretendConnector.info, id: 'other' } });
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'other', mode: 'test', fields: pretendFields(), by: 'o' })).toMatchObject({ ok: true });
        await runPaymentSweep(Date.now() + 5 * 60_000);
        expect(record().status).toBe('held');
    });

    it('another merchant on the same provider is refused while a payment is open, as it could not be read', async () => {
        await connectPretend();
        await startPretend();
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'pretend', mode: 'test', fields: pretendFields({ accountName: 'Another shop' }), by: 'o' })).toMatchObject({ ok: false, reason: 'open-payments' });
        expect(await connectPaymentAccount({ accountId: ACCOUNT, provider: 'pretend', mode: 'test', fields: pretendFields({ secretKey: 'FRESHKEY-0001' }), by: 'o' })).toMatchObject({ ok: true });
    });

    it('holding works from the record as it is now: a payment paid meanwhile stays paid, with its result still waiting', async () => {
        hooks.stop();
        hooks = capturePaymentHooks({ onResult: () => { throw new Error('app down'); } });
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
        expect(await holdPayment(record().paymentId, ['disconnected'])).toBe(false);
        expect(record().status).toBe('paid');
        expect(record().pending).toEqual([expect.objectContaining({ status: 'paid' })]);
    });

    it('switching mode clears what was said about the other mode\'s keys', async () => {
        const both: PaymentConnector = { ...pretendConnector, info: { ...pretendConnector.info, id: 'both', modes: ['test', 'live'] } };
        replaceConnectorForTest(both);
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'live', fields: pretendFields(), by: 'o' });
        await connectPaymentAccount({ accountId: ACCOUNT, provider: 'both', mode: 'test', fields: pretendFields({ keyExpiresOn: '2020-01-01' }), by: 'o' });
        await runAccountCheck();
        expect((await readPaymentAccount(ACCOUNT))?.problems['key-expiring']).toBeTruthy();
        expect(await switchPaymentMode({ accountId: ACCOUNT, mode: 'live', by: 'o' })).toMatchObject({ ok: true, account: { problems: {} } });
        expect((await readPaymentAccount(ACCOUNT))?.problems).toEqual({});
    });
});

describe('refunds', () => {
    async function paid() {
        await connectPretend();
        await startPretend();
        await pretendPayment({ accountId: ACCOUNT, reference: 'order-1', outcome: 'paid', processNow: true });
    }

    it('whole, then nothing left', async () => {
        await paid();
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: true, refundedMinor: 1250 });
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: false, reason: 'too-much' });
    });

    it('in parts, never more than was paid', async () => {
        await paid();
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', amountMinor: 250, by: 'o' })).toMatchObject({ ok: true, refundedMinor: 250 });
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', amountMinor: 1001, by: 'o' })).toMatchObject({ ok: false, reason: 'too-much' });
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', amountMinor: 1000, by: 'o' })).toMatchObject({ ok: true, refundedMinor: 1250 });
        expect(record().status).toBe('paid');
    });

    it('only a paid payment', async () => {
        await connectPretend();
        await startPretend();
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: false, reason: 'not-paid' });
    });

    it('a refused refund can be tried again; one with no answer is set aside, so it can never go twice', async () => {
        await paid();
        const refund = vi.fn(async () => ({ ok: false as const, failure: 'refused' as const, detail: 'no' }));
        replaceConnectorForTest({ ...pretendConnector, refund });
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: false, reason: 'refused' });
        expect(record().refundingMinor).toBeUndefined();
        refund.mockResolvedValueOnce({ ok: false, failure: 'timeout' as never, detail: 'no answer' });
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: false });
        expect(record().refundingMinor).toBe(1250);
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: false, reason: 'busy' });
    });

    it('a refund with no answer shows, and a person settles it whichever way it went', async () => {
        await paid();
        const refund = vi.fn(async () => ({ ok: false as const, failure: 'timeout' as const, detail: 'no answer' }));
        replaceConnectorForTest({ ...pretendConnector, refund });
        await refundPayment({ accountId: ACCOUNT, reference: 'order-1', amountMinor: 250, by: 'o' });
        expect(await readPayment({ accountId: ACCOUNT, reference: 'order-1' })).toMatchObject({ refundingMinor: 250, refundedMinor: 0 });
        expect(await settleRefund({ accountId: ACCOUNT, reference: 'order-1', went: true, by: 'o' })).toMatchObject({ refundedMinor: 250 });
        expect(record().refundingMinor).toBeUndefined();
        await refundPayment({ accountId: ACCOUNT, reference: 'order-1', amountMinor: 100, by: 'o' });
        expect(await settleRefund({ accountId: ACCOUNT, reference: 'order-1', went: false, by: 'o' })).toMatchObject({ refundedMinor: 250 });
        expect(await settleRefund({ accountId: ACCOUNT, reference: 'order-1', went: false, by: 'o' })).toMatchObject({ ok: false, reason: 'not-found' });
        expect(await settleRefund({ accountId: ACCOUNT, reference: 'order-1', by: 'o' } as never)).toMatchObject({ ok: false, reason: 'bad-input' });
    });

    it('a provider that cannot refund says so', async () => {
        await paid();
        replaceConnectorForTest({ ...pretendConnector, info: { ...pretendConnector.info, canRefund: false } });
        expect(await refundPayment({ accountId: ACCOUNT, reference: 'order-1', by: 'o' })).toMatchObject({ ok: false, reason: 'unsupported' });
    });
});

describe('the feature', () => {
    it('off: every call says so', async () => {
        vi.resetModules();
        vi.doMock('../feature-flags.js', () => ({ isFeatureOn: () => false }));
        const accounts = await import('../merchant-payments/accounts.js');
        const payments = await import('../merchant-payments/payments.js');
        expect(await accounts.connectPaymentAccount({ accountId: 'a', provider: 'pretend', mode: 'test', fields: {}, by: 'o' })).toMatchObject({ ok: false, reason: 'off' });
        expect(await payments.startPayment({ accountId: 'a', amountMinor: 1, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example' })).toMatchObject({ ok: false, reason: 'off' });
        vi.doUnmock('../feature-flags.js');
        vi.resetModules();
    });
});
