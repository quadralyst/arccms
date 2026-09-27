/**
 * The signed-in person's own account: keep its claims right, and delete it.
 *
 *   refreshMyClaims   re-apply `arccms_uid` and `role` from the record (the
 *                     browser calls it when its token lacks them, for example
 *                     an account made before the claim existed)
 *   deleteMyAccount   delete the account and everything under it
 *                     (onUserDelete.ts does the cleanup)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { mergeUserClaims, USER_RECORD_CLAIM } from './claims.js';
import { requireOwnRecord } from '../auth/accounts.js';

/** How recent a sign-in must be to delete the account. */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export const refreshMyClaims = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    const uid = String(record.data['uid']);
    const role = typeof record.data['role'] === 'string' ? record.data['role'] : '';
    await mergeUserClaims(uid, { role: role || null, [USER_RECORD_CLAIM]: record.ref.id });
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
    await record.ref.delete();
    logger.info(`deleteMyAccount: ${record.ref.id} deleted by its owner.`);
    return { deleted: true };
});
