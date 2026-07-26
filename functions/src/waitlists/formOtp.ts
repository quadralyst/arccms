import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { getEmailTemplate } from '../utils/emailTemplateHelper.js';

/**
 * Server-authoritative OTP for signup forms (audience-unification spec U5, U-D5).
 *
 * This is the form's double-opt-in confirmation email — the industry pattern —
 * and it replaces a client-side flow that:
 *  - generated the code in the browser,
 *  - wrote it in **plaintext** onto the member doc, where anyone could read it,
 *  - compared it in the browser, so a client could simply skip the check, and
 *  - triggered email sends from two different document-update triggers, which is
 *    why a returning user could receive two codes.
 *
 * Codes now live hashed in `form_otps/{waitlistId}_{emailHash}`, keyed per form so
 * the same address can hold independent codes for different forms.
 */

/** OTP lifetime — matches the 15 minutes the waitlist templates promise. */
const OTP_TTL_MS = 15 * 60 * 1000;
/** Minimum gap between resends for the same address on the same form. */
const RESEND_THROTTLE_MS = 60 * 1000;
/** Max verify attempts before a fresh code is required. */
const MAX_ATTEMPTS = 5;

const FORM_OTP_COLLECTION = 'form_otps';

function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Salted by the form + address, so a hash is useless anywhere else. */
function hashCode(code: string, scopeKey: string): string {
  return createHash('sha256').update(`${scopeKey}:${code}`).digest('hex');
}

function otpDocId(waitlistId: string, emailHash: string): string {
  return `${waitlistId}_${emailHash}`;
}

/**
 * Callable: send a form's verification code.
 *
 * Public (pre-auth) by necessity — a visitor has no account yet — so it is
 * rate-limited per form+address and never reveals whether the address is already
 * on the list.
 */
export const requestFormOtp = onCall(async (request) => {
  const waitlistId = String(request.data?.waitlistId || '').trim();
  const email = normalizeEmail(request.data?.email);
  if (!waitlistId) throw new HttpsError('invalid-argument', 'waitlistId is required.');
  if (!email || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }

  const emailHash = computeEmailHash(email);
  const ref = db.collection(FORM_OTP_COLLECTION).doc(otpDocId(waitlistId, emailHash));
  const now = Date.now();

  const existing = await ref.get();
  if (existing.exists) {
    const lastSent = (existing.data()?.['lastSentAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (now - lastSent < RESEND_THROTTLE_MS) {
      const wait = Math.ceil((RESEND_THROTTLE_MS - (now - lastSent)) / 1000);
      throw new HttpsError('resource-exhausted', `Please wait ${wait}s before requesting another code.`);
    }
  }

  // Per-form template, falling back to the global default (U-D5 keeps each form's
  // own content and layout).
  let template;
  try {
    template = await getEmailTemplate(waitlistId, 'waitlist_verify_otp_email');
  } catch {
    throw new HttpsError('failed-precondition', 'This form has no verification email template.');
  }

  const code = generateCode();
  await ref.set(
    {
      waitlistId,
      email,
      emailHash,
      codeHash: hashCode(code, `${waitlistId}:${emailHash}`),
      expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS),
      attempts: 0,
      lastSentAt: Timestamp.fromMillis(now),
      verified: false,
      createdAt: Timestamp.fromMillis(now),
    },
    { merge: true },
  );

  const toName = typeof request.data?.name === 'string' && request.data.name
    ? request.data.name
    : email.split('@')[0];

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

  logger.info(`requestFormOtp: queued code for ${email} on ${waitlistId} (status=${result.status}).`);
  // `sent:false` is not an error — the kill-switch or a feature toggle may be off,
  // and the caller decides how to degrade.
  return { sent: result.status === 'pending', status: result.status };
});

/**
 * Callable: verify a form's code.
 *
 * Server-authoritative: expiry, attempt cap and the hash are all checked here, so
 * a client cannot self-verify. On success the record is marked, and the caller may
 * then flip the member doc — which is why `Waitlists/{id}/users` no longer accepts
 * client writes to `emailVerified` (see firestore.rules).
 */
export const verifyFormOtp = onCall(async (request) => {
  const waitlistId = String(request.data?.waitlistId || '').trim();
  const email = normalizeEmail(request.data?.email);
  const code = String(request.data?.code || '');
  if (!waitlistId || !email || !code) {
    throw new HttpsError('invalid-argument', 'waitlistId, email and code are required.');
  }

  const emailHash = computeEmailHash(email);
  const ref = db.collection(FORM_OTP_COLLECTION).doc(otpDocId(waitlistId, emailHash));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
  }

  const data = snap.data()!;
  const expiresAt = (data['expiresAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (expiresAt < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Your code has expired. Please request a new one.');
  }

  const attempts = (data['attempts'] as number) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please request a new code.');
  }

  if (data['codeHash'] !== hashCode(code, `${waitlistId}:${emailHash}`)) {
    await ref.update({ attempts: attempts + 1 });
    throw new HttpsError('invalid-argument', 'Invalid verification code.');
  }

  await ref.update({ verified: true, verifiedAt: Timestamp.now() });

  // Flip the member doc here, server-side, so verification state is never
  // client-writable. Matched by email because the member doc id is the
  // waitlisted-user id, which the caller may not know yet.
  let memberVerified = false;
  try {
    const members = await db
      .collection('Waitlists').doc(waitlistId).collection('users')
      .where('email', '==', email).limit(1).get();
    if (!members.empty) {
      await members.docs[0].ref.update({
        emailVerified: true,
        verifiedAt: Timestamp.now(),
        // Clear the legacy plaintext fields if an older doc still carries them.
        verificationCode: '',
      });
      memberVerified = true;
    }
  } catch (err) {
    logger.error(`verifyFormOtp: could not flip member doc for ${email} on ${waitlistId}`, err);
  }

  logger.info(`verifyFormOtp: verified ${email} on ${waitlistId} (member updated=${memberVerified}).`);
  return { verified: true, memberVerified };
});
