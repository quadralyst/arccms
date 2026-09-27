/**
 * Phone sign-in callables: a number, an SMS code the first time, a 6-digit PIN
 * after that. Every step is public (before sign-in) and rate limited.
 *
 *   checkPhoneAccount    is this number registered, and does it have a PIN?
 *   requestPhoneOtp      send a code (signup, reset or link); with the Test
 *                        provider the reply carries the code, as no SMS is sent
 *   verifyPhoneOtp       check the code
 *   completePhoneSignup  new number: name and PIN, creates the account
 *   signInWithPin        registered number: the PIN
 *   resetPin             forgot PIN (or never set one): a new PIN after a code
 *   setPin               signed in: change the PIN
 *
 * The three that sign someone in return a custom token.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { isAllowedCountry, maskPhone, normalizePhone, phoneHash } from './phoneNumber.js';
import { readSmsSettings, type SmsSettings } from '../sms/smsSettings.js';
import {
    PHONE_INDEX,
    callerKey,
    canSignIn,
    checkPin,
    consumeRateLimit,
    findUserByPhone,
    hasPin,
    issueSignInToken,
    isValidPin,
    requireOwnRecord,
    requirePhoneSignIn,
    setPin as storePin,
} from './accounts.js';
import { consumeVerifiedPhoneOtp, isPhoneOtpPurpose, issuePhoneOtp, verifyPhoneOtp as checkPhoneOtp } from './phoneOtp.js';

const HOUR = 60 * 60 * 1000;
const TOO_MANY = 'Too many attempts. Please try again later.';

/** The number in E.164, or the error the sign-in page shows under the field. */
export function readPhone(raw: unknown, sms: SmsSettings): string {
    const e164 = normalizePhone(raw, sms.defaultCountryCode);
    if (!e164) throw new HttpsError('invalid-argument', 'Enter a valid mobile number.');
    if (!isAllowedCountry(e164, sms.allowedCountryCodes)) {
        const codes = sms.allowedCountryCodes.map((c) => `+${c}`).join(', ');
        throw new HttpsError('invalid-argument', `Only numbers starting ${codes} can be used here.`);
    }
    return e164;
}

export function readName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 60) throw new HttpsError('invalid-argument', 'Please enter your name.');
    return name;
}

function readPin(raw: unknown): string {
    if (!isValidPin(raw)) throw new HttpsError('invalid-argument', 'Your PIN is 6 digits.');
    return raw;
}

async function phoneContext(request: CallableRequest) {
    const signIn = await requirePhoneSignIn();
    const sms = await readSmsSettings();
    const phone = readPhone(request.data?.phone, sms);
    return { signIn, sms, phone };
}

export const checkPhoneAccount = onCall(async (request) => {
    await consumeRateLimit(`check-ip-${callerKey(request)}`, 100, HOUR, TOO_MANY);
    const { signIn, phone } = await phoneContext(request);
    const account = await findUserByPhone(phone);
    return {
        phone,
        exists: !!account,
        hasPin: account ? await hasPin(String(account.data['uid'])) : false,
        signupOpen: signIn.signupOpen,
    };
});

export const requestPhoneOtp = onCall(async (request) => {
    const purpose = request.data?.purpose;
    if (!isPhoneOtpPurpose(purpose)) throw new HttpsError('invalid-argument', 'Unknown request.');
    const { signIn, sms, phone } = await phoneContext(request);

    let uid: string | undefined;
    if (purpose === 'link') {
        uid = String((await requireOwnRecord(request)).data['uid']);
    } else {
        const account = await findUserByPhone(phone);
        if (purpose === 'signup' && account) throw new HttpsError('already-exists', 'This number already has an account.');
        if (purpose === 'signup' && !signIn.signupOpen) throw new HttpsError('failed-precondition', "New accounts can't be created on this site right now.");
        if (purpose === 'reset' && !account) throw new HttpsError('not-found', 'No account uses this number.');
    }

    await consumeRateLimit(`otp-ip-${callerKey(request)}`, 20, HOUR, TOO_MANY);
    await consumeRateLimit(`otp-phone-${phoneHash(phone)}`, 5, HOUR, 'Too many codes for this number. Please try again in an hour.');
    const { testCode } = await issuePhoneOtp(phone, purpose, sms, uid);
    logger.info(`requestPhoneOtp: ${purpose} code sent to ${maskPhone(phone)}.`);
    // Test provider: no SMS goes out, so the page shows the code (Settings, SMS warns admins).
    return { sent: true, phone, ...(testCode ? { testCode } : {}) };
});

