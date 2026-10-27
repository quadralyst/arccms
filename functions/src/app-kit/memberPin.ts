/**
 * An app signs a member in with their own sign-in PIN, such as on a shared till where
 * each person taps their name (F32, specs/sign-in-pin-spec.md, docs/app/pin.html#member-pin).
 *
 * The PIN is the one in `auth_pins/<uid>`, and a try here is a sign-in try, but what a
 * wrong one locks stays where it was made (F36, specs/member-pin-lock-spec.md):
 *
 * - wrong tries lock the person on this rate key only (one device, one screen): the
 *   fifth in a row there locks them there for 5 minutes, then 15, then an hour
 *   (`locked-here`, with `retryAfter`); they can still sign in everywhere else;
 * - wrong tries on every rate key together reach the account lock (the one the sign-in
 *   page's five wrong tries set, which Forgot PIN undoes) only at 20 in a day, so slow
 *   guessing over many devices still ends;
 * - a right PIN resets the count on its rate key; a new PIN (Forgot PIN) resets them all.
 *
 * The counts per rate key are in `app_member_pin_tries`, closed to every browser; the
 * day's total is on the PIN record itself, so setting a new PIN clears it.
 */
import { createHash } from 'node:crypto';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import {
    AUTH_PINS,
    MAX_PIN_ATTEMPTS,
    callerKey,
    canSignIn,
    checkSessionClaims,
    countFailure,
    findUserByUid,
    issueSignInToken,
    pinMatches,
    pinPepper,
    pinRefusal,
    rateLimitWait,
    readPin,
    type PinCheck,
} from '../auth/accounts.js';
import { refuse } from '../auth/refusal.js';
import { isBlank } from '../shared/blank.js';

/** Wrong tries one rate key may make in an hour, across every person (as sign-in's per-caller limit). */
export const MEMBER_PIN_WRONG_PER_HOUR = 30;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

/** Counts of wrong member PINs per person and rate key: `app_member_pin_tries/<uid>__<key hash>`. */
export const MEMBER_PIN_TRIES = 'app_member_pin_tries';
/** Wrong tries in a row on one rate key before the person is locked there. */
export const MEMBER_PIN_TRIES_HERE = 5;
/** How long each lock on a rate key lasts, the first, the second, then every later one. */
export const MEMBER_PIN_WAITS_MS = [5 * MINUTE, 15 * MINUTE, HOUR] as const;
/** Wrong tries at app screens, on every rate key together, in a day before the account locks. */
export const MEMBER_PIN_TRIES_PER_DAY = 20;

/** Which PIN a count belongs to: a fingerprint of its salt, new each time the PIN is set. */
function pinId(record: Record<string, unknown>): string {
    return createHash('sha256').update(String(record['salt'] ?? '')).digest('hex').slice(0, 16);
}

function triesId(uid: string, rateKey: string): string {
    return `${uid}__${createHash('sha256').update(rateKey).digest('hex').slice(0, 32)}`;
}

const millis = (value: unknown): number => (value as Timestamp | undefined)?.toMillis?.() ?? 0;

type MemberPinCheck = PinCheck | { ok: false; reason: 'locked-here'; retryAfter: number };

/**
 * Check the PIN against `auth_pins/<uid>` in one transaction with this rate key's count
 * and the day's total, so tries sent at once cannot share a count.
 */
