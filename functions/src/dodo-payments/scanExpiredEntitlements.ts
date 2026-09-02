import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../init.js';

/** Days past `premiumExpiresAt` before we force-expire — absorbs renewal-webhook lag. */
const GRACE_DAYS = 3;

/** Users read (and written, in one batch) per page. Well under the 500-op batch cap. */
const PAGE_SIZE = 200;

/** Subscription statuses that should lose access once expiry + grace has passed. */
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'] as const;

/**
 * Daily safety net for subscription access. Normally the webhook
 * (`subscription.cancelled` / `.expired`) revokes access; if that delivery is
 * missed, a subscription could stay `isPro` forever. This scan force-expires any
 * subscription whose `premiumExpiresAt` is older than now − GRACE_DAYS.
 *
 * One-time / lifetime purchases are unaffected: they carry no `premiumExpiresAt`
 * (so they never match the range query) and no `providerSubscriptionId` (a second
 * guard). Their `updatesUntil` is informational and never revokes access.
 *
 * Reuses the existing users composite index (premiumStatus + premiumExpiresAt).
 * Reads and writes are paged so the scan does not grow unbounded with the user base.
 */
export const scanExpiredEntitlements = onSchedule({ schedule: 'every day 08:00', timeZone: 'UTC' }, async () => {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000));
  let expired = 0;

  for (const status of ACTIVE_STATUSES) {
    let cursor: QueryDocumentSnapshot | undefined;

    for (;;) {
      let query = db
        .collection('users')
        .where('premiumStatus', '==', status)
        .where('premiumExpiresAt', '<=', cutoff)
        // Explicit sort on the inequality field gives a stable cursor. Paging
        // forward is safe even though we mutate premiumStatus as we go: revoked
        // docs drop out of the filter and we never look back.
        .orderBy('premiumExpiresAt')
        .limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);

      const snap = await query.get();
      if (snap.empty) break;

      const batch = db.batch();
      let writes = 0;

      for (const doc of snap.docs) {
        const user = doc.data();
        // Only subscriptions expire; a lifetime one-time grant has no subscription id.
        if (!user['providerSubscriptionId']) continue;
        // Firestore orders null below every other type, so a doc whose expiry was
        // written as null matches `<= cutoff`. Never revoke on a non-date: a missing
        // expiry means we don't know the period, not that it has ended.
        if (!(user['premiumExpiresAt'] instanceof Timestamp)) {
          logger.warn(`Skipping ${doc.ref.path} — premiumExpiresAt is not a Timestamp`, {
            premiumExpiresAt: user['premiumExpiresAt'],
          });
          continue;
        }

        batch.set(
          doc.ref,
          {
            isPro: false,
            premiumStatus: 'expired',
            premiumType: null,
            premiumTierRank: null,
            modifiedAt: Timestamp.now(),
          },
          { merge: true },
        );
        writes++;
      }

      if (writes > 0) await batch.commit();
      expired += writes;

      if (snap.size < PAGE_SIZE) break;
      cursor = snap.docs[snap.size - 1];
    }
  }

  logger.info(`Entitlement expiry scan complete: ${expired} subscription(s) force-expired (grace ${GRACE_DAYS}d).`);
});
