import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error: plain ESM module without type declarations
import { forward, forwardHeaders, targetUrl } from '../../functions-legacy/proxy.js';

function mockRes() {
    const res: any = { headers: {} as Record<string, string> };
    res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
    res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v; });
    res.send = vi.fn((body: Buffer) => { res.body = body; return res; });
    return res;
}

describe('legacy proxy (CO-D6)', () => {
    it('targets the arccms- successor and keeps the query string', () => {
        expect(targetUrl({ name: 'trackEmailOpen', project: 'p', region: 'us-central1', originalUrl: '/?emailId=abc' }))
            .toBe('https://us-central1-p.cloudfunctions.net/arccms-trackEmailOpen?emailId=abc');
        expect(targetUrl({ name: 'search', project: 'p', region: 'europe-west1', originalUrl: '/' }))
            .toBe('https://europe-west1-p.cloudfunctions.net/arccms-search');
    });

    it('drops hop headers and keeps the rest, including webhook signatures and auth', () => {
        expect(forwardHeaders({
            host: 'old.example', 'content-length': '10', connection: 'keep-alive',
            'webhook-signature': 'v1,abc', authorization: 'Bearer t', 'content-type': 'application/json',
        })).toEqual({ 'webhook-signature': 'v1,abc', authorization: 'Bearer t', 'content-type': 'application/json' });
    });

    it('forwards the raw body byte for byte, so provider signatures still verify', async () => {
        const raw = Buffer.from('{"type":"payment.succeeded","data":{"amount":100}}');
        const fetchImpl = vi.fn(async () => new Response('ok', { status: 200, headers: { 'x-upstream': '1' } }));
        const res = mockRes();

        await forward({ method: 'POST', headers: { 'content-type': 'application/json' }, rawBody: raw }, res, 'https://t/x', fetchImpl);

        const init = (fetchImpl.mock.calls[0] as any)[1];
        expect(init.method).toBe('POST');
        expect(init.body).toBe(raw);
        expect(init.redirect).toBe('manual');
        expect(res.statusCode).toBe(200);
        expect(res.headers['x-upstream']).toBe('1');
        expect(res.body.toString()).toBe('ok');
    });

    it('sends no body for GET (tracking pixel, unsubscribe link)', async () => {
        const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
        await forward({ method: 'GET', headers: {}, rawBody: Buffer.from('') }, mockRes(), 'https://t/x', fetchImpl);
        expect((fetchImpl.mock.calls[0] as any)[1].body).toBeUndefined();
    });

    it('passes the successor status through, and answers 502 when it is unreachable', async () => {
        const denied = mockRes();
        await forward({ method: 'POST', headers: {}, rawBody: Buffer.from('x') }, denied, 'https://t/x',
            vi.fn(async () => new Response('bad signature', { status: 401 })));
        expect(denied.statusCode).toBe(401);

        const down = mockRes();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await forward({ method: 'GET', headers: {} }, down, 'https://t/x', vi.fn(async () => { throw new Error('ECONNRESET'); }));
        expect(down.statusCode).toBe(502);
    });

    it('keeps exactly the old names that live outside the codebase', async () => {
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const index = readFileSync(join(__dirname, '..', '..', 'functions-legacy', 'index.js'), 'utf8');
        const names = [...index.matchAll(/export const (\w+) = legacy\('(\w+)'\)/g)].map((m) => [m[1], m[2]]);
        expect(names).toEqual([
            ['trackEmailOpen', 'trackEmailOpen'],
            ['handleUnsubscribe', 'handleUnsubscribe'],
            ['handleEmailPreferences', 'handleEmailPreferences'],
            ['handleEmailWebhook', 'handleEmailWebhook'],
            ['dodoWebhook', 'dodoWebhook'],
            ['search', 'search'],
        ]);
    });
});
