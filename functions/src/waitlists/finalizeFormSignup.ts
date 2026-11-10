import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { getEmailTemplate } from '../utils/emailTemplateHelper.js';
import type { EmailSettings } from '../types.js';
import { readFormId } from './formInput.js';
import { FORM_TICKET_TTL_MS, memberFromTicket } from './formTicket.js';

/**
 * Server-authoritative completion of a form signup (audience-unification spec U5,
 * item 5).
 *
 * The browser used to write `emailVerified`, `isConfirmed` and `verifiedAt` itself,
 * which is why the security rules had to allow unauthenticated updates to those
 * fields, and therefore why anyone could mark themselves verified with a single
 * Firestore write. Moving these writes here is what makes the rules lockdown
 * possible.
 *
 * Signup forms are plain (specs/form-gamification-spec.md): no queue position or
 * referral is recorded. The confirmed count still sets the form's `totalSignups`.
 *
 * The member is named by the ticket `joinForm` gave (formTicket.ts), not by an id,
 * so a caller can only finish the signup it started.
 *
 * **Authorization is derived, never supplied.** The caller cannot say "no OTP was
 * needed": this function decides whether the form requires one (email enabled AND
 * an active OTP template) and, when it does, demands a *verified* `form_otps`
 * record for that member's address. Trusting a client flag would recreate the hole
 * in a new place.
 */

interface FinalizeResult {
  totalSignups: number;
  emailVerified: boolean;
  alreadyConfirmed: boolean;
}

/**
 * Does this form gate signup behind a verification code?
 *
 * Fails **closed**. The earlier version returned `false` whenever the template
 * lookup threw, so a form with no OTP template — the out-of-the-box state for any
 * form that missed the create trigger — was treated as "verification not required"
 * and confirmed signups as unverified. That is the wrong direction to fail in: it
 * lets unproven addresses into marketing sends while the form looks healthy.
 *
 * The only fail-open cases are the ones where no code *could* have been sent, so
 * demanding one would strand every signup.
 */
async function otpRequired(waitlistId: string): Promise<boolean> {
  let settings: EmailSettings | undefined;
  try {
    settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  } catch { /* treat as not configured */ }

  // Email switched off entirely (or no provider) ⇒ nothing was ever sent.
  if (!settings?.isEnabled || !settings?.activeProvider) return false;
  if (settings.features?.waitlistEmails === false) return false;

  // Email IS on, so a code should exist. getEmailTemplate seeds this form's
  // defaults when they are missing, so reaching the catch means we could neither
  // find nor create one — a real misconfiguration, not a reason to skip
  // verification.
  const template = await getEmailTemplate(waitlistId, 'waitlist_verify_otp_email');

  // Deactivating the template is the supported way to turn a form's OTP off
  // (deleting it is not — the default is recreated on demand by design).
  return template.isActive !== false;
}

export const finalizeFormSignup = onCall(async (request) => {
  const waitlistId = readFormId(request.data?.waitlistId);
  // The member comes from the ticket joinForm gave, never from an id the caller names.
  const member = await memberFromTicket(waitlistId, request.data?.ticket);
  const memberRef = member.ref;
  const email = member.email;

  // ── Authorization ───────────────────────────────────────────────────────────
  // Checked before anything is answered, "already on the list" included: otherwise
  // anyone who typed someone else's address would learn that they are on it.
  let needsOtp: boolean;
  try {
    needsOtp = await otpRequired(waitlistId);
  } catch (err) {
    // Fail closed with a message an admin can act on, rather than a bare
    // `internal`, or worse, silently confirming the signup unverified.
    logger.error(`finalizeFormSignup: cannot resolve the OTP template for ${waitlistId}`, err);
    throw new HttpsError(
      'failed-precondition',
      'This form has no verification email template, so signups cannot be confirmed. '
      + 'Open the form\'s Templates page to restore the default.',
    );
  }

  if (needsOtp) {
    const otpSnap = await db
      .collection('form_otps')
      .doc(`${waitlistId}_${computeEmailHash(email)}`)
      .get();
    const otp = otpSnap.exists ? otpSnap.data() : undefined;
    const verifiedAt = (otp?.['verifiedAt'] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    // A code verified in this signup, not one left verified from an earlier one:
    // the record stays `verified` until the next code is asked for.
    if (otp?.['verified'] !== true || verifiedAt < Date.now() - FORM_TICKET_TTL_MS) {
      // The whole point of this function: without a server-side record of a
      // verified code, the signup cannot be completed.
      throw new HttpsError('permission-denied', 'This email has not been verified.');
    }
  }

  try {
    // The form's signup count: confirmed members, this one included. Counted
    // server-side so a client cannot inflate it.
    const confirmed = await db
      .collection('Waitlists').doc(waitlistId).collection('users')
      .where('isConfirmed', '==', true)
      .count().get();

    // Idempotent: re-running (a double-click, a retried request) must not count the
    // signup twice.
    if (member.data['isConfirmed'] === true) {
      // With a code, the caller proved the address, so "already on the list" is theirs
      // to hear. Without one, anyone could have typed it: the reply is the one a new
      // signup gets, so it says nothing about whether that address is on the list.
      if (!needsOtp) {
        return { totalSignups: confirmed.data().count, emailVerified: false, alreadyConfirmed: false } satisfies FinalizeResult;
      }
      return {
        totalSignups: 0,
        emailVerified: member.data['emailVerified'] === true,
        alreadyConfirmed: true,
      } satisfies FinalizeResult;
    }
    const totalSignups = confirmed.data().count + 1;

    const now = Timestamp.now();
    const update: Record<string, unknown> = {
      // `false` on the no-OTP path: the address was never actually confirmed, and
      // saying otherwise would let unverified addresses into marketing sends.
      emailVerified: needsOtp,
      isConfirmed: true,
      verifiedAt: now,
      // Clear any legacy plaintext leftovers.
      verificationCode: FieldValue.delete(),
      verificationExpires: FieldValue.delete(),
    };
    await memberRef.update(update);
    await db.collection('Waitlists').doc(waitlistId).update({ totalSignups });

    // The mirror onto `WaitlistedUsers` is gone (U6). `joinForm` no longer creates a
    // registry record, so for anyone signing up now there was nothing to mirror to —
    // the block was already a guarded no-op. Members created before the cutover keep
    // their registry doc; it is simply no longer written to.

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
      `finalizeFormSignup: member ${member.id} on ${waitlistId} confirmed (${totalSignups} signups), `
      + `emailVerified=${needsOtp}.`,
    );
    return { totalSignups, emailVerified: needsOtp, alreadyConfirmed: false } satisfies FinalizeResult;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('finalizeFormSignup failed', err);
    throw new HttpsError('internal', 'Could not complete the signup.');
  }
});
