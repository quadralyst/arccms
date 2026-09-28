/**
 * The signed-in person's own account: keep its claims right, and delete it.
 *
 *   refreshMyClaims   re-apply `arccms_uid` and `arccms_role` from the record
 *                     (the browser calls it when its token lacks them or they
 *                     differ, for example an account made before the claim existed);
 *                     a blocked or detached record gets none
 *   deleteMyAccount   delete the account and everything under it: the person's
 *                     contact (their address, lists and consent) here, the rest
 *                     in onUserDelete.ts
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { clearArcClaims, setRecordClaims, USER_RECORD_CLAIM } from './claims.js';
import { canSignIn, requireOwnRecord } from '../auth/accounts.js';
import { eraseContact } from '../email-core/eraseContact.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

/** How recent a sign-in must be to delete the account. */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export const refreshMyClaims = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    const uid = String(record.data['uid']);
    // Blocking or detaching a record removes its claims (syncUserRole.ts); this
    // must not hand them back (review F).
    if (!canSignIn(record.data)) {
        await clearArcClaims(uid);
        throw new HttpsError('permission-denied', 'This account is blocked. Please contact the site administrator.');
    }
    const role = typeof record.data['role'] === 'string' ? record.data['role'] : '';
    await setRecordClaims(uid, role, record.ref.id);
    return { [USER_RECORD_CLAIM]: record.ref.id };
});

/** Whether the token's sign-in happened within the last few minutes. */
export function signedInRecently(authTimeSeconds: unknown, now = Date.now()): boolean {
    const authTime = Number(authTimeSeconds) * 1000;
    return Number.isFinite(authTime) && now - authTime <= RECENT_SIGN_IN_MS;
}

export const deleteMyAccount = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    if (record.data['role'] === 'admin') {
        throw new HttpsError('failed-precondition', 'An administrator account is removed by another administrator, under Users.');
    }
    if (!signedInRecently((request.auth!.token as { auth_time?: number }).auth_time)) {
        throw new HttpsError('failed-precondition', 'For your security, sign in again, then delete your account.', { reason: 'recent-sign-in' });
    }
    // "Everything saved in it" includes the contact: an admin deleting a user
    // only unlinks it (it may predate the account), but the person asking to be
    // deleted is asking for their address to go too (review F).
    const email = typeof record.data['email'] === 'string' ? record.data['email'].trim().toLowerCase() : '';
    if (email) await eraseContact(computeEmailHash(email), String(record.data['uid']));
    await record.ref.delete();
    logger.info(`deleteMyAccount: ${record.ref.id} deleted by its owner.`);
    return { deleted: true };
});
