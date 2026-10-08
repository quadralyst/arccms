import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { ensureDefaultTemplates } from '../email-core/defaultTemplates.js';
import type { EmailTemplateData } from '../types.js';
import { callerKey, consumeRateLimit, releaseRateLimit, requireOwnRecord } from './accounts.js';
import { newOtpTicket, ticketMatches } from './otpTicket.js';
import { isWarmUp, WARM } from './warmUp.js';
import { refuse } from './refusal.js';
import { codeSealKey, resendWait, reusableCode, sealCode } from './codeSeal.js';

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
    throw refuse('invalid-argument', 'invalid-email', 'Enter a valid email address.');
  }
  const name = typeof request.data?.name === 'string' && request.data.name ? request.data.name : undefined;
  // The wait first: only codes really sent count towards the hourly limits, and
  // one that could not be queued is given back (specs/sign-in-codes-spec.md, SC-D3, SC-D4).
  await assertEmailResendReady(email);
  const callerLimit = `email-otp-ip-${callerKey(request)}`;
  const addressLimit = `email-otp-${computeEmailHash(email)}`;
  await consumeRateLimit(callerLimit, 20, HOUR, 'Too many attempts. Please try again later.');
  await consumeRateLimit(addressLimit, 5, HOUR, 'Too many codes for this address. Please try again later.', 'too-many-codes');
  try {
    return await issueEmailOtp(email, 'signup', { name });
  } catch (err) {
    // Counted but not sent (a refusal from the provider, or a second request at once).
    await Promise.all([releaseRateLimit(callerLimit), releaseRateLimit(addressLimit)]);
    throw err;
  }
});

/**
 * Refuse with `wait` (and the seconds left) while the last code for this address
 * is under a minute old. Callers check it before counting the hourly limits, so
 * a refused send never uses one up (specs/sign-in-codes-spec.md, SC-D3).
 */
export async function assertEmailResendReady(email: string, now = Date.now()): Promise<void> {
  const existing = await db.collection(SIGNUP_OTP_COLLECTION).doc(computeEmailHash(email)).get();
  if (existing.exists) refuseWithinWait(existing.data(), now);
}

function refuseWithinWait(data: Record<string, unknown> | undefined, now: number): void {
  const wait = resendWait(data, now, RESEND_THROTTLE_MS);
  if (wait) throw refuse('resource-exhausted', 'wait', `Please wait ${wait}s before asking for another code.`, { wait });
}

/**
 * Email this address its code: the one it already has while that still works
 * (`sameCode`, specs/sign-in-codes-spec.md SC-D9), else a new one. Shared by
 * the sign-up page and by adding an email to an account (`requestEmailLinkOtp`).
 * With the Simulated provider the reply says `testMode`, and carries a sign-up
 * code as `testCode`.
 */
export async function issueEmailOtp(
  email: string,
  purpose: EmailOtpPurpose,
  options: { name?: string; uid?: string } = {},
): Promise<{ sent: boolean; status: string; testMode?: boolean; testCode?: string; sameCode?: boolean }> {
  const emailHash = computeEmailHash(email);
  const ref = db.collection(SIGNUP_OTP_COLLECTION).doc(emailHash);
  const now = Date.now();

  // Checked here too, before the transaction below settles it for two requests at once.
  await assertEmailResendReady(email, now);

  const template = await loadSignupOtpTemplate();
  if (!template) {
    throw refuse('failed-precondition', 'email-failed', "We couldn't send the email. Please try again later.");
  }
  const sealKey = await codeSealKey(); // read before the transaction, not inside it

  // The wait, the choice of code and the write in one go (SC-D11).
  const { code, sameCode } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : undefined;
    refuseWithinWait(data, now);
    const again = reusableCode(data, {
      samePurpose: !!data && matchesPurpose(data, purpose, options.uid),
      docId: emailHash, key: sealKey, now, maxAttempts: MAX_ATTEMPTS, hash: (c) => hashCode(c, emailHash),
    });
    const times = { expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS), lastSentAt: Timestamp.fromMillis(now) };
    if (again) {
      // The same code, its wrong tries kept, for another 10 minutes.
      tx.update(ref, times);
      return { code: again, sameCode: true };
    }
    const fresh = generateCode();
    tx.set(ref, {
      email,
      emailHash,
      purpose,
      uid: options.uid ?? null,
      codeHash: hashCode(fresh, emailHash),
      codeSealed: sealCode(fresh, emailHash, sealKey),
      issuedAt: Timestamp.fromMillis(now),
      attempts: 0,
      verified: false,
      createdAt: Timestamp.fromMillis(now),
      ...times,
    });
    return { code: fresh, sameCode: false };
  });
  const again = sameCode ? { sameCode: true } : {};

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
  if (!sent || !(await isSimulatedEmail())) return { sent, status: result.status, ...again };
  // Simulated provider: no email goes out, the code is only in Email Logs. The
  // page shows a sign-up code, which only makes a new account, like the Test SMS
  // provider. A link code would let anyone add an address to their account:
  // Email Logs only.
  return { sent, status: result.status, testMode: true, ...(purpose === 'signup' ? { testCode: code } : {}), ...again };
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
    throw refuse('invalid-argument', 'code-wrong', "That code didn't work.");
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

  if (outcome === 'missing') throw refuse('not-found', 'code-expired', 'That code has expired. Please ask for a new one.');
  if (outcome === 'expired') throw refuse('deadline-exceeded', 'code-expired', 'That code has expired. Please ask for a new one.');
  if (outcome === 'locked') throw refuse('resource-exhausted', 'code-tries', 'Too many tries. Please ask for a new code.');
  if (outcome === 'wrong') throw refuse('invalid-argument', 'code-wrong', "That code didn't work.");
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
