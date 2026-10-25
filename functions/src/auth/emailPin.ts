/**
 * Email sign-in with a PIN (F31 part 1, specs/sign-in-pin-spec.md, docs/app/sign-in.html#email-pin):
 * when the site signs email accounts in with a PIN (Settings, User Settings, or the
 * app's choice in src/custom/sign-in.ts), an email works as a phone number does: a
 * code by email the first time, then a 6-digit PIN, the same PIN (`auth_pins/<uid>`)
 * as the person's phone sign-in, with the same lockout, limits and strength rule.
 *
 *   requestEmailPinCode   public: a `device` code (the first PIN sign-in on a device)
 *                         or a `pin-reset` code (Forgot PIN, or a first PIN)
 *   completeEmailSignup   new address, after its sign-up code: name and PIN create
 *                         the account (no password)
 *   signInWithEmailPin    the PIN (on a device proved before, when the site asks for that)
 *   resetEmailPin         after a `pin-reset` code: a new PIN; the password, if any, goes
 *
 * The three that sign someone in return a sign-in token. Codes are checked with
 * verifySignupOtp (signupOtp.ts), which hands back the ticket these take.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import {
    applyNewAccountClaims,
    callerKey,
    canSignIn,
    checkPin,
    consumeRateLimit,
    findUserByEmail,
    hasPin,
    issueSignInToken,
    newUserRecord,
    pinRefusal,
    readPin,
    readSignInSettings,
    releaseRateLimit,
    setPin as storePin,
    type SignInSettings,
    type UserRecord,
} from './accounts.js';
import { normalizeEmailAddress } from './linkIdentifiers.js';
import { readName, readNewPin } from './phoneAuth.js';
import { consumeVerifiedSignupCode, emailCodeAskedAgain, issueEmailOtp, requestedLanguage, resetCodesShown, verifiedEmailCode } from './signupOtp.js';
import { forgetDevices, knownDevice, newDeviceRefusal, readDeviceKey, rememberDevice } from './devices.js';
import { dropPasswordForPin, hasPassword, HOST_ACCOUNT, pinEligible } from './emailPinRules.js';
import { authOwnerFor } from './googleAccount.js';
import { isWarmUp, WARM } from './warmUp.js';
import { refuse } from './refusal.js';
import { APP_MANAGED, isLockedAppAccount } from '../users/lockedAppAccount.js';

const HOUR = 60 * 60 * 1000;
const TOO_MANY = 'Too many attempts. Please try again later.';
const NO_PIN = 'Set a PIN with a code sent to your email.';

/** What the sign-in page asks a registered email for. */
export type EmailSignInWith = 'password' | 'pin' | 'code';

/** The two codes this file sends. */
export type EmailPinPurpose = 'device' | 'pin-reset';

/**
 * How a registered email account signs in (the table in specs/sign-in-pin-spec.md): the
 * page asks each account for what it has, never for what the setting says.
 * - a PIN, and the site signs email accounts in with one, or the account has no password: `pin`;
 * - no PIN, the site uses PINs, the account may have one and has no password: `code`
 *   (a `pin-reset` code, then a first PIN);
 * - otherwise: `password`, as before.
 */
export function emailSignInWith(input: { eligible: boolean; pin: boolean; password: boolean; emailPin: boolean }): EmailSignInWith {
    if (input.eligible && input.pin && (input.emailPin || !input.password)) return 'pin';
    if (input.eligible && !input.pin && input.emailPin && !input.password) return 'code';
    return 'password';
}

