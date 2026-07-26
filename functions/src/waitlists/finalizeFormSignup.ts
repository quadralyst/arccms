import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { getEmailTemplate } from '../utils/emailTemplateHelper.js';
import type { EmailSettings } from '../types.js';

/**
 * Server-authoritative completion of a form signup (audience-unification spec U5,
 * item 5).
 *
 * The browser used to write `emailVerified`, `isConfirmed`, `queuePosition` and
 * `verifiedAt` itself, which is why the security rules had to allow
 * unauthenticated updates to those fields — and therefore why anyone could mark
 * themselves verified, or jump the queue, with a single Firestore write. Moving
 * these writes here is what makes the rules lockdown possible.
 *
 * **Authorization is derived, never supplied.** The caller cannot say "no OTP was
 * needed": this function decides whether the form requires one (email enabled AND
 * an active OTP template) and, when it does, demands a *verified* `form_otps`
 * record for that member's address. Trusting a client flag would recreate the hole
 * in a new place.
 */

interface FinalizeResult {
  queuePosition: number;
  totalSignups: number;
  emailVerified: boolean;
  alreadyConfirmed: boolean;
}

/** Does this form still gate signup behind a verification code? */
async function otpRequired(waitlistId: string): Promise<boolean> {
  let settings: EmailSettings | undefined;
  try {
    settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  } catch { /* treat as not configured */ }

  // Email switched off (or no provider) ⇒ no code could ever have been sent, so
  // requiring one would strand every signup.
  if (!settings?.isEnabled || !settings?.activeProvider) return false;
  if (settings.features?.waitlistEmails === false) return false;

  // An admin can also deactivate the form's OTP template to skip verification.
  try {
    const template = await getEmailTemplate(waitlistId, 'waitlist_verify_otp_email');
    return template.isActive !== false;
  } catch {
    return false; // no template ⇒ nothing to verify against
  }
}

export const finalizeFormSignup = onCall(async (request) => {
  const waitlistId = String(request.data?.waitlistId || '').trim();
  const userId = String(request.data?.userId || '').trim();
  const referredBy = String(request.data?.referredBy || '').trim();
  if (!waitlistId || !userId) {
    throw new HttpsError('invalid-argument', 'waitlistId and userId are required.');
  }

  const memberRef = db.collection('Waitlists').doc(waitlistId).collection('users').doc(userId);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpsError('not-found', 'This signup no longer exists.');
  }
  const member = memberSnap.data()!;
  const email = String(member['email'] || '').trim().toLowerCase();
  if (!email) {
    throw new HttpsError('failed-precondition', 'This signup has no email address.');
  }

  // Idempotent: re-running (a double-click, a retried request) must not shuffle
  // positions or re-credit a referral.
  if (member['isConfirmed'] === true) {
    return {
      queuePosition: (member['queuePosition'] as number) || 0,
      totalSignups: 0,
      emailVerified: member['emailVerified'] === true,
      alreadyConfirmed: true,
    } satisfies FinalizeResult;
  }

  // ── Authorization ───────────────────────────────────────────────────────────
  const needsOtp = await otpRequired(waitlistId);
  if (needsOtp) {
    const otpSnap = await db
      .collection('form_otps')
      .doc(`${waitlistId}_${computeEmailHash(email)}`)
      .get();
    if (!otpSnap.exists || otpSnap.data()?.['verified'] !== true) {
      // The whole point of this function: without a server-side record of a
      // verified code, the signup cannot be completed.
      throw new HttpsError('permission-denied', 'This email has not been verified.');
    }
  }

  try {
    // Queue position = confirmed members + 1. Counted server-side so a client
    // cannot choose its own place in the queue.
    const confirmed = await db
      .collection('Waitlists').doc(waitlistId).collection('users')
      .where('isConfirmed', '==', true)
      .count().get();
    const queuePosition = confirmed.data().count + 1;
    const totalSignups = queuePosition;

    const now = Timestamp.now();
    const update: Record<string, unknown> = {
      // `false` on the no-OTP path: the address was never actually confirmed, and
      // saying otherwise would let unverified addresses into marketing sends.
      emailVerified: needsOtp,
      isConfirmed: true,
      queuePosition,
      verifiedAt: now,
      // Clear any legacy plaintext leftovers.
      verificationCode: FieldValue.delete(),
      verificationExpires: FieldValue.delete(),
    };
    if (referredBy) update['referredBy'] = referredBy;

    await memberRef.update(update);
    await db.collection('Waitlists').doc(waitlistId).update({ totalSignups });

    // Mirror onto the global registry while it still exists (retired in U6).
    const globalId = member['waitlistedUserId'] as string | undefined;
    if (globalId) {
      try {
        const globalRef = db.collection('WaitlistedUsers').doc(globalId);
        if ((await globalRef.get()).exists) await globalRef.update(update);
      } catch (err) {
        logger.warn(`finalizeFormSignup: could not mirror to WaitlistedUsers/${globalId}`, err);
      }
    }

    // The form's default tag, applied server-side like every other tag write.
    try {
      const defaultTagId = (await db.collection('Waitlists').doc(waitlistId).get()).data()?.['defaultTagId'];
      if (defaultTagId) {
        await memberRef.update({ tags: FieldValue.arrayUnion(defaultTagId) });
      }
    } catch (err) {
      logger.warn('finalizeFormSignup: could not apply the default tag', err);
    }

    logger.info(
      `finalizeFormSignup: ${email} on ${waitlistId} → position ${queuePosition}, `
      + `emailVerified=${needsOtp}.`,
    );
    return { queuePosition, totalSignups, emailVerified: needsOtp, alreadyConfirmed: false } satisfies FinalizeResult;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('finalizeFormSignup failed', err);
    throw new HttpsError('internal', 'Could not complete the signup.');
  }
});
