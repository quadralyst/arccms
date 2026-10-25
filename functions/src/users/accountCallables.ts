/**
 * The signed-in person's own account: keep its claims right, and delete it.
 *
 *   refreshMyClaims   re-apply `arccms_uid` and `arccms_role` from the record
 *                     (the browser calls it when its token lacks them or they
 *                     differ, for example an account made before the claim existed);
 *                     a blocked or detached record gets none
 *                     (a locked app account too, but only when it signed in
 *                     with the app's token: appAccountLock.ts)
 *   deleteMyAccount   delete the account and everything under it: the person's
 *                     contact (their address, lists and consent) here, the rest
 *                     in onUserDelete.ts (never a locked app account: its app
 *                     deletes it, with deleteAppAccount)
 *   rememberThisDevice  remember the device a signed-in person is on for PIN sign-in,
 *                     so "Ask for a code on a new device" asks nothing there
 *                     (specs/sign-in-pin-spec.md); the page calls it once per device
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { clearArcClaims, setRecordClaims, USER_RECORD_CLAIM } from './claims.js';
import { canSignIn, requireOwnRecord } from '../auth/accounts.js';
import { readDeviceKey, rememberDevice } from '../auth/devices.js';
import { refuseOtherSignIn } from '../auth/appAccountLock.js';
import { eraseContact } from '../email-core/eraseContact.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

/** How recent a sign-in must be to delete the account. */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export const refreshMyClaims = onCall(async (request) => {
    // The browser needs its claims, so a locked app account gets here too.
    const record = await requireOwnRecord(request, { allowLockedAppAccount: true });
    await refuseOtherSignIn(request, record);
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

/**
 * A device already signed in is one its person proved, by whatever way they signed in:
 * remembered, so turning on "Ask for a code on a new device" asks for no code on it.
 */
export const rememberThisDevice = onCall(async (request) => {
    const record = await requireOwnRecord(request);
    if (!canSignIn(record.data)) return { remembered: false };
    const key = readDeviceKey(request.data?.deviceKey);
    if (!key) return { remembered: false };
    await rememberDevice(String(record.data['uid']), key);
    return { remembered: true };
});
