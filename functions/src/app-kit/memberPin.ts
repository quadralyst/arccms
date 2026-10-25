/**
 * An app signs a member in with their own sign-in PIN, such as on a shared till where
 * each person taps their name (F32, specs/sign-in-pin-spec.md, docs/app/pin.html#member-pin).
 *
 * Unlike createPhonePinCheck(), this is a sign-in: the PIN is checked against
 * `auth_pins/<uid>` with sign-in's own count, so a wrong try here is a wrong sign-in
 * try, the fifth locks the person's PIN sign-in everywhere, a correct one resets the
 * count, and Forgot PIN on the sign-in page unlocks it.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
    callerKey,
    canSignIn,
    checkPin,
    checkSessionClaims,
    countFailure,
    findUserByUid,
    issueSignInToken,
    pinRefusal,
    rateLimitWait,
    readPin,
} from '../auth/accounts.js';
import { refuse } from '../auth/refusal.js';
import { isBlank } from '../shared/blank.js';

/** Wrong tries one rate key may make in an hour, across every person (as sign-in's per-caller limit). */
export const MEMBER_PIN_WRONG_PER_HOUR = 30;
const HOUR = 60 * 60 * 1000;

export interface MemberPinOptions {
    /** Claims for this one sign-in (issueSignInToken), such as the till it is on. */
    sessionClaims?: Record<string, unknown>;
    /** What wrong tries are counted against: a key from hashedKey() or callerKey(). Default: the caller's address. */
    rateKey?: string;
}

/**
 * Checks `pin` as the sign-in PIN of the person with Auth uid `uid` and returns a sign-in
 * token for them, or throws the refusal the sign-in page would show: `pin-format`,
 * `no-account`, `account-blocked`, `wrong` (with `remaining`), `no-pin`, `locked`, or
 * `too-many-attempts` (with `retryAfter`). Only wrong tries count against the rate key,
 * so a busy shared screen is never slowed. Your callable decides where it may be used.
 */
export async function signInWithMemberPin(
    request: CallableRequest,
    uid: string,
    pin: unknown,
    options: MemberPinOptions = {},
): Promise<{ token: string }> {
    // A mistake in the call costs nobody a try.
    checkSessionClaims(options.sessionClaims);
    if (options.rateKey !== undefined && isBlank(options.rateKey)) throw new HttpsError('invalid-argument', 'rateKey is blank.');
    if (typeof uid !== 'string' || isBlank(uid) || uid.includes('/')) throw refuse('not-found', 'no-account', 'No such person.');
    const typed = readPin(pin);

    const key = `member-pin-${options.rateKey ?? callerKey(request)}`;
    const wait = await rateLimitWait(key, MEMBER_PIN_WRONG_PER_HOUR, HOUR);
    if (wait) throw new HttpsError('resource-exhausted', 'Too many attempts. Please try again later.', { reason: 'too-many-attempts', retryAfter: wait });

    const record = await findUserByUid(uid);
    if (!record) throw refuse('not-found', 'no-account', 'No such person.');
    if (!canSignIn(record.data)) throw refuse('permission-denied', 'account-blocked', 'This account is blocked. Please contact the site administrator.');

    const result = await checkPin(uid, typed);
    if (result.ok) return { token: await issueSignInToken(uid, options.sessionClaims) };
    if (result.reason !== 'locked') await countFailure(key, MEMBER_PIN_WRONG_PER_HOUR, HOUR);
    throw pinRefusal(result, 'This person has no sign-in PIN yet. They set one on the sign-in page.');
}
