import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { sendMail } from '../mail-config/mailConfig.js';
import type { EmailLogData } from '../types.js';

/** Max docs processed per run (bounds work; leftovers picked up next tick). */
const MAX_PER_RUN = 100;

/**
 * Every 5 minutes, retry emails that are due for another attempt.
 *
 * Picks up `retrying` (transient send failures) and `deferred` (quota-exhausted)
 * logs whose `nextAttemptAt` has passed and re-runs `sendMail`, which re-checks
 * the kill-switch and quota on each attempt.
 */
export const retryPendingEmails = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'UTC' },
  async () => {
    const now = Timestamp.now();
    const seen = new Set<string>();
    let processed = 0;

    for (const status of ['retrying', 'deferred'] as const) {
      if (processed >= MAX_PER_RUN) break;

      let snap;
      try {
        snap = await db
          .collection('EmailLogs')
          .where('status', '==', status)
          .where('nextAttemptAt', '<=', now)
          .limit(MAX_PER_RUN - processed)
          .get();
      } catch (err) {
        logger.error(`retryPendingEmails: query failed for status='${status}'`, err);
        continue;
      }

      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        processed++;
        try {
          await sendMail(doc.data() as EmailLogData, doc.id);
        } catch (err) {
          logger.error(`retryPendingEmails: sendMail failed for ${doc.id}`, err);
        }
      }
    }

    logger.info(`retryPendingEmails: processed ${processed} due email(s).`);
  },
);
