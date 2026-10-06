/**
 * Custom claims ArcCMS puts on a Firebase Auth account.
 *
 * - `arccms_role`: the ArcCMS role, the gate `isAdmin()` / `isEditor()` read in the
 *   rules and `isArcAdmin()` reads in functions (syncUserRole.ts sets it). Never the
 *   plain `role`: an app sharing the sign-in pool may give its own admins
 *   `role: 'admin'` (specs/coexistence-spec.md, CO-D7). ArcCMS no longer writes
 *   `role` and leaves any existing `role` claim alone, since in a shared pool it
 *   cannot tell who set it.
 * - `arccms_uid`: the id of the person's `users` record. The record id is not the
 *   Auth uid, so without this apps query `where('uid', '==', auth.uid)` and rules
 *   `get()` the record. With it, rules check `request.auth.token.arccms_uid`
 *   (`ownsUserRecord()` in firestore.rules) and apps read it from the ID token.
 *   Named with the `arccms_` prefix (specs/coexistence-spec.md, CO-D7) so an app
 *   sharing the sign-in pool cannot collide with it.
 *
 * Claims are always merged, never replaced, so claims set by anything else survive,
 * and merges on one account run one at a time (claimLock.ts).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { owner } from '../init.js';
import { withClaimLock } from './claimLock.js';

export const USER_RECORD_CLAIM = 'arccms_uid';
export const ROLE_CLAIM = 'arccms_role';

/** The ArcCMS role on an ID token or an account's custom claims, or `''`. */
export function arcRoleOf(claims: unknown): string {
    const role = (claims as Record<string, unknown> | null | undefined)?.[ROLE_CLAIM];
    return typeof role === 'string' ? role : '';
}

/** Whether an ID token (or an account's custom claims) makes its holder an ArcCMS admin. */
export function isArcAdmin(claims: unknown): boolean {
    return arcRoleOf(claims) === 'admin';
}

/** How many times a claims write is read back and redone when another write landed in between. */
const CLAIM_WRITE_ATTEMPTS = 3;

type ClaimPatch = Record<string, unknown>;

const removes = (value: unknown) => value === null || value === '';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The claims an account would have after `patch`: merged, never replaced. */
export function mergedClaims(current: Record<string, unknown>, patch: ClaimPatch): Record<string, unknown> {
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (removes(value)) delete next[key];
        else next[key] = value;
    }
    return next;
}

/** Whether an account's claims already say what `patch` asks for. */
function applied(claims: Record<string, unknown>, patch: ClaimPatch): boolean {
    return Object.entries(patch).every(([key, value]) => (removes(value) ? !(key in claims) : same(claims[key], value)));
}

/**
 * Merge claims into an account: a value of `null` or `''` removes that claim, and
 * nothing is written when every claim already has its value.
 *
 * Firebase has no atomic merge: a write reads the claims, then replaces them all. So
 * every write that changes something holds the account's lease (withClaimLock,
 * claimLock.ts) while it reads, writes and reads back, and writes going through here
 * (ArcCMS's own claims and an app's, mergeAppClaims) run one after another. The read
 * back stays as a second line: if the patch is missing (a writer that outlived its
 * lease, or one outside ArcCMS calling setCustomUserClaims), it is redone on the fresh
 * claims, up to three times. A writer outside ArcCMS can still overwrite the claims.
 * `check` sees the claims about to be written, and may refuse them.
 */
export async function mergeClaims(uid: string, patch: ClaimPatch, check?: (next: Record<string, unknown>) => void): Promise<void> {
    // Most calls change nothing (a role sync on an unchanged role): they cost no lease.
    if (applied({ ...((await owner.getUser(uid)).customClaims ?? {}) }, patch)) return;
    await withClaimLock(uid, async () => {
        for (let attempt = 1; attempt <= CLAIM_WRITE_ATTEMPTS; attempt++) {
            const user = await owner.getUser(uid);
            const current: Record<string, unknown> = { ...(user.customClaims ?? {}) };
            if (applied(current, patch)) return;
            const next = mergedClaims(current, patch);
            check?.(next);
            await owner.setCustomUserClaims(uid, next);
            const after = (await owner.getUser(uid)).customClaims ?? {};
            if (applied(after, patch)) return;
        }
        throw new Error(`Could not set the claims on ${uid}: another write kept replacing them.`);
    });
}

