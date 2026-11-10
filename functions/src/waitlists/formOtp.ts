import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { getEmailTemplate } from '../utils/emailTemplateHelper.js';
import { callerKey, consumeRateLimits, releaseRateLimit } from '../auth/accounts.js';
import { beforeCodeCheck, countWrongCode, type CodeTarget } from '../auth/codeGuesses.js';
import { HOUR, readFormId, requireActiveForm } from './formInput.js';
import { memberFromTicket } from './formTicket.js';

/**
 * Server-authoritative OTP for signup forms (audience-unification spec U5, U-D5).
 *
 * This is the form's double-opt-in confirmation email (the industry pattern), and
 * it replaces a client-side flow that:
 *  - generated the code in the browser,
 *  - wrote it in **plaintext** onto the member doc, where anyone could read it,
 *  - compared it in the browser, so a client could simply skip the check, and
 *  - triggered email sends from two different document-update triggers, which is
 *    why a returning user could receive two codes.
 *
 * Codes now live hashed in `form_otps/{waitlistId}_{emailHash}`, keyed per form so
 * the same address can hold independent codes for different forms.
 *
 * Both callables take the ticket `joinForm` gave (formTicket.ts), not an address:
 * the address is the member's own, read here, so a caller can only ask for or
 * check a code for the signup it just made. The form must be open.
 */

/** OTP lifetime: matches the 15 minutes the waitlist templates promise. */
const OTP_TTL_MS = 15 * 60 * 1000;
/** Minimum gap between resends for the same address on the same form. */
const RESEND_THROTTLE_MS = 60 * 1000;
/** Max verify attempts before a fresh code is required. */
const MAX_ATTEMPTS = 5;
/**
 * Codes per caller IP an hour, and per address an hour. The IP limit is higher than
 * the sign-up code's: many people on one office or school network share an IP.
 */
const CODE_LIMIT_PER_IP = 60;
const CODE_LIMIT_PER_ADDRESS = 5;

const FORM_OTP_COLLECTION = 'form_otps';

/** Six digits from the system's secure random source. */
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

/** Salted by the form + address, so a hash is useless anywhere else. */
function hashCode(code: string, scopeKey: string): string {
  return createHash('sha256').update(`${scopeKey}:${code}`).digest('hex');
}

function sameHash(stored: unknown, computed: string): boolean {
  if (typeof stored !== 'string' || stored.length !== computed.length) return false;
  return timingSafeEqual(Buffer.from(stored, 'utf8'), Buffer.from(computed, 'utf8'));
}

function otpDocId(waitlistId: string, emailHash: string): string {
  return `${waitlistId}_${emailHash}`;
}

/**
 * Wrong form codes count per address, apart from the sign-in codes' count, so
 * guessing at a form never locks the person out of signing in.
 */
function formCodeTarget(emailHash: string): CodeTarget {
  return { via: 'form', hash: emailHash };
}

/**
 * Skip reasons that belong to one address (an admin disabled the contact, a bounce
 * or complaint suppressed it). The reply for these is the reply for a sent code, so
 * the form never tells a visitor anything about someone else's address. The other
 * reasons (email off, the form's emails or template off) are the same for everyone.
 */
const ADDRESS_SKIP_REASONS: ReadonlySet<string> = new Set(['contact_disabled', 'unsubscribed', 'suppressed']);

function throttled(wait: number): HttpsError {
  return new HttpsError('resource-exhausted', `Please wait ${wait}s before requesting another code.`, { reason: 'wait', retryAfter: wait });
}

/**
 * Callable: send a form's verification code to the member the ticket names.
 *
 * Public (pre-auth) by necessity, since a visitor has no account yet, so it is
 * limited: one code a minute per form and address, then 60 codes an hour per
 * caller and 5 per address. A request that sends nothing (refused by a limit, or
 * failing before the email is queued) gives its counts back. The minute is claimed
 * in a transaction on the code record, so two requests at the same moment send one
 * code, not two. It never reveals whether the address is already on the list, or
 * anything else about it: a code not sent because of that address (disabled,
 * suppressed) gets the reply a sent code gets.
 */