export const verifyPhoneOtp = onCall(async (request) => {
    const purpose = request.data?.purpose;
    if (!isPhoneOtpPurpose(purpose)) throw new HttpsError('invalid-argument', 'Unknown request.');
    const { phone } = await phoneContext(request);
    const code = String(request.data?.code ?? '');
    if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', "That code didn't work.");
    const uid = purpose === 'link' ? request.auth?.uid : undefined;
    await checkPhoneOtp(phone, code, purpose, uid);
    return { verified: true };
});

export const completePhoneSignup = onCall(async (request) => {
    const { signIn, phone } = await phoneContext(request);
    const name = readName(request.data?.name);
    const pin = readPin(request.data?.pin);
    if (!signIn.signupOpen) throw new HttpsError('failed-precondition', "New accounts can't be created on this site right now.");
    if (await findUserByPhone(phone)) throw new HttpsError('already-exists', 'This number already has an account.');
    if (!(await consumeVerifiedPhoneOtp(phone, 'signup'))) {
        throw new HttpsError('failed-precondition', 'Your code has expired. Please ask for a new one.');
    }

    const account = await owner.createUser({ displayName: name });
    const uid = account.uid;
    const ref = db.collection('users').doc();
    const indexRef = db.collection(PHONE_INDEX).doc(phoneHash(phone));
    const now = Timestamp.now();
    try {
        await db.runTransaction(async (tx) => {
            if ((await tx.get(indexRef)).exists) throw new HttpsError('already-exists', 'This number already has an account.');
            tx.create(indexRef, { userDocId: ref.id, uid, createdAt: now });
            tx.set(ref, {
                id: ref.id,
                uid,
                name,
                email: '',
                emailVerified: false,
                phone,
                phoneVerified: true,
                role: 'user',
                status: 'Active',
                isActive: true,
                by: 'phone',
                createdBy: uid,
                modifiedBy: uid,
                createdAt: now,
                modifiedAt: now,
            });
        });
    } catch (err) {
        // Never leave a sign-in account behind that no record points to.
        await owner.deleteUser(uid).catch(() => undefined);
        throw err;
    }
    await storePin(uid, pin);
    logger.info(`completePhoneSignup: account created for ${maskPhone(phone)}.`);
    return { token: await issueSignInToken(uid) };
});

export const signInWithPin = onCall(async (request) => {
    await consumeRateLimit(`pin-ip-${callerKey(request)}`, 30, HOUR, TOO_MANY);
    const { phone } = await phoneContext(request);
    const pin = readPin(request.data?.pin);
    const account = await findUserByPhone(phone);
    if (!account) throw new HttpsError('not-found', 'No account uses this number.');
    if (!canSignIn(account.data)) throw new HttpsError('permission-denied', 'This account is blocked. Please contact the site administrator.');

    const uid = String(account.data['uid']);
    const result = await checkPin(uid, pin);
    if (result.ok) return { token: await issueSignInToken(uid) };
    if (result.reason === 'wrong') {
        const tries = result.remaining === 1 ? '1 try' : `${result.remaining} tries`;
        throw new HttpsError('permission-denied', `Wrong PIN. ${tries} left.`, { reason: 'wrong', remaining: result.remaining });
    }
    if (result.reason === 'none') {
        throw new HttpsError('failed-precondition', 'Set a PIN with a code sent to your number.', { reason: 'no-pin' });
    }
    throw new HttpsError('resource-exhausted', 'Too many tries. Reset your PIN with a code.', { reason: 'locked' });
});

export const resetPin = onCall(async (request) => {
    const { phone } = await phoneContext(request);
    const pin = readPin(request.data?.pin);
    const account = await findUserByPhone(phone);
    if (!account) throw new HttpsError('not-found', 'No account uses this number.');
    if (!canSignIn(account.data)) throw new HttpsError('permission-denied', 'This account is blocked. Please contact the site administrator.');
    if (!(await consumeVerifiedPhoneOtp(phone, 'reset'))) {
        throw new HttpsError('failed-precondition', 'Your code has expired. Please ask for a new one.');
    }
    const uid = String(account.data['uid']);
    await storePin(uid, pin);
    return { token: await issueSignInToken(uid) };
});

export const setPin = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    if (!record.data['phone']) throw new HttpsError('failed-precondition', 'Add a phone number first.');
    await storePin(String(record.data['uid']), readPin(request.data?.pin));
    return { saved: true };
});
