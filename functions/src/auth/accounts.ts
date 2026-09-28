/**
 * Shared pieces of phone, Google and linked sign-in (item 1 of the pilot
 * framework work): finding the account behind a number, PINs, rate limits and
 * sign-in tokens.
 *
 * A person is one Firebase Auth account plus one `users` record. Email and
 * Google sign-in are Firebase's own. Phone sign-in is ours: the number is
 * verified by an SMS code, the person then signs in with a 6-digit PIN, and
 * the server hands the browser a custom token for their account. The number
 * lives on the `users` record and in `phone_index`, never on the Auth account,
 * so a sign-in pool shared with another app (docs/coexistence-spec.md, P3) is
 * never touched.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, owner } from '../init.js';
import { phoneHash } from './phoneNumber.js';
import { KNOWN_ROLES } from '../users/syncUserRole.js';
import { setRecordClaims } from '../users/claims.js';

const scryptAsync = promisify(scrypt) as (pin: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const PHONE_INDEX = 'phone_index';
export const AUTH_PINS = 'auth_pins';
export const RATE_LIMITS = '_rate_limits';
export const ACCOUNT_TRANSFERS = 'account_transfers';

/** Wrong PINs in a row before the PIN locks and needs a reset by SMS code. */
export const MAX_PIN_ATTEMPTS = 5;

export const PIN_PATTERN = /^\d{6}$/;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SignInSettings {
    /** `Settings/users.isSignupEnabled`, open when the document is missing (as the rules read it). */
    signupOpen: boolean;
    phoneSignIn: boolean;
    googleSignIn: boolean;
    /** `Settings/users.defaultRole` for self sign-ups; `user` when unset or unknown. */
    defaultRole: string;
}

export function resolveSignInSettings(data: Record<string, unknown> | undefined): SignInSettings {
    const role = data?.['defaultRole'];
    return {
        signupOpen: data?.['isSignupEnabled'] !== false,
        phoneSignIn: data?.['phoneSignIn'] === true,
        googleSignIn: data?.['googleSignIn'] === true,
        defaultRole: typeof role === 'string' && KNOWN_ROLES.includes(role) ? role : 'user',
    };
}

export async function readSignInSettings(): Promise<SignInSettings> {
    const snap = await db.collection('Settings').doc('users').get();
    return resolveSignInSettings(snap.data());
}

