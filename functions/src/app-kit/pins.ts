/**
 * PINs an app checks itself, apart from Arc CMS's phone PINs (specs/app-pin-spec.md,
 * docs/app/pin.html). Same rules (6 digits, no easy ones under the strict rule),
 * same hashing and lockout, kept in one fixed collection, `app_pins`, that no client
 * can read or write. The app's password and PIN strength (src/custom/sign-in.ts)
 * applies here too.
 */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { checkPin, clearPinLock, hasPin, isValidPin, pinTooEasy, removePin, setPin, type PinCheck, type PinLocation } from '../auth/accounts.js';
import { SIGN_IN_STRENGTHS, type SignInStrength } from '../shared/sign-in-strength.js';
import { isBlank } from '../shared/blank.js';

/** Where every app PIN is kept: `app_pins/<namespace>__<uid>`. Never an `arc_` name, which would be public. */
export const APP_PINS = 'app_pins';

const NAMESPACE = /^[a-z][a-z0-9_-]{1,30}$/;
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Refuses a bad namespace or limit, as the app kit's PIN helpers all do, and returns
 * the limit: `maxAttempts` 1 to 20, default 5.
 */
export function checkPinOptions(namespace: string, options: { maxAttempts?: number }): number {
    if (typeof namespace !== 'string' || !NAMESPACE.test(namespace) || namespace.includes('__')) {
        throw new Error(`PIN namespace "${namespace}": lower case letters, digits, - and _, starting with a letter, 2 to 31 characters, no "__".`);
    }
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
        throw new Error(`PIN maxAttempts ${maxAttempts}: a whole number from 1 to 20.`);
    }
    return maxAttempts;
}

/** `<namespace>__<uid>`, refusing a uid that is blank or would make a path. */
export function pinDocId(namespace: string, uid: string): string {
    if (isBlank(uid) || uid.includes('/')) throw new HttpsError('invalid-argument', 'No such person.');
    return `${namespace}__${uid}`;
}

export interface PinStore {
    /** Sets or replaces the person's PIN, which also clears a lock. Refuses one that is not 6 digits, or too easy under the strict rule. */
    set(uid: string, pin: string): Promise<void>;
    /** Checks a PIN, counting wrong tries: `{ ok }`, or `none`, `locked`, or `wrong` with `remaining`. */
    check(uid: string, pin: unknown): Promise<PinCheck>;
    /** Whether the person has a PIN in this store. */
    has(uid: string): Promise<boolean>;
    /** Unlocks a locked PIN without changing it. */
    clearLock(uid: string): Promise<void>;
    /** Removes the person's PIN from this store. */
    remove(uid: string): Promise<void>;
}

/**
 * A place for an app's PINs (docs/app/pin.html). The namespace keeps different kinds
 * apart (`kiosk`, `staff`); `maxAttempts` (1 to 20, default 5) is how many wrong tries
 * in a row lock a PIN until set() or clearLock(). `strength` is how hard a new PIN
 * must be: the app's choice in src/custom/sign-in.ts unless the store names one, so a
 * casual app can keep a strict staff PIN (`strength: 'strict'`).
 */
export function createPinStore(namespace: string, options: { maxAttempts?: number; strength?: SignInStrength } = {}): PinStore {
    const maxAttempts = checkPinOptions(namespace, options);
    const strength = options.strength;
    if (strength !== undefined && !(SIGN_IN_STRENGTHS as readonly unknown[]).includes(strength)) {
        throw new Error(`PIN strength ${JSON.stringify(strength)}: 'strict' or 'simple', or leave it out for the app's choice.`);
    }
    const at = (uid: string): PinLocation => ({ collection: APP_PINS, docId: pinDocId(namespace, uid), maxAttempts, extra: { uid, namespace } });
    return {
        async set(uid, pin) {
            if (!isValidPin(pin)) throw new HttpsError('invalid-argument', 'A PIN is 6 digits.');
            if (pinTooEasy(pin, strength)) throw new HttpsError('invalid-argument', 'That PIN is too easy to guess. Choose another.', { reason: 'weak-pin' });
            await setPin(uid, pin, at(uid));
        },
        async check(uid, pin) {
            // Not 6 digits is simply wrong: it costs a try like any other wrong PIN.
            return checkPin(uid, typeof pin === 'string' ? pin : '', at(uid));
        },
        has: (uid) => hasPin(uid, at(uid)),
        clearLock: (uid) => clearPinLock(uid, at(uid)),
        remove: (uid) => removePin(uid, at(uid)),
    };
}

const SCOPE = /^[a-z][a-z0-9_-]{0,30}$/;

/**
 * A rate-limit key an app chooses (docs/app/pin.html): `scope` names what is counted
 * (`kiosk-device`), `value` is what it is counted for (a device id). The value is hashed,
 * so no raw id lands in `_rate_limits`, and the scope keeps it apart from Arc CMS's keys.
 */
export function hashedKey(scope: string, value: string): string {
    if (typeof scope !== 'string' || !SCOPE.test(scope)) throw new Error(`Rate-limit scope "${scope}": lower case letters, digits, - and _, starting with a letter.`);
    if (isBlank(value)) throw new HttpsError('invalid-argument', 'Nothing to count this request against.');
    return `app-${scope}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}