async function checkMemberPin(uid: string, pin: string, rateKey: string, now = Date.now()): Promise<MemberPinCheck> {
    await pinPepper(); // read (or made) before the transaction below, not inside it
    const pinRef = db.collection(AUTH_PINS).doc(uid);
    const triesRef = db.collection(MEMBER_PIN_TRIES).doc(triesId(uid, rateKey));
    return db.runTransaction(async (tx): Promise<MemberPinCheck> => {
        const pinSnap = await tx.get(pinRef);
        const triesSnap = await tx.get(triesRef);
        if (!pinSnap.exists) return { ok: false, reason: 'none' };
        const record = pinSnap.data() ?? {};
        // The account lock, from the sign-in page or from many tries at app screens.
        if (Number(record['failedAttempts'] ?? 0) >= MAX_PIN_ATTEMPTS) return { ok: false, reason: 'locked' };

        const id = pinId(record);
        const kept = triesSnap.data();
        // A count for an older PIN, or untouched for a day, starts again.
        const fresh = !kept || kept['pinId'] !== id || now - millis(kept['lastFailedAt']) > DAY;
        const failed = fresh ? 0 : Number(kept['failedAttempts'] ?? 0);
        const strikes = fresh ? 0 : Number(kept['strikes'] ?? 0);
        const lockedUntil = fresh ? 0 : millis(kept['lockedUntil']);
        if (lockedUntil > now) return { ok: false, reason: 'locked-here', retryAfter: Math.ceil((lockedUntil - now) / 1000) };

        if (await pinMatches(record, pin)) {
            if (triesSnap.exists) tx.delete(triesRef);
            return { ok: true };
        }

        // The day's total at app screens, kept on the PIN record so a new PIN clears it.
        const dayStart = millis(record['appFailedSince']);
        const total = now - dayStart > DAY ? 1 : Number(record['appFailed'] ?? 0) + 1;
        const lockAccount = total >= MEMBER_PIN_TRIES_PER_DAY;
        tx.update(pinRef, {
            appFailed: total,
            appFailedSince: now - dayStart > DAY ? Timestamp.fromMillis(now) : record['appFailedSince'],
            ...(lockAccount ? { failedAttempts: MAX_PIN_ATTEMPTS, lastFailedAt: Timestamp.fromMillis(now) } : {}),
        });
        if (lockAccount) {
            tx.delete(triesRef);
            return { ok: false, reason: 'locked' };
        }

        const here = failed + 1;
        if (here >= MEMBER_PIN_TRIES_HERE) {
            const wait = MEMBER_PIN_WAITS_MS[Math.min(strikes, MEMBER_PIN_WAITS_MS.length - 1)];
            tx.set(triesRef, {
                uid, pinId: id, failedAttempts: 0, strikes: strikes + 1,
                lockedUntil: Timestamp.fromMillis(now + wait), lastFailedAt: Timestamp.fromMillis(now),
            });
            return { ok: false, reason: 'locked-here', retryAfter: Math.ceil(wait / 1000) };
        }
        tx.set(triesRef, { uid, pinId: id, failedAttempts: here, strikes, lockedUntil: null, lastFailedAt: Timestamp.fromMillis(now) });
        return { ok: false, reason: 'wrong', remaining: MEMBER_PIN_TRIES_HERE - here };
    });
}

export interface MemberPinOptions {
    /** Claims for this one sign-in (issueSignInToken), such as the till it is on. */
    sessionClaims?: Record<string, unknown>;
    /**
     * Where wrong tries are counted and a person is locked: a key from hashedKey() or
     * callerKey(), one per device or screen. Default: the caller's address.
     */
    rateKey?: string;
}

/**
 * Checks `pin` as the sign-in PIN of the person with Auth uid `uid` and returns a sign-in
 * token for them, or throws the refusal the sign-in page would show: `pin-format`,
 * `no-account`, `account-blocked`, `wrong` (with `remaining` before the lock here),
 * `locked-here` (on this rate key, with `retryAfter`), `no-pin`, `locked` (the account),
 * or `too-many-attempts` (with `retryAfter`). Only wrong tries count against the rate key,
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

    const result = await checkMemberPin(uid, typed, key);
    if (result.ok) return { token: await issueSignInToken(uid, options.sessionClaims) };
    if (result.reason === 'wrong' || result.reason === 'none') await countFailure(key, MEMBER_PIN_WRONG_PER_HOUR, HOUR);
    if (result.reason === 'locked-here') {
        const minutes = Math.max(1, Math.ceil(result.retryAfter / 60));
        throw new HttpsError('resource-exhausted', `Too many wrong PINs here. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`, {
            reason: 'locked-here', retryAfter: result.retryAfter,
        });
    }
    throw pinRefusal(result, 'This person has no sign-in PIN yet. They set one on the sign-in page.');
}
