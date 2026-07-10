import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/** Days past `premiumExpiresAt` before we force-expire — absorbs renewal-webhook lag. */
const GRACE_DAYS = 3;

/** Subscription statuses that should lose access once expiry + grace has passed. */
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'] as const;

/**
 * Daily safety net for subscription access. Normally the webhook
 * (`subscription.cancelled` / `.expired`) revokes access; if that delivery is
 * missed, a subscription could stay `isPro` forever. This scan force-expires any
 * subscription whose `premiumExpiresAt` is older than now − GRACE_DAYS.
 *
 * One-time / lifetime purchases are unaffected: they carry no `premiumExpiresAt`
 * (so they never match the range query) and no `dodoSubscriptionId` (a second
 * guard). Their `updatesUntil` is informational and never revokes access.
 *
 * Reuses the existing users composite index (premiumStatus + premiumExpiresAt).
 */
export const scanExpiredEntitlements = onSchedule({ schedule: 'every day 08:00', timeZone: 'UTC' }, async () => {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000));
  let expired = 0;

  for (const status of ACTIVE_STATUSES) {
    const snap = await db
      .collection('users')
      .where('premiumStatus', '==', status)
      .where('premiumExpiresAt', '<=', cutoff)
      .get();

    for (const doc of snap.docs) {
      const user = doc.data();
      // Only subscriptions expire; a lifetime one-time grant has no subscription id.
      if (!user['dodoSubscriptionId']) continue;

      await doc.ref.set(
        {
          isPro: false,
          premiumStatus: 'expired',
          premiumType: null,
          premiumTierRank: null,
          modifiedAt: Timestamp.now(),
        },
        { merge: true },
      );
      expired++;
    }
  }

  logger.info(`Entitlement expiry scan complete: ${expired} subscription(s) force-expired (grace ${GRACE_DAYS}d).`);
});
