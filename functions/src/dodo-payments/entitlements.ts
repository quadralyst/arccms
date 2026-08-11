import { Timestamp, DocumentReference, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { DodoWebhookData, ProductDoc, UserEntitlement, PAYMENT_PROVIDER } from './types.js';

/**
 * Locate the users/{id} document for a webhook event.
 * Preference order: metadata.userId (the Firebase Auth uid we set at checkout) →
 * customer email lookup. Returns null if no user can be matched.
 */
export async function findUserRef(data: DodoWebhookData): Promise<DocumentReference | null> {
  const uid = data?.metadata?.userId;
  if (uid) {
    const byUid = await db.collection('users').where('uid', '==', uid).limit(1).get();
    if (!byUid.empty) return byUid.docs[0].ref;
  }

  const email = data?.customer?.email;
  if (email) {
    const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!byEmail.empty) return byEmail.docs[0].ref;
  }

  logger.warn('No matching user for payment event', { uid, email: data?.customer?.email });
  return null;
}

/** Map a Dodo subscription/payment status to our entitlement status. */
function mapStatus(rawStatus?: string, isTrial?: boolean): UserEntitlement['premiumStatus'] {
  if (isTrial) return 'trialing';
  switch (rawStatus) {
    case 'active':
    case 'succeeded':
      return 'active';
    case 'on_hold':
    case 'past_due':
      return 'past_due';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return 'active';
  }
}

/**
 * Grant (or upgrade) a user's entitlement. Single active tier — highest rank
 * wins: an entitlement is only overwritten when the new product's tierRank is
 * greater than or equal to the user's current rank, OR the user is not pro.
 */
export async function grantEntitlement(
  userRef: DocumentReference,
  product: ProductDoc,
  opts: {
    subscriptionId?: string;
    customerId?: string;
    rawStatus?: string;
    isTrial?: boolean;
    nextBillingDate?: string;
    eventAt?: Date;
    tierLabel?: string;
    discountCode?: string;
  },
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.data() ?? {};

    // Discard events that predate the last one we applied (out-of-order delivery).
    if (isStaleEvent(current, opts.eventAt)) {
      logger.info('Skipping entitlement grant — stale (out-of-order) event', { eventAt: opts.eventAt });
      return;
    }

    const currentRank: number = typeof current['premiumTierRank'] === 'number' ? current['premiumTierRank'] : -1;
    const isCurrentlyPro = current['isPro'] === true;

    const newRank = product.tierRank ?? 0;
    // Don't downgrade an active higher tier from a lower-tier purchase.
    if (isCurrentlyPro && newRank < currentRank) {
      logger.info('Skipping entitlement grant — user holds a higher tier', { newRank, currentRank });
      return;
    }

    const entitlement: Omit<UserEntitlement, 'premiumExpiresAt'> = {
      isPro: true,
      premiumType: product.premiumType,
      premiumTierRank: newRank,
      premiumStatus: mapStatus(opts.rawStatus, opts.isTrial),
      provider: PAYMENT_PROVIDER,
      providerSubscriptionId: opts.subscriptionId ?? null,
      // A customer id is stable for the life of the account, so an event that
      // omits it must never blank out the one we already hold.
      providerCustomerId: opts.customerId ?? (current['providerCustomerId'] as string | undefined) ?? null,
      // Grandfathering audit trail — the deal locked in at purchase. Preserve the
      // original values on renewals whose webhook omits the checkout metadata.
      // Checkout metadata round-trips absent fields as '', so treat empty as absent.
      premiumTierLabel: firstNonEmpty(opts.tierLabel, current['premiumTierLabel']),
      premiumDiscountCode: firstNonEmpty(opts.discountCode, current['premiumDiscountCode']),
    };

    tx.set(
      userRef,
      {
        ...entitlement,
        ...expiresAtPatch(product, current, opts),
        ...updatesUntilPatch(product, current, opts.eventAt),
        ...eventAtPatch(current, opts.eventAt),
        modifiedAt: Timestamp.now(),
      },
      { merge: true },
    );
  });
}

/** First of `incoming`/`stored` that is a non-empty string, else null. */
function firstNonEmpty(incoming: string | undefined, stored: unknown): string | null {
  if (typeof incoming === 'string' && incoming !== '') return incoming;
  if (typeof stored === 'string' && stored !== '') return stored;
  return null;
}

/**
 * Resolve the subscription expiry (`premiumExpiresAt`) for this event.
 *
 * Returns a merge patch, and — critically — `{}` (leave the stored value alone)
 * rather than ever writing `null` over a date we already know. Dodo's `Payment`
 * payloads carry a `subscription_id` but no `next_billing_date`, so the
 * `payment.succeeded` that accompanies every `subscription.active`/`.renewed`
 * would otherwise wipe the expiry it just set.
 *
 * Precedence:
 *  1. the gateway's own `next_billing_date` — authoritative, always wins;
 *  2. an already-stored expiry still in the future — the current period is intact,
 *     so a date-less event for the same charge changes nothing;
 *  3. derived from the event time + the product's trial/billing interval — this is
 *     what advances the expiry on a charge the gateway sent no date for;
 *  4. nothing we can compute (no interval configured) — leave it alone.
 *
 * One-time products have no expiry: the field is deleted so a lifetime grant can
 * never be picked up by the daily expiry sweep.
 */
