/**
 * npm run payments:proof, every check, through the real payment code against the pretend
 * provider. What matters most is that its marks cannot flatter: an event the script forged must
 * not read as the provider's own, and a payment the script read first must not hide one that came.
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

import { db as initDb } from '../init.js';
import { connectPaymentAccount, disconnectPaymentAccount } from '../merchant-payments/accounts.js';
import { paymentConnectors, replaceConnectorForTest } from '../merchant-payments/connectors/index.js';
import { payrexx } from '../merchant-payments/connectors/payrexx.js';
import { PRETEND_COLLECTION, pretendConnector } from '../merchant-payments/connectors/pretend.js';
import { processPaymentEvent } from '../merchant-payments/onEvent.js';
import { endPayment, readPayment, refundPayment, startPayment } from '../merchant-payments/payments.js';
import { pretendPayment } from '../merchant-payments/pretendControl.js';
import { PAYMENTS, readAccount, type PaymentRecord } from '../merchant-payments/store.js';
import { runPaymentSweep } from '../merchant-payments/sweep.js';
import type { PaymentConnector } from '../merchant-payments/types.js';
import { receivePaymentEvent } from '../merchant-payments/webhook.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';
import { SECRET, WEBHOOK_KEY_ID, WEBHOOK_SECRET } from './helpers/merchantPayments.js';
// @ts-expect-error: plain ESM script without type declarations
import { runProof } from '../../../scripts/merchant-payments-proof.mjs';

const db = initDb as unknown as MemoryFirestore;
const ACCOUNT = 'proof-pretend';
const kit = { paymentConnectors, connectPaymentAccount, disconnectPaymentAccount, startPayment, readPayment, endPayment, refundPayment };

/** Refuses any key but the real one, as a provider does. */
const strictKeys: PaymentConnector = { ...pretendConnector, testKeys: async ({ keys }) => (keys['secretKey'] === SECRET ? { ok: true } : { ok: false, failure: 'key-refused', detail: 'refused' }) };
/** As Payrexx: nothing signed, and its own shape of event. */
const unsigned: PaymentConnector = { ...strictKeys, info: { ...strictKeys.info, signsEvents: false }, parseEvent: payrexx.parseEvent };

const records = () => db.all(PAYMENTS).map(({ data }) => data as unknown as PaymentRecord);
const newest = (label: string) => records().find((record) => record.reference.startsWith(`proof-${label}-`)) as PaymentRecord;

async function runTrigger() {
    for (const { data } of db.all('MerchantPaymentEvents')) await processPaymentEvent(data);
}

/** The deployed webhook, reached the way the script reaches it. */
const webhook = async (address: string, init: { headers: Record<string, string>; body: string }) => {
    const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]));
    const answer = await receivePaymentEvent({ method: 'POST', path: new URL(address).pathname, headers, rawBody: Buffer.from(init.body) });
    return { status: answer.status };
};

/** A person at the keyboard: answers by the question, and each `wait` is a moment passing. */
function proof(answers: Array<[RegExp, string | (() => Promise<string>)]>, onWait: Array<() => Promise<unknown>> = []) {
    const lines: string[] = [];
    const left = [...answers];
    let clock = 1_000_000;
    return {
        lines,
        run: () => runProof({
            kit,
            args: ['--provider=pretend', '--mode=test'],
            ask: async (question: string) => {
                const at = left.findIndex(([match]) => match.test(question));
                if (at < 0) return '';
                const [, answer] = left.splice(at, 1)[0];
                return typeof answer === 'function' ? answer() : answer;
            },
            askHidden: async (question: string) => (/Secret key/.test(question) ? SECRET : /Webhook key ID/.test(question) ? WEBHOOK_KEY_ID : WEBHOOK_SECRET),
            log: (line: string) => lines.push(line),
            wait: async () => {
                await onWait.shift()?.();
                await runTrigger();
            },
            peek: async (paymentId: string) => db.read(PAYMENTS, paymentId) ?? null,
            fetchImpl: webhook,
            now: () => (clock += 1000),
        }),
    };
}

