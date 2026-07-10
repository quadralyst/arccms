import { Timestamp, DocumentReference, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { DodoWebhookData, ProductDoc, UserEntitlement } from './types.js';

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

    const expiresAt = opts.nextBillingDate ? Timestamp.fromDate(new Date(opts.nextBillingDate)) : null;

    const entitlement: UserEntitlement = {
      isPro: true,
      premiumType: product.premiumType,
      premiumTierRank: newRank,
      premiumStatus: mapStatus(opts.rawStatus, opts.isTrial),
      premiumExpiresAt: expiresAt,
      dodoSubscriptionId: opts.subscriptionId ?? null,
      dodoCustomerId: opts.customerId ?? null,
    };

    tx.set(
      userRef,
      { ...entitlement, ...eventAtPatch(current, opts.eventAt), modifiedAt: Timestamp.now() },
      { merge: true },
    );
  });
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
    if (subscriptionId && current['dodoSubscriptionId'] && current['dodoSubscriptionId'] !== subscriptionId) {
      logger.info('Skipping revoke — different active subscription', {
        ending: subscriptionId,
        active: current['dodoSubscriptionId'],
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
        dodoSubscriptionId: FieldValue.delete(),
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

    if (subscriptionId && current['dodoSubscriptionId'] && current['dodoSubscriptionId'] !== subscriptionId) {
      logger.info('Skipping past-due — different active subscription', {
        failing: subscriptionId,
        active: current['dodoSubscriptionId'],
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
