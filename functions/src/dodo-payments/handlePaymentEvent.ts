import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { findUserRef, grantEntitlement, revokeEntitlement, markPastDue } from './entitlements.js';
import { grantCredits, refundCredits, refundableCreditAmount } from './credits.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';
import { toMajorUnits } from './money.js';
import { DodoWebhookPayload, DodoWebhookData, ProductDoc, TransactionDoc, TransactionStatus, PAYMENT_PROVIDER } from './types.js';

/**
 * Give up after this many failed attempts. Without a cap, `retry: true` would
 * re-run a permanently-broken event (deleted product, malformed payload) for the
 * platform's full retry window; the doc is left flagged for manual replay instead.
 */
const MAX_PROCESSING_ATTEMPTS = 5;

/**
 * Processes a recorded webhook event: updates Transactions, adjusts the product
 * purchase counter, grants/revokes the user's entitlement, and enqueues the
 * relevant (admin-toggleable) email. Runs as a Firestore trigger so processing
 * is decoupled from webhook delivery and independently retryable.
 *
 * `retry: true` + rethrowing is what actually makes it retryable: a transient
 * failure here means a customer was charged but not entitled, so the platform
 * must run it again. Every side effect below is therefore idempotent — the
 * Transaction, buyer counter, credit ledger and outbound emails are all keyed on
 * a stable per-event id, so a redelivery is a no-op rather than a duplicate.
 */
export const handlePaymentEvent = onDocumentCreated(
  { document: 'WebhookEvents/{eventId}', retry: true },
  async (event) => {
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
      // Retries redeliver the ORIGINAL snapshot, so the running count has to be
      // read back from the document rather than taken from `snap`.
      const fresh = await snap.ref.get();
      const attempts = (typeof fresh.data()?.['processingAttempts'] === 'number'
        ? (fresh.data()?.['processingAttempts'] as number)
        : 0) + 1;
      const givingUp = attempts >= MAX_PROCESSING_ATTEMPTS;

      logger.error(
        `Failed to process WebhookEvents/${eventId} (attempt ${attempts}/${MAX_PROCESSING_ATTEMPTS})` +
          (givingUp ? ' — giving up, flagged for manual replay' : ' — will retry'),
        error,
      );
      await snap.ref.update({
        processed: false,
        processingError: error instanceof Error ? error.message : String(error),
        processingAttempts: attempts,
        lastAttemptAt: Timestamp.now(),
        ...(givingUp ? { processingFailedPermanently: true } : {}),
      });

      if (!givingUp) throw error; // signal the platform to retry
    }
  },
);