const base: Array<[RegExp, string]> = [[/Account name/, 'My shop']];
const row = (answer: { rows: Array<{ check: string }> }, check: string) => answer.rows.find((r) => r.check === check);

beforeEach(() => {
    db.store.clear();
    replaceConnectorForTest(strictKeys);
});

afterEach(() => {
    replaceConnectorForTest(null);
});

describe('payments:proof, against the pretend provider', () => {
    it('a wrong key is refused and saves nothing, and a forged event is refused', async () => {
        const answer = await proof(base).run();
        expect(row(answer, 'wrong key')).toMatchObject({ expected: true, saw: 'answered key-refused' });
        expect(row(answer, 'forged event')).toMatchObject({ expected: true, saw: expect.stringContaining('401') });
        expect(await readAccount(`${ACCOUNT}-wrong`)).toBeNull();
    });

    it('pay: a real event counts even when the script\'s own read finished the payment first', async () => {
        const reference = () => newest('pay').reference;
        const answer = await proof(
            [...base, [/A number/, '1'], [/Which way/, 'card'], [/Amount/, '250']],
            [
                // The buyer pays, and the script's next read finds it before any event.
                () => pretendPayment({ accountId: ACCOUNT, reference: reference(), outcome: 'paid', deliver: 'none' }),
                () => pretendPayment({ accountId: ACCOUNT, reference: reference(), outcome: 'paid', deliver: 'now' }),
            ],
        ).run();
        expect(newest('pay')).toMatchObject({ status: 'paid', eventSeen: true });
        expect(row(answer, 'pay, card')).toMatchObject({ expected: true, saw: expect.stringContaining('event arrived') });
    });

    it('pay: no event at all is marked, not hidden', async () => {
        const answer = await proof(
            [...base, [/A number/, '1'], [/Which way/, 'card']],
            [() => pretendPayment({ accountId: ACCOUNT, reference: newest('pay').reference, outcome: 'paid', deliver: 'none' })],
        ).run();
        expect(row(answer, 'pay, card')).toMatchObject({ expected: false, saw: expect.stringContaining('NO EVENT') });
    });

    it('pay: a declined card is for you to judge, and a part refund then the rest both go through', async () => {
        const declined = await proof(
            [...base, [/A number/, '1'], [/Which way/, 'card']],
            [() => pretendPayment({ accountId: ACCOUNT, reference: newest('pay').reference, outcome: 'failed', deliver: 'now', processNow: true })],
        ).run();
        expect(row(declined, 'pay, card')).toMatchObject({ expected: null });

        db.store.clear();
        const refunds = await proof(
            [...base, [/A number/, '1'], [/Which way/, 'card'], [/Amount/, '300'], [/Refund through Arc/, 'part'], [/How much/, '100'], [/Refund through Arc/, 'whole']],
            [() => pretendPayment({ accountId: ACCOUNT, reference: newest('pay').reference, outcome: 'paid', deliver: 'now', processNow: true })],
        ).run();
        expect(row(refunds, 'refund, part')).toMatchObject({ expected: true });
        expect(row(refunds, 'refund, whole')).toMatchObject({ expected: true });
        expect(newest('pay')).toMatchObject({ refundedMinor: 300 });
    });

    it('end: the page is ended and the record cancelled, with what you saw written down', async () => {
        const answer = await proof([...base, [/A number/, '2'], [/What does it show/, 'Session expired']]).run();
        expect(newest('end').status).toBe('cancelled');
        expect(row(answer, 'end a page')).toMatchObject({ expected: true, saw: expect.stringContaining('Session expired') });
    });

    it('late: money after the page ended arrives as paid and late', async () => {
        const answer = await proof([
            ...base,
            [/A number/, '3'],
            [/Now press the button/, async () => {
                await pretendPayment({ accountId: ACCOUNT, reference: newest('late').reference, outcome: 'paid', deliver: 'now', processNow: true });
                return 'y';
            }],
        ]).run();
        expect(newest('late')).toMatchObject({ status: 'paid', late: true });
        expect(row(answer, 'late money')).toMatchObject({ expected: true, saw: expect.stringContaining('late') });
    });

    it('late: a provider that refuses an ended page is what the rules ask too', async () => {
        const answer = await proof([...base, [/A number/, '3'], [/Now press the button/, 'n']]).run();
        expect(row(answer, 'late money')).toMatchObject({ expected: true, saw: expect.stringContaining('cancelled') });
    });

    it('sweep: only the sweep finds it, and the script never read the provider itself', async () => {
        const read = vi.fn(pretendConnector.read);
        replaceConnectorForTest({ ...strictKeys, read });
        const answer = await proof(
            [...base, [/A number/, '4']],
            [
                async () => {
                    await pretendPayment({ accountId: ACCOUNT, reference: newest('sweep').reference, outcome: 'paid', deliver: 'none' });
                    // Nothing has read it yet: the record still says open.
                    expect(read).not.toHaveBeenCalled();
                    expect(newest('sweep').status).toBe('open');
                },
                () => runPaymentSweep(Date.now() + 10 * 60_000),
            ],
        ).run();
        expect(read).toHaveBeenCalledOnce();
        expect(newest('sweep')).toMatchObject({ status: 'paid', eventSeen: false });
        expect(row(answer, 'sweep')).toMatchObject({ expected: true });
    });

    it('sweep: an event arriving means the webhook was not removed, which is marked', async () => {
        const answer = await proof(
            [...base, [/A number/, '4']],
            [() => pretendPayment({ accountId: ACCOUNT, reference: newest('sweep').reference, outcome: 'paid', deliver: 'now', processNow: true })],
        ).run();
        expect(row(answer, 'sweep')).toMatchObject({ expected: false, saw: expect.stringContaining('still on') });
    });

    it('removes the keys when it finishes', async () => {
        await proof([...base, [/Disconnect/, 'y']]).run();
        expect(await readAccount(ACCOUNT)).toBeNull();
        expect(db.all('MerchantAccountKeys')).toEqual([]);
    });
});

