import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';

/** How far ahead of the updates-end date to send the reminder. */
const REMINDER_WINDOW_DAYS = 14;

/**
 * Daily scan that reminds users whose included free-updates window ends soon (E2).
 *
 * One-time / lifetime purchases keep access forever but stop receiving new
 * updates after `users.updatesUntil`. This scan finds users within the reminder
 * window and sends the (toggleable) `updates_ending_email` once, deduped via
 * `updatesEndingReminderSent`.
 */
export const scanUpdatesEnding = onSchedule(
  { schedule: 'every day 09:30', timeZone: 'UTC' },
  async () => {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // `<=` excludes null/missing updatesUntil, so only users with a real date match.
    const snap = await db
      .collection('users')
      .where('updatesUntil', '<=', Timestamp.fromDate(windowEnd))
      .get();

    let sent = 0;
    for (const doc of snap.docs) {
      const user = doc.data();
      if (user['updatesEndingReminderSent'] === true) continue;

      const until = (user['updatesUntil'] as Timestamp | undefined)?.toDate?.();
      if (!until) continue;
      if (until < now) continue; // window already ended — skip

      await sendPaymentEmail(
        'updates_ending_email',
        { email: user['email'], name: user['name'] || user['firstName'] },
        { plan: user['premiumType'], updatesEndDate: until.toDateString() },
      );
      await doc.ref.update({ updatesEndingReminderSent: true });
      sent++;
    }

    logger.info(`Updates-ending scan complete: ${sent} reminder(s) sent.`);
  },
);
