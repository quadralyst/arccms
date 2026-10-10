/**
 * Checks a person's phone sign-in PIN for an app's own gate, such as a parent area
 * (docs/app/pin.html#phone-pin). The PIN is the one in `auth_pins`, read and never
 * written: wrong tries count in `app_phone_pin_tries`, one counter per namespace and
 * person, so a child guessing at the gate can lock the gate but never phone sign-in.
 */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { AUTH_PINS, hasPin, pinMatches, pinPepper, type PinCheck } from '../auth/accounts.js';
import { checkPinOptions, pinDocId } from './pins.js';

/** Wrong tries at an app's phone PIN gates: `app_phone_pin_tries/<namespace>__<uid>`, closed to every browser. */
export const PHONE_PIN_TRIES = 'app_phone_pin_tries';

export interface PhonePinCheck {
    /** Whether the person has a phone sign-in PIN to check against. */
    has(uid: string): Promise<boolean>;
    /** Checks the PIN, counting wrong tries here only: `{ ok }`, or `none`, `locked`, or `wrong` with `remaining`. */
    check(uid: string, pin: unknown): Promise<PinCheck>;
    /** Unlocks this namespace's gate for the person. Phone sign-in is never locked by it. */
    clearLock(uid: string): Promise<void>;
}

/**
 * Which phone PIN a count belongs to: a fingerprint of its salt, which is new each time
 * the PIN is set. A new phone PIN (Forgot PIN) starts a fresh count, as set() does for
 * an app PIN.
 */
function pinId(record: Record<string, unknown>): string {
    return createHash('sha256').update(String(record['salt'] ?? '')).digest('hex').slice(0, 16);
}

/**
 * A check of the person's phone sign-in PIN for a gate inside your app, never for
 * signing in (docs/app/pin.html#phone-pin). The namespace names the gate (`parent`);
 * `maxAttempts` (1 to 20, default 5) is how many wrong tries in a row lock it until
 * clearLock() or a new phone PIN.
 */
export function createPhonePinCheck(namespace: string, options: { maxAttempts?: number } = {}): PhonePinCheck {
    const maxAttempts = checkPinOptions(namespace, options);
    const triesRef = (uid: string) => db.collection(PHONE_PIN_TRIES).doc(pinDocId(namespace, uid));
    return {
        has: async (uid) => {
            pinDocId(namespace, uid);
            return hasPin(uid);
        },
        async check(uid, pin) {
            const ref = triesRef(uid);
            const typed = typeof pin === 'string' ? pin : ''; // not 6 digits is simply wrong, and costs a try
            await pinPepper(); // read (or made) before the transaction below, not inside it
            return db.runTransaction(async (tx): Promise<PinCheck> => {
                const phonePin = await tx.get(db.collection(AUTH_PINS).doc(uid));
                const tries = await tx.get(ref);
                if (!phonePin.exists) return { ok: false, reason: 'none' };
                const record = phonePin.data() ?? {};
                const id = pinId(record);
                const counted = tries.data() ?? {};
                const failed = counted['pinId'] === id ? Number(counted['failedAttempts'] ?? 0) : 0;
                if (failed >= maxAttempts) return { ok: false, reason: 'locked' };
                if (await pinMatches(record, typed)) {
                    if (tries.exists) tx.delete(ref);
                    return { ok: true };
                }
                tx.set(ref, { uid, namespace, pinId: id, failedAttempts: failed + 1, lastFailedAt: Timestamp.now() });
                const remaining = maxAttempts - failed - 1;
                return remaining > 0 ? { ok: false, reason: 'wrong', remaining } : { ok: false, reason: 'locked' };
            });
        },
        clearLock: async (uid) => {
            await triesRef(uid).delete();
        },
    };
}