async function processEvent(payload: DodoWebhookPayload): Promise<void> {
  const { type } = payload;
  const data = payload.data || {};
  // Event time drives out-of-order protection in the entitlement writes.
  const eventAt = payload.timestamp ? new Date(payload.timestamp) : undefined;
  const at = eventAt && !isNaN(eventAt.getTime()) ? eventAt : undefined;

  if (isTestEvent(data)) {
    await handleTestEvent(type, data, at);
    return;
  }

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

/**
 * True for a charge started from the admin "test this tier" link, which stamps
 * `metadata.test` at checkout ({@link ../dodo-payments/createTestCheckoutLink}).
 */
function isTestEvent(data: DodoWebhookData): boolean {
  return data?.metadata?.test === 'true';
}

/** Map an event type onto the status its Transaction should carry. */
function statusForEvent(eventType: string): TransactionStatus {
  if (eventType.endsWith('.failed')) return 'failed';
  if (eventType.startsWith('refund.')) return 'refunded';
  if (eventType === 'payment.succeeded' || eventType === 'subscription.active' || eventType === 'subscription.renewed') {
    return 'succeeded';
  }
  return 'pending';
}

/**
 * Record an admin test charge and stop.
 *
 * The charge is real at the gateway, so it is worth seeing in the transactions
 * list — flagged `isTest` — but it must produce none of the side effects of a
 * customer purchase. Most importantly it must not touch `Products.purchaseCount`:
 * that counter selects the pricing tier for real buyers, so testing the tier
 * ladder used to silently advance it. It also must not grant entitlement or
 * credits to the admin, pollute their grandfathering trail, or send a receipt.
 */
async function handleTestEvent(eventType: string, data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const { created } = await recordTransaction(
    data,
    eventType,
    statusForEvent(eventType),
    product,
    data.metadata?.userId || '',
    eventAt,
    true,
  );
  logger.info(
    `Test-mode ${eventType} recorded with no side effects` + (created ? '' : ' (already recorded)'),
    { productId: product?.id, subscriptionId: data.subscription_id, paymentId: data.payment_id },
  );
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
 * Stable idempotency key for a webhook event.
 *
 * The event type is part of every key. It has to be: a refund payload carries the
 * ORIGINAL `payment_id`, so a payment-id-only key made `refund.succeeded` collide
 * with the charge it reverses and the refund was silently never recorded. Refunds
 * key on their own `refund_id` where one is present.
 *
 * Subscription-only events (activation, renewal, cancellation) carry no payment
 * id, so they key on the subscription id plus the billing period. The period falls
 * back through next → previous billing date → the event timestamp, so that two
 * distinct renewals can never collapse onto one key while a redelivery of the same
 * event (whose timestamp is fixed) still dedups.
 */
function buildIdempotencyKey(data: DodoWebhookData, eventType: string, eventAt?: Date): string {
  if (data.refund_id) return `ref:${data.refund_id}:${eventType}`;
  if (data.payment_id) return `pay:${data.payment_id}:${eventType}`;
  if (data.subscription_id) {
    const period = data.next_billing_date || data.previous_billing_date || eventAt?.toISOString() || '';
    return `sub:${data.subscription_id}:${eventType}:${period}`;
  }
  return `evt:${eventType}:${data.customer?.customer_id || ''}:${eventAt?.toISOString() || ''}`;
}

/** Write a Transaction, idempotently keyed on {@link buildIdempotencyKey}. */
async function recordTransaction(
  data: DodoWebhookData,
  eventType: string,
  status: TransactionStatus,
  product: (ProductDoc & { id: string }) | null,
  userId: string,
  eventAt?: Date,
  isTest = false,
): Promise<{ created: boolean; idempotencyKey: string }> {
  const idempotencyKey = buildIdempotencyKey(data, eventType, eventAt);
  const existing = await db.collection('Transactions').where('idempotencyKey', '==', idempotencyKey).limit(1).get();
  if (!existing.empty) {
    logger.info(`Transaction for ${idempotencyKey} already recorded; skipping.`);
    return { created: false, idempotencyKey };
  }

  const txn: TransactionDoc = {
    userId,
    userEmail: data.customer?.email || '',
    provider: PAYMENT_PROVIDER,
    providerPaymentId: data.payment_id,
    providerSubscriptionId: data.subscription_id,
    productId: product?.id || data.metadata?.productId || '',
    premiumType: product?.premiumType || data.metadata?.premiumType || '',
    // A refund's own `amount` is the refunded sum; `total_amount`, when the payload
    // repeats it, is the ORIGINAL charge — so refunds must read `amount` first.
    amount:
      status === 'refunded'
        ? toMajorUnits(data.amount ?? data.total_amount, data.currency)
        : toMajorUnits(data.total_amount ?? data.amount, data.currency),
    currency: data.currency || '',
    status,
    type: product?.type || (data.subscription_id ? 'subscription' : 'one_time'),
    tierApplied: data.metadata?.tierLabel || '',
    discountCode: data.metadata?.discountCode || '',
    eventType,
    idempotencyKey,
    // Omitted rather than written false, so real transactions stay unchanged.
    ...(isTest ? { isTest: true } : {}),
    createdAt: Timestamp.now(),
  };
  await db.collection('Transactions').add(txn);
  return { created: true, idempotencyKey };
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

  const { created, idempotencyKey } = await recordTransaction(data, eventType, 'succeeded', product, userId, eventAt);

  // Count the buyer at most once — one-time purchase or first subscription
  // activation only. Renewal charges never add a buyer (tiers count buyers).
  // Deliberately NOT gated on `created`: countBuyerOnce has its own atomic
  // CountedBuyers guard, and gating would permanently lose the count on a retry
  // that happens after the Transaction was already written.
  if (product) {
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

  // Dodo emits BOTH a subscription event and a payment.succeeded for a single
  // charge, so emailing on every success event sent two receipts per purchase.
  // The receipt belongs to the event that moved money; the subscription events
  // only announce a trial starting, which no payment event covers.
  const recipient = { email: data.customer?.email || '', name: data.customer?.name };
  if (eventType === 'payment.succeeded') {
    if (created) {
      await sendPaymentEmail(
        'payment_succeeded_email',
        recipient,
        {
          amount: toMajorUnits(data.total_amount, data.currency),
          currency: data.currency,
          status: 'succeeded',
          plan: product?.premiumType,
          renewalDate: data.next_billing_date,
        },
        idempotencyKey,
      );
    }
  } else if (eventType === 'subscription.active' && (data.trial_period_days ?? 0) > 0) {
    await sendPaymentEmail(
      'subscription_lifecycle_email',
      recipient,
      { status: 'trialing', plan: product?.premiumType },
      idempotencyKey,
    );
  }
}

async function handleFailure(eventType: string, data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  const { created, idempotencyKey } = await recordTransaction(data, eventType, 'failed', product, userId, eventAt);
  const recipient = { email: data.customer?.email || '', name: data.customer?.name };

  if (eventType === 'subscription.failed') {
    const userRef = await findUserRef(data);
    if (userRef) await markPastDue(userRef, data.subscription_id, eventAt);
    // Not a second copy of the failure receipt — a dunning notice about the
    // subscription itself. The charge failure is reported by payment.failed.
    await sendPaymentEmail('subscription_lifecycle_email', recipient, { status: 'past_due', plan: product?.premiumType }, idempotencyKey);
    return;
  }

  if (created) {
    await sendPaymentEmail(
      'payment_failed_email',
      recipient,
      { amount: toMajorUnits(data.total_amount, data.currency), currency: data.currency, status: 'failed', plan: product?.premiumType },
      idempotencyKey,
    );
  }
}

async function handleOnHold(data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const userRef = await findUserRef(data);
  if (userRef) await markPastDue(userRef, data.subscription_id, eventAt);
  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { status: 'on_hold' },
    buildIdempotencyKey(data, 'subscription.on_hold', eventAt),
  );
}

async function handleEnd(data: DodoWebhookData, finalStatus: 'cancelled' | 'expired', eventAt?: Date): Promise<void> {
  const userRef = await findUserRef(data);
  if (userRef) await revokeEntitlement(userRef, data.subscription_id, finalStatus, eventAt);
  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { status: finalStatus },
    buildIdempotencyKey(data, `subscription.${finalStatus}`, eventAt),
  );
}

async function handleRefund(data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  const isPartial = data.is_partial === true;

  // Always record the refund. Its amount is the refunded amount (data.amount).
  const { idempotencyKey } = await recordTransaction(data, 'refund.succeeded', 'refunded', product, userId, eventAt);

  // Only a FULL refund removes access and claws back credits. A partial refund
  // (e.g. a prorated/goodwill amount) leaves the entitlement and credits intact.
  if (!isPartial) {
    const userRef = await findUserRef(data);
    if (userRef) {
      await revokeEntitlement(userRef, data.subscription_id, 'expired', eventAt);

      if (product && (product.creditsGranted ?? 0) > 0) {
        const key = data.payment_id || data.subscription_id || '';
        // Claw back what the refunded charge actually granted — not the product's
        // current per-charge allowance, which under-counts a subscription that
        // granted once per renewal and is stale if the product was since edited.
        const amount = await refundableCreditAmount({
          providerPaymentId: data.payment_id,
          providerSubscriptionId: data.subscription_id,
          fallback: product.creditsGranted as number,
        });
        await refundCredits(userRef, userId, amount, {
          ledgerId: `refund:${key}`,
          productId: product.id,
          providerPaymentId: data.payment_id,
        });
      }
    }
  }

  await sendPaymentEmail(
    'subscription_lifecycle_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { amount: toMajorUnits(data.amount ?? data.total_amount, data.currency), currency: data.currency, status: 'refunded' },
    idempotencyKey,
  );
}
