import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';

const REMINDER_WINDOW_DAYS = 3;

/** Users read per page, so the scan does not grow unbounded with the user base. */
const PAGE_SIZE = 200;

/**
 * Daily scan that emails users whose free trial ends soon.
 *
 * Dodo's standard webhook set has no reliable "trial ending" event, so we drive
 * this from local state: when a trialing subscription is activated we store the
 * trial end on the user (`premiumExpiresAt` while `premiumStatus === 'trialing'`).
 * This scan finds those within the reminder window and sends the (toggleable)
 * `trial_ending_email` once, marked via `premiumTrialReminderSent`.
 */
export const scanTrialEndings = onSchedule({ schedule: 'every day 09:00', timeZone: 'UTC' }, async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let sent = 0;
  let cursor: QueryDocumentSnapshot | undefined;

  for (;;) {
    let query = db
      .collection('users')
      .where('premiumStatus', '==', 'trialing')
      .where('premiumExpiresAt', '<=', Timestamp.fromDate(windowEnd))
      // Reminded users keep matching the filter (the flag is not part of it), so
      // the cursor is what stops this run from revisiting them.
      .orderBy('premiumExpiresAt')
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const user = doc.data();
      if (user['premiumTrialReminderSent'] === true) continue;

      // Null sorts below every type in Firestore, so a null expiry matches the
      // `<= windowEnd` range. Without a real trial-end date there is nothing to
      // remind about — skip rather than send a reminder with a blank date.
      if (!(user['premiumExpiresAt'] instanceof Timestamp)) continue;
      const expiresAt = user['premiumExpiresAt'].toDate();
      if (expiresAt < now) continue; // already ended — skip

      await sendPaymentEmail(
        'trial_ending_email',
        { email: user['email'], name: user['name'] || user['firstName'] },
        { plan: user['premiumType'], trialEndsAt: expiresAt.toDateString() },
        // The flag below is set after the send, so a crash in between would
        // otherwise re-remind on the next run.
        `trial:${doc.id}`,
      );
      await doc.ref.update({ premiumTrialReminderSent: true });
      sent++;
    }

    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.size - 1];
  }

  logger.info(`Trial-ending scan complete: ${sent} reminder(s) sent.`);
});
