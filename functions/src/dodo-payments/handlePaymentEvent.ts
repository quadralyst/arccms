import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { findUserRef, grantEntitlement, revokeEntitlement, markPastDue, currentEntitlement } from './entitlements.js';
import { grantCredits, refundCredits, refundableCreditAmount } from './credits.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';
import { upsertContact, ensureSystemLists, SYSTEM_LISTS } from '../email-core/contacts.js';
import { isFeatureOn } from '../feature-flags.js';
import { createNotification } from '../email-core/notifications.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { emitAppEvent } from '../email-core/appEvents.js';
import { toMajorUnits } from './money.js';
import { DodoWebhookPayload, DodoWebhookData, ProductDoc, TransactionDoc, TransactionStatus, PAYMENT_PROVIDER, providerProductId } from './types.js';
import type { DocumentReference } from 'firebase-admin/firestore';
import { isAdminTestCheckout } from './testCheckouts.js';
import { getDodoClient } from './dodoClient.js';
import { arcDocument } from '../arc-config.js';

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
  { ...arcDocument('WebhookEvents/{eventId}'), retry: true },
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
          (givingUp ? ': giving up, flagged for manual replay' : ': will retry'),
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

  if (await isTestEvent(data)) {
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

    case 'subscription.plan_changed':
      await handlePlanChanged(data, at);
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
 * True for a charge started from the admin "test this tier" link, which stamps a
 * token it keeps in `metadata.test` ({@link ../dodo-payments/createTestCheckoutLink}).
 * Any other `test` value (a buyer can set checkout metadata on a payment link) is
 * ignored, and the event is handled as a real purchase with all its checks.
 */
async function isTestEvent(data: DodoWebhookData): Promise<boolean> {
  if (data?.metadata?.test === undefined) return false;
  if (await isAdminTestCheckout(data)) return true;
  logger.warn('Payment event carries a test flag no admin test checkout made; handled as a real purchase', {
    productId: data.metadata?.productId, paymentId: data.payment_id, subscriptionId: data.subscription_id,
  });
  return false;
}

/**
 * The gateway product ids the event says were paid for: the cart of a payment
 * (`product_cart[].product_id`) and the product of a subscription (`product_id`).
 */
export function paidProductIds(data: DodoWebhookData): string[] {
  const ids: string[] = [];
  if (Array.isArray(data.product_cart)) {
    for (const item of data.product_cart) {
      if (typeof item?.product_id === 'string' && item.product_id) ids.push(item.product_id);
    }
  }
  if (typeof data.product_id === 'string' && data.product_id) ids.push(data.product_id);
  return ids;
}

/**
 * How an event's purchase relates to the Product its metadata names. The metadata
 * says which Product to grant, and a buyer can set metadata on a gateway payment
 * link, so a grant also needs the gateway's own record of what was bought:
 *
 * - `paid`: the event's products include that Product's gateway product.
 * - `subscription-charge`: a charge of a subscription that names no product (Dodo's
 *   payment events list products only for one-time payments). It grants nothing
 *   itself; the subscription's own events, which name the product, do.
 * - `mismatch`: anything else, including an event that names no product at all.
 *
 * `paid` is what the event names ({@link paidProductIds}), or for a one-time payment
 * whose payload lists none, what the gateway's own record of the payment lists
 * ({@link paidProductIdsOf}).
 */
export type ProductCheck = 'paid' | 'subscription-charge' | 'mismatch';

export function checkPaidProduct(paid: string[], data: DodoWebhookData, eventType: string, product: ProductDoc): ProductCheck {
  if (!paid.length) {
    return eventType === 'payment.succeeded' && data.subscription_id ? 'subscription-charge' : 'mismatch';
  }
  const expected = providerProductId(product);
  return expected && paid.includes(expected) ? 'paid' : 'mismatch';
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
  productMismatch = false,
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
    ...(productMismatch ? { productMismatch: true } : {}),
    createdAt: Timestamp.now(),
    ...(data.payment_id ? { providerPaymentId: data.payment_id } : {}),
    ...(data.subscription_id ? { providerSubscriptionId: data.subscription_id } : {}),
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

/**
 * The products an event paid for. A one-time payment whose payload lists none is
 * read back from the gateway, so a real buyer is never refused for a short payload.
 * A failed read throws, and the trigger retries the event.
 */
export async function paidProductIdsOf(data: DodoWebhookData, eventType: string): Promise<string[]> {
  const named = paidProductIds(data);
  if (named.length || eventType !== 'payment.succeeded' || data.subscription_id || !data.payment_id) return named;
  const { client } = await getDodoClient();
  const payment = await client.payments.retrieve(data.payment_id);
  return paidProductIds({ product_cart: payment.product_cart ?? null });
}

/** Product type plus id, as loaded from `Products`. */
type LoadedProduct = ProductDoc & { id: string };

/** The success events that renew or (re)start a subscription the member may already hold. */
const SUBSCRIPTION_SUCCESS = new Set(['subscription.active', 'subscription.renewed']);

/**
 * The one Product linked to a gateway product id, or null when none or more than one is.
 * Products saved before `providerProductIds` keep a flat `dodoProductId`.
 */
export async function productByProviderId(gatewayProductId: string): Promise<LoadedProduct | null> {
  if (!gatewayProductId) return null;
  const found = new Map<string, LoadedProduct>();
  for (const field of [`providerProductIds.${PAYMENT_PROVIDER}`, 'dodoProductId']) {
    const snap = await db.collection('Products').where(field, '==', gatewayProductId).limit(2).get();
    for (const doc of snap.docs) found.set(doc.id, { ...(doc.data() as ProductDoc), id: doc.id });
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

/** Whether the member's current entitlement came from this Product. */
function holdsProduct(current: Record<string, unknown>, product: LoadedProduct): boolean {
  const held = current['premiumProductId'];
  if (typeof held === 'string' && held) return held === product.id;
  // Granted before the Product was stored on the member: the plan name stands in.
  return current['isPro'] === true && current['premiumType'] === product.premiumType;
}

/**
 * What a success event pays for, and whether it may grant.
 *
 * `checkPaidProduct` decides, except for a subscription the member already holds
 * (its id is the member's `providerSubscriptionId`) renewing under a gateway product
 * other than the Product's current one. That happens when the plan was changed in
 * the gateway, or the admin linked the Product to another gateway product. Then:
 * the Product now linked to what was paid is granted (the plan changed), or, when no
 * Product is, the Product the member holds keeps going (the link changed). Both are
 * reported to the admins (`note`); anything else that does not match is refused.
 */
export async function decideSuccessProduct(
  named: LoadedProduct,
  paid: string[],
  data: DodoWebhookData,
  eventType: string,
  userRef: DocumentReference | null,
): Promise<{ product: LoadedProduct; check: ProductCheck; note?: 'plan-changed' | 'relinked' }> {
  const check = checkPaidProduct(paid, data, eventType, named);
  if (check !== 'mismatch' || !SUBSCRIPTION_SUCCESS.has(eventType) || !data.subscription_id || !userRef || !paid.length) {
    return { product: named, check };
  }
  const current = await currentEntitlement(userRef);
  if (current['providerSubscriptionId'] !== data.subscription_id) return { product: named, check };
  const linked = await productByProviderId(paid[0]);
  if (linked && linked.id !== named.id) return { product: linked, check: 'paid', note: 'plan-changed' };
  if (!linked && holdsProduct(current, named)) return { product: named, check: 'paid', note: 'relinked' };
  return { product: named, check };
}

/** Tell the admins about a payment whose product did not match (never silent). */
async function alertProductMismatch(
  outcome: 'refused' | 'plan-changed' | 'relinked',
  product: LoadedProduct,
  data: DodoWebhookData,
): Promise<void> {
  const who = data.customer?.email || 'A customer';
  const name = product.name || product.premiumType || product.id;
  const body = outcome === 'refused'
    ? `${who} paid for something other than ${name}, so nothing was given. Check the payment in Dodo.`
    : outcome === 'plan-changed'
      ? `${who}'s subscription is now billed as ${name} in Dodo, so it now gives ${name}.`
      : `${who}'s subscription to ${name} renewed under a Dodo product that ${name} is no longer linked to. Access continues.`;
  await notifyAdmins('admin_payment_check', { title: 'Payment to check', body, link: '/admin/transactions' });
}

async function handleSuccess(eventType: string, data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const named = await loadProduct(data);
  const userRef = await findUserRef(data);
  const userId = data.metadata?.userId || '';

  // What was paid for must be the Product the metadata names, or nothing is granted:
  // no buyer counted, no access, no credits, no receipt, no customer list. Decided
  // before anything is written: a failed read of the gateway retries the whole event,
  // so the Transaction, and with it the receipt, is never written by an attempt
  // that then fails.
  const paid = named ? await paidProductIdsOf(data, eventType) : [];
  const decision = named ? await decideSuccessProduct(named, paid, data, eventType, userRef) : null;
  const product = decision?.product ?? named;
  const check = decision?.check ?? null;
  const mismatch = check === 'mismatch';

  const { created, idempotencyKey } = await recordTransaction(data, eventType, 'succeeded', product, userId, eventAt, false, mismatch);

  if (product && (mismatch || decision?.note)) {
    logger.warn(mismatch
      ? 'Payment event paid for a different product than its metadata names; nothing granted'
      : `Subscription renewed under another gateway product (${decision?.note}); granted`, {
      productId: product.id,
      expectedProviderProductId: providerProductId(product) ?? null,
      paidProviderProductIds: paid,
      paymentId: data.payment_id,
      subscriptionId: data.subscription_id,
      userId,
    });
    // Once per event: a redelivery finds its Transaction already written.
    if (created) await alertProductMismatch(mismatch ? 'refused' : decision!.note!, product, data);
  }
  if (mismatch) return;

  // Count the buyer at most once — one-time purchase or first subscription
  // activation only. Renewal charges never add a buyer (tiers count buyers).
  // Deliberately NOT gated on `created`: countBuyerOnce has its own atomic
  // CountedBuyers guard, and gating would permanently lose the count on a retry
  // that happens after the Transaction was already written.
  if (product && check === 'paid') {
    await countBuyerOnce(product, data, eventType);
  }

  if (userRef && product && check === 'paid') {
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
      paymentId: data.payment_id,
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

  // Mirror the buyer into the unified Contacts layer (source `customer`,
  // joins the `all-customers` system list). Idempotent — repeat charges no-op.
  // Contacts are the audience feature's (specs/feature-flags-spec.md).
  const customerEmail = data.customer?.email || '';
  if (customerEmail && isFeatureOn('audience')) {
    try {
      await ensureSystemLists();
      await upsertContact({
        email: customerEmail,
        name: data.customer?.name,
        userId: userId || undefined,
        source: 'customer',
        addLists: [SYSTEM_LISTS.ALL_CUSTOMERS],
      });
    } catch (err) {
      logger.warn('handleSuccess: failed to sync customer contact', err);
    }
  }

  // Notifications & event bus (Phase 5) — additive, non-fatal.
  await Promise.allSettled([
    userId
      ? createNotification({ userId, type: 'payment_succeeded', title: 'Payment received', body: 'Thank you! Your payment was successful.', createdBy: 'system' })
      : Promise.resolve(''),
    notifyAdmins('admin_payment_received', { title: 'Payment received', body: `${customerEmail || 'A customer'} paid.`, link: '/admin/transactions' }),
    emitAppEvent('payment.succeeded', { userId, contactEmail: customerEmail }),
  ]);
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
  const { idempotencyKey } = await recordTransaction(data, eventType, 'failed', product, userId, eventAt);
  const recipient = { email: data.customer?.email || '', name: data.customer?.name };

  if (eventType === 'subscription.failed') {
    const userRef = await findUserRef(data);
    if (userRef) await markPastDue(userRef, data.subscription_id, eventAt);
    // Not a second copy of the failure receipt — a dunning notice about the
    // subscription itself. The charge failure is reported by payment.failed.
    await sendPaymentEmail('subscription_lifecycle_email', recipient, { status: 'past_due', plan: product?.premiumType }, idempotencyKey);
    return;
  }

  await sendPaymentEmail(
    'payment_failed_email',
    { email: data.customer?.email || '', name: data.customer?.name },
    { amount: toMajorUnits(data.total_amount, data.currency), currency: data.currency, status: 'failed', plan: product?.premiumType },
  );

  // Notifications & event bus (Phase 5) — additive, non-fatal.
  await Promise.allSettled([
    userId
      ? createNotification({ userId, type: 'payment_failed', title: 'Payment failed', body: 'We could not process your payment. Please update your payment method.', createdBy: 'system' })
      : Promise.resolve(''),
    notifyAdmins('admin_payment_failed', { title: 'Payment failed', body: `${data.customer?.email || 'A customer'} had a payment fail.`, link: '/admin/transactions' }),
    emitAppEvent('payment.failed', { userId, contactEmail: data.customer?.email || '' }),
  ]);
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

/**
 * The plan of a subscription was changed in the gateway: the member now holds the
 * Product linked to the new gateway product. Only for the subscription the member
 * holds, and only when exactly one Product is linked to it; anything else is left
 * as it is and reported to the admins. No money moved, so no Transaction or email.
 */
async function handlePlanChanged(data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const userRef = await findUserRef(data);
  const gatewayProductId = paidProductIds(data)[0] ?? '';
  const product = await productByProviderId(gatewayProductId);
  const current = userRef ? await currentEntitlement(userRef) : {};
  const holds = !!data.subscription_id && current['providerSubscriptionId'] === data.subscription_id;
  if (!userRef || !product || !holds) {
    logger.warn('Plan change not applied', {
      gatewayProductId, subscriptionId: data.subscription_id, productFound: !!product, memberFound: !!userRef, holds,
    });
    await notifyAdmins('admin_payment_check', {
      title: 'Payment to check',
      body: `${data.customer?.email || 'A customer'} changed plan in Dodo, but the site could not match the new plan to a product. Their access is unchanged.`,
      link: '/admin/transactions',
    });
    return;
  }
  await grantEntitlement(userRef, product, {
    subscriptionId: data.subscription_id,
    customerId: data.customer?.customer_id,
    rawStatus: data.status,
    nextBillingDate: data.next_billing_date,
    eventAt,
  });
}

/** The charge a refund reverses, as its `payment.succeeded` Transaction recorded it. */
async function refundedCharge(paymentId: string | undefined): Promise<TransactionDoc | null> {
  if (!paymentId) return null;
  const snap = await db.collection('Transactions')
    .where('providerPaymentId', '==', paymentId)
    .where('eventType', '==', 'payment.succeeded')
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as TransactionDoc);
}

/**
 * Whether a refund reverses the payment that gives the member their current access:
 * the subscription they hold, or the one-time payment that granted it. A member
 * granted before the payment was stored on them is matched by the refunded charge's
 * own record (their uid and plan, and no subscription of theirs).
 */
export function refundEndsAccess(
  current: Record<string, unknown>,
  refund: { paymentId?: string; subscriptionId?: string },
  charge: TransactionDoc | null,
): boolean {
  if (current['isPro'] !== true) return false;
  const heldSub = current['providerSubscriptionId'];
  if (refund.subscriptionId && heldSub === refund.subscriptionId) return true;
  const heldPayment = current['premiumPaymentId'];
  if (typeof heldPayment === 'string' && heldPayment) return heldPayment === refund.paymentId;
  return !heldSub && !refund.subscriptionId && !!charge && !charge.isTest && !charge.productMismatch
    && charge.userId === current['uid'] && charge.premiumType === current['premiumType'];
}

async function handleRefund(data: DodoWebhookData, eventAt?: Date): Promise<void> {
  const product = await loadProduct(data);
  const userId = data.metadata?.userId || '';
  const isPartial = data.is_partial === true;

  // Always record the refund. Its amount is the refunded amount (data.amount).
  const { idempotencyKey } = await recordTransaction(data, 'refund.succeeded', 'refunded', product, userId, eventAt);

  // Only a FULL refund removes access and claws back credits. A partial refund
  // (e.g. a prorated/goodwill amount) leaves the entitlement and credits intact.
  // Whose access and credits is the refunded charge's own record, not the
  // metadata: only the member that charge was for, and only what it gave them.
  if (!isPartial) {
    const charge = await refundedCharge(data.payment_id);
    const subscriptionId = data.subscription_id || charge?.providerSubscriptionId;
    const owner = charge?.userId || userId;
    const userRef = await findUserRef({ ...data, metadata: { ...(data.metadata ?? {}), userId: owner } });
    if (userRef) {
      const current = await currentEntitlement(userRef);
      if (refundEndsAccess(current, { paymentId: data.payment_id, subscriptionId }, charge)) {
        await revokeEntitlement(userRef, subscriptionId, 'expired', eventAt);
      } else {
        logger.info('Refund leaves access alone: it is not the payment that gives the member access', {
          paymentId: data.payment_id, subscriptionId,
        });
      }

      const chargeGranted = !!charge && !charge.isTest && !charge.productMismatch && (!userId || charge.userId === userId);
      if (product && (product.creditsGranted ?? 0) > 0 && chargeGranted) {
        const key = data.payment_id || subscriptionId || '';
        // Claw back what the refunded charge actually granted — not the product's
        // current per-charge allowance, which under-counts a subscription that
        // granted once per renewal and is stale if the product was since edited.
        const amount = await refundableCreditAmount({
          providerPaymentId: data.payment_id,
          providerSubscriptionId: subscriptionId,
          fallback: product.creditsGranted as number,
        });
        await refundCredits(userRef, owner, amount, {
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
