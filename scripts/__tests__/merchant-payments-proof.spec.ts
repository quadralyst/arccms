import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { flag, runProof, tryForgedEvents, wrongKey } from '../merchant-payments-proof.mjs';

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
        { id: 'secretApiKey', label: 'Secret API Key', secret: true, preview: true, required: true },
    ],
};

/** Answers by what is asked, so a new question cannot shift the rest. */
const replies: Array<[RegExp, string]> = [
    [/Merchant ID/, '1234'],
    [/A number/, ''],
    [/Disconnect/, 'y'],
];

function harness(over: Record<string, unknown> = {}, script = replies) {
    const lines: string[] = [];
    const questions: string[] = [];
    const queue = [...script];
    const kit = {
        paymentConnectors: () => [connector],
        connectPaymentAccount: vi.fn(async ({ fields }: { fields: Record<string, string> }) => (fields['secretApiKey'] === SECRET
            ? { ok: true, account: { publicName: '1234', last4: 'NARY', webhookAddress: 'https://x.example/hook/abc' } }
            : { ok: false, reason: 'key-refused', detail: 'refused' })),
        startPayment: vi.fn(async () => ({ ok: true, paymentId: 'p1', pageUrl: 'https://pay.example/1', closesAtIso: '2026-11-05T10:00:00.000Z' })),
        readPayment: vi.fn(async () => ({ ok: true, reference: 'r', amountMinor: 250, refundedMinor: 0, status: 'paid', providerStatus: 'CAPTURED', method: 'card', eventSeen: true })),
        endPayment: vi.fn(async () => ({ ok: true, status: 'cancelled' })),
        refundPayment: vi.fn(async () => ({ ok: true, providerStatus: 'CREATED', refundedMinor: 250 })),
        disconnectPaymentAccount: vi.fn(async () => ({ ok: true, heldOpen: 0 })),
        ...over,
    };
    const askHidden = vi.fn(async () => SECRET);
    const ask = async (question: string) => {
        questions.push(question);
        const at = queue.findIndex(([match]) => match.test(question));
        return at < 0 ? '' : queue.splice(at, 1)[0][1];
    };
    return {
        kit,
        lines,
        questions,
        askHidden,
        run: (args = ['--provider=worldline-connect', '--mode=test'], fetchImpl: unknown = vi.fn(async () => ({ status: 401 })), now: () => number = () => 1000) =>
            runProof({ kit, args, ask, askHidden, log: (line: string) => lines.push(line), wait: async () => undefined, peek: async () => null, fetchImpl, now }),
    };
}