function expiresAtPatch(
  product: ProductDoc,
  current: Record<string, unknown>,
  opts: { subscriptionId?: string; nextBillingDate?: string; eventAt?: Date; isTrial?: boolean },
): Record<string, unknown> {
  // Trust the event over the product doc: anything carrying a subscription id is a
  // subscription, whatever `type` says (older products may have no `type` at all).
  const isSubscription = !!opts.subscriptionId || product.type === 'subscription';
  if (!isSubscription) {
    return product.type === 'one_time' ? { premiumExpiresAt: FieldValue.delete() } : {};
  }

  if (opts.nextBillingDate) {
    const gatewayDate = new Date(opts.nextBillingDate);
    if (!isNaN(gatewayDate.getTime())) return { premiumExpiresAt: Timestamp.fromDate(gatewayDate) };
    logger.warn('Ignoring unparseable next_billing_date', { nextBillingDate: opts.nextBillingDate });
  }

  const base = opts.eventAt ?? new Date();
  const stored = current['premiumExpiresAt'];
  if (stored instanceof Timestamp && stored.toDate().getTime() > base.getTime()) return {};

  const derived = new Date(base.getTime());
  if (opts.isTrial && (product.trialDays ?? 0) > 0) {
    derived.setDate(derived.getDate() + (product.trialDays as number));
  } else if (product.interval === 'year') {
    derived.setFullYear(derived.getFullYear() + 1);
  } else if (product.interval === 'month') {
    // Month-end overflow (Jan 31 → Mar 3) rounds the period *up*, which errs
    // toward keeping access — the safe direction for a fallback estimate.
    derived.setMonth(derived.getMonth() + 1);
  } else {
    logger.warn('No next_billing_date and no product interval — leaving premiumExpiresAt unchanged', {
      premiumType: product.premiumType,
    });
    return {};
  }
  return { premiumExpiresAt: Timestamp.fromDate(derived) };
}

/**
 * For one-time products, resolve the "free updates until" date once and preserve
 * it thereafter. Returns a merge patch: `{}` (leave the field alone) for
 * subscriptions or when already set, else `{ updatesUntil: <Timestamp|null> }`.
 * `null` means the product has no updates window configured.
 */
function updatesUntilPatch(
  product: ProductDoc,
  current: Record<string, unknown>,
  eventAt?: Date,
): Record<string, unknown> {
  if (product.type !== 'one_time') return {};
  // Set once — the original purchase date defines the window; don't slide it on re-grant.
  if (current['updatesUntil'] instanceof Timestamp) return {};

  const years = product.updatesYears ?? 0;
  const days = product.updatesDays ?? 0;
  if (years <= 0 && days <= 0) return { updatesUntil: null };

  const base = eventAt ?? new Date();
  const until = new Date(base.getTime());
  if (years > 0) until.setFullYear(until.getFullYear() + years);
  if (days > 0) until.setDate(until.getDate() + days);
  return { updatesUntil: Timestamp.fromDate(until) };
}

/**
 * Revoke a user's entitlement when a subscription is cancelled/expired.
 * Only clears if the ending subscription is the one currently granting access
 * (single-active-tier model). Concurrent/stacked subscriptions are out of scope.
 */
export async function revokeEntitlement(
  userRef: DocumentReference,
  subscriptionId: string | undefined,
  finalStatus: 'cancelled' | 'expired',
  eventAt?: Date,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.data() ?? {};

    // If the user's active subscription differs from the one ending, leave it.
    if (subscriptionId && current['providerSubscriptionId'] && current['providerSubscriptionId'] !== subscriptionId) {
      logger.info('Skipping revoke — different active subscription', {
        ending: subscriptionId,
        active: current['providerSubscriptionId'],
      });
      return;
    }

    // Discard events that predate the last one we applied (out-of-order delivery).
    if (isStaleEvent(current, eventAt)) {
      logger.info('Skipping revoke — stale (out-of-order) event', { eventAt });
      return;
    }

    tx.set(
      userRef,
      {
        isPro: false,
        premiumStatus: finalStatus,
        premiumType: null,
        premiumTierRank: null,
        providerSubscriptionId: FieldValue.delete(),
        ...eventAtPatch(current, eventAt),
        modifiedAt: Timestamp.now(),
      },
      { merge: true },
    );
  });
}

/**
 * Mark a user's entitlement as past_due without revoking (renewal/payment
 * failure). Only applies when the failing subscription is the one currently
 * granting access, and only for events newer than the last applied one.
 */
export async function markPastDue(
  userRef: DocumentReference,
  subscriptionId?: string,
  eventAt?: Date,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.data() ?? {};

    if (subscriptionId && current['providerSubscriptionId'] && current['providerSubscriptionId'] !== subscriptionId) {
      logger.info('Skipping past-due — different active subscription', {
        failing: subscriptionId,
        active: current['providerSubscriptionId'],
      });
      return;
    }

    if (isStaleEvent(current, eventAt)) {
      logger.info('Skipping past-due — stale (out-of-order) event', { eventAt });
      return;
    }

    tx.set(
      userRef,
      { premiumStatus: 'past_due', ...eventAtPatch(current, eventAt), modifiedAt: Timestamp.now() },
      { merge: true },
    );
  });
}

/** True when `eventAt` is strictly older than the last applied event timestamp. */
function isStaleEvent(current: Record<string, unknown>, eventAt?: Date): boolean {
  if (!eventAt) return false;
  const stored = current['premiumEventAt'];
  if (stored instanceof Timestamp) {
    return stored.toDate().getTime() > eventAt.getTime();
  }
  return false;
}

/** Merge patch that advances the stored event timestamp (only when we have one). */
function eventAtPatch(current: Record<string, unknown>, eventAt?: Date): Record<string, unknown> {
  if (!eventAt) return {};
  return { premiumEventAt: Timestamp.fromDate(eventAt) };
}