export async function requirePhoneSignIn(): Promise<SignInSettings> {
    const settings = await readSignInSettings();
    if (!settings.phoneSignIn) {
        throw new HttpsError('failed-precondition', 'Phone sign-in is not turned on for this site.');
    }
    return settings;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface UserRecord {
    ref: DocumentReference;
    data: Record<string, unknown>;
}

function toRecord(snap: DocumentSnapshot | undefined): UserRecord | null {
    return snap?.exists ? { ref: snap.ref, data: snap.data() ?? {} } : null;
}

export async function findUserByUid(uid: string): Promise<UserRecord | null> {
    const snap = await db.collection('users').where('uid', '==', uid).limit(1).get();
    return snap.empty ? null : toRecord(snap.docs[0]);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    return snap.empty ? null : toRecord(snap.docs[0]);
}

/** The account a verified number belongs to, through `phone_index`. */
export async function findUserByPhone(e164: string): Promise<UserRecord | null> {
    const index = await db.collection(PHONE_INDEX).doc(phoneHash(e164)).get();
    const userDocId = index.data()?.['userDocId'];
    if (!userDocId) return null;
    const record = toRecord(await db.collection('users').doc(String(userDocId)).get());
    // A stale index entry (record deleted, or the number no longer on it) is no account.
    return record && record.data['phone'] === e164 ? record : null;
}

/** Whether this record may sign in at all. */
export function canSignIn(data: Record<string, unknown>): boolean {
    return data['isActive'] !== false && data['status'] !== 'Detached';
}

export function requireSignedIn(request: CallableRequest): string {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in again.');
    return request.auth.uid;
}

/** The caller's own record, or an error the profile page can show. */
export async function requireOwnRecord(request: CallableRequest): Promise<UserRecord> {
    const uid = requireSignedIn(request);
    const record = await findUserByUid(uid);
    if (!record) throw new HttpsError('failed-precondition', "This account doesn't have access to this site.");
    return record;
}

/**
 * Claims for an account whose record the server just created, set before the
 * browser gets its first ID token so `arccms_uid` (and the role) are in it from
 * the start. The role trigger sets the same values again; merging makes that harmless.
 */
export function applyNewAccountClaims(uid: string, userDocId: string, role: string): Promise<void> {
    return setRecordClaims(uid, role, userDocId);
}

/** A custom token the browser exchanges for a session (`signInWithCustomToken`). */
export async function issueSignInToken(uid: string): Promise<string> {
    return owner.createCustomToken(uid);
}

// ---------------------------------------------------------------------------
// PINs
// ---------------------------------------------------------------------------

export function isValidPin(pin: unknown): pin is string {
    return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

export async function hashPin(pin: string, salt: Buffer): Promise<string> {
    return (await scryptAsync(pin, salt, 32)).toString('hex');
}

export async function hasPin(uid: string): Promise<boolean> {
    return (await db.collection(AUTH_PINS).doc(uid).get()).exists;
}

/** Set or replace a PIN, which also clears any lock. */
export async function setPin(uid: string, pin: string): Promise<void> {
    const salt = randomBytes(16);
    await db.collection(AUTH_PINS).doc(uid).set({
        salt: salt.toString('hex'),
        hash: await hashPin(pin, salt),
        failedAttempts: 0,
        updatedAt: Timestamp.now(),
    });
}

export type PinCheck =
    | { ok: true }
    | { ok: false; reason: 'none' | 'locked' }
    | { ok: false; reason: 'wrong'; remaining: number };

/** Check a PIN, counting wrong ones; the fifth wrong one in a row locks it. */
export async function checkPin(uid: string, pin: string): Promise<PinCheck> {
    const ref = db.collection(AUTH_PINS).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, reason: 'none' };
    const data = snap.data() ?? {};
    const failed = Number(data['failedAttempts'] ?? 0);
    if (failed >= MAX_PIN_ATTEMPTS) return { ok: false, reason: 'locked' };

    const expected = Buffer.from(String(data['hash'] ?? ''), 'hex');
    const actual = Buffer.from(await hashPin(pin, Buffer.from(String(data['salt'] ?? ''), 'hex')), 'hex');
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        if (failed) await ref.update({ failedAttempts: 0 });
        return { ok: true };
    }
    await ref.update({ failedAttempts: failed + 1, lastFailedAt: Timestamp.now() });
    const remaining = MAX_PIN_ATTEMPTS - failed - 1;
    return remaining > 0 ? { ok: false, reason: 'wrong', remaining } : { ok: false, reason: 'locked' };
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/**
 * Count one use of `key` in a fixed window; refuse once `max` is reached.
 * Keys are hashes, never raw numbers or addresses.
 */
export async function consumeRateLimit(key: string, max: number, windowMs: number, message: string): Promise<void> {
    const ref = db.collection(RATE_LIMITS).doc(key);
    const now = Date.now();
    const allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() ?? {};
        const windowStart = Number(data['windowStart'] ?? 0);
        if (!snap.exists || now - windowStart >= windowMs) {
            tx.set(ref, { windowStart: now, count: 1, expiresAt: Timestamp.fromMillis(now + windowMs) });
            return true;
        }
        const count = Number(data['count'] ?? 0);
        if (count >= max) return false;
        tx.update(ref, { count: count + 1 });
        return true;
    });
    if (!allowed) throw new HttpsError('resource-exhausted', message);
}

/** The caller's IP, hashed, for per-IP limits. */
export function callerKey(request: CallableRequest): string {
    const raw = request.rawRequest;
    const forwarded = String(raw?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
    const ip = forwarded || raw?.ip || 'unknown';
    return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}
