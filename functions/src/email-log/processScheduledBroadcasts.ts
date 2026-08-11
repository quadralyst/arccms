import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/** Broadcasts scheduled more than this long ago are considered stale and parked. */
const STALE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Every 5 minutes, activate due scheduled broadcasts (Phase 6.2).
 *
 * A `scheduled` broadcast whose `scheduledAt` has passed is flipped to `queued`
 * and a continuation doc kicks off processing (audience broadcasts don't re-fire
 * the create trigger). Broadcasts left un-activated for >24h (e.g. email was
 * disabled across the window) are parked as `failed` rather than firing stale.
 */
export const processScheduledBroadcasts = onSchedule({ schedule: 'every 5 minutes', timeZone: 'UTC' }, async () => {
  const now = Timestamp.now();
  const snap = await db
    .collection('BroadcastEmails')
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', now)
    .limit(50)
    .get();

  let activated = 0;
  let parked = 0;

  for (const doc of snap.docs) {
    const scheduledAt = (doc.data()['scheduledAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (Date.now() - scheduledAt > STALE_GRACE_MS) {
      await doc.ref.update({
        status: 'failed',
        errorMessage: `Scheduled send was overdue by more than 24h and was not fired.`,
        updatedAt: Timestamp.now(),
      });
      parked++;
      continue;
    }

    await doc.ref.update({ status: 'queued', updatedAt: Timestamp.now() });
    await db.collection('_broadcast_continue').add({ broadcastId: doc.id, triggeredAt: Timestamp.now() });
    activated++;
  }

  if (activated || parked) logger.info(`processScheduledBroadcasts: activated ${activated}, parked ${parked}.`);
});
