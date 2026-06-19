import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { sendPaymentEmail } from './paymentEmailHelper.js';

const REMINDER_WINDOW_DAYS = 3;

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

  const snap = await db
    .collection('users')
    .where('premiumStatus', '==', 'trialing')
    .where('premiumExpiresAt', '<=', Timestamp.fromDate(windowEnd))
    .get();

  let sent = 0;
  for (const doc of snap.docs) {
    const user = doc.data();
    if (user['premiumTrialReminderSent'] === true) continue;

    const expiresAt = (user['premiumExpiresAt'] as Timestamp | undefined)?.toDate();
    if (expiresAt && expiresAt < now) continue; // already ended — skip

    await sendPaymentEmail(
      'trial_ending_email',
      { email: user['email'], name: user['name'] || user['firstName'] },
      { plan: user['premiumType'], trialEndsAt: expiresAt ? expiresAt.toDateString() : '' },
    );
    await doc.ref.update({ premiumTrialReminderSent: true });
    sent++;
  }

  logger.info(`Trial-ending scan complete: ${sent} reminder(s) sent.`);
});
