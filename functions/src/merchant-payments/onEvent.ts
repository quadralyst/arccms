/**
 * The work after an event was recorded: read the payment back from the provider, and let that
 * answer, never the event, say what happened (rule 4). If the provider cannot answer now, the
 * sweep reads it soon.
 */
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { arcDocument } from '../arc-config.js';
import { db } from '../init.js';
import { noteEventArrived } from './alerts.js';
import { checkPayment } from './settle.js';
import { connectorFor } from './connectors/index.js';
import { PAYMENTS, type PaymentRecord } from './store.js';

/** Unsigned events prompt at most one read in this long; the sweep covers the rest. */
export const UNSIGNED_READ_GAP_MS = 30_000;

export async function processPaymentEvent(event: { paymentId?: unknown; accountId?: unknown; hint?: unknown }, nowMs = Date.now()): Promise<void> {
    if (typeof event.paymentId !== 'string' || typeof event.accountId !== 'string') return;
    const ref = db.collection(PAYMENTS).doc(event.paymentId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const record = snap.data() as PaymentRecord;
    const hint = typeof event.hint === 'string' ? event.hint : undefined;
    await noteEventArrived(event.accountId);
    // Anyone with the address can send a provider's unsigned events, each with different bytes:
    // one read at a time, or they become a flood of calls on the merchant's account.
    const connector = connectorFor(record.provider);
    if (connector && !connector.info.signsEvents && record.lastReadAtMs && nowMs - record.lastReadAtMs < UNSIGNED_READ_GAP_MS) {
        await ref.update({ eventSeen: true, nextCheckAtMs: nowMs + UNSIGNED_READ_GAP_MS, ...(hint ? { eventHint: hint } : {}) });
        return;
    }
    await ref.update({ eventSeen: true, ...(hint ? { eventHint: hint } : {}) });
    const answer = await checkPayment(event.paymentId, { via: 'event', nowMs, ...(hint ? { hint } : {}) });
    if (!answer.ok) {
        await ref.update({ nextCheckAtMs: nowMs });
        logger.warn('merchant-payments: a payment could not be read back', { failure: answer.failure });
    }
}

// Retried if a write fails: running it twice changes nothing, and the provider will not send it again.
export const onMerchantPaymentEvent = onDocumentCreated({ ...arcDocument('MerchantPaymentEvents/{eventKey}'), retry: true }, async (event) => {
    const data = event.data?.data();
    if (data) await processPaymentEvent(data);
});