/** The account behind an address that may sign in with a PIN, or the refusal the page shows. */
export async function emailPinAccount(email: string): Promise<UserRecord & { uid: string }> {
    const record = await findUserByEmail(email);
    if (!record) throw refuse('not-found', 'no-email-account', 'No account uses this email.');
    if (isLockedAppAccount(record.data)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
    if (!canSignIn(record.data)) throw refuse('permission-denied', 'account-blocked', 'This account is blocked. Please contact the site administrator.');
    if (!pinEligible(record.data)) throw refuse('failed-precondition', 'host-account', HOST_ACCOUNT);
    const uid = String(record.data['uid'] ?? '');
    if (!uid) throw refuse('not-found', 'no-email-account', 'No account uses this email.');
    return { ...record, uid };
}

/**
 * What the sign-in page needs about a registered email (checkEmailAccount): what to ask
 * for, whether this device needs a code first, whether to offer a PIN after the password,
 * and the code purpose to send now (`device` or `pin-reset`), or none.
 */
export async function emailPinStatus(
    record: UserRecord,
    settings: SignInSettings,
    deviceKey: string | null,
): Promise<{ signInWith: EmailSignInWith; deviceCode?: true; offerPin?: true; codePurpose: EmailPinPurpose | null }> {
    const uid = String(record.data['uid'] ?? '');
    const eligible = !!uid && pinEligible(record.data) && canSignIn(record.data);
    if (!eligible) return { signInWith: 'password', codePurpose: null };
    const pin = await hasPin(uid);
    // The password decides only when the PIN and the setting disagree (the table above).
    const password = pin !== settings.emailPin ? await hasPassword(uid) : false;
    const signInWith = emailSignInWith({ eligible, pin, password, emailPin: settings.emailPin });
    if (signInWith === 'code') return { signInWith, codePurpose: 'pin-reset' };
    if (signInWith === 'pin') {
        const deviceCode = settings.newDeviceCode && !(await knownDevice(uid, deviceKey));
        return deviceCode ? { signInWith, deviceCode: true, codePurpose: 'device' } : { signInWith, codePurpose: null };
    }
    const offerPin = settings.emailPin && record.data['role'] !== 'admin';
    return { signInWith, ...(offerPin ? { offerPin: true as const } : {}), codePurpose: null };
}

/**
 * Email a `device` or `pin-reset` code, for requestEmailPinCode and checkEmailAccount.
 * Limits as a password reset code: one a minute and 5 an hour per address, 20 an hour
 * per caller, the caller's count first. Unlike a password reset there is no fallback:
 * when the email engine sends nothing, it says so (`email-failed`).
 */
export async function sendEmailPinCode(
    request: CallableRequest,
    email: string,
    purpose: EmailPinPurpose,
    name: string | undefined,
): Promise<Record<string, unknown>> {
    const asked = await emailCodeAskedAgain(email, purpose);
    if (asked) {
        const test = (await resetCodesShown()) ? { testMode: true, testCode: asked.code } : {};
        return { sent: true, status: 'pending', ...test, alreadySent: true, wait: asked.wait };
    }
    const callerLimit = `pin-otp-ip-${callerKey(request)}`;
    const addressLimit = `pin-otp-${computeEmailHash(email)}`;
    await consumeRateLimit(callerLimit, 20, HOUR, TOO_MANY);
    await consumeRateLimit(addressLimit, 5, HOUR, 'Too many codes for this address. Please try again later.', 'too-many-codes').catch(async (err) => {
        await releaseRateLimit(callerLimit);
        throw err;
    });
    const giveBack = () => Promise.all([releaseRateLimit(callerLimit), releaseRateLimit(addressLimit)]);
    const reply = await issueEmailOtp(email, purpose, { name, language: requestedLanguage(request.data) }).catch(async (err) => {
        await giveBack();
        throw err;
    });
    if (!reply.sent) {
        await giveBack();
        throw refuse('unavailable', 'email-failed', "We couldn't send the email. Please try again later.");
    }
    return reply;
}

function readPurpose(raw: unknown): EmailPinPurpose {
    if (raw !== 'device' && raw !== 'pin-reset') throw new HttpsError('invalid-argument', 'Unknown request.');
    return raw;
}

export const requestEmailPinCode = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    const purpose = readPurpose(request.data?.purpose);
    const [settings, account] = await Promise.all([readSignInSettings(), emailPinAccount(email)]);
    const name = typeof account.data['name'] === 'string' ? account.data['name'] : undefined;
    const pin = await hasPin(account.uid);
    // A device code only where a PIN signs in; a PIN reset where the site uses PINs or the account has one.
    if (purpose === 'device' && !pin) throw new HttpsError('failed-precondition', NO_PIN, { reason: 'no-pin' });
    if (purpose === 'pin-reset' && !settings.emailPin && !pin) throw refuse('failed-precondition', 'pin-sign-in-off', 'Sign in with your password.');
    return sendEmailPinCode(request, email, purpose, name);
});

