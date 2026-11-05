import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { flag, runProof, tryForgedEvents } from '../merchant-payments-proof.mjs';

const SECRET = 'TYPED-SECRET-CANARY';
const connector = {
    id: 'worldline-connect',
    name: 'Worldline Connect',
    modes: ['test'],
    webhookByHand: true,
    signsEvents: true,
    pageLife: { settable: false, minutes: 120 },
    fields: [
        { id: 'merchantId', label: 'Merchant ID', secret: false, required: true },
        { id: 'secretApiKey', label: 'Secret API Key', secret: true, required: true },
    ],
};

function harness(over: Record<string, unknown> = {}) {
    const lines: string[] = [];
    const answers = ['1234', '', 'card', '250', 'y', '', 'y'];
    const kit = {
        paymentConnectors: () => [connector],
        connectPaymentAccount: vi.fn(async () => ({ ok: true, account: { publicName: '1234', last4: 'NARY', webhookAddress: 'https://x.example/hook/abc' } })),
        startPayment: vi.fn(async () => ({ ok: true, pageUrl: 'https://pay.example/1', closesAtIso: '2026-11-05T10:00:00.000Z' })),
        readPayment: vi.fn(async () => ({ ok: true, status: 'paid', providerStatus: 'CAPTURED', method: 'card', eventSeen: true })),
        refundPayment: vi.fn(async () => ({ ok: true, providerStatus: 'CREATED' })),
        disconnectPaymentAccount: vi.fn(async () => ({ ok: true, heldOpen: 0 })),
        ...over,
    };
    const askHidden = vi.fn(async () => SECRET);
    return {
        kit,
        lines,
        askHidden,
        run: (args = ['--provider=worldline-connect', '--mode=test']) =>
            runProof({ kit, args, ask: async () => answers.shift() ?? '', askHidden, log: (line: string) => lines.push(line), wait: async () => undefined, fetchImpl: vi.fn(async () => ({ status: 401 })), now: () => 1000 }),
    };
}

describe('payments:proof', () => {
    it('takes a secret only at the hidden prompt, and never prints it', async () => {
        const h = harness();
        await h.run();
        expect(h.askHidden).toHaveBeenCalledOnce();
        expect(h.kit.connectPaymentAccount).toHaveBeenCalledWith(expect.objectContaining({ fields: { merchantId: '1234', secretApiKey: SECRET } }));
        expect(h.lines.join('\n')).not.toContain(SECRET);
    });

    it('shows the address and the page, reports what the provider said, and removes the keys at the end', async () => {
        const h = harness();
        const answer = await h.run();
        const text = h.lines.join('\n');
        expect(text).toContain('https://x.example/hook/abc');
        expect(text).toContain('https://pay.example/1');
        expect(answer.rows).toEqual([expect.objectContaining({ way: 'card', outcome: 'paid', providerStatus: 'CAPTURED', method: 'card', events: 'event arrived', forged: '401 in 0 ms' })]);
        expect(h.kit.refundPayment).toHaveBeenCalled();
        expect(h.kit.disconnectPaymentAccount).toHaveBeenCalled();
    });

    it('stops at keys the provider refuses', async () => {
        const h = harness({ connectPaymentAccount: vi.fn(async () => ({ ok: false, reason: 'key-refused', detail: 'Worldline refused the keys' })) });
        expect(await h.run()).toEqual({ ok: false });
        expect(h.kit.startPayment).not.toHaveBeenCalled();
    });

    it('needs a provider and a mode, and refuses a mode the provider lacks', async () => {
        const h = harness();
        expect(await h.run(['--provider=worldline-connect'])).toEqual({ ok: false });
        expect(await h.run(['--provider=worldline-connect', '--mode=live'])).toEqual({ ok: false });
        expect(h.kit.connectPaymentAccount).not.toHaveBeenCalled();
    });

    it('forges both kinds of event at the deployed address', async () => {
        const fetchImpl = vi.fn(async () => ({ status: 401 }));
        await tryForgedEvents({ address: 'https://x.example/h', signed: true, reference: 'r', fetchImpl, now: () => 5 });
        await tryForgedEvents({ address: 'https://x.example/h', signed: false, reference: 'r', fetchImpl, now: () => 5 });
        const [[, signed], [, unsigned]] = fetchImpl.mock.calls as unknown as Array<[string, { headers: Record<string, string>; body: string }]>;
        expect(signed.headers['X-GCS-Signature']).toBeTruthy();
        expect(JSON.parse(unsigned.body).transaction.referenceId).toBe('r');
    });

    it('reads a flag', () => {
        expect(flag(['--mode=test'], 'mode')).toBe('test');
        expect(flag([], 'mode')).toBeUndefined();
    });
});
