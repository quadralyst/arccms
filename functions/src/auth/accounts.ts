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
 * so a sign-in pool shared with another app (specs/coexistence-spec.md, P3) is
 * never touched.
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, owner } from '../init.js';
import { phoneHash } from './phoneNumber.js';
import { KNOWN_ROLES } from '../users/syncUserRole.js';
import { setRecordClaims } from '../users/claims.js';
import { SIGN_IN_NOT_READY, alertSigningProblem, signingProblem } from './signInSetup.js';
import { isBlank } from '../shared/blank.js';
import { refuseLockedAppAccount } from '../users/lockedAppAccount.js';
import { refuse } from './refusal.js';

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
        throw refuse('failed-precondition', 'phone-off', 'Phone sign-in is not turned on for this site.');
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
    if (isBlank(email)) return null;
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

/**
 * The fields of a `users` record that the server creates for a new person, with no
 * email unless one is given and no phone unless one is given. Phone sign-up and app
 * accounts (specs/app-accounts-spec.md) both use it, so the two shapes cannot drift.
 * `email` and `phone` are '' rather than missing, so ordered queries and the admin list
 * still find the record; lookups by exact value check isBlank() first (C-D13).
 */
export function newUserRecord(input: {
    id: string;
    uid: string;
    name: string;
    role: string;
    by: string;
    now: Timestamp;
    email?: string;
    phone?: string;
    phoneVerified?: boolean;
}): Record<string, unknown> {
    return {
        id: input.id,
        uid: input.uid,
        name: input.name,
        email: input.email ?? '',
        emailVerified: false,
        phone: input.phone ?? '',
        phoneVerified: input.phoneVerified ?? false,
        role: input.role,
        status: 'Active',
        isActive: true,
        by: input.by,
        createdBy: input.uid,
        modifiedBy: input.uid,
        createdAt: input.now,
        modifiedAt: input.now,
    };
}

/** Whether this record may sign in at all. */
export function canSignIn(data: Record<string, unknown>): boolean {
    return data['isActive'] !== false && data['status'] !== 'Detached';
}

export function requireSignedIn(request: CallableRequest): string {
    if (!request.auth?.uid) throw refuse('unauthenticated', 'sign-in-again', 'Please sign in again.');
    return request.auth.uid;
}

/**
 * The caller's own record, or an error the profile page can show.
 *
 * Every caller of this changes the person's own account (a sign-in method, a PIN,
 * deleting it), so a locked app account is refused here, by default. Only a
 * callable a locked account must still reach passes `allowLockedAppAccount`
 * (refreshMyClaims); a test keeps that list short.
 */
