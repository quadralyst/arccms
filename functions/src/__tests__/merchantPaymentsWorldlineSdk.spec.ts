// @vitest-environment node
/**
 * Worldline's real SDK against a local server standing in for its API, so the calls the
 * connector makes are ones the SDK has, in the shapes it takes and answers, and a signed
 * event matches the SDK's own check. Nothing leaves this machine.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceWorldlineClientForTest, worldlineConnect, type WorldlineClient } from '../merchant-payments/connectors/worldlineConnect.js';

vi.mock('../init', () => ({ db: {} }));

interface Seen {
    method: string;
    path: string;
    headers: IncomingMessage['headers'];
    body: string;
}

let server: Server;
let port: number;
let seen: Seen[];
let reply: (request: Seen) => { status: number; body?: object };

beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const request = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
            seen.push(request);
            const answer = reply(request);
            res.writeHead(answer.status, { 'Content-Type': 'application/json', Date: new Date().toUTCString() });
            res.end(answer.body ? JSON.stringify(answer.body) : undefined);
        });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise((done) => server.close(done)));

const keys = { merchantId: '1234', apiKeyId: 'APIKEYID0', secretApiKey: 'SECRETAPIKEY-CANARY', webhookKeyId: 'WHKEYID', webhookSecret: 'WHSECRET-CANARY', pageSubdomain: 'myshop', countryCode: 'CH' };
const context = { mode: 'test' as const, keys, timeoutMs: 5000 };

beforeEach(() => {
    seen = [];
    reply = () => ({ status: 200, body: {} });
    replaceWorldlineClientForTest(async () => {
        const sdk = await import('connect-sdk-nodejs');
        return sdk.init({ host: '127.0.0.1', port, scheme: 'http', enableLogging: false, apiKeyId: keys.apiKeyId, secretApiKey: keys.secretApiKey, integrator: 'Arc CMS' }) as unknown as WorldlineClient;
    });
});

afterEach(() => replaceWorldlineClientForTest(null));

describe('the connector on the real SDK', () => {
    it('tests keys at the documented address, signing the request and never sending the secret', async () => {
        reply = () => ({ status: 200, body: { result: 'OK' } });
        expect(await worldlineConnect.testKeys(context)).toEqual({ ok: true });
        expect(seen[0]).toMatchObject({ method: 'GET', path: '/v1/1234/services/testconnection' });
        expect(String(seen[0].headers.authorization)).toMatch(/^GCS v1HMAC:APIKEYID0:/);
        expect(JSON.stringify(seen[0])).not.toContain('CANARY');
    });

    it('a 403 is keys refused, with no key in what comes back', async () => {
        reply = () => ({ status: 403, body: { errorId: 'x', errors: [{ code: '9007', message: 'ACCESS_TO_MERCHANT_NOT_ALLOWED' }] } });
        const answer = await worldlineConnect.testKeys(context);
        expect(answer).toMatchObject({ ok: false, failure: 'key-refused' });
        expect(JSON.stringify(answer)).not.toContain('CANARY');
    });

    it('creates a hosted checkout, with the idempotence header', async () => {
        reply = () => ({ status: 201, body: { RETURNMAC: 'mac', hostedCheckoutId: 'hc1', partialRedirectUrl: 'pay1.preprod.checkout.worldline-solutions.com/checkout/abc' } });
        const answer = await worldlineConnect.start(context, { paymentId: 'pid1', amountMinor: 1250, currency: 'CHF', reference: 'order-1', returnUrl: 'https://a.example/x' });
        expect(answer).toMatchObject({ ok: true, providerId: 'hc1', pageUrl: 'https://myshop.pay1.preprod.checkout.worldline-solutions.com/checkout/abc' });
        expect(seen[0]).toMatchObject({ method: 'POST', path: '/v1/1234/hostedcheckouts' });
        expect(seen[0].headers['x-gcs-idempotence-key']).toMatch(/^[a-f0-9]{40}$/);
        expect(JSON.parse(seen[0].body).order.references.merchantReference).toBe('order-1');
    });

    it('reads a checkout, ends it, reads its payment and refunds', async () => {
        reply = ({ method, path }) => {
            if (method === 'DELETE') return { status: 204 };
            if (path.endsWith('/refund')) return { status: 201, body: { id: 'rf1', status: 'CREATED' } };
            if (path.includes('/payments/')) return { status: 200, body: { id: 'p9', status: 'PAID', paymentOutput: { amountOfMoney: { amount: 5, currencyCode: 'CHF' }, references: { merchantReference: 'r' } } } };
            return { status: 200, body: { status: 'IN_PROGRESS' } };
        };
        expect(await worldlineConnect.read(context, { providerId: 'hc1', reference: 'r' })).toMatchObject({ ok: true, state: 'open', providerStatus: 'IN_PROGRESS' });
        expect(await worldlineConnect.end(context, { providerId: 'hc1', reference: 'r' })).toEqual({ ok: true });
        const refunded = await worldlineConnect.refund(context, { providerId: 'hc1', providerPaymentId: 'p9', reference: 'r' }, { amountMinor: 5, currency: 'CHF', reference: 'r-r1', paymentId: 'pid-r1' });
        expect(refunded).toEqual({ ok: true, refundId: 'rf1', providerStatus: 'CREATED' });
        expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /v1/1234/hostedcheckouts/hc1', 'DELETE /v1/1234/hostedcheckouts/hc1', 'POST /v1/1234/payments/p9/refund']);
    });

    it('an ended page falls back to its payment', async () => {
        reply = ({ path }) => (path.includes('/payments/') ? { status: 200, body: { id: 'p9', status: 'CAPTURED', paymentOutput: { amountOfMoney: { amount: 5, currencyCode: 'CHF' }, references: { merchantReference: 'r' } } } } : { status: 404, body: { errors: [{ code: '1010', message: 'UNKNOWN_HOSTED_CHECKOUT_ID' }] } });
        expect(await worldlineConnect.read(context, { providerId: 'hc1', providerPaymentId: 'p9', reference: 'r' })).toMatchObject({ state: 'paid', amountMinor: 5 });
        expect(seen.map((s) => s.path)).toEqual(['/v1/1234/hostedcheckouts/hc1', '/v1/1234/payments/p9']);
    });

    it('an ended page with no payment known is looked for by the page', async () => {
        reply = ({ path }) => (path.startsWith('/v1/1234/payments') ? { status: 200, body: { payments: [{ id: 'p9', status: 'PAID', paymentOutput: { amountOfMoney: { amount: 5, currencyCode: 'CHF' }, references: { merchantReference: 'r' } } }] } } : { status: 404, body: { errors: [{ code: '1010' }] } });
        expect(await worldlineConnect.read(context, { providerId: 'hc1', reference: 'r' })).toMatchObject({ state: 'paid', providerPaymentId: 'p9' });
        expect(seen[1].path).toBe('/v1/1234/payments?hostedCheckoutId=hc1');
    });

    it('a server that cannot be reached comes back in the connectors\' words', async () => {
        replaceWorldlineClientForTest(async () => {
            const sdk = await import('connect-sdk-nodejs');
            return sdk.init({ host: '127.0.0.1', port: 1, scheme: 'http', enableLogging: false, apiKeyId: keys.apiKeyId, secretApiKey: keys.secretApiKey, integrator: 'Arc CMS' }) as unknown as WorldlineClient;
        });
        const answer = await worldlineConnect.testKeys(context);
        expect(answer).toMatchObject({ ok: false, failure: 'unavailable' });
        expect(JSON.stringify(answer)).not.toContain('CANARY');
    });

    it('a signature the connector accepts is one the SDK\'s own webhook helper accepts, and the same for a forged one', async () => {
        const { createHmac } = await import('node:crypto');
        const sdk = await import('connect-sdk-nodejs');
        const body = '{"apiVersion":"v1","id":"evt-1","created":"2026-11-05T10:00:00.000+0100","merchantId":"1234","type":"payment.captured","payment":{"id":"p9"}}';
        const sign = (secret: string) => createHmac('sha256', secret).update(Buffer.from(body)).digest('base64');
        sdk.webhooks.inMemorySecretKeyStore.storeSecretKey('WHKEYID', 'WHSECRET-CANARY');
        const helper = sdk.webhooks.v1.init({ getSecretKey: sdk.webhooks.inMemorySecretKeyStore.getSecretKey });
        const good = { 'x-gcs-signature': sign('WHSECRET-CANARY'), 'x-gcs-keyid': 'WHKEYID' };
        const bad = { 'x-gcs-signature': sign('SOMEONE-ELSE'), 'x-gcs-keyid': 'WHKEYID' };
        await expect(helper.unmarshal(body, good)).resolves.toMatchObject({ id: 'evt-1' });
        expect(worldlineConnect.verifyEvent!(Buffer.from(body), good, { test: keys })).toBe(true);
        await expect(helper.unmarshal(body, bad)).rejects.toBeTruthy();
        expect(worldlineConnect.verifyEvent!(Buffer.from(body), bad, { test: keys })).toBe(false);
        sdk.webhooks.inMemorySecretKeyStore.clear();
    });
});
