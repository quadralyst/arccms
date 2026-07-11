import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { findUserRef, grantEntitlement, revokeEntitlement, markPastDue } from './entitlements.js';
import { grantCredits, refundCredits } from './credits.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';
import { toMajorUnits } from './money.js';
import { DodoWebhookPayload, DodoWebhookData, ProductDoc, TransactionDoc, TransactionStatus, PAYMENT_PROVIDER } from './types.js';

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
  // Event time drives out-of-order protection in the entitlement writes.
  const eventAt = payload.timestamp ? new Date(payload.timestamp) : undefined;
  const at = eventAt && !isNaN(eventAt.getTime()) ? eventAt : undefined;

  switch (type) {
    case 'payment.succeeded':
    case 'subscription.active':
    case 'subscription.renewed':
      await handleSuccess(type, data, at);
      break;

    case 'payment.failed':
    case 'subscription.failed':
      await handleFailure(type, data, at);
      break;

    case 'subscription.on_hold':
      await handleOnHold(data, at);
      break;

    case 'subscription.cancelled':
      await handleEnd(data, 'cancelled', at);
      break;

    case 'subscription.expired':
      await handleEnd(data, 'expired', at);
      break;

    case 'refund.succeeded':
      await handleRefund(data, at);
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

/**
 * Stable idempotency key for a webhook event. Prefer the payment id; fall back to
 * the subscription id + event type + billing period so subscription-only events
 * (activation, renewal, cancellation — which may carry no payment id) still dedup.
 */
function buildIdempotencyKey(data: DodoWebhookData, eventType: string): string {
  if (data.payment_id) return `pay:${data.payment_id}`;
  if (data.subscription_id) {
    const period = data.next_billing_date || '';
    return `sub:${data.subscription_id}:${eventType}:${period}`;
  }
  return `evt:${eventType}:${data.customer?.customer_id || ''}`;
}

/** Write a Transaction, idempotently keyed on {@link buildIdempotencyKey}. */
async function recordTransaction(
  data: DodoWebhookData,
  eventType: string,
  status: TransactionStatus,
  product: (ProductDoc & { id: string }) | null,
  userId: string,
): Promise<boolean> {
  const idempotencyKey = buildIdempotencyKey(data, eventType);
  const existing = await db.collection('Transactions').where('idempotencyKey', '==', idempotencyKey).limit(1).get();
  if (!existing.empty) {
    logger.info(`Transaction for ${idempotencyKey} already recorded; skipping.`);
    return false;
  }

  const txn: TransactionDoc = {
    userId,
    userEmail: data.customer?.email || '',
    provider: PAYMENT_PROVIDER,
    providerPaymentId: data.payment_id,
    providerSubscriptionId: data.subscription_id,
    productId: product?.id || data.metadata?.productId || '',
    premiumType: product?.premiumType || data.metadata?.premiumType || '',
    amount: toMajorUnits(data.total_amount, data.currency),
    currency: data.currency || '',
    status,
    type: product?.type || (data.subscription_id ? 'subscription' : 'one_time'),
    tierApplied: data.metadata?.tierLabel || '',
    discountCode: data.metadata?.discountCode || '',
    eventType,
    idempotencyKey,
    createdAt: Timestamp.now(),
  };
  await db.collection('Transactions').add(txn);
  return true;
}

/**
 * Increment a product's confirmed-buyer counter at most once per buyer.
 *
 * A "buyer" is a one-time purchase (keyed on payment id) or the first activation
 * of a subscription (keyed on subscription id). Renewal charges — which arrive as
 * `subscription.renewed` or as a fresh `payment.succeeded` carrying a
 * subscription id — never add a buyer. A `CountedBuyers/{key}` marker created via
 * `.create()` makes this atomic and safe under webhook redelivery/retry.
 */
async function countBuyerOnce(
  product: ProductDoc & { id: string },
  data: DodoWebhookData,
  eventType: string,
): Promise<void> {
  let key: string | null = null;
  if (eventType === 'payment.succeeded' && !data.subscription_id && data.payment_id) {
    key = `pay:${data.payment_id}`;
  } else if (eventType === 'subscription.active' && data.subscription_id) {
    key = `sub:${data.subscription_id}`;
  }
  if (!key) return; // renewals / recurring charges don't add buyers

  try {
    await db.collection('CountedBuyers').doc(key).create({ productId: product.id, countedAt: Timestamp.now() });
  } catch {
    logger.info(`Buyer ${key} already counted for product ${product.id}; skipping increment.`);
    return;
  }
  await db.collection('Products').doc(product.id).update({ purchaseCount: FieldValue.increment(1) });
}

/**
 * Decide whether a success event grants a credit allowance and under which
 * idempotency key. Mirrors {@link countBuyerOnce}'s dedup shape, but — unlike the
 * buyer counter — renewals DO grant (a recurring allowance). A recurring
 * `payment.succeeded` that carries a subscription id is skipped to avoid
 * double-granting alongside `subscription.active`/`.renewed`.
 */
function creditGrantPlan(
  data: DodoWebhookData,
  eventType: string,
): { ledgerId: string; reason: 'purchase' | 'renewal' } | null {
  if (eventType === 'payment.succeeded' && !data.subscription_id && data.payment_id) {
    return { ledgerId: `grant:pay:${data.payment_id}`, reason: 'purchase' };
  }
  if (eventType === 'subscription.active' && data.subscription_id) {
    return { ledgerId: `grant:sub:${data.subscription_id}:active`, reason: 'purchase' };
  }
  if (eventType === 'subscription.renewed' && data.subscription_id) {
    const period = data.next_billing_date || data.payment_id || '';
    return { ledgerId: `grant:sub:${data.subscription_id}:renew:${period}`, reason: 'renewal' };
  }
  return null;
}

async function handleSuccess(eventType: string, data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const userRef = await findUserRef(data);
  const userId = data.metadata?.userId || '';

  const created = await recordTransaction(data, eventType, 'succeeded', product, userId);

  // Count the buyer at most once — one-time purchase or first subscription
  // activation only. Renewal charges never add a buyer (tiers count buyers).
  if (created && product) {
    await countBuyerOnce(product, data, eventType);
  }

  if (userRef && product) {
    const isTrial = (data.trial_period_days ?? 0) > 0 && eventType === 'subscription.active';
    await grantEntitlement(userRef, product, {
      subscriptionId: data.subscription_id,
      customerId: data.customer?.customer_id,
      rawStatus: data.status,
      isTrial,
      nextBillingDate: data.next_billing_date,
      eventAt,
      tierLabel: data.metadata?.tierLabel,
      discountCode: data.metadata?.discountCode,
    });

    // Prepaid credits: grant the allowance once per charge (initial + each renewal).
    const plan = creditGrantPlan(data, eventType);
    if (plan && (product.creditsGranted ?? 0) > 0) {
      await grantCredits(userRef, userId, product.creditsGranted as number, {
        ledgerId: plan.ledgerId,
        reason: plan.reason,
        productId: product.id,
        providerPaymentId: data.payment_id,
        providerSubscriptionId: data.subscription_id,
      });
    }
  }

  await sendPaymentEmail(
    'payment_succeeded_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    {
      amount: toMajorUnits(data.total_amount, data.currency),
      currency: data.currency,
      status: 'succeeded',
      plan: product?.premiumType,
      renewalDate: data.next_billing_date,
    },
  );
}

