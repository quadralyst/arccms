/**
 * One-time codes sent by SMS, the phone twin of `signupOtp.ts`.
 *
 * One code per number at a time, in `phone_otps/{phoneHash}`, stored hashed with
 * a 10-minute expiry, a 60-second resend gap and 5 tries. A code is for one
 * purpose: `signup` (a new number), `reset` (a new PIN for a number that has an
 * account) or `link` (adding the number to the signed-in account, which also
 * records whose request it was). Verifying marks it verified and hands the
 * browser a ticket (otpTicket.ts); the step that acts on it (create the
 * account, set the PIN, link the number) consumes it within 30 minutes, with
 * that ticket, or for `link` by the same signed-in account.
 *
 * Tries are counted in a transaction, so guesses sent in parallel cannot all
 * read the same count (review F).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../init.js';
import { phoneHash } from './phoneNumber.js';
import { sendSms } from '../sms/sendSms.js';
import { newOtpTicket, ticketMatches } from './otpTicket.js';
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

/** Check a code and mark it verified. Returns the ticket the next step needs. */
export async function verifyPhoneOtp(e164: string, code: string, purpose: PhoneOtpPurpose, uid?: string): Promise<string> {
    const key = phoneHash(e164);
    const ref = db.collection(PHONE_OTPS).doc(key);
    const { ticket, ticketHash } = newOtpTicket();
    const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!snap.exists || !data || data['purpose'] !== purpose || (purpose === 'link' && data['uid'] !== uid)) return 'missing';
        const expiresAt = (data['expiresAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
        if (expiresAt < Date.now()) return 'expired';
        const attempts = Number(data['attempts'] ?? 0);
        if (attempts >= MAX_OTP_ATTEMPTS) return 'locked';
        if (data['codeHash'] !== hashCode(String(code), key)) {
            tx.update(ref, { attempts: attempts + 1 });
            return 'wrong';
        }
        tx.update(ref, { attempts: attempts + 1, verified: true, verifiedAt: Timestamp.now(), ticketHash });
        return 'ok';
    });
    if (outcome === 'ok') return ticket;
    if (outcome === 'missing') throw new HttpsError('not-found', 'That code has expired. Please ask for a new one.');
    if (outcome === 'expired') throw new HttpsError('deadline-exceeded', 'That code has expired. Please ask for a new one.');
    if (outcome === 'locked') throw new HttpsError('resource-exhausted', 'Too many tries. Please ask for a new code.');
    throw new HttpsError('invalid-argument', "That code didn't work.");
}

/**
 * Use up a verified code. Returns false when there is none for this purpose,
 * or the caller is not the one who verified it: `link` codes belong to the
 * signed-in account that asked, the others to the browser holding the ticket.
 */
export async function consumeVerifiedPhoneOtp(
    e164: string,
    purpose: PhoneOtpPurpose,
    proof: { uid?: string; ticket?: unknown },
): Promise<boolean> {
    const ref = db.collection(PHONE_OTPS).doc(phoneHash(e164));
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!snap.exists || !data || data['verified'] !== true || data['purpose'] !== purpose) return false;
        if (purpose === 'link' ? !proof.uid || data['uid'] !== proof.uid : !ticketMatches(proof.ticket, data['ticketHash'])) return false;
        const verifiedAt = (data['verifiedAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
        if (Date.now() - verifiedAt > VERIFIED_WINDOW_MS) return false;
        tx.delete(ref);
        return true;
    });
}