export const requestFormOtp = onCall(async (request) => {
  const waitlistId = readFormId(request.data?.waitlistId);
  await requireActiveForm(waitlistId);
  const member = await memberFromTicket(waitlistId, request.data?.ticket);
  const email = member.email;

  const emailHash = computeEmailHash(email);
  const ref = db.collection(FORM_OTP_COLLECTION).doc(otpDocId(waitlistId, emailHash));
  const now = Date.now();

  // A quick answer for a resend inside the minute, before anything is counted.
  const existing = await ref.get();
  const lastSentBefore = (existing.data()?.['lastSentAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (existing.exists && now - lastSentBefore < RESEND_THROTTLE_MS) {
    throw throttled(Math.ceil((RESEND_THROTTLE_MS - (now - lastSentBefore)) / 1000));
  }

  // Per-form template (U-D5 keeps each form's own content and layout). If the
  // form has none, getEmailTemplate seeds this form's defaults and re-reads,
  // so a form that never got its templates verifies out of the box instead of
  // dead-ending every signup here.
  let template;
  try {
    template = await getEmailTemplate(waitlistId, 'waitlist_verify_otp_email');
  } catch {
    throw new HttpsError('failed-precondition', 'This form has no verification email template.');
  }

  // Both limits at once; a refusal gives back the other's count.
  const counted = await consumeRateLimits([
    { key: `form-otp-ip-${callerKey(request)}`, max: CODE_LIMIT_PER_IP, windowMs: HOUR, message: 'Too many attempts. Please try again later.' },
    {
      key: `form-otp-${emailHash}`, max: CODE_LIMIT_PER_ADDRESS, windowMs: HOUR,
      message: 'Too many codes for this address. Please try again later.', reason: 'too-many-codes',
    },
  ]);

  try {
    const code = generateCode();
    // Claim the minute and store the new code together: a request that read the
    // record before this one wrote it runs again, sees the claim and sends nothing.
    const wait = await db.runTransaction(async (tx): Promise<number> => {
      const snap = await tx.get(ref);
      const lastSent = (snap.data()?.['lastSentAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (snap.exists && now - lastSent < RESEND_THROTTLE_MS) return Math.ceil((RESEND_THROTTLE_MS - (now - lastSent)) / 1000);
      tx.set(ref, {
        waitlistId,
        email,
        emailHash,
        codeHash: hashCode(code, `${waitlistId}:${emailHash}`),
        expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS),
        attempts: 0,
        lastSentAt: Timestamp.fromMillis(now),
        verified: false,
        createdAt: Timestamp.fromMillis(now),
      }, { merge: true });
      return 0;
    });
    if (wait) throw throttled(wait);

    // The member's own name (joinForm capped it), never text from this request.
    const storedName = member.data['firstName'];
    const toName = typeof storedName === 'string' && storedName ? storedName : email.split('@')[0];

    const result = await queueEmail({
      source: 'waitlist',
      category: 'transactional',
      toEmail: email,
      toName,
      senderEmail: template.senderEmail,
      senderName: template.senderName,
      subject: template.subject,
      template: template.template,
      text: template.previewText || '',
      type: 'waitlist_verify_otp_email',
      templateIsActive: template.isActive !== false,
      data: { otp: code },
    });

    logger.info(`requestFormOtp: queued a code for member ${member.id} on ${waitlistId} (status=${result.status}).`);
    // Not sent because of this address: answered as sent (see above). Email Logs has the truth.
    if (result.status !== 'pending' && result.skipReason && ADDRESS_SKIP_REASONS.has(result.skipReason)) {
      return { sent: true, status: 'pending' };
    }
    // `sent:false` is not an error: the kill-switch or a feature toggle may be off,
    // and the caller decides how to degrade.
    return { sent: result.status === 'pending', status: result.status };
  } catch (err) {
    // Counted but not sent.
    await Promise.all(counted.map((key) => releaseRateLimit(key)));
    throw err;
  }
});

type VerifyOutcome = 'missing' | 'expired' | 'locked' | 'wrong' | 'ok';

/**
 * Callable: verify a form's code for the member the ticket names.
 *
 * Server-authoritative: expiry, attempt cap and the hash are all checked here, so
 * a client cannot self-verify. An address may send 20 wrong codes a day across
 * its forms (auth/codeGuesses.ts), apart from its sign-in codes. The attempt is counted inside a transaction, so
 * guesses sent at the same moment cannot get past the cap of 5. On success the
 * record and the member doc are marked, which is why `Waitlists/{id}/users` takes
 * no client writes to `emailVerified` (see firestore.rules).
 */
export const verifyFormOtp = onCall(async (request) => {
  const waitlistId = readFormId(request.data?.waitlistId);
  const code = typeof request.data?.code === 'string' ? request.data.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Please enter the 6-digit code.');
  }
  await requireActiveForm(waitlistId);
  const member = await memberFromTicket(waitlistId, request.data?.ticket);

  const emailHash = computeEmailHash(member.email);
  const ref = db.collection(FORM_OTP_COLLECTION).doc(otpDocId(waitlistId, emailHash));
  const expected = hashCode(code, `${waitlistId}:${emailHash}`);
  // The sign-in codes' guessing limits (auth/codeGuesses.ts): 20 wrong codes a day for
  // the address, 60 checks an hour from the caller. Each code's 5 tries stay too.
  const target = formCodeTarget(emailHash);
  await beforeCodeCheck(target, request);

  const outcome = await db.runTransaction(async (tx): Promise<VerifyOutcome> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'missing';
    const data = snap.data()!;
    const expiresAt = (data['expiresAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (expiresAt < Date.now()) return 'expired';
    const attempts = Number(data['attempts']) || 0;
    if (attempts >= MAX_ATTEMPTS) return 'locked';
    if (!sameHash(data['codeHash'], expected)) {
      tx.update(ref, { attempts: attempts + 1 });
      return 'wrong';
    }
    tx.update(ref, { verified: true, verifiedAt: Timestamp.now() });
    return 'ok';
  });

  if (outcome === 'missing') throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
  if (outcome === 'expired') throw new HttpsError('deadline-exceeded', 'Your code has expired. Please request a new one.');
  if (outcome === 'locked') throw new HttpsError('resource-exhausted', 'Too many attempts. Please request a new code.', { reason: 'code-locked' });
  if (outcome === 'wrong') {
    await countWrongCode(target);
    throw new HttpsError('invalid-argument', 'Invalid verification code.');
  }

  // Flip the member doc here, server-side, so verification state is never
  // client-writable.
  let memberVerified = false;
  try {
    await member.ref.update({
      emailVerified: true,
      verifiedAt: Timestamp.now(),
      // Clear the legacy plaintext fields if an older doc still carries them.
      verificationCode: '',
    });
    memberVerified = true;
  } catch (err) {
    logger.error(`verifyFormOtp: could not flip member ${member.id} on ${waitlistId}`, err);
  }

  logger.info(`verifyFormOtp: verified member ${member.id} on ${waitlistId} (member updated=${memberVerified}).`);
  return { verified: true, memberVerified };
});
