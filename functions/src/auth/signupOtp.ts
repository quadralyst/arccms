import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { ensureDefaultTemplates } from '../email-core/defaultTemplates.js';
import type { EmailTemplateData } from '../types.js';

/** OTP lifetime. */
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** Minimum gap between resends for the same address. */
const RESEND_THROTTLE_MS = 60 * 1000; // 60 seconds
/** Max verify attempts before a fresh code is required. */
const MAX_ATTEMPTS = 5;

const SIGNUP_OTP_COLLECTION = 'signup_otps';

function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

function generateCode(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * What a code is for: `signup` (the sign-up page) or `link` (adding or changing
 * the email of the signed-in account, which records whose request it was).
 * Records written before this existed have no purpose and are sign-up codes.
 */
export type EmailOtpPurpose = 'signup' | 'link';

/** How long a verified code stays usable for the step that follows it. */
export const EMAIL_VERIFIED_WINDOW_MS = 30 * 60 * 1000;

/** Codes are stored hashed (salted by emailHash) — never in plaintext. */
function hashCode(code: string, emailHash: string): string {
  return createHash('sha256').update(`${emailHash}:${code}`).digest('hex');
}

async function loadSignupOtpTemplate(): Promise<(EmailTemplateData & { isActive?: boolean }) | null> {
  const read = async () =>
    db.collection('EmailTemplate').where('type', '==', 'signup_otp_email').limit(1).get();

  let snap = await read();
  if (snap.empty) {
    // Lazily seed defaults so a first-ever signup isn't blocked by an unseeded template.
    await ensureDefaultTemplates();
    snap = await read();
  }
  return snap.empty ? null : (snap.docs[0].data() as EmailTemplateData & { isActive?: boolean });
}

/**
 * Callable: request a signup verification code (E3).
 *
 * Public (pre-auth) but rate-limited: one code per address per 60s, stored
 * hashed with a 10-minute expiry and a 5-attempt cap in
 * `signup_otps/{emailHash}`. Delivery goes through queueEmail (source `auth`,
 * transactional) so the kill-switch / authEmails toggle / suppression all apply.
 */
export const requestSignupOtp = onCall(async (request) => {
  const email = normalizeEmail(request.data?.email);
  if (!email || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }
  const name = typeof request.data?.name === 'string' && request.data.name ? request.data.name : undefined;
  return issueEmailOtp(email, 'signup', { name });
});

/**
 * Create a code for this address and email it. Shared by the sign-up page and
 * by adding an email to an account (`requestEmailLinkOtp`).
 */
export async function issueEmailOtp(
  email: string,
  purpose: EmailOtpPurpose,
  options: { name?: string; uid?: string } = {},
): Promise<{ sent: boolean; status: string }> {
  const emailHash = computeEmailHash(email);
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(emailHash);
  const now = Date.now();

  const existing = await ref.get();
  if (existing.exists) {
    const lastSent = (existing.data()?.['lastSentAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (now - lastSent < RESEND_THROTTLE_MS) {
      const wait = Math.ceil((RESEND_THROTTLE_MS - (now - lastSent)) / 1000);
      throw new HttpsError('resource-exhausted', `Please wait ${wait}s before requesting another code.`);
    }
  }

  const template = await loadSignupOtpTemplate();
  if (!template) {
    throw new HttpsError('failed-precondition', 'Signup OTP email template is not configured.');
  }

  const code = generateCode();
  await ref.set(
    {
      email,
      emailHash,
      purpose,
      uid: options.uid ?? null,
      codeHash: hashCode(code, emailHash),
      expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS),
      attempts: 0,
      lastSentAt: Timestamp.fromMillis(now),
      verified: false,
      createdAt: Timestamp.fromMillis(now),
    },
    { merge: true },
  );

  const toName = options.name || email.split('@')[0];

  const result = await queueEmail({
    source: 'auth',
    category: 'transactional',
    toEmail: email,
    toName,
    senderEmail: template.senderEmail,
    senderName: template.senderName,
    subject: template.subject,
    template: template.template,
    text: template.previewText || '',
    type: 'signup_otp_email',
    templateIsActive: template.isActive !== false,
    data: { otp: code },
  });

  logger.info(`issueEmailOtp: queued ${purpose} OTP for ${email} (status=${result.status}).`);
  return { sent: result.status === 'pending', status: result.status };
}

/**
 * Callable: verify a signup code (E3). Server-authoritative — checks expiry,
 * the attempt cap, and the hashed code. On success marks the record verified so
 * the account can be created with `emailVerified:true`.
 */
export const verifySignupOtp = onCall(async (request) => {
  const email = normalizeEmail(request.data?.email);
  const code = String(request.data?.code || '');
  if (!email || !code) {
    throw new HttpsError('invalid-argument', 'Email and code are required.');
  }
  const purpose: EmailOtpPurpose = request.data?.purpose === 'link' ? 'link' : 'signup';

  const emailHash = computeEmailHash(email);
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(emailHash);
  const snap = await ref.get();
  if (!snap.exists || !matchesPurpose(snap.data()!, purpose, request.auth?.uid)) {
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

  if (data['codeHash'] !== hashCode(code, emailHash)) {
    await ref.update({ attempts: attempts + 1 });
    throw new HttpsError('invalid-argument', 'Invalid verification code.');
  }

  await ref.update({ verified: true, verifiedAt: Timestamp.now() });
  logger.info(`verifySignupOtp: verified ${email}.`);
  return { verified: true };
});

function matchesPurpose(data: Record<string, unknown>, purpose: EmailOtpPurpose, uid: string | undefined): boolean {
  const stored = (data['purpose'] as EmailOtpPurpose | undefined) ?? 'signup';
  if (stored !== purpose) return false;
  return purpose !== 'link' || (!!uid && data['uid'] === uid);
}

/** Whether this address was verified with a sign-up code (the proof `onUserCreated` needs). */
export async function wasVerifiedBySignupCode(email: string): Promise<boolean> {
  const snap = await db.collection(SIGNUP_OTP_COLLECTION).doc(computeEmailHash(normalizeEmail(email))).get();
  const data = snap.data();
  if (!data || data['verified'] !== true || ((data['purpose'] as string | undefined) ?? 'signup') !== 'signup') return false;
  // Only a recent verification: an old one says nothing about who signed up now.
  const verifiedAt = (data['verifiedAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
  return Date.now() - verifiedAt <= EMAIL_VERIFIED_WINDOW_MS;
}

/** Use up a verified link code. Returns false when there is none for this caller. */
export async function consumeVerifiedEmailLinkOtp(email: string, uid: string): Promise<boolean> {
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(computeEmailHash(normalizeEmail(email)));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data || data['verified'] !== true || !matchesPurpose(data, 'link', uid)) return false;
    const verifiedAt = (data['verifiedAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (Date.now() - verifiedAt > EMAIL_VERIFIED_WINDOW_MS) return false;
    tx.delete(ref);
    return true;
  });
}
