/**
 * Phone sign-in callables: a number, an SMS code the first time, a 6-digit PIN
 * after that. Every step is public (before sign-in) and rate limited.
 *
 *   checkPhoneAccount    is this number registered, and does it have a PIN?
 *                        With `sendCode`, it also sends the code the next step needs
 *   requestPhoneOtp      send a code (signup, reset or link); with the Test
 *                        provider no SMS is sent, and the reply carries a
 *                        sign-up code, and a reset code when an admin allows
 *                        it (link codes: SMS Logs only)
 *   verifyPhoneOtp       check the code; the reply's ticket goes to the next step
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
    applyNewAccountClaims,
    callerKey,
    canSignIn,
    checkPin,
    consumeRateLimit,
    consumeRateLimits,
    findUserByPhone,
    releaseRateLimit,
    hasPin,
    issueSignInToken,
    isValidPin,
    pinTooEasy,
    newUserRecord,
    requireOwnRecord,
    requirePhoneSignIn,
    setPin as storePin,
} from './accounts.js';
import { consumeVerifiedPhoneOtp, phoneCodeAskedAgain, isPhoneOtpPurpose, issuePhoneOtp, verifyPhoneOtp as checkPhoneOtp, type PhoneOtpPurpose } from './phoneOtp.js';
import { isWarmUp, WARM } from './warmUp.js';
import { codeOrRefusal, refuse } from './refusal.js';

const HOUR = 60 * 60 * 1000;
const TOO_MANY = 'Too many attempts. Please try again later.';

/** The number in E.164, or the error the sign-in page shows under the field. */
export function readPhone(raw: unknown, sms: SmsSettings): string {
    const e164 = normalizePhone(raw, sms.defaultCountryCode);
    if (!e164) throw refuse('invalid-argument', 'invalid-number', 'Enter a valid mobile number.');
    if (!isAllowedCountry(e164, sms.allowedCountryCodes)) {
        const codes = sms.allowedCountryCodes.map((c) => `+${c}`).join(', ');
        throw refuse('invalid-argument', 'country-not-allowed', `Only numbers starting ${codes} can be used here.`, { codes });
    }
    return e164;
}

export function readName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 60) throw refuse('invalid-argument', 'name-required', 'Please enter your name.');
    return name;
}

function readPin(raw: unknown): string {
    if (!isValidPin(raw)) throw refuse('invalid-argument', 'pin-format', 'Your PIN is 6 digits.');
    return raw;
}

/** A PIN being chosen: 6 digits, and under the strict rule not one of the first ones an attacker tries. */
export function readNewPin(raw: unknown): string {
    const pin = readPin(raw);
    if (pinTooEasy(pin)) {
        throw new HttpsError('invalid-argument', 'That PIN is too easy to guess. Avoid repeated digits and runs like 123456.', { reason: 'weak-pin' });
    }
    return pin;
}

async function phoneContext(request: CallableRequest) {
    // The two settings documents together: neither needs the other (specs/sign-in-speed-spec.md, SP-D1).
    const [signIn, sms] = await Promise.all([requirePhoneSignIn(), readSmsSettings()]);
    const phone = readPhone(request.data?.phone, sms);
    return { signIn, sms, phone };
}

/**
 * Is this number registered, and does it have a PIN? With `sendCode: true` it
 * also sends the code when the next screen is the code screen (a new number
 * while signups are open, or a number with no PIN), so the page makes one call
 * instead of two; the send's reply comes back as `code`, or its refusal as
 * `codeRefused` (specs/sign-in-speed-spec.md, SP-D5, SP-D7).
 */
export const checkPhoneAccount = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    // The caller's limit is counted while the settings are read; nothing is answered until it passes (SP-D4).
    const [, { signIn, sms, phone }] = await Promise.all([
        consumeRateLimit(`check-ip-${callerKey(request)}`, 100, HOUR, TOO_MANY),
        phoneContext(request),
    ]);
    const account = await findUserByPhone(phone);
    const purpose: PhoneOtpPurpose | null = account ? 'reset' : signIn.signupOpen ? 'signup' : null;
    const sendCode = request.data?.sendCode === true && !!purpose;
    // The PIN and the number's earlier code together; the code is only sent when there is no PIN.
    const [pin, asked] = await Promise.all([
        account ? hasPin(String(account.data['uid'])) : Promise.resolve(false),
        sendCode ? phoneCodeAskedAgain(phone, purpose!) : Promise.resolve(null),
    ]);
    const reply = { phone, exists: !!account, hasPin: pin, signupOpen: signIn.signupOpen };
    if (!sendCode || pin) return reply;
    return { ...reply, ...(await codeOrRefusal(() => sendPhoneCode(request, { phone, purpose: purpose!, sms, asked }))) };
});

