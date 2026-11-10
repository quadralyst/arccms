/**
 * Limits on guessing an emailed or texted code, on top of the 5 tries each code has
 * and the 5 codes an hour an address or number may get:
 *
 * - 20 wrong codes a day for one address or number. After that every check is
 *   refused until the day is over (counted from the first wrong code), with the
 *   seconds left as `retryAfter`, so the page says when to try again.
 * - 60 code checks an hour from one caller (by IP), right or wrong.
 *
 * Every path that checks a code goes through verifyEmailCode (signupOtp.ts) or
 * verifyPhoneOtp (phoneOtp.ts), which call these: sign-up, password reset, PIN
 * reset, a new device, adding an email or number, and a fresh code. A public
 * form's code check (waitlists/formOtp.ts) calls them too, with its own count.
 */
import type { CallableRequest } from 'firebase-functions/v2/https';
import { callerKey, consumeRateLimits, countFailure, rateLimitWait } from './accounts.js';
import { refuse } from './refusal.js';

const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** Wrong codes one address or number may send in a day. */
export const WRONG_CODES_PER_DAY = 20;
/** Code checks one caller may make in an hour. */
export const CODE_CHECKS_PER_HOUR = 60;

/**
 * Who a code was sent to: an address's or a number's hash. `form` is a public
 * form's code (waitlists/formOtp.ts), counted apart from the address's sign-in codes.
 */
export type CodeTarget = { via: 'email' | 'phone' | 'form'; hash: string };

/** The rate limit key for the wrong codes sent to this address or number. */
export function wrongCodesKey(target: CodeTarget): string {
    return `code-wrong-${target.via}-${target.hash}`;
}

/**
 * Before a code is checked: count the caller's check, and refuse when this address
 * or number has used up its wrong codes for the day. `caller` is the request, for
 * its IP.
 */
export async function beforeCodeCheck(target: CodeTarget, caller: CallableRequest): Promise<void> {
    const [, wait] = await Promise.all([
        consumeRateLimits([{
            key: `code-check-ip-${callerKey(caller)}`, max: CODE_CHECKS_PER_HOUR, windowMs: HOUR,
            message: 'Too many attempts. Please try again later.',
        }]),
        rateLimitWait(wrongCodesKey(target), WRONG_CODES_PER_DAY, DAY),
    ]);
    if (wait) {
        throw refuse('resource-exhausted', 'too-many-codes', 'Too many wrong codes. Please try again tomorrow.', { retryAfter: wait });
    }
}

/** After a wrong code: count it against the address or number for the day. */
export function countWrongCode(target: CodeTarget): Promise<void> {
    return countFailure(wrongCodesKey(target), WRONG_CODES_PER_DAY, DAY);
}