async function handleFailure(eventType: string, data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  await recordTransaction(data, eventType, 'failed', product, userId);

  if (eventType === 'subscription.failed') {
    const userRef = await findUserRef(data);
    if (userRef) await markPastDue(userRef, data.subscription_id, eventAt);
  }

  await sendPaymentEmail(
    'payment_failed_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { amount: toMajorUnits(data.total_amount, data.currency), currency: data.currency, status: 'failed', plan: product?.premiumType },
  );
}

async function handleOnHold(data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const userRef = await findUserRef(data);
  if (userRef) await markPastDue(userRef, data.subscription_id, eventAt);
  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { status: 'on_hold' },
  );
}

async function handleEnd(data: DodoWebhookData, finalStatus: 'cancelled' | 'expired', eventAt?: Date): Promise<void> {
  const userRef = await findUserRef(data);
  if (userRef) await revokeEntitlement(userRef, data.subscription_id, finalStatus, eventAt);
  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { status: finalStatus },
  );
}

async function handleRefund(data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  await recordTransaction(data, 'refund.succeeded', 'refunded', product, userId);

  const userRef = await findUserRef(data);
  if (userRef) {
    await revokeEntitlement(userRef, data.subscription_id, 'expired', eventAt);

    // Claw back the credits granted for the refunded charge (clamped at zero).
    if (product && (product.creditsGranted ?? 0) > 0) {
      const key = data.payment_id || data.subscription_id || '';
      await refundCredits(userRef, userId, product.creditsGranted as number, {
        ledgerId: `refund:${key}`,
        productId: product.id,
        providerPaymentId: data.payment_id,
      });
    }
  }

  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { amount: toMajorUnits(data.total_amount, data.currency), currency: data.currency, status: 'refunded' },
  );
}