export async function requireOwnRecord(
    request: CallableRequest,
    options: { allowLockedAppAccount?: boolean } = {},
): Promise<UserRecord> {
    const uid = requireSignedIn(request);
    const record = await findUserByUid(uid);
    if (!record) throw refuse('failed-precondition', 'no-access', "This account doesn't have access to this site.");
    if (!options.allowLockedAppAccount) refuseLockedAppAccount(record.data);
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

/**
 * A custom token the browser exchanges for a session (`signInWithCustomToken`).
 *
 * Signing it needs Google Cloud setup (signInSetup.ts). When that is missing the person
 * is told phone sign-in is not ready, and the admins are told how to fix it, instead of
 * the person getting "Something went wrong" and the cause sitting in the logs.
 */
export async function issueSignInToken(uid: string): Promise<string> {
    try {
        return await owner.createCustomToken(uid);
    } catch (error) {
        const problem = signingProblem(error);
        if (!problem) throw error;
        logger.error(`Sign-in tokens cannot be created (${problem}). See docs/features/sign-in.html.`, error);
        await alertSigningProblem(problem);
        throw new HttpsError('failed-precondition', SIGN_IN_NOT_READY, { reason: 'sign-in-not-ready' });
    }
}

// ---------------------------------------------------------------------------
// PINs
// ---------------------------------------------------------------------------

export function isValidPin(pin: unknown): pin is string {
    return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

/** PINs people pick most, which an attacker tries first on every number. */
const COMMON_PINS = new Set([
    '123123', '121212', '112233', '123321', '111222', '696969', '159753', '147258',
    '102030', '789456', '520520', '131313', '232323', '101010', '202020', '999000',
]);

/**
 * Too easy to guess for a new PIN (review F): one digit repeated, a straight
 * run up or down (123456, 987654, 345678), or a common pattern. With 5 tries
 * per account, these would be the first ones tried on every number. PINs set
 * before this still sign in; only new ones are refused.
 */
export function isWeakPin(pin: string): boolean {
    if (/^(\d)\1+$/.test(pin)) return true;
    const steps = [...pin].slice(1).map((d, i) => (Number(d) - Number(pin[i]) + 10) % 10);
    if (steps.every((step) => step === 1) || steps.every((step) => step === 9)) return true;
    return COMMON_PINS.has(pin);
}

export async function hashPin(pin: string, salt: Buffer): Promise<string> {
    return (await scryptAsync(pin, salt, 32)).toString('hex');
}

/**
 * The PIN pepper (review F): a random secret in `_system/pin_pepper`, which no
 * client can read, mixed into every PIN hash. A 6-digit PIN has only a million
 * values, so a copy of `auth_pins` alone (a mistaken rule, an export of one
 * collection) could be cracked offline in hours; without the pepper it cannot.
 * Made on first use, then kept in memory.
 */
export const PIN_PEPPER_DOC = { collection: '_system', doc: 'pin_pepper' } as const;
let pepperCache: Promise<string> | null = null;

export function pinPepper(): Promise<string> {
    pepperCache ??= db.runTransaction(async (tx) => {
        const ref = db.collection(PIN_PEPPER_DOC.collection).doc(PIN_PEPPER_DOC.doc);
        const snap = await tx.get(ref);
        const existing = snap.data()?.['value'];
        if (typeof existing === 'string' && existing) return existing;
        const value = randomBytes(32).toString('base64');
        tx.set(ref, { value, createdAt: Timestamp.now() });
        return value;
    }).catch((err) => {
        pepperCache = null;
        throw err;
    });
    return pepperCache;
}

/** For tests: forget the pepper read from Firestore. */
export function resetPinPepperCache(): void {
    pepperCache = null;
}

/** Version 2 hashes: the PIN keyed with the pepper, then scrypt with the salt. */
export const PIN_HASH_VERSION = 2;

async function hashPinV2(pin: string, salt: Buffer): Promise<string> {
    const keyed = createHmac('sha256', await pinPepper()).update(pin).digest('hex');
    return hashPin(keyed, salt);
}

/** A stored PIN record for this PIN: a new salt, the pepper, and no lock. */
async function pinRecord(pin: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const salt = randomBytes(16);
    return {
        salt: salt.toString('hex'),
        hash: await hashPinV2(pin, salt),
        version: PIN_HASH_VERSION,
        failedAttempts: 0,
        updatedAt: Timestamp.now(),
        ...extra,
    };
}

/**
 * Where a PIN is kept and how many wrong tries lock it. Arc CMS's phone PINs are
 * `auth_pins/{uid}` with 5 tries; an app's PINs (functions/src/app-kit/pins.ts) are in
 * their own collection with their own limit, so the two never share a document.
 */
export interface PinLocation {
    collection: string;
    docId: string;
    maxAttempts: number;
    /** Fields kept on the document beside the hash (an app PIN's uid and namespace). */
    extra?: Record<string, unknown>;
}

const phonePin = (uid: string): PinLocation => ({ collection: AUTH_PINS, docId: uid, maxAttempts: MAX_PIN_ATTEMPTS });
const pinRef = (at: PinLocation) => db.collection(at.collection).doc(at.docId);

export async function hasPin(uid: string, at: PinLocation = phonePin(uid)): Promise<boolean> {
    return (await pinRef(at).get()).exists;
}

/** Set or replace a PIN, which also clears any lock. */
export async function setPin(uid: string, pin: string, at: PinLocation = phonePin(uid)): Promise<void> {
    await pinRef(at).set(await pinRecord(pin, at.extra));
}

/** Clear a lock without changing the PIN. Does nothing when there is no PIN. */
export async function clearPinLock(uid: string, at: PinLocation = phonePin(uid)): Promise<void> {
    const ref = pinRef(at);
    await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) tx.update(ref, { failedAttempts: 0, updatedAt: Timestamp.now() });
    });
}

/** Remove a PIN altogether. */
export async function removePin(uid: string, at: PinLocation = phonePin(uid)): Promise<void> {
    await pinRef(at).delete();
}

export type PinCheck =
    | { ok: true }
    | { ok: false; reason: 'none' | 'locked' }
    | { ok: false; reason: 'wrong'; remaining: number };

