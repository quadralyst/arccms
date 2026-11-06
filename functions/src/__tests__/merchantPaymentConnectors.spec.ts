/**
 * Worldline Connect and Payrexx, with no network: the SDK and fetch are stand-ins. What these
 * prove is what Arc sends and how it reads what comes back, against the providers' docs. What
 * the providers really do is proven on their own accounts (docs/app/merchant-payments.html#proof).
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore() };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({ onRequest: (_options: unknown, handler: unknown) => handler }));

import { db as initDb } from '../init.js';
import { connectPaymentAccount } from '../merchant-payments/accounts.js';
import { payrexx, payrexxState } from '../merchant-payments/connectors/payrexx.js';
import { safeDetail } from '../merchant-payments/connectors/shared.js';
import { replaceWorldlineClientForTest, startKey, WORLDLINE_HOSTS, worldlineConnect, worldlineState, type WorldlineClient } from '../merchant-payments/connectors/worldlineConnect.js';
import { readPayment, startPayment } from '../merchant-payments/payments.js';
import { paymentIdFor } from '../merchant-payments/store.js';
import { receivePaymentEvent } from '../merchant-payments/webhook.js';
import type { PaymentKeys } from '../merchant-payments/types.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const db = initDb as unknown as MemoryFirestore;

const worldlineKeys: PaymentKeys = { merchantId: '1234', apiKeyId: 'APIKEYID', secretApiKey: 'SECRETAPIKEY-CANARY', webhookKeyId: 'WHKEYID', webhookSecret: 'WHSECRET-CANARY', pageSubdomain: 'myshop', countryCode: 'CH' };
const payrexxKeys: PaymentKeys = { instance: 'myshop', apiSecret: 'PAYREXX-CANARY-KEY' };

function fakeClient(answers: Partial<Record<string, { status: number; body?: unknown; isSuccess?: boolean }>> = {}) {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const hosts: string[] = [];
    const answer = (name: string) => async (...args: unknown[]) => {
        calls.push({ name, args });
        return answers[name] ?? { status: 200, isSuccess: true, body: {} };
    };
    const client: WorldlineClient = {
        v1: {
            hostedcheckouts: { create: answer('create'), get: answer('get'), remove: answer('remove') },
            payments: { get: answer('paymentGet'), find: answer('find'), refund: answer('refund') },
            services: { testconnection: answer('testconnection') },
        },
    };
    replaceWorldlineClientForTest(async (host) => {
        hosts.push(host);
        return client;
    });
    return { calls, hosts };
}

const context = (mode: 'test' | 'live' = 'test') => ({ mode, keys: worldlineKeys, timeoutMs: 1000 });

afterEach(() => {
    replaceWorldlineClientForTest(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('Worldline Connect', () => {
    it('sends each prompt to where the Configuration Center really has it', () => {
        const help = (id: string) => worldlineConnect.info.fields.find((f) => f.id === id)?.help;
        for (const id of ['apiKeyId', 'secretApiKey']) expect(help(id)).toContain('Account settings, API keys (HMAC SHA-256)');
        for (const id of ['webhookKeyId', 'webhookSecret']) expect(help(id)).toContain('Account settings, Webhooks keys');
        expect(help('pageSubdomain')).toContain('Merchant settings, Hosted payment pages, Subdomains');
    });

    it('the address follows the mode, and nothing else: live never reaches pre-production', async () => {
        const { hosts } = fakeClient();
        await worldlineConnect.testKeys(context('live'));
        await worldlineConnect.testKeys(context('test'));
        expect(hosts).toEqual([WORLDLINE_HOSTS.live, WORLDLINE_HOSTS.test]);
        expect(WORLDLINE_HOSTS.live).not.toContain('preprod');
        expect(WORLDLINE_HOSTS.test).toContain('preprod');
    });

    it('the SDK is never asked to log, and no account value can name a host', async () => {
        const fields = worldlineConnect.info.fields.map((f) => f.id);
        expect(fields.some((id) => /host|url|endpoint/i.test(id))).toBe(false);
        const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../merchant-payments/connectors/worldlineConnect.ts'), 'utf8');
        expect(source).toContain('enableLogging: false');
    });

    it('always names a customer, as Connect refuses a page without one, from the payment and within its 15 characters', async () => {
        const { calls } = fakeClient({ create: { status: 201, isSuccess: true, body: { hostedCheckoutId: 'hc1', partialRedirectUrl: 'pay1.preprod.checkout.worldline-solutions.com/checkout/abc' } } });
        const paymentId = 'a'.repeat(15) + 'b'.repeat(25);
        await worldlineConnect.start(context(), { paymentId, amountMinor: 100, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' });
        await worldlineConnect.start(context(), { paymentId: `c${paymentId}`, amountMinor: 100, currency: 'CHF', reference: 'order-2', returnUrl: 'https://a.example/x' });
        const customers = calls.map((call) => (call.args as [string, any])[1].order.customer.merchantCustomerId);
        expect(customers[0]).toBe('a'.repeat(15));
        expect(customers[1]).toHaveLength(15);
        // Not one customer for every buyer, and nothing of the app's own reference.
        expect(customers[1]).not.toBe(customers[0]);
        expect(customers[0]).not.toContain('order');
    });

    it('says which field Connect refused, and keeps out anything that is not a field\'s name', async () => {
        const refusal = (propertyName: string) => ({ status: 400, isSuccess: false, body: { errors: [{ code: '20000000', message: 'PARAMETER_NOT_FOUND_IN_REQUEST', propertyName }] } });
        const start = () => worldlineConnect.start(context(), { paymentId: 'p', amountMinor: 100, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' });
        fakeClient({ create: refusal('order.customer.merchantCustomerId') });
        expect(await start()).toEqual({ ok: false, failure: 'refused', detail: 'Worldline refused the request (400) (20000000 PARAMETER_NOT_FOUND_IN_REQUEST order.customer.merchantCustomerId)' });
        fakeClient({ create: refusal('order.items[0].name') });
        expect(await start()).toMatchObject({ detail: expect.stringContaining('order.items[0].name') });
        fakeClient({ create: refusal('https://evil.example/<script>') });
        expect(await start()).toEqual({ ok: false, failure: 'refused', detail: 'Worldline refused the request (400) (20000000 PARAMETER_NOT_FOUND_IN_REQUEST)' });
    });

    it('starts a hosted page with no buyer\'s details, a sale, and a key against making two', async () => {
        const { calls } = fakeClient({ create: { status: 201, isSuccess: true, body: { hostedCheckoutId: 'hc1', partialRedirectUrl: 'pay1.preprod.checkout.worldline-solutions.com/checkout/abc', RETURNMAC: 'mac' } } });
        const answer = await worldlineConnect.start(context(), { paymentId: 'pid1', amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x', language: 'de_CH' });
        expect(answer).toEqual({ ok: true, providerId: 'hc1', pageUrl: 'https://myshop.pay1.preprod.checkout.worldline-solutions.com/checkout/abc', lifeMinutes: 120 });
        const [merchant, body, ctx] = calls[0].args as [string, any, any];
        expect(merchant).toBe('1234');
        expect(body.order.amountOfMoney).toEqual({ amount: 1250, currencyCode: 'CHF' });
        expect(body.order.references.merchantReference).toBe('order-1');
        expect(body.order.customer).toEqual({ merchantCustomerId: 'pid1', billingAddress: { countryCode: 'CH' } });
        expect(body.hostedCheckoutSpecificInput).toMatchObject({ returnUrl: 'https://a.example/x', showResultPage: false, returnCancelState: true, locale: 'de_CH' });
        expect(body.cardPaymentMethodSpecificInput.requiresApproval).toBe(false);
        expect(body.redirectPaymentMethodSpecificInput.requiresApproval).toBe(false);
        expect(body.mobilePaymentMethodSpecificInput.requiresApproval).toBe(false);
        expect(ctx.idempotence.key).toBe(startKey({ paymentId: 'pid1', amountMinor: 1250, currency: 'CHF', returnUrl: 'https://a.example/x' }));
        expect(JSON.stringify(body)).not.toContain('CANARY');
    });

    it('a retry with another amount is another request, so it cannot be answered with the old page', () => {
        const base = { paymentId: 'p', amountMinor: 100, currency: 'CHF', returnUrl: 'https://a.example/x' };
        expect(startKey(base)).toBe(startKey({ ...base }));
        expect(startKey({ ...base, amountMinor: 101 })).not.toBe(startKey(base));
        expect(startKey({ ...base, currency: 'EUR' })).not.toBe(startKey(base));
        expect(startKey({ ...base, returnUrl: 'https://a.example/y' })).not.toBe(startKey(base));
    });

    it('rule 4: what was really captured wins over what was asked, so a part capture is not the whole', async () => {
        const payment = (extra: object) => ({ status: 200, isSuccess: true, body: { status: 'PAYMENT_CREATED', createdPaymentOutput: { payment: { id: 'p9', status: 'CAPTURED', paymentOutput: { amountOfMoney: { amount: 1250, currencyCode: 'CHF' }, references: { merchantReference: 'o' }, ...extra } } } } });
        fakeClient({ get: payment({ amountCaptured: 500, amountPaid: 0 }) });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'o' })).toMatchObject({ amountMinor: 500 });
        fakeClient({ get: payment({ amountCaptured: 0, amountPaid: 0 }) });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'o' })).toMatchObject({ amountMinor: 1250 });
    });

    it('an ended page with no payment known is looked for by the page, and a paid one wins', async () => {
        const { calls } = fakeClient({ get: { status: 404, isSuccess: false }, find: { status: 200, isSuccess: true, body: { payments: [{ id: 'a', status: 'REJECTED' }, { id: 'b', status: 'PAID', paymentOutput: { amountOfMoney: { amount: 5, currencyCode: 'CHF' }, references: { merchantReference: 'r' } } }, { id: 'c', status: 'CREATED' }] } } });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'r' })).toMatchObject({ state: 'paid', providerPaymentId: 'b', amountMinor: 5 });
        expect(calls.find((c) => c.name === 'find')?.args).toEqual(['1234', { hostedCheckoutId: 'hc1' }]);
        fakeClient({ get: { status: 404, isSuccess: false }, find: { status: 200, isSuccess: true, body: { payments: [] } } });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'r' })).toMatchObject({ ok: false, failure: 'not-found' });
    });

    it('says when a payment is under way, as apart from a page nobody paid on', async () => {
        fakeClient({ get: { status: 200, isSuccess: true, body: { status: 'PAYMENT_CREATED', createdPaymentOutput: { payment: { id: 'p9', status: 'CAPTURE_REQUESTED' } } } } });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'r' })).toMatchObject({ state: 'open', paymentExists: true });
        fakeClient({ get: { status: 200, isSuccess: true, body: { status: 'IN_PROGRESS' } } });
        expect((await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'r' }) as { paymentExists?: boolean }).paymentExists).toBeUndefined();
    });

    it('a partial address with a leading dot still makes one good address', async () => {
        fakeClient({ create: { status: 201, isSuccess: true, body: { hostedCheckoutId: 'hc1', partialRedirectUrl: '.pay1.checkout.worldline-solutions.com/x' } } });
        const answer = await worldlineConnect.start(context('live'), { paymentId: 'p', amountMinor: 1, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' });
        expect(answer).toMatchObject({ pageUrl: 'https://myshop.pay1.checkout.worldline-solutions.com/x' });
    });

    it('a subdomain that tries to leave the domain is refused when connecting', () => {
        const pattern = worldlineConnect.info.fields.find((f) => f.id === 'pageSubdomain')!.pattern!;
        expect(pattern.test('myshop')).toBe(true);
        for (const bad of ['evil.example/', 'evil.example#', 'a.b', 'a@b', '-a']) expect(pattern.test(bad)).toBe(false);
    });

    it.each([
        ['CAPTURED', 'paid'], ['PAID', 'paid'], ['COMPLETED', 'paid'],
        ['PENDING_APPROVAL', 'open'], ['PENDING_CAPTURE', 'open'], ['CAPTURE_REQUESTED', 'open'], ['AUTHORIZATION_REQUESTED', 'open'], ['PENDING_PAYMENT', 'open'], ['PENDING_FRAUD_APPROVAL', 'open'], ['CAPTURE_IN_PROGRESS', 'open'], ['REDIRECTED', 'open'], ['CREATED', 'open'],
        ['REJECTED', 'failed'], ['REJECTED_CAPTURE', 'failed'], ['CANCELLED', 'cancelled'],
        ['REVERSED', 'unclear'], ['REFUNDED', 'unclear'], ['CHARGEBACKED', 'unclear'], ['CHARGEBACK_NOTIFICATION', 'unclear'],
        ['SOMETHING_NEW', 'open'], ['', 'open'], [null, 'open'], ['constructor', 'open'], ['__proto__', 'open'],
    ])('rule 5, the strict table: %s is %s', (status, state) => {
        expect(worldlineState(status as string)).toBe(state);
    });

    it('reads a paid checkout from the provider\'s own fields', async () => {
        fakeClient({ get: { status: 200, isSuccess: true, body: { status: 'PAYMENT_CREATED', createdPaymentOutput: { payment: { id: 'p9', status: 'CAPTURED', paymentOutput: { amountOfMoney: { amount: 1250, currencyCode: 'CHF' }, references: { merchantReference: 'order-1' }, paymentMethod: 'card' } } } } } });
        expect(await worldlineConnect.read(context('live'), { providerId: 'hc1', reference: 'order-1' })).toEqual({ ok: true, state: 'paid', providerStatus: 'CAPTURED', amountMinor: 1250, currency: 'CHF', reference: 'order-1', providerPaymentId: 'p9', method: 'card', mode: 'live', paymentExists: true });
    });

    it.each([
        ['IN_PROGRESS', 'open'],
        ['CANCELLED_BY_CONSUMER', 'cancelled'],
        ['CLIENT_NOT_ELIGIBLE_FOR_SELECTED_PAYMENT_PRODUCT', 'failed'],
        ['SOMETHING_NEW', 'open'],
    ])('a checkout at %s is %s', async (status, state) => {
        fakeClient({ get: { status: 200, isSuccess: true, body: { status } } });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', reference: 'r' })).toMatchObject({ ok: true, state });
    });

    it('an ended page is read through its payment, when there was one', async () => {
        const { calls } = fakeClient({ get: { status: 404, isSuccess: false, body: {} }, paymentGet: { status: 200, isSuccess: true, body: { id: 'p9', status: 'PAID', paymentOutput: { amountOfMoney: { amount: 5, currencyCode: 'CHF' }, references: { merchantReference: 'r' } } } } });
        expect(await worldlineConnect.read(context(), { providerId: 'hc1', providerPaymentId: 'p9', reference: 'r' })).toMatchObject({ state: 'paid' });
        expect(calls.map((c) => c.name)).toEqual(['get', 'paymentGet']);
    });

    it.each([
        [401, 'key-refused'], [403, 'key-refused'], [404, 'not-found'], [429, 'unavailable'], [500, 'unavailable'], [400, 'refused'],
    ])('an answer of %i is %s', async (status, failure) => {
        fakeClient({ testconnection: { status, isSuccess: false, body: { errors: [{ code: '9007', message: 'ACCESS_TO_MERCHANT_NOT_ALLOWED' }] } } });
        expect(await worldlineConnect.testKeys(context())).toMatchObject({ ok: false, failure });
    });

    it('an SDK that throws, quoting the request, says nothing of it', async () => {
        replaceWorldlineClientForTest(async () => { throw new Error(`failed with key ${worldlineKeys['secretApiKey']}`); });
        const answer = await worldlineConnect.testKeys(context());
        expect(answer).toMatchObject({ ok: false, failure: 'unavailable' });
        expect(JSON.stringify(answer)).not.toContain('CANARY');
    });

    it('a call that takes too long comes back in time', async () => {
        const never = () => new Promise<never>(() => undefined);
        replaceWorldlineClientForTest(async () => ({ v1: { services: { testconnection: never } } }) as unknown as WorldlineClient);
        expect(await worldlineConnect.testKeys({ ...context(), timeoutMs: 5 })).toMatchObject({ ok: false, failure: 'timeout' });
    });

    it('refunds on the payment, whole or in part, once', async () => {
        const { calls } = fakeClient({ refund: { status: 201, isSuccess: true, body: { id: 'rf1', status: 'CREATED' } } });
        expect(await worldlineConnect.refund(context(), { providerId: 'hc1', providerPaymentId: 'p9', reference: 'r' }, { amountMinor: 250, currency: 'CHF', reference: 'r-r1', paymentId: 'pid-r1' })).toEqual({ ok: true, refundId: 'rf1', providerStatus: 'CREATED' });
        const [merchant, payment, body, ctx] = calls[0].args as [string, string, any, any];
        expect([merchant, payment]).toEqual(['1234', 'p9']);
        expect(body).toEqual({ amountOfMoney: { amount: 250, currencyCode: 'CHF' }, refundReferences: { merchantReference: 'r-r1' } });
        expect(ctx.idempotence.key).toBe('pid-r1');
        expect(await worldlineConnect.refund(context(), { providerId: 'hc1', reference: 'r' }, { currency: 'CHF', reference: 'x', paymentId: 'y' })).toMatchObject({ ok: false, failure: 'not-found' });
    });

    describe('events', () => {
        const body = Buffer.from('{"apiVersion":"v1","id":"evt-1","type":"payment.captured","payment":{"id":"p9","paymentOutput":{"references":{"merchantReference":"order-1"}}}}');
        const signature = (bytes: Buffer, secret: string) => createHmac('sha256', secret).update(bytes).digest('base64');
        const keysByMode = { live: worldlineKeys };

        it('takes the signature its docs describe: base64 of HMAC-SHA256 over the body, with the key named by its id', () => {
            expect(worldlineConnect.verifyEvent!(body, { 'x-gcs-signature': signature(body, 'WHSECRET-CANARY'), 'x-gcs-keyid': 'WHKEYID' }, keysByMode)).toBe(true);
        });

        it.each([
            ['a secret of the sender\'s own', { 'x-gcs-signature': signature(body, 'MINE'), 'x-gcs-keyid': 'WHKEYID' }],
            ['a key id the server does not hold', { 'x-gcs-signature': signature(body, 'WHSECRET-CANARY'), 'x-gcs-keyid': 'OTHER' }],
            ['no signature', { 'x-gcs-keyid': 'WHKEYID' }],
            ['no key id', { 'x-gcs-signature': signature(body, 'WHSECRET-CANARY') }],
        ])('refuses %s', (_name, headers) => {
            expect(worldlineConnect.verifyEvent!(body, headers, keysByMode)).toBe(false);
        });

        it('holds no key for an account with none', () => {
            expect(worldlineConnect.verifyEvent!(body, { 'x-gcs-signature': signature(body, 'x'), 'x-gcs-keyid': 'WHKEYID' }, {})).toBe(false);
        });

        it('reads the event id and reference, and treats the Test button\'s event as nothing', () => {
            expect(worldlineConnect.parseEvent(body, {})).toEqual({ eventId: 'evt-1', type: 'payment.captured', reference: 'order-1', providerPaymentId: 'p9' });
            expect(worldlineConnect.parseEvent(Buffer.from('{"id":"TEST-1","type":"payment.created","payment":{"paymentOutput":{"references":{"merchantReference":"o"}}}}'), {})).toBeNull();
            expect(worldlineConnect.parseEvent(Buffer.from('not json'), {})).toBeNull();
        });
    });

    describe('through the webhook', () => {
        beforeEach(() => {
            db.store.clear();
            vi.stubEnv('ARC_PAYMENTS_TRY', 'worldline-connect');
            fakeClient({ create: { status: 201, isSuccess: true, body: { hostedCheckoutId: 'hc1', partialRedirectUrl: 'pay1.preprod.checkout.worldline-solutions.com/checkout/abc' } } });
        });

        async function connect() {
            const answer = await connectPaymentAccount({ accountId: 'b1', provider: 'worldline-connect', mode: 'test', fields: worldlineKeys, by: 'o' });
            if (!answer.ok) throw new Error(answer.detail);
            return answer.account;
        }

        it('answers the address check with the header\'s value, and only for a real address', async () => {
            const { webhookAddress } = await connect();
            const id = webhookAddress.split('/').pop()!;
            expect(await receivePaymentEvent({ method: 'GET', path: `/${id}`, headers: { 'x-gcs-webhooks-endpoint-verification': 'abc123' } })).toEqual({ status: 200, body: 'abc123' });
            expect((await receivePaymentEvent({ method: 'GET', path: `/${id}`, headers: {} })).status).toBe(400);
            expect((await receivePaymentEvent({ method: 'GET', path: `/${'0'.repeat(32)}`, headers: { 'x-gcs-webhooks-endpoint-verification': 'abc123' } })).status).toBe(404);
        });

        it('a real start and a real signed event make one record', async () => {
            const { webhookAddress } = await connect();
            const started = await startPayment({ accountId: 'b1', amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' });
            expect(started).toMatchObject({ ok: true, lifeFixedByProvider: true, pageUrl: 'https://myshop.pay1.preprod.checkout.worldline-solutions.com/checkout/abc' });
            const rawBody = Buffer.from('{"id":"evt-1","type":"payment.captured","payment":{"id":"p9","paymentOutput":{"references":{"merchantReference":"order-1"}}}}');
            const answer = await receivePaymentEvent({ method: 'POST', path: `/${webhookAddress.split('/').pop()}`, rawBody, headers: { 'x-gcs-signature': createHmac('sha256', 'WHSECRET-CANARY').update(rawBody).digest('base64'), 'x-gcs-keyid': 'WHKEYID' } });
            expect(answer).toEqual({ status: 200, body: 'Received' });
            expect(db.all('MerchantPaymentEvents')).toHaveLength(1);
            expect((db.read('MerchantPayments', paymentIdFor('b1', 'order-1')) as any).status).toBe('open');
        });

        it('a reference too long for Connect is refused before anything is sent', async () => {
            await connect();
            expect(await startPayment({ accountId: 'b1', amountMinor: 1, currency: 'CHF', reference: 'x'.repeat(31), returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'bad-input' });
        });
    });
});

describe('Payrexx', () => {
    const live = { mode: 'live' as const, keys: payrexxKeys, timeoutMs: 1000 };
    type Reply = { status?: number; body?: unknown };

    function fakeFetch(replies: Array<Reply | ((url: string) => Reply)>) {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        let at = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            const next = replies[Math.min(at++, replies.length - 1)];
            const reply = typeof next === 'function' ? next(url) : next;
            return { status: reply.status ?? 200, json: async () => reply.body ?? {} };
        }));
        return calls;
    }

    it('the key goes in a header, never in an address, and follows no redirect', async () => {
        const calls = fakeFetch([{ body: { status: 'success', data: [] } }]);
        expect(await payrexx.testKeys(live)).toEqual({ ok: true });
        expect(calls[0].url).toBe('https://api.payrexx.com/v1.0/Transaction/?limit=1&instance=myshop');
        expect(calls[0].url).not.toContain('CANARY');
        expect((calls[0].init.headers as Record<string, string>)['X-API-KEY']).toBe(payrexxKeys['apiSecret']);
        expect(calls[0].init.redirect).toBe('error');
    });

    it('an instance name that could change the address is refused when connecting', () => {
        const pattern = payrexx.info.fields.find((f) => f.id === 'instance')!.pattern!;
        expect(pattern.test('myshop')).toBe(true);
        for (const bad of ['a/b', 'a&b=c', 'a b', 'a.evil.example', '']) expect(pattern.test(bad)).toBe(false);
    });

    it('starts a gateway in minor units, with the page\'s life, and gives its page', async () => {
        const calls = fakeFetch([{ body: { status: 'success', data: [{ id: 77, hash: 'abc', link: 'https://myshop.payrexx.com/de/?payment=abc', status: 'waiting' }] } }]);
        const answer = await payrexx.start(live, { paymentId: 'p', amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x', lifeMinutes: 15 });
        expect(answer).toEqual({ ok: true, providerId: '77', pageUrl: 'https://myshop.payrexx.com/de/?payment=abc', lifeMinutes: 15 });
        expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ amount: 1250, currency: 'CHF', referenceId: 'order-1', validity: 15, successRedirectUrl: 'https://a.example/x' });
        expect(calls[0].init.method).toBe('POST');
    });

    it.each([
        ['confirmed', 'paid'],
        ['waiting', 'open'], ['authorized', 'open'], ['reserved', 'open'],
        ['cancelled', 'cancelled'], ['declined', 'failed'], ['error', 'failed'],
        ['refunded', 'unclear'], ['partially-refunded', 'unclear'], ['refund_pending', 'unclear'], ['chargeback', 'unclear'],
        ['something-new', 'open'], ['', 'open'], [null, 'open'], ['constructor', 'open'],
    ])('rule 5, the strict table: %s is %s', (status, state) => {
        expect(payrexxState(status as string)).toBe(state);
    });

    const gateway = (extra: object = {}) => ({ body: { status: 'success', data: [{ id: 77, status: 'confirmed', amount: 1250, currency: 'CHF', referenceId: 'order-1', ...extra }] } });
    const transaction = (extra: object = {}) => ({ body: { status: 'success', data: [{ id: 501, status: 'confirmed', mode: 'LIVE', referenceId: 'order-1', invoice: { totalAmount: 1250, currencyAlpha3: 'CHF' }, payment: { brand: 'twint' }, ...extra }] } });

    it('reads what was paid from the transaction, not from the gateway', async () => {
        const calls = fakeFetch([gateway({ invoices: [{ transactions: [{ id: 501 }] }] }), transaction()]);
        expect(await payrexx.read(live, { providerId: '77', reference: 'order-1' })).toEqual({ ok: true, state: 'paid', providerStatus: 'confirmed', amountMinor: 1250, currency: 'CHF', reference: 'order-1', providerPaymentId: '501', mode: 'live', method: 'twint', paymentExists: true });
        expect(calls.map((c) => c.url.split('?')[0])).toEqual(['https://api.payrexx.com/v1.0/Gateway/77/', 'https://api.payrexx.com/v1.0/Transaction/501/']);
    });

    it('a gateway that says confirmed, with no transaction to prove it, is not paid', async () => {
        fakeFetch([gateway()]);
        expect(await payrexx.read(live, { providerId: '77', reference: 'order-1' })).toEqual({ ok: true, state: 'open', providerStatus: 'gateway confirmed', paymentExists: true });
    });

    it('rule 6: a transaction not plainly LIVE says test, which a live record holds', async () => {
        fakeFetch([gateway({ invoices: [{ transactions: [{ id: 501 }] }] }), transaction({ mode: 'TEST' })]);
        expect(await payrexx.read(live, { providerId: '77', reference: 'order-1' })).toMatchObject({ mode: 'test' });
        fakeFetch([gateway({ invoices: [{ transactions: [{ id: 501 }] }] }), transaction({ mode: undefined })]);
        expect(await payrexx.read(live, { providerId: '77', reference: 'order-1' })).toMatchObject({ mode: 'test' });
    });

    it('rule 2: an id from an unsigned event counts only if that transaction is this gateway\'s', async () => {
        const invoice = (paymentRequestId: unknown) => ({ invoice: { totalAmount: 1250, currencyAlpha3: 'CHF', paymentRequestId } });
        fakeFetch([gateway(), transaction({ ...invoice(77), referenceId: 'someone-else' })]);
        expect(await payrexx.read(live, { providerId: '77', providerPaymentId: '501', reference: 'order-1' })).toMatchObject({ state: 'open' });
        // The same reference and amount, on another gateway of the same instance: not this payment's money.
        fakeFetch([gateway(), transaction(invoice(88))]);
        expect(await payrexx.read(live, { providerId: '77', providerPaymentId: '501', reference: 'order-1' })).toMatchObject({ state: 'open' });
        fakeFetch([gateway(), transaction(invoice(undefined))]);
        expect(await payrexx.read(live, { providerId: '77', providerPaymentId: '501', reference: 'order-1' })).toMatchObject({ state: 'open' });
        fakeFetch([gateway(), transaction(invoice(77))]);
        expect(await payrexx.read(live, { providerId: '77', providerPaymentId: '501', reference: 'order-1' })).toMatchObject({ state: 'paid', amountMinor: 1250 });
        fakeFetch([gateway(), { status: 404, body: { status: 'error' } }]);
        expect(await payrexx.read(live, { providerId: '77', providerPaymentId: '9999', reference: 'order-1' })).toMatchObject({ state: 'open' });
    });

    it('reads every try on a page, and a confirmed one wins in any order', async () => {
        const named = { invoices: [{ transactions: [{ id: 601 }, { id: 602 }] }] };
        const byId = (url: string) => (url.includes('/601/') ? transaction({ id: 601, status: 'confirmed' }) : transaction({ id: 602, status: 'declined' }));
        fakeFetch([gateway(named), byId, byId]);
        expect(await payrexx.read(live, { providerId: '77', reference: 'order-1' })).toMatchObject({ state: 'paid', providerPaymentId: '601' });
    });

    it('a deleted gateway does not hide a transaction already known', async () => {
        const belongs = transaction({ invoice: { totalAmount: 1250, currencyAlpha3: 'CHF', paymentRequestId: 77 } });
        fakeFetch([{ status: 404, body: { status: 'error' } }, belongs]);
        expect(await payrexx.read(live, { providerId: '77', providerPaymentId: '501', reference: 'order-1' })).toMatchObject({ state: 'paid' });
        fakeFetch([{ status: 404, body: { status: 'error' } }]);
        expect(await payrexx.read(live, { providerId: '77', reference: 'order-1' })).toMatchObject({ ok: false, failure: 'not-found' });
    });

    it.each([[401, 'key-refused'], [403, 'key-refused'], [404, 'not-found'], [405, 'unavailable'], [429, 'unavailable'], [503, 'unavailable'], [400, 'refused']])('an answer of %i is %s', async (status, failure) => {
        fakeFetch([{ status, body: { status: 'error', message: 'no' } }]);
        expect(await payrexx.testKeys(live)).toMatchObject({ ok: false, failure });
    });

    it('a network error says nothing of the request', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`fetch failed with ${payrexxKeys['apiSecret']}`); }));
        const answer = await payrexx.testKeys(live);
        expect(answer).toMatchObject({ ok: false, failure: 'unavailable' });
        expect(JSON.stringify(answer)).not.toContain('CANARY');
    });

    it('ends a page by deleting its gateway', async () => {
        const calls = fakeFetch([{ body: { status: 'success', data: [{ id: 1 }] } }]);
        expect(await payrexx.end(live, { providerId: '77', reference: 'r' })).toEqual({ ok: true });
        expect(calls[0].init.method).toBe('DELETE');
        expect(calls[0].url.startsWith('https://api.payrexx.com/v1.0/Gateway/77/?')).toBe(true);
    });

    it('refunds on the transaction, whole or in part', async () => {
        const calls = fakeFetch([{ body: { status: 'success', data: [{ id: 2, status: 'refunded' }] } }]);
        expect(await payrexx.refund(live, { providerId: '77', providerPaymentId: '501', reference: 'r' }, { amountMinor: 250, currency: 'CHF', reference: 'x', paymentId: 'y' })).toEqual({ ok: true, refundId: '2', providerStatus: 'refunded' });
        expect(calls[0].url.split('?')[0]).toBe('https://api.payrexx.com/v1.0/Transaction/501/refund/');
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ amount: 250 });
    });

    describe('events', () => {
        const json = Buffer.from('{"transaction":{"id":501,"status":"confirmed","referenceId":"order-1"}}');

        it('signs nothing, so it has no check to pass: its events can only prompt a read back', () => {
            expect(payrexx.verifyEvent).toBeUndefined();
            expect(payrexx.info.signsEvents).toBe(false);
        });

        it('reads JSON and form events alike', () => {
            expect(payrexx.parseEvent(json, { 'content-type': 'application/json' })).toMatchObject({ reference: 'order-1', providerPaymentId: '501', type: 'confirmed' });
            const form = Buffer.from(new URLSearchParams({ 'transaction[id]': '501', 'transaction[status]': 'confirmed', 'transaction[referenceId]': 'order-1' }).toString());
            expect(payrexx.parseEvent(form, { 'content-type': 'application/x-www-form-urlencoded' })).toMatchObject({ reference: 'order-1', providerPaymentId: '501', type: 'confirmed' });
        });

        it('identical bytes are the same event; an id that is not a number is ignored', () => {
            expect(payrexx.parseEvent(json, {})!.eventId).toBe(payrexx.parseEvent(json, {})!.eventId);
            expect(payrexx.parseEvent(Buffer.from('{"transaction":{"id":"../x","referenceId":"o"}}'), {})!.providerPaymentId).toBeUndefined();
            expect(payrexx.parseEvent(Buffer.from('{}'), {})).toBeNull();
            expect(payrexx.parseEvent(Buffer.from('{bad'), {})).toBeNull();
        });

        describe('through the webhook', () => {
            beforeEach(() => {
                db.store.clear();
                vi.stubEnv('ARC_PAYMENTS_TRY', 'payrexx:live');
            });

            it('rule 2: an unsigned event with a made-up status changes nothing, and is read back', async () => {
                fakeFetch([{ body: { status: 'success', data: [] } }, { body: { status: 'success', data: [{ id: 77, link: 'https://myshop.payrexx.com/?payment=a', status: 'waiting' }] } }]);
                const connected = await connectPaymentAccount({ accountId: 'b1', provider: 'payrexx', mode: 'live', fields: payrexxKeys, by: 'o' });
                if (!connected.ok) throw new Error(connected.detail);
                expect(connected.account.webhookAddress).not.toContain('CANARY');
                await startPayment({ accountId: 'b1', amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' });
                const id = connected.account.webhookAddress.split('/').pop();
                expect(await receivePaymentEvent({ method: 'POST', path: `/${id}`, headers: {}, rawBody: json })).toEqual({ status: 200, body: 'Received' });
                const record = db.read('MerchantPayments', paymentIdFor('b1', 'order-1')) as any;
                expect(record.status).toBe('open');

                fakeFetch([{ body: { status: 'success', data: [{ id: 77, status: 'waiting' }] } }]);
                expect(await readPayment({ accountId: 'b1', reference: 'order-1' })).toMatchObject({ status: 'open' });

                const unknown = Buffer.from('{"transaction":{"id":1,"status":"confirmed","referenceId":"no-such-order"}}');
                const before = db.all('MerchantPaymentEvents').length;
                expect(await receivePaymentEvent({ method: 'POST', path: `/${id}`, headers: {}, rawBody: unknown })).toEqual({ status: 200, body: 'Nothing to do' });
                expect(db.all('MerchantPaymentEvents')).toHaveLength(before);
            });

            it('a page on another instance\'s address is refused', async () => {
                fakeFetch([{ body: { status: 'success', data: [] } }, { body: { status: 'success', data: [{ id: 77, link: 'https://other.payrexx.com/?payment=a' }] } }, { body: { status: 'success', data: [{ id: 77 }] } }]);
                await connectPaymentAccount({ accountId: 'b1', provider: 'payrexx', mode: 'live', fields: payrexxKeys, by: 'o' });
                expect(await startPayment({ accountId: 'b1', amountMinor: 1, currency: 'CHF', reference: 'r', returnUrl: 'https://a.example/x' })).toMatchObject({ ok: false, reason: 'bad-page-address' });
            });
        });
    });
});

describe('safeDetail', () => {
    it('takes out anything long enough to be a key, any address, and odd characters', () => {
        const said = safeDetail('refused key made_up_key_abcdefghijklmnopqrstuvwxyz at https://evil.example/x?a=b <script>');
        expect(said).not.toContain('made_up_key');
        expect(said).not.toContain('evil.example');
        expect(said).not.toContain('<');
        expect(safeDetail(undefined)).toBe('');
        expect(safeDetail('x'.repeat(23)).length).toBe(23);
        expect(safeDetail('A'.repeat(30))).toBe('[removed]');
        expect(safeDetail('aB3_dE4_fG5_hI6_jK7_lM8_nO9')).toBe('[removed]');
    });

    it('keeps a provider\'s long error name, which says what went wrong', () => {
        expect(safeDetail('9002 MISSING_OR_INVALID_AUTHORIZATION')).toBe('9002 MISSING_OR_INVALID_AUTHORIZATION');
    });
});
