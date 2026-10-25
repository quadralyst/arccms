/**
 * A fresh code before a sensitive action (F31 part 2, specs/sign-in-pin-spec.md,
 * docs/app/fresh-code.html): for the few actions a PIN is not enough for, such as
 * changing payment keys or setting up a device, and which a PIN account cannot
 * re-check with a password.
 *
 *   requestFreshCode   signed in: send a code to the person's own address (or, with
 *                      no address, number); nothing else can be named
 *   confirmFreshCode   signed in: the code, for a purpose; returns a proof
 *
 * The app's own function takes the proof and uses it up with useFreshCodeProof()
 * (app kit): one use, for that person and purpose, within 5 minutes. The code
 * itself is a sign-in code with purpose `fresh` (signupOtp.ts, phoneOtp.ts), with
 * the same 10-minute life, minute between sends and 5 tries.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { callerKey, canSignIn, consumeRateLimits, releaseRateLimit, requireOwnRecord, requireSignedIn, type UserRecord } from './accounts.js';
import { consumeVerifiedEmailLinkOtp, emailCodeAskedAgain, issueEmailOtp, requestedLanguage, resetCodesShown, verifyEmailCode } from './signupOtp.js';
import { consumeVerifiedPhoneOtp, issuePhoneOtp, phoneCodeAskedAgain, verifyPhoneOtp } from './phoneOtp.js';
import { maskPhone } from './phoneNumber.js';
import { readSmsSettings } from '../sms/smsSettings.js';
import { newOtpTicket, ticketMatches } from './otpTicket.js';
import { refuse } from './refusal.js';
import { isBlank } from '../shared/blank.js';

/** Proofs waiting to be used: `auth_fresh_proofs/<uid>__<purpose>`, closed to every browser. */
export const FRESH_PROOFS = 'auth_fresh_proofs';
/** How long a proof stays usable after the code was confirmed. */
export const FRESH_PROOF_MS = 5 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
const PURPOSE = /^[a-z][a-z0-9_-]{1,40}$/;

/** The purpose an app names (`pos-setup`), or the refusal. */
export function readFreshPurpose(raw: unknown): string {
    if (typeof raw !== 'string' || !PURPOSE.test(raw) || raw.includes('__')) {
        throw new HttpsError('invalid-argument', 'A fresh code purpose is lower case letters, digits, - and _, starting with a letter, 2 to 41 characters.');
    }
    return raw;
}

/** `g•••@example.com`: enough for the person to know which address, not enough to read it. */
export function maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    return `${name.slice(0, 1)}•••@${domain ?? ''}`;
}

/** Where the person's fresh code goes: their verified address first (free), else their verified number, else an address. */
export function freshCodeTarget(data: Record<string, unknown>): { via: 'email'; email: string } | { via: 'phone'; phone: string } | null {
    const email = typeof data['email'] === 'string' ? data['email'].trim().toLowerCase() : '';
    const phone = typeof data['phone'] === 'string' ? data['phone'] : '';
    if (!isBlank(email) && data['emailVerified'] === true) return { via: 'email', email };
    if (!isBlank(phone) && data['phoneVerified'] === true) return { via: 'phone', phone };
    if (!isBlank(email)) return { via: 'email', email };
    return null;
}

/** Where this signed-in person's code goes, or the refusal: never a blocked account. */
function targetOf(record: UserRecord) {
    if (!canSignIn(record.data)) throw refuse('permission-denied', 'account-blocked', 'This account is blocked. Please contact the site administrator.');
    const target = freshCodeTarget(record.data);
    if (!target) throw refuse('failed-precondition', 'no-contact', 'This account has no email address or phone number to send a code to.');
    return target;
}

const proofRef = (uid: string, purpose: string) => db.collection(FRESH_PROOFS).doc(`${uid}__${purpose}`);

