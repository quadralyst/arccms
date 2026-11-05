/**
 * The server's own look at what is still unfinished, so a missed webhook recovers with no
 * browser. Every 2 minutes: payments due a read (each read further apart, up to 15 minutes), and
 * results the app has not taken yet.
 */
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { STARTING_MS } from './payments.js';
import { applyRead, checkGapMs, checkPayment, CLOSE_GRACE_MS, deliverPending, holdPayment } from './settle.js';
import { PAYMENTS, type PaymentRecord } from './store.js';

/** A run reads at most this many, as providers limit calls (Payrexx: 600 in 5 minutes). */
export const SWEEP_LIMIT = 100;
const AT_ONCE = 8;
/** How long past its page's close an unfinished payment is read, before a person is asked. */
export const UNFINISHED_LIMIT_MS = 3 * 86_400_000;

async function inTurn<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
        while (next < items.length) await work(items[next++]);
    }));
}

/**
 * One payment due a read. What keeps it being read is whether it can still become money:
 *
 *   open, and no payment on the page: until the page has closed, then cancelled.
 *   open, with a payment under way: on, up to the limit, then held for a person. A captured
 *     card can take a day, and closing that as unpaid would lose real money.
 *   cancelled or failed: until the page has closed, as a buyer can finish after the app gave
 *     up, and past it while the provider cannot answer or a payment is under way.
 *   no keys any more: held for a person while it was still payable, as nothing can read it now.
 */
export async function sweepPayment(record: PaymentRecord, nowMs: number): Promise<void> {
    const ref = db.collection(PAYMENTS).doc(record.paymentId);
    if (record.status === 'starting') {
        // The instance that was asking for a page never finished, so no one has its address.
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const current = snap.exists ? (snap.data() as PaymentRecord) : null;
            if (current?.status === 'starting' && nowMs - current.createdAtMs >= STARTING_MS) tx.delete(ref);
        });
        return;
    }
    const closed = nowMs > record.closesAtMs + CLOSE_GRACE_MS;
    const overLimit = nowMs > record.closesAtMs + UNFINISHED_LIMIT_MS;
    const answer = await checkPayment(record.paymentId, { via: 'sweep', nowMs });
    const known = answer.ok ? answer.record : answer.record ?? record;
    const stop = () => ref.update({ nextCheckAtMs: FieldValue.delete() });
    const again = () => ref.update({ checks: (known.checks ?? 0) + 1, nextCheckAtMs: nowMs + checkGapMs((known.checks ?? 0) + 1) });

    if (known.status === 'paid' || known.status === 'held') return void (await stop());
    if (!answer.ok && answer.failure === 'no-keys') {
        if (known.status === 'open' || !closed) await holdPayment(record.paymentId, ['disconnected'], nowMs);
        return void (await stop());
    }
    const notFound = !answer.ok && answer.failure === 'not-found';
    const underWay = answer.ok && answer.read.paymentExists === true;
    const unread = !answer.ok && !notFound;

    if (known.status === 'open') {
        if (!closed) return void (await again());
        if (underWay || unread) {
            if (overLimit) {
                await holdPayment(record.paymentId, [unread ? 'provider-unread' : 'provider-status'], nowMs);
                return void (await stop());
            }
            return void (await again());
        }
        // The page has closed, and the provider says no payment was made on it.
        await applyRead(record.paymentId, { ok: true, state: 'cancelled', providerStatus: 'page closed' }, nowMs);
        await deliverPending(record.paymentId, nowMs);
        return void (await stop());
    }
    if (!closed || ((underWay || unread) && !overLimit)) return void (await again());
    await stop();
}

export async function runPaymentSweep(nowMs = Date.now()): Promise<{ read: number; delivered: number }> {
    const due = await db.collection(PAYMENTS).where('nextCheckAtMs', '<=', nowMs).orderBy('nextCheckAtMs').limit(SWEEP_LIMIT).get();
    await inTurn(due.docs.map((doc) => doc.data() as PaymentRecord), async (record) => {
        try {
            await sweepPayment(record, nowMs);
        } catch {
            logger.error('merchant-payments: a payment could not be swept', { provider: record.provider });
        }
    });
    const waiting = await db.collection(PAYMENTS).where('deliveryNextAtMs', '<=', nowMs).orderBy('deliveryNextAtMs').limit(SWEEP_LIMIT).get();
    await inTurn(waiting.docs.map((doc) => doc.id), async (id) => {
        try {
            await deliverPending(id, nowMs);
        } catch {
            logger.error('merchant-payments: a result could not be delivered');
        }
    });
    return { read: due.size, delivered: waiting.size };
}

export const sweepMerchantPayments = onSchedule({ schedule: 'every 2 minutes', timeZone: 'UTC', timeoutSeconds: 300 }, async () => {
    await runPaymentSweep();
});