/** Merge ArcCMS's claims into an account (see mergeClaims). */
export function mergeUserClaims(uid: string, patch: Record<string, string | null>): Promise<void> {
    return mergeClaims(uid, patch);
}

/** Point an account's `arccms_uid` claim at its `users` record. */
export function setUserRecordClaim(uid: string, userDocId: string): Promise<void> {
    return mergeUserClaims(uid, { [USER_RECORD_CLAIM]: userDocId });
}

/** Apply a record's role and id as claims. An empty role removes `arccms_role`. */
export function setRecordClaims(uid: string, role: string, userDocId: string): Promise<void> {
    return mergeUserClaims(uid, { [ROLE_CLAIM]: role || null, [USER_RECORD_CLAIM]: userDocId });
}

/**
 * Remove every ArcCMS claim from an account that outlives its `users` record (one
 * shared with or owned by another app), so it keeps no ArcCMS access.
 */
export function clearArcClaims(uid: string): Promise<void> {
    return mergeUserClaims(uid, { [ROLE_CLAIM]: null, [USER_RECORD_CLAIM]: null });
}

// ---------------------------------------------------------------------------
// An app's own claims (specs/app-accounts-spec.md, C-D5, C-D7)
// ---------------------------------------------------------------------------

/** Firebase sets these itself; a custom claim may not use them. */
export const RESERVED_CLAIMS = ['acr', 'amr', 'at_hash', 'aud', 'auth_time', 'azp', 'cnf', 'c_hash', 'exp', 'firebase', 'iat', 'iss', 'jti', 'nbf', 'nonce', 'sub'];

/** Firebase's limit for an account's custom claims, as JSON. */
export const MAX_CLAIMS_BYTES = 1000;

/** Problems with an app's claim patch: an `arccms_` name, a reserved name, no names at all. */
export function appClaimProblems(patch: Record<string, unknown>): string[] {
    const keys = Object.keys(patch ?? {});
    if (!keys.length) return ['Give at least one claim.'];
    return keys.flatMap((key) => [
        ...(key.startsWith('arccms_') ? [`"${key}" is ArcCMS's own claim; an app's claims may not start with arccms_.`] : []),
        ...(RESERVED_CLAIMS.includes(key) ? [`"${key}" is reserved by Firebase.`] : []),
    ]);
}

/**
 * Merge an app's own claims into an account (docs/app/app-accounts.html). Refuses any
 * `arccms_` name and the names Firebase reserves, and refuses before writing when the
 * account's claims would pass Firebase's 1000-byte limit. Never replaces the claims
 * already there; `null` removes one of the app's. Values may be any JSON value.
 */
export async function mergeAppClaims(uid: string, patch: Record<string, unknown>): Promise<void> {
    const problems = appClaimProblems(patch);
    if (problems.length) throw new HttpsError('invalid-argument', problems.join(' '));
    await mergeClaims(uid, patch, (next) => {
        const bytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
        if (bytes > MAX_CLAIMS_BYTES) {
            throw new HttpsError('invalid-argument', `These claims would take ${bytes} bytes; Firebase allows ${MAX_CLAIMS_BYTES} for all of an account's claims.`);
        }
    });
}

/**
 * Ends the person's sign-in sessions: their refresh tokens are revoked, so every device
 * is signed out at its next token refresh, within the hour. A new sign-in works as usual.
 */
export function revokeSessions(uid: string): Promise<void> {
    return owner.revokeRefreshTokens(uid);
}