export const requestFreshCode = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    readFreshPurpose(request.data?.purpose);
    const uid = String(record.data['uid']);
    const target = targetOf(record);
    const to = target.via === 'email' ? maskEmail(target.email) : maskPhone(target.phone);
    const sms = target.via === 'phone' ? await readSmsSettings() : null;

    // Asked again within the minute: the code already sent, nothing new, nothing counted.
    const asked = target.via === 'email' ? await emailCodeAskedAgain(target.email, 'fresh', uid) : await phoneCodeAskedAgain(target.phone, 'fresh', uid);
    if (asked) {
        const shown = target.via === 'email' ? await resetCodesShown() : sms!.provider === 'log' && sms!.showResetCodes;
        return { sent: true, via: target.via, to, alreadySent: true, wait: asked.wait, ...(shown ? { testMode: true, testCode: asked.code } : {}) };
    }
    const counted = await consumeRateLimits([
        { key: `fresh-ip-${callerKey(request)}`, max: 20, windowMs: HOUR, message: 'Too many attempts. Please try again later.' },
        { key: `fresh-uid-${uid}`, max: 5, windowMs: HOUR, message: 'Too many codes. Please try again later.', reason: 'too-many-codes' },
    ]);
    // Counted but not sent (a refusal from the provider, email off): given back.
    const giveBack = () => Promise.all(counted.map((key) => releaseRateLimit(key)));
    if (target.via === 'phone') {
        const { testCode, sameCode } = await issuePhoneOtp(target.phone, 'fresh', sms!, uid).catch(async (err) => {
            await giveBack();
            throw err;
        });
        const test = testCode ? { testMode: true, ...(sms!.showResetCodes ? { testCode } : { testCodeInLogs: true }) } : {};
        return { sent: true, via: 'phone', to, ...test, ...(sameCode ? { sameCode } : {}) };
    }
    const name = typeof record.data['name'] === 'string' ? record.data['name'] : undefined;
    const reply = await issueEmailOtp(target.email, 'fresh', { uid, name, language: requestedLanguage(request.data) }).catch(async (err) => {
        await giveBack();
        throw err;
    });
    if (!reply.sent) {
        await giveBack();
        throw refuse('unavailable', 'email-failed', "We couldn't send the email. Please try again later.");
    }
    const { testMode, testCode, testCodeInLogs, sameCode } = reply;
    const test = testMode ? { testMode, ...(testCode ? { testCode } : {}), ...(testCodeInLogs ? { testCodeInLogs } : {}) } : {};
    return { sent: true, via: 'email', to, ...test, ...(sameCode ? { sameCode } : {}) };
});

export const confirmFreshCode = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    const purpose = readFreshPurpose(request.data?.purpose);
    const code = String(request.data?.code ?? '');
    if (!/^\d{6}$/.test(code)) throw refuse('invalid-argument', 'code-wrong', "That code didn't work.");
    const uid = String(record.data['uid']);
    const target = targetOf(record);
    if (target.via === 'email') {
        await verifyEmailCode(target.email, code, 'fresh', uid);
        await consumeVerifiedEmailLinkOtp(target.email, uid, 'fresh');
    } else {
        await verifyPhoneOtp(target.phone, code, 'fresh', uid);
        await consumeVerifiedPhoneOtp(target.phone, 'fresh', { uid });
    }
    const { ticket, ticketHash } = newOtpTicket();
    await proofRef(uid, purpose).set({ uid, purpose, proofHash: ticketHash, expiresAt: Timestamp.fromMillis(Date.now() + FRESH_PROOF_MS) });
    logger.info(`confirmFreshCode: a fresh code was confirmed for ${purpose}.`);
    return { proof: ticket, expiresIn: FRESH_PROOF_MS / 1000 };
});

/**
 * Use up a fresh-code proof in an app's own function (docs/app/fresh-code.html): the
 * caller confirmed a fresh code for `purpose` within the last 5 minutes and this proof
 * is the one that confirmation gave their browser. Throws `permission-denied` with
 * reason `fresh-code-required` when it is missing, used, expired, another person's or
 * for another purpose, so the page asks for a code and tries again.
 */
export async function useFreshCodeProof(request: Pick<CallableRequest, 'auth'>, proof: unknown, purpose: string): Promise<void> {
    const uid = requireSignedIn(request as CallableRequest);
    readFreshPurpose(purpose);
    const ref = proofRef(uid, purpose);
    const ok = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!snap.exists || !data || data['uid'] !== uid || !ticketMatches(proof, data['proofHash'])) return false;
        tx.delete(ref);
        const expiresAt = (data['expiresAt'] as Timestamp | undefined)?.toMillis?.() ?? 0;
        return expiresAt >= Date.now();
    });
    if (!ok) throw new HttpsError('permission-denied', 'Please confirm with a fresh code first.', { reason: 'fresh-code-required' });
}