export const completeEmailSignup = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    if (!email || !email.includes('@')) throw refuse('invalid-argument', 'invalid-email', 'Enter a valid email address.');
    const name = readName(request.data?.name);
    const pin = readNewPin(request.data?.pin);
    const settings = await readSignInSettings();
    if (!settings.emailPin) throw refuse('failed-precondition', 'pin-sign-in-off', 'Sign in with your password.');
    if (!settings.signupOpen) throw refuse('failed-precondition', 'signup-closed', "New accounts can't be created on this site right now.");
    const taken = () => refuse('already-exists', 'email-has-account', 'You already have an account with this email. Enter your password to sign in.');
    if (await findUserByEmail(email)) throw taken();
    if (await owner.getUserByEmail(email).catch(() => null)) throw taken();
    // The code is the only proof this address is theirs: there is no password.
    if (!(await consumeVerifiedSignupCode(email, request.data?.ticket))) {
        throw refuse('failed-precondition', 'code-expired', 'Your code has expired. Please ask for a new one.');
    }

    const account = await owner.createUser({ email, emailVerified: true, displayName: name });
    const uid = account.uid;
    const ref = db.collection('users').doc();
    try {
        await ref.set({
            ...newUserRecord({ id: ref.id, uid, name, role: settings.defaultRole, by: 'email', now: Timestamp.now(), email }),
            emailVerified: true,
            authOwner: authOwnerFor(account.metadata?.creationTime),
        });
    } catch (err) {
        // Never leave a sign-in account behind that no record points to.
        await owner.deleteUser(uid).catch(() => undefined);
        throw err;
    }
    const [, , , token] = await Promise.all([
        storePin(uid, pin),
        applyNewAccountClaims(uid, ref.id, settings.defaultRole),
        rememberDevice(uid, readDeviceKey(request.data?.deviceKey)),
        issueSignInToken(uid),
    ]);
    logger.info(`completeEmailSignup: account created for ${email} with a PIN.`);
    return { token };
});

export const signInWithEmailPin = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    // The same per-caller count as phone PIN sign-in (phoneAuth.ts).
    const [, settings, account] = await Promise.all([
        consumeRateLimit(`pin-ip-${callerKey(request)}`, 30, HOUR, TOO_MANY),
        readSignInSettings(),
        emailPinAccount(email),
    ]);
    const pin = readPin(request.data?.pin);
    const uid = account.uid;
    const deviceKey = readDeviceKey(request.data?.deviceKey);
    // A device not proved yet gets no PIN tries at all: a code first.
    const ticket = request.data?.ticket;
    const byCode = settings.newDeviceCode && !(await knownDevice(uid, deviceKey));
    if (byCode && !(await verifiedEmailCode(email, 'device', ticket, false))) throw newDeviceRefusal();
    const result = await checkPin(uid, pin);
    if (!result.ok) throw pinRefusal(result, NO_PIN);
    const [, , token] = await Promise.all([
        byCode ? verifiedEmailCode(email, 'device', ticket, true) : Promise.resolve(true),
        rememberDevice(uid, deviceKey),
        issueSignInToken(uid),
    ]);
    return { token };
});

export const resetEmailPin = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    const pin = readNewPin(request.data?.pin);
    const account = await emailPinAccount(email);
    if (!(await verifiedEmailCode(email, 'pin-reset', request.data?.ticket, true))) {
        throw refuse('failed-precondition', 'code-expired', 'Your code has expired. Please ask for a new one.');
    }
    const uid = account.uid;
    await storePin(uid, pin);
    // As a phone PIN reset: every other session ends, every device is forgotten, and a
    // password the account had goes (dropPasswordForPin), so there is one way in.
    await Promise.all([owner.revokeRefreshTokens(uid), forgetDevices(uid), dropPasswordForPin(account)]);
    const [, token] = await Promise.all([rememberDevice(uid, readDeviceKey(request.data?.deviceKey)), issueSignInToken(uid)]);
    logger.info(`resetEmailPin: a new PIN was set for ${email} with a code.`);
    return { token };
});