/**
 * Whether `pin` is the one a stored PIN record holds: the record's salt, with the
 * pepper for a version 2 hash. Compares in constant time; reads the pepper, so call
 * pinPepper() before a transaction that uses it.
 */
export async function pinMatches(record: Record<string, unknown>, pin: string): Promise<boolean> {
    const salt = Buffer.from(String(record['salt'] ?? ''), 'hex');
    const expected = Buffer.from(String(record['hash'] ?? ''), 'hex');
    const actual = Buffer.from(record['version'] === PIN_HASH_VERSION ? await hashPinV2(pin, salt) : await hashPin(pin, salt), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Check a PIN, counting wrong ones; the fifth wrong one in a row locks it. The
 * check and the count are one transaction, so guesses sent in parallel cannot
 * all read the same count (review F).
 */
export async function checkPin(uid: string, pin: string, at: PinLocation = phonePin(uid)): Promise<PinCheck> {
    await pinPepper(); // read (or made) before the transaction below, not inside it
    const ref = pinRef(at);
    const max = at.maxAttempts;
    return db.runTransaction(async (tx): Promise<PinCheck> => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, reason: 'none' };
        const data = snap.data() ?? {};
        const failed = Number(data['failedAttempts'] ?? 0);
        if (failed >= max) return { ok: false, reason: 'locked' };

        if (await pinMatches(data, pin)) {
            // A PIN set before the pepper is stored again with it, now that we know it.
            if (data['version'] !== PIN_HASH_VERSION) tx.set(ref, await pinRecord(pin, at.extra));
            else if (failed) tx.update(ref, { failedAttempts: 0 });
            return { ok: true };
        }
        tx.update(ref, { failedAttempts: failed + 1, lastFailedAt: Timestamp.now() });
        const remaining = max - failed - 1;
        return remaining > 0 ? { ok: false, reason: 'wrong', remaining } : { ok: false, reason: 'locked' };
    });
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/**
 * Count one use of `key` in a fixed window; refuse once `max` is reached.
 * Keys are hashes, never raw numbers or addresses. The refusal carries
 * `details.reason` (`too-many-attempts` unless given) and `details.retryAfter`,
 * the seconds until the window reopens, so a page can say when to try again
 * (specs/sign-in-codes-spec.md, SC-D5).
 */
export async function consumeRateLimit(
    key: string,
    max: number,
    windowMs: number,
    message: string,
    reason = 'too-many-attempts',
): Promise<void> {
    const ref = db.collection(RATE_LIMITS).doc(key);
    const now = Date.now();
    const reopensAt = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() ?? {};
        const windowStart = Number(data['windowStart'] ?? 0);
        if (!snap.exists || now - windowStart >= windowMs) {
            tx.set(ref, { windowStart: now, count: 1, expiresAt: Timestamp.fromMillis(now + windowMs) });
            return 0;
        }
        const count = Number(data['count'] ?? 0);
        if (count >= max) return windowStart + windowMs;
        tx.update(ref, { count: count + 1 });
        return 0;
    });
    if (reopensAt) throw new HttpsError('resource-exhausted', message, { reason, retryAfter: Math.max(1, Math.ceil((reopensAt - now) / 1000)) });
}

/**
 * Give back one use of `key`, for something counted that did not happen (an
 * SMS the provider refused): only what was really sent counts (SC-D4).
 */
export async function releaseRateLimit(key: string): Promise<void> {
    const ref = db.collection(RATE_LIMITS).doc(key);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = Number(snap.data()?.['count'] ?? 0);
        if (snap.exists && count > 0) tx.update(ref, { count: count - 1 });
    });
}

/**
 * The caller's IP, hashed, for per-IP limits. Google's front end adds the
 * address it saw to the END of X-Forwarded-For; anything before it is whatever
 * the client sent, so the first entry could be forged to get a fresh limit on
 * every request (review F). Called through a proxy (Firebase Hosting), the last
 * entry is the proxy's, which only makes the limit stricter.
 */
export function callerKey(request: CallableRequest, options: { trustedProxies?: number } = {}): string {
    // A function reached through proxies of its own (a Firebase Hosting rewrite) sees
    // each one's address after the caller's: skip that many from the end (docs/app/pin.html).
    const skip = Math.max(0, Math.min(5, Math.floor(options.trustedProxies ?? 0)));
    const raw = request.rawRequest;
    const header = raw?.headers?.['x-forwarded-for'];
    const entries = String(Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    const ip = entries[entries.length - 1 - skip] || raw?.ip || 'unknown';
    return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}