describe('payments:proof, where the provider signs nothing', () => {
    beforeEach(() => replaceConnectorForTest(unsigned));

    it('a forged event goes all the way and changes nothing, on a page kept for it, which is then ended', async () => {
        const answer = await proof(base).run();
        expect(row(answer, 'forged event')).toMatchObject({ expected: true, saw: expect.stringContaining('stayed open') });
        expect(newest('forged')).toMatchObject({ status: 'cancelled', eventSeen: true });
    });

    it('a forged event that makes a payment paid is marked', async () => {
        const answer = await proof(base, [
            async () => {
                const record = newest('forged');
                await db.collection(PRETEND_COLLECTION).doc(record.providerId).set({ providerStatus: 'paid' }, { merge: true });
            },
        ]).run();
        expect(row(answer, 'forged event')).toMatchObject({ expected: false });
    });

    it('the script\'s forged event never reads as the provider\'s event on a payment you make', async () => {
        const answer = await proof(
            [...base, [/A number/, '1'], [/Which way/, 'card']],
            [
                async () => undefined,
                () => pretendPayment({ accountId: ACCOUNT, reference: newest('pay').reference, outcome: 'paid', deliver: 'none' }),
            ],
        ).run();
        expect(newest('forged').eventSeen).toBe(true);
        expect(newest('pay').eventSeen).toBe(false);
        expect(row(answer, 'pay, card')).toMatchObject({ expected: false, saw: expect.stringContaining('NO EVENT') });
    });

    it('the provider\'s own event on that payment does count', async () => {
        const answer = await proof(
            [...base, [/A number/, '1'], [/Which way/, 'card']],
            [
                async () => undefined,
                async () => {
                    const record = newest('pay');
                    await pretendPayment({ accountId: ACCOUNT, reference: record.reference, outcome: 'paid', deliver: 'none' });
                    const account = await readAccount(ACCOUNT);
                    const rawBody = Buffer.from(JSON.stringify({ transaction: { id: 7, status: 'confirmed', referenceId: record.reference } }));
                    await receivePaymentEvent({ method: 'POST', path: `/${account?.webhookId}`, headers: { 'content-type': 'application/json' }, rawBody });
                },
            ],
        ).run();
        expect(row(answer, 'pay, card')).toMatchObject({ expected: true, saw: expect.stringContaining('event arrived') });
    });
});