export const requestPhoneOtp = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const purpose = request.data?.purpose;
    if (!isPhoneOtpPurpose(purpose)) throw new HttpsError('invalid-argument', 'Unknown request.');
    const { signIn, sms, phone } = await phoneContext(request);

    let uid: string | undefined;
    let asked: Awaited<ReturnType<typeof phoneCodeAskedAgain>>;
    if (purpose === 'link') {
        // The earlier code is checked against the signed-in account, so it waits for it.
        uid = String((await requireOwnRecord(request)).data['uid']);
        asked = await phoneCodeAskedAgain(phone, purpose, uid);
    } else {
        // The account and the number's earlier code together (specs/sign-in-speed-spec.md, SP-D2).
        const [account, earlier] = await Promise.all([findUserByPhone(phone), phoneCodeAskedAgain(phone, purpose)]);
        if (purpose === 'signup' && account) throw refuse('already-exists', 'number-taken', 'This number already has an account.');
        if (purpose === 'signup' && !signIn.signupOpen) throw refuse('failed-precondition', 'signup-closed', "New accounts can't be created on this site right now.");
        if (purpose === 'reset' && !account) throw refuse('not-found', 'no-account', 'No account uses this number.');
        asked = earlier;
    }
    return sendPhoneCode(request, { phone, purpose, sms, uid, asked });
});

/**
 * Send this number its code, for requestPhoneOtp and checkPhoneAccount. `asked`
 * is the caller's phoneCodeAskedAgain: asked again within the minute (a reload,
 * another tab), the reply is the code already sent and nothing goes (F22). It is
 * checked before the hourly limits, so only codes really sent count, and one the
 * provider refuses is given back (specs/sign-in-codes-spec.md, SC-D3, SC-D4).
 */
async function sendPhoneCode(
    request: CallableRequest,
    input: { phone: string; purpose: PhoneOtpPurpose; sms: SmsSettings; uid?: string; asked: { wait: number; code: string } | null },
) {
    const { phone, purpose, sms, uid, asked } = input;
    if (asked) return codeReply(phone, purpose, sms, sms.provider === 'log', asked.code, { alreadySent: true, wait: asked.wait });
    const counted = await consumeRateLimits([
        { key: `otp-ip-${callerKey(request)}`, max: 20, windowMs: HOUR, message: TOO_MANY },
        { key: `otp-phone-${phoneHash(phone)}`, max: 5, windowMs: HOUR, message: 'Too many codes for this number. Please try again later.', reason: 'too-many-codes' },
    ]);
    let testCode: string | undefined;
    let sameCode: boolean | undefined;
    try {
        ({ testCode, sameCode } = await issuePhoneOtp(phone, purpose, sms, uid));
    } catch (err) {
        // Counted but not sent (a refusal from the provider, or a second request at once).
        await Promise.all(counted.map((key) => releaseRateLimit(key)));
        throw err;
    }
    logger.info(`sendPhoneCode: ${purpose} code sent to ${maskPhone(phone)}.`);
    return codeReply(phone, purpose, sms, !!testCode, testCode, sameCode ? { sameCode: true } : {});
}

/**
 * A code request's reply. Test provider: no SMS goes out (Settings, SMS warns
 * admins). The page may show a sign-up code, which only makes a new account. A
 * reset code would let anyone take over any number, so it is shown only when an
 * admin turned on "Show PIN reset codes on screen"; otherwise it is in SMS Logs,
 * for admins. A link code would let anyone move a number to their account: SMS
 * Logs only (review F).
 */
function codeReply(
    phone: string,
    purpose: string,
    sms: SmsSettings,
    testMode: boolean,
    code: string | undefined,
    extra: Record<string, unknown>,
) {
    if (!testMode) return { sent: true, phone, ...extra };
    const shown = purpose === 'signup' || (purpose === 'reset' && sms.showResetCodes);
    return { sent: true, phone, testMode: true, ...(shown && code ? { testCode: code } : {}), ...extra };
}

