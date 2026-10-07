import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { ensureDefaultTemplates } from '../email-core/defaultTemplates.js';
import type { EmailTemplateData } from '../types.js';
import { callerKey, consumeRateLimit, requireOwnRecord } from './accounts.js';
import { newOtpTicket, ticketMatches } from './otpTicket.js';
import { isWarmUp, WARM } from './warmUp.js';

const HOUR = 60 * 60 * 1000;

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
 * Public (pre-auth) but rate-limited: one code per address per 60s and 5 an
 * hour, 20 an hour per caller, stored hashed with a 10-minute expiry and a
 * 5-attempt cap in `signup_otps/{emailHash}`. Delivery goes through queueEmail (source `auth`,
 * transactional) so the kill-switch / authEmails toggle / suppression all apply.
 */
export const requestSignupOtp = onCall(async (request) => {
  if (isWarmUp(request)) return WARM;
  const email = normalizeEmail(request.data?.email);
  if (!email || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }
  const name = typeof request.data?.name === 'string' && request.data.name ? request.data.name : undefined;
  await consumeRateLimit(`email-otp-ip-${callerKey(request)}`, 20, HOUR, 'Too many attempts. Please try again later.');
  await consumeRateLimit(`email-otp-${computeEmailHash(email)}`, 5, HOUR, 'Too many codes for this address. Please try again in an hour.');
  return issueEmailOtp(email, 'signup', { name });
});

/**
 * Create a code for this address and email it. Shared by the sign-up page and
 * by adding an email to an account (`requestEmailLinkOtp`). With the Simulated
 * provider the reply says `testMode`, and carries a sign-up code as `testCode`.
 */
export async function issueEmailOtp(
  email: string,
  purpose: EmailOtpPurpose,
  options: { name?: string; uid?: string } = {},
): Promise<{ sent: boolean; status: string; testMode?: boolean; testCode?: string }> {
  const emailHash = computeEmailHash(email);
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(emailHash);
  const now = Date.now();

  const existing = await ref.get();
  if (existing.exists) {
    const lastSent = (existing.data()?.['lastSentAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (now - lastSent < RESEND_THROTTLE_MS) {
      const wait = Math.ceil((RESEND_THROTTLE_MS - (now - lastSent)) / 1000);
      throw new HttpsError('resource-exhausted', `Please wait ${wait}s before asking for another code.`);
    }
  }

  const template = await loadSignupOtpTemplate();
  if (!template) {
    throw new HttpsError('failed-precondition', "We couldn't send the email. Please try again later.");
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
    // The person is waiting for this code: send it now, not from the trigger.
    sendNow: true,
  });

  logger.info(`issueEmailOtp: queued ${purpose} OTP for ${email} (status=${result.status}).`);
  const sent = result.status === 'pending';
  if (!sent || !(await isSimulatedEmail())) return { sent, status: result.status };
  // Simulated provider: no email goes out, the code is only in Email Logs. The
  // page shows a sign-up code, which only makes a new account, like the Test SMS
  // provider. A link code would let anyone add an address to their account:
  // Email Logs only.
  return { sent, status: result.status, testMode: true, ...(purpose === 'signup' ? { testCode: code } : {}) };
}

/** Whether email goes to the Simulated provider, which records it in Email Logs and sends nothing. */
async function isSimulatedEmail(): Promise<boolean> {
  const settings = (await db.collection('Settings').doc('email').get()).data();
  return settings?.['isEnabled'] === true && settings?.['activeProvider'] === 'debug_log';
}

/**
 * Callable: verify a signup code (E3). Server-authoritative: checks expiry,
 * the attempt cap and the hashed code, counting tries in a transaction so
 * guesses sent in parallel cannot all read the same count. On success marks
 * the record verified and returns a ticket: creating the account with
 * `emailVerified:true` needs it back, so only the browser that entered the code
 * can (review F).
 */
export const verifySignupOtp = onCall(async (request) => {
  if (isWarmUp(request)) return WARM;
  const email = normalizeEmail(request.data?.email);
  const code = String(request.data?.code || '');
  if (!email || !code) {
    throw new HttpsError('invalid-argument', "That code didn't work.");
  }
  const purpose: EmailOtpPurpose = request.data?.purpose === 'link' ? 'link' : 'signup';
  // A link code is for the signed-in account's own record (never a locked app account).
  if (purpose === 'link') await requireOwnRecord(request);

  const emailHash = computeEmailHash(email);
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(emailHash);
  const { ticket, ticketHash } = newOtpTicket();
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data || !matchesPurpose(data, purpose, request.auth?.uid)) return 'missing';
    const expiresAt = (data['expiresAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (expiresAt < Date.now()) return 'expired';
    const attempts = (data['attempts'] as number) || 0;
    if (attempts >= MAX_ATTEMPTS) return 'locked';
    if (data['codeHash'] !== hashCode(code, emailHash)) {
      tx.update(ref, { attempts: attempts + 1 });
      return 'wrong';
    }
    tx.update(ref, { attempts: attempts + 1, verified: true, verifiedAt: Timestamp.now(), ticketHash });
    return 'ok';
  });

  if (outcome === 'missing') throw new HttpsError('not-found', 'That code has expired. Please ask for a new one.');
  if (outcome === 'expired') throw new HttpsError('deadline-exceeded', 'That code has expired. Please ask for a new one.');
  if (outcome === 'locked') throw new HttpsError('resource-exhausted', 'Too many tries. Please ask for a new code.');
  if (outcome === 'wrong') throw new HttpsError('invalid-argument', "That code didn't work.");
  logger.info(`verifySignupOtp: verified ${email}.`);
  return { verified: true, ticket };
});

function matchesPurpose(data: Record<string, unknown>, purpose: EmailOtpPurpose, uid: string | undefined): boolean {
  const stored = (data['purpose'] as EmailOtpPurpose | undefined) ?? 'signup';
  if (stored !== purpose) return false;
  return purpose !== 'link' || (!!uid && data['uid'] === uid);
}

/**
 * Use up a verified sign-up code for this address, when `ticket` is the one
 * its verification handed out: the proof the new account's email is verified.
 * A recent verification by someone else, or an old one, proves nothing.
 */
export async function consumeVerifiedSignupCode(email: string, ticket: unknown): Promise<boolean> {
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(computeEmailHash(normalizeEmail(email)));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data || data['verified'] !== true || !matchesPurpose(data, 'signup', undefined)) return false;
    if (!ticketMatches(ticket, data['ticketHash'])) return false;
    const verifiedAt = (data['verifiedAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (Date.now() - verifiedAt > EMAIL_VERIFIED_WINDOW_MS) return false;
    tx.delete(ref);
    return true;
  });
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
