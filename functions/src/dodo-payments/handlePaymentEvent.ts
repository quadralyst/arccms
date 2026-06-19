import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { findUserRef, grantEntitlement, revokeEntitlement, markPastDue } from './entitlements.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';
import { DodoWebhookPayload, DodoWebhookData, ProductDoc, TransactionDoc, TransactionStatus } from './types.js';

/**
 * Processes a recorded webhook event: updates Transactions, adjusts the product
 * purchase counter, grants/revokes the user's entitlement, and enqueues the
 * relevant (admin-toggleable) email. Runs as a Firestore trigger so processing
 * is decoupled from webhook delivery and independently retryable.
 */
export const handlePaymentEvent = onDocumentCreated('WebhookEvents/{eventId}', async (event) => {
  const eventId = event.params.eventId;
  const snap = event.data;
  if (!snap) return;

  const payload = snap.data()?.['rawPayload'] as DodoWebhookPayload | undefined;
  if (!payload?.type) {
    logger.warn(`WebhookEvents/${eventId} has no payload type`);
    return;
  }

  try {
    await processEvent(payload);
    await snap.ref.update({ processed: true, processedAt: Timestamp.now() });
  } catch (error) {
    logger.error(`Failed to process WebhookEvents/${eventId}`, error);
    await snap.ref.update({
      processed: false,
      processingError: error instanceof Error ? error.message : String(error),
    });
  }
});

async function processEvent(payload: DodoWebhookPayload): Promise<void> {
  const { type } = payload;
  const data = payload.data || {};

  switch (type) {
    case 'payment.succeeded':
    case 'subscription.active':
    case 'subscription.renewed':
      await handleSuccess(type, data);
      break;

    case 'payment.failed':
    case 'subscription.failed':
      await handleFailure(type, data);
      break;

    case 'subscription.on_hold':
      await handleOnHold(data);
      break;

    case 'subscription.cancelled':
      await handleEnd(data, 'cancelled');
      break;

    case 'subscription.expired':
      await handleEnd(data, 'expired');
      break;

    case 'refund.succeeded':
      await handleRefund(data);
      break;

    default:
      logger.info(`Unhandled Dodo event type: ${type}`);
  }
}

/** Load the Product referenced in the event metadata. */
async function loadProduct(data: DodoWebhookData): Promise<(ProductDoc & { id: string }) | null> {
  const productId = data?.metadata?.productId;
  if (!productId) return null;
  const doc = await db.collection('Products').doc(productId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as ProductDoc) };
}

/** Dodo amounts are in the smallest currency unit (e.g. cents) — convert to major units. */
function toMajorUnits(amount?: number): number {
  if (typeof amount !== 'number') return 0;
  return Math.round(amount) / 100;
}

/** Write a Transaction, idempotently keyed on the Dodo payment id. */
async function recordTransaction(
  data: DodoWebhookData,
  eventType: string,
  status: TransactionStatus,
  product: (ProductDoc & { id: string }) | null,
  userId: string,
): Promise<boolean> {
  const dodoPaymentId = data.payment_id;
  if (dodoPaymentId) {
    const existing = await db.collection('Transactions').where('dodoPaymentId', '==', dodoPaymentId).limit(1).get();
    if (!existing.empty) {
      logger.info(`Transaction for payment ${dodoPaymentId} already recorded; skipping.`);
      return false;
    }
  }

  const txn: TransactionDoc = {
    userId,
    userEmail: data.customer?.email || '',
    dodoPaymentId: data.payment_id,
    dodoSubscriptionId: data.subscription_id,
    productId: product?.id || data.metadata?.productId || '',
    premiumType: product?.premiumType || data.metadata?.premiumType || '',
    amount: toMajorUnits(data.total_amount),
    currency: data.currency || '',
    status,
    type: product?.type || (data.subscription_id ? 'subscription' : 'one_time'),
    tierApplied: data.metadata?.tierLabel || '',
    eventType,
    createdAt: Timestamp.now(),
  };
  await db.collection('Transactions').add(txn);
  return true;
}

async function handleSuccess(eventType: string, data: DodoWebhookData): Promise<void> {
  const product = await loadProduct(data);
  const userRef = await findUserRef(data);
  const userId = data.metadata?.userId || '';

  const created = await recordTransaction(data, eventType, 'succeeded', product, userId);

  // Increment the product purchase counter once per buyer — on first activation
  // or one-time success, NOT on subscription renewals (tiers count buyers).
  if (created && product && eventType !== 'subscription.renewed') {
    await db.collection('Products').doc(product.id).update({ purchaseCount: FieldValue.increment(1) });
  }

  if (userRef && product) {
    const isTrial = (data.trial_period_days ?? 0) > 0 && eventType === 'subscription.active';
    await grantEntitlement(userRef, product, {
      subscriptionId: data.subscription_id,
      customerId: data.customer?.customer_id,
      rawStatus: data.status,
      isTrial,
      nextBillingDate: data.next_billing_date,
    });
  }

  await sendPaymentEmail(
    'payment_succeeded_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    {
      amount: toMajorUnits(data.total_amount),
      currency: data.currency,
      status: 'succeeded',
      plan: product?.premiumType,
      renewalDate: data.next_billing_date,
    },
  );
}

async function handleFailure(eventType: string, data: DodoWebhookData): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  await recordTransaction(data, eventType, 'failed', product, userId);

  if (eventType === 'subscription.failed') {
    const userRef = await findUserRef(data);
    if (userRef) await markPastDue(userRef);
  }

  await sendPaymentEmail(
    'payment_failed_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { amount: toMajorUnits(data.total_amount), currency: data.currency, status: 'failed', plan: product?.premiumType },
  );
}

async function handleOnHold(data: DodoWebhookData): Promise<void> {
  const userRef = await findUserRef(data);
  if (userRef) await markPastDue(userRef);
  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { status: 'on_hold' },
  );
}

async function handleEnd(data: DodoWebhookData, finalStatus: 'cancelled' | 'expired'): Promise<void> {
  const userRef = await findUserRef(data);
  if (userRef) await revokeEntitlement(userRef, data.subscription_id, finalStatus);
  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { status: finalStatus },
  );
}

async function handleRefund(data: DodoWebhookData): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  await recordTransaction(data, 'refund.succeeded', 'refunded', product, userId);

  const userRef = await findUserRef(data);
  if (userRef) await revokeEntitlement(userRef, data.subscription_id, 'expired');

  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { amount: toMajorUnits(data.total_amount), currency: data.currency, status: 'refunded' },
  );
}