export const verifyPhoneOtp = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const purpose = request.data?.purpose;
    if (!isPhoneOtpPurpose(purpose)) throw new HttpsError('invalid-argument', 'Unknown request.');
    const { phone } = await phoneContext(request);
    const code = String(request.data?.code ?? '');
    if (!/^\d{6}$/.test(code)) throw refuse('invalid-argument', 'code-wrong', "That code didn't work.");
    // A link code is for the signed-in account's own record (never a locked app account).
    const uid = purpose === 'link' ? String((await requireOwnRecord(request)).data['uid']) : undefined;
    const ticket = await checkPhoneOtp(phone, code, purpose, uid);
    return { verified: true, ticket };
});

export const completePhoneSignup = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const { signIn, phone } = await phoneContext(request);
    const name = readName(request.data?.name);
    const pin = readNewPin(request.data?.pin);
    if (!signIn.signupOpen) throw refuse('failed-precondition', 'signup-closed', "New accounts can't be created on this site right now.");
    if (await findUserByPhone(phone)) throw refuse('already-exists', 'number-taken', 'This number already has an account.');
    if (!(await consumeVerifiedPhoneOtp(phone, 'signup', { ticket: request.data?.ticket }))) {
        throw refuse('failed-precondition', 'code-expired', 'Your code has expired. Please ask for a new one.');
    }

    const account = await owner.createUser({ displayName: name });
    const uid = account.uid;
    const ref = db.collection('users').doc();
    const indexRef = db.collection(PHONE_INDEX).doc(phoneHash(phone));
    const now = Timestamp.now();
    try {
        await db.runTransaction(async (tx) => {
            if ((await tx.get(indexRef)).exists) throw refuse('already-exists', 'number-taken', 'This number already has an account.');
            tx.create(indexRef, { userDocId: ref.id, uid, createdAt: now });
            tx.set(ref, newUserRecord({ id: ref.id, uid, name, role: signIn.defaultRole, by: 'phone', now, phone, phoneVerified: true }));
        });
    } catch (err) {
        // Never leave a sign-in account behind that no record points to.
        await owner.deleteUser(uid).catch(() => undefined);
        throw err;
    }
    // The PIN, the claims and the token together: the token carries no claims, they are
    // read when the browser signs in with it, after this answers (specs/sign-in-speed-spec.md, SP-D15).
    const [, , token] = await Promise.all([
        storePin(uid, pin),
        applyNewAccountClaims(uid, ref.id, signIn.defaultRole),
        issueSignInToken(uid),
    ]);
    logger.info(`completePhoneSignup: account created for ${maskPhone(phone)}.`);
    return { token };
});

export const signInWithPin = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    // The caller's limit is counted while the settings are read (SP-D4).
    const [, { phone }] = await Promise.all([
        consumeRateLimit(`pin-ip-${callerKey(request)}`, 30, HOUR, TOO_MANY),
        phoneContext(request),
    ]);
    const pin = readPin(request.data?.pin);
    const account = await findUserByPhone(phone);
    if (!account) throw refuse('not-found', 'no-account', 'No account uses this number.');
    if (!canSignIn(account.data)) throw refuse('permission-denied', 'account-blocked', 'This account is blocked. Please contact the site administrator.');

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
    const pin = readNewPin(request.data?.pin);
    const account = await findUserByPhone(phone);
    if (!account) throw refuse('not-found', 'no-account', 'No account uses this number.');
    if (!canSignIn(account.data)) throw refuse('permission-denied', 'account-blocked', 'This account is blocked. Please contact the site administrator.');
    if (!(await consumeVerifiedPhoneOtp(phone, 'reset', { ticket: request.data?.ticket }))) {
        throw refuse('failed-precondition', 'code-expired', 'Your code has expired. Please ask for a new one.');
    }
    const uid = String(account.data['uid']);
    await storePin(uid, pin);
    // A reset is how someone who lost control of their PIN gets it back, so end
    // every other session: whoever used the old PIN is signed out within the hour.
    await owner.revokeRefreshTokens(uid);
    return { token: await issueSignInToken(uid) };
});

export const setPin = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    if (!record.data['phone']) throw refuse('failed-precondition', 'add-phone-first', 'Add a phone number first.');
    await storePin(String(record.data['uid']), readNewPin(request.data?.pin));
    return { saved: true };
});