describe('payments:proof', () => {
    it('takes a secret only at the hidden prompt, and never prints it or its wrong copy', async () => {
        const h = harness();
        await h.run();
        expect(h.askHidden).toHaveBeenCalledOnce();
        expect(h.kit.connectPaymentAccount).toHaveBeenCalledWith(expect.objectContaining({ fields: { merchantId: '1234', secretApiKey: SECRET } }));
        const text = [...h.lines, ...h.questions].join('\n');
        expect(text).not.toContain(SECRET);
        expect(text).not.toContain(wrongKey(SECRET));
    });

    it('tries a wrong key on its own account, and a forged event, before you are asked to add the address', async () => {
        const h = harness();
        const answer = await h.run();
        expect(h.kit.connectPaymentAccount.mock.calls[1][0]).toMatchObject({ accountId: 'proof-worldline-connect-wrong', fields: { secretApiKey: wrongKey(SECRET) } });
        expect(answer.rows).toEqual([
            { check: 'wrong key', saw: 'answered key-refused', expected: true },
            { check: 'forged event', saw: 'answered 401 in 0 ms', expected: true },
        ]);
        const text = h.lines.join('\n');
        expect(text.indexOf('Forging an event')).toBeLessThan(text.indexOf('Webhook address: https://x.example/hook/abc'));
        expect(h.questions.findIndex((q) => /Add it in the provider/.test(q))).toBeGreaterThanOrEqual(0);
    });

    it('marks a wrong key the provider took, and removes that account at once', async () => {
        const h = harness({ connectPaymentAccount: vi.fn(async () => ({ ok: true, account: { publicName: '1234', last4: 'NARY', webhookAddress: 'https://x.example/hook/abc' } })) });
        const answer = await h.run();
        expect(answer.rows[0]).toMatchObject({ check: 'wrong key', expected: false });
        expect(h.kit.disconnectPaymentAccount).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'proof-worldline-connect-wrong' }));
    });

    it('leaves a wrong key to you when the provider did not say', async () => {
        const connect = vi.fn(async ({ fields }: { fields: Record<string, string> }) => (fields['secretApiKey'] === SECRET
            ? { ok: true, account: { webhookAddress: 'https://x.example/hook/abc' } }
            : { ok: false, reason: 'unavailable', detail: 'down' }));
        const answer = await harness({ connectPaymentAccount: connect }).run();
        expect(answer.rows[0]).toMatchObject({ check: 'wrong key', saw: 'answered unavailable', expected: null });
    });

    it('marks a forged event let through, and an answer over the limit', async () => {
        const through = await harness().run(undefined, vi.fn(async () => ({ status: 200 })));
        expect(through.rows[1]).toMatchObject({ check: 'forged event', expected: false });
        let clock = 0;
        const slow = await harness().run(undefined, vi.fn(async () => ({ status: 401 })), () => (clock += 11_000));
        expect(slow.rows[1]).toMatchObject({ check: 'forged event', expected: false, saw: expect.stringContaining('over the 10 second limit') });
    });

    it('says the functions look missing when the webhook is not there', async () => {
        const h = harness();
        await h.run(undefined, vi.fn(async () => ({ status: 404 })));
        expect(h.lines.join('\n')).toContain('are the four functions deployed');
    });

    it('lists what a run did not try, and removes the keys at the end', async () => {
        const h = harness();
        await h.run();
        const text = h.lines.join('\n');
        expect(text).toContain('Not tried in this run: pay, ending a page, late money, the sweep.');
        expect(text).toContain('a part capture');
        expect(h.kit.disconnectPaymentAccount).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'proof-worldline-connect', force: true }));
    });

    it('junk at a part refund refunds nothing, and never the whole of it', async () => {
        const h = harness({}, [[/Merchant ID/, '1234'], [/A number/, '1'], [/Which way/, 'card'], [/Refund through Arc/, 'part'], [/How much/, 'abc'], [/A number/, '']]);
        await h.run();
        expect(h.kit.refundPayment).not.toHaveBeenCalled();
        expect(h.lines.join('\n')).toContain('nothing was refunded');
    });

    it('asks each question on one line, as a prompt with a line break redraws badly', async () => {
        const h = harness({}, [[/Merchant ID/, '1234'], [/A number/, '2'], [/A number/, '3'], [/A number/, '4'], [/A number/, '']]);
        await h.run();
        expect(h.questions.filter((q) => q.includes('\n'))).toEqual([]);
    });

    it('keeps the keys when told to, and --remove takes them out with no keys typed', async () => {
        const kept = harness({}, [[/Merchant ID/, '1234'], [/Disconnect/, 'n']]);
        await kept.run();
        expect(kept.kit.disconnectPaymentAccount).not.toHaveBeenCalled();

        const h = harness();
        expect(await h.run(['--provider=worldline-connect', '--mode=test', '--remove'])).toEqual({ ok: true });
        expect(h.askHidden).not.toHaveBeenCalled();
        expect(h.kit.connectPaymentAccount).not.toHaveBeenCalled();
        expect(h.kit.disconnectPaymentAccount).toHaveBeenCalledWith({ accountId: 'proof-worldline-connect', by: 'payments-proof', force: true });
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

    it('warns that a live account moves real money', async () => {
        const live = { ...connector, modes: ['live'] };
        const h = harness({ paymentConnectors: () => [live] });
        await h.run(['--provider=worldline-connect', '--mode=live']);
        expect(h.lines.join('\n')).toContain('real money');
    });

    it('forges both kinds of event at the deployed address', async () => {
        const fetchImpl = vi.fn(async () => ({ status: 401 }));
        await tryForgedEvents({ address: 'https://x.example/h', signed: true, reference: 'r', fetchImpl, now: () => 5 });
        await tryForgedEvents({ address: 'https://x.example/h', signed: false, reference: 'r', fetchImpl, now: () => 5 });
        const [[, signed], [, unsigned]] = fetchImpl.mock.calls as unknown as Array<[string, { headers: Record<string, string>; body: string }]>;
        expect(signed.headers['X-GCS-Signature']).toBeTruthy();
        expect(JSON.parse(unsigned.body).transaction.referenceId).toBe('r');
    });

    it('makes a wrong key of the same length, never the key itself', () => {
        expect(wrongKey('abcdefghij')).toBe('abcdewrong');
        expect(wrongKey('abcdewrong')).toBe('abcderight');
        expect(wrongKey('abcdefghij')).toHaveLength(10);
    });

    it('reads a flag', () => {
        expect(flag(['--mode=test'], 'mode')).toBe('test');
        expect(flag([], 'mode')).toBeUndefined();
    });
});
