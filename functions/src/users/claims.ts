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
 * Claims are always merged, never replaced, so claims set by anything else survive.
 */
import { owner } from '../init.js';

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

/**
 * Merge claims into an account. A value of `null` or `''` removes that claim.
 * Writes nothing when every claim already has its value.
 *
 * Firebase has no atomic merge: this reads the claims, then writes them all. If
 * another app sharing the sign-in pool sets its own claims on the same account
 * in between, one of the two writes is lost (review F). ArcCMS writes claims
 * rarely (sign-up, a role change, blocking, deletion), so this is accepted
 * rather than guarded; an app that writes claims often should re-read and
 * merge in the same way, and `syncAllUserRoles` re-applies ArcCMS's own.
 */
export async function mergeUserClaims(uid: string, patch: Record<string, string | null>): Promise<void> {
    const user = await owner.getUser(uid);
    const current: Record<string, unknown> = { ...(user.customClaims ?? {}) };
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') delete next[key];
        else next[key] = value;
    }
    const changed = Object.keys({ ...current, ...next }).some((key) => current[key] !== next[key]);
    if (changed) await owner.setCustomUserClaims(uid, next);
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
