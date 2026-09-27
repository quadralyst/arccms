/**
 * One-time codes sent by SMS, the phone twin of `signupOtp.ts`.
 *
 * One code per number at a time, in `phone_otps/{phoneHash}`, stored hashed with
 * a 10-minute expiry, a 60-second resend gap and 5 tries. A code is for one
 * purpose: `signup` (a new number), `reset` (a new PIN for a number that has an
 * account) or `link` (adding the number to the signed-in account, which also
 * records whose request it was). Verifying marks it verified; the step that
 * acts on it (create the account, set the PIN, link the number) consumes it
 * within 30 minutes.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../init.js';
import { phoneHash } from './phoneNumber.js';
import { sendSms } from '../sms/sendSms.js';
import type { SmsSettings } from '../sms/smsSettings.js';

export const PHONE_OTPS = 'phone_otps';
export const PHONE_OTP_PURPOSES = ['signup', 'reset', 'link'] as const;
export type PhoneOtpPurpose = (typeof PHONE_OTP_PURPOSES)[number];

export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESEND_THROTTLE_MS = 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
/** How long a verified code stays usable for the step that follows it. */
export const VERIFIED_WINDOW_MS = 30 * 60 * 1000;

export function isPhoneOtpPurpose(value: unknown): value is PhoneOtpPurpose {
    return PHONE_OTP_PURPOSES.includes(value as PhoneOtpPurpose);
}

function hashCode(code: string, key: string): string {
    return createHash('sha256').update(`${key}:${code}`).digest('hex');
}

export function otpSmsText(code: string): string {
    return `${code} is your verification code. It expires in 10 minutes. Do not share it with anyone.`;
}

/**
 * Create a code for this number and send it. Throws when throttled or when the
 * SMS fails. Returns the code only with the Test (log) provider, where nothing
 * is sent and the sign-in page shows it instead.
 */
export async function issuePhoneOtp(
    e164: string,
    purpose: PhoneOtpPurpose,
    settings: SmsSettings,
    uid?: string,
): Promise<{ testCode?: string }> {
    const key = phoneHash(e164);
    const ref = db.collection(PHONE_OTPS).doc(key);
    const now = Date.now();

    const existing = await ref.get();
    const lastSent = (existing.data()?.['lastSentAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (now - lastSent < RESEND_THROTTLE_MS) {
        const wait = Math.ceil((RESEND_THROTTLE_MS - (now - lastSent)) / 1000);
        throw new HttpsError('resource-exhausted', `Please wait ${wait}s before asking for another code.`);
    }

    const code = String(randomInt(100000, 1000000));
    await ref.set({
        purpose,
        uid: uid ?? null,
        codeHash: hashCode(code, key),
        expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS),
        attempts: 0,
        lastSentAt: Timestamp.fromMillis(now),
        verified: false,
    });

    const result = await sendSms({ to: e164, purpose: 'otp', code, text: otpSmsText(code) }, settings);
    if (result.status === 'failed') {
        // Let them try again straight away rather than wait out the resend gap.
        await ref.delete();
        throw new HttpsError('unavailable', "We couldn't send the SMS. Please try again in a moment.");
    }
    return result.status === 'logged' ? { testCode: code } : {};
}

/** Check a code and mark it verified. */
export async function verifyPhoneOtp(e164: string, code: string, purpose: PhoneOtpPurpose, uid?: string): Promise<void> {
    const key = phoneHash(e164);
    const ref = db.collection(PHONE_OTPS).doc(key);
    const snap = await ref.get();
    const data = snap.data();
    if (!snap.exists || !data || data['purpose'] !== purpose || (purpose === 'link' && data['uid'] !== uid)) {
        throw new HttpsError('not-found', 'That code has expired. Please ask for a new one.');
    }
    const expiresAt = (data['expiresAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (expiresAt < Date.now()) {
        throw new HttpsError('deadline-exceeded', 'That code has expired. Please ask for a new one.');
    }
    const attempts = Number(data['attempts'] ?? 0);
    if (attempts >= MAX_OTP_ATTEMPTS) {
        throw new HttpsError('resource-exhausted', 'Too many tries. Please ask for a new code.');
    }
    if (data['codeHash'] !== hashCode(String(code), key)) {
        await ref.update({ attempts: attempts + 1 });
        throw new HttpsError('invalid-argument', "That code didn't work.");
    }
    await ref.update({ verified: true, verifiedAt: Timestamp.now() });
}

/** Use up a verified code. Returns false when there is none for this purpose (and caller). */
export async function consumeVerifiedPhoneOtp(e164: string, purpose: PhoneOtpPurpose, uid?: string): Promise<boolean> {
    const ref = db.collection(PHONE_OTPS).doc(phoneHash(e164));
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!snap.exists || !data || data['verified'] !== true || data['purpose'] !== purpose) return false;
        if (purpose === 'link' && data['uid'] !== uid) return false;
        const verifiedAt = (data['verifiedAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
        if (Date.now() - verifiedAt > VERIFIED_WINDOW_MS) return false;
        tx.delete(ref);
        return true;
    });
}
