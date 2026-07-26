import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings } from '../types.js';
import { sendDueEnrollment } from './dripSend.js';
import type { DripCampaignDoc } from './dripEnrollment.js';

/** Max enrollments processed per run; leftovers are picked up next tick. */
const MAX_PER_RUN = 100;

/**
 * Drip scheduler (spec §Phase-7.3). Every 15 minutes, send the due step of each
 * active enrollment after re-verifying eligibility, then advance or complete.
 *
 * The per-enrollment work lives in `dripSend.sendDueEnrollment`, shared with the
 * U5 day-0 fast path so both paths apply identical eligibility rules.
 *
 * Kill-switch / drips-feature off ⇒ the step is HELD (never advanced or lost) so
 * it retries when re-enabled. Leaving the list / unsubscribing / suppression ⇒
 * the enrollment exits.
 */
export const processDripQueue = onSchedule({ schedule: 'every 15 minutes', timeZone: 'UTC' }, async () => {
  const now = Timestamp.now();
  let snap;
  try {
    snap = await db
      .collection('DripEnrollments')
      .where('status', '==', 'active')
      .where('nextSendAt', '<=', now)
      .limit(MAX_PER_RUN)
      .get();
  } catch (err) {
    logger.error('processDripQueue: query failed', err);
    return;
  }

  const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  const campaignCache = new Map<string, DripCampaignDoc | null>();
  const tally = { sent: 0, completed: 0, exited: 0, held: 0 };

  for (const doc of snap.docs) {
    const outcome = await sendDueEnrollment(doc.ref, doc.data(), { settings, campaignCache });
    tally[outcome]++;
  }

  logger.info(
    `processDripQueue: sent=${tally.sent} completed=${tally.completed} `
    + `exited=${tally.exited} held=${tally.held} (${snap.size} due).`,
  );
});
