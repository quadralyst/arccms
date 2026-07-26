import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Record a referral, server-side.
 *
 * The browser used to do this: query `Waitlists/{id}/users` for
 * `where('referralCode','==',code)` to find the referrer, then read that referrer's
 * `referrals` subcollection to check for a duplicate, then write the record. Those two
 * reads are the last reason `firestore.rules` needed public read on collections holding
 * raw email addresses.
 *
 * Moving it here also closes two holes the client version had:
 *
 * - **The self-referral and duplicate guards were advisory.** They ran in the browser,
 *   so anyone could skip them and credit themselves repeatedly by writing referral
 *   records directly. The counter itself was already functions-only, but a forged record
 *   made the crediting trigger fire.
 * - **The referrer's email was exposed to the referred person.** The old code read the
 *   referrer's whole member document to compare addresses. Nothing is returned about the
 *   referrer now.
 *
 * `totalReferrals` is still incremented by onReferralCreate/onReferralUpdate from the
 * record's own path — not here — so there is exactly one place that counts.
 */

interface CreditResult {
  /** False when nothing was written: unknown code, self-referral, or already recorded. */
  recorded: boolean;
}

function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export const creditReferral = onCall(async (request): Promise<CreditResult> => {
  const waitlistId = String(request.data?.waitlistId || '').trim();
  const referrerCode = String(request.data?.referrerCode || '').trim();
  const referredEmail = String(request.data?.referredEmail || '').trim().toLowerCase();
  const referredName = String(request.data?.referredName || '').trim();
  const referredMemberId = String(request.data?.referredMemberId || '').trim();
  const status = request.data?.status === 'pending' ? 'pending' : 'completed';

  if (!waitlistId || !referrerCode || !referredEmail) {
    throw new HttpsError('invalid-argument', 'waitlistId, referrerCode and referredEmail are required.');
  }

  try {
    const members = db.collection('Waitlists').doc(waitlistId).collection('users');

    // Referral codes are per member per form, so the lookup is scoped to the form.
    const referrer = await members.where('referralCode', '==', referrerCode).limit(1).get();
    if (referrer.empty) return { recorded: false };

    const referrerDoc = referrer.docs[0];
    const referrerEmail = String(referrerDoc.data()['email'] || '').toLowerCase();

    // Self-referral. Enforced here because in the browser it was merely advisory.
    if (referrerEmail && referrerEmail === referredEmail) {
      logger.info(`creditReferral: self-referral blocked for ${referredEmail} on ${waitlistId}.`);
      return { recorded: false };
    }

    const referrals = referrerDoc.ref.collection('referrals');

    // One record per referred address per code — likewise no longer skippable.
    const duplicate = await referrals
      .where('referredEmail', '==', referredEmail)
      .where('referrerCode', '==', referrerCode)
      .limit(1)
      .get();
    if (!duplicate.empty) return { recorded: false };

    const now = Timestamp.now();
    await referrals.add({
      referrerCode,
      referredEmail,
      referredMaskedEmail: maskEmail(referredEmail),
      referredName,
      referredUserId: referredMemberId,
      waitlistId,
      referredBy: referrerDoc.id,
      status,
      createdAt: now,
      ...(status === 'completed' ? { completedAt: now } : {}),
    });

    logger.info(`creditReferral: ${status} referral recorded on ${waitlistId} for code ${referrerCode}.`);
    return { recorded: true };
  } catch (err) {
    logger.error(`creditReferral failed for ${waitlistId}`, err);
    throw new HttpsError('internal', 'Could not record the referral.');
  }
});
