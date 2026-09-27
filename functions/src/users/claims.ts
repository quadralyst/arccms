/**
 * Custom claims ArcCMS puts on a Firebase Auth account.
 *
 * - `role`: the ArcCMS role, the gate `isAdmin()` / `isEditor()` read (syncUserRole.ts).
 * - `arccms_uid`: the id of the person's `users` record. The record id is not the
 *   Auth uid, so without this apps query `where('uid', '==', auth.uid)` and rules
 *   `get()` the record. With it, rules check `request.auth.token.arccms_uid`
 *   (`ownsUserRecord()` in firestore.rules) and apps read it from the ID token.
 *   Named with the `arccms_` prefix (docs/coexistence-spec.md, CO-D7) so an app
 *   sharing the sign-in pool cannot collide with it.
 *
 * Claims are always merged, never replaced, so claims set by anything else survive.
 */
import { owner } from '../init.js';

export const USER_RECORD_CLAIM = 'arccms_uid';

/**
 * Merge claims into an account. A value of `null` or `''` removes that claim.
 * Writes nothing when every claim already has its value.
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
