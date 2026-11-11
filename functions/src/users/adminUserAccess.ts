/**
 * Admin: change a person's role, block or unblock them, or delete them, from Users.
 *
 * These are the only ways to change `role`, `isActive` and `status` or to delete a
 * `users` record: the Firestore rules refuse them from every browser, an admin's
 * too, so no page or app can skip the checks below.
 *
 * The checks, read and written in one transaction with the list of admins, so two
 * admins acting at once cannot both pass:
 * - The caller is an active admin by their record, not only by their token: a
 *   blocked or demoted admin keeps an admin ID token for up to an hour, and must not
 *   use it to unblock or promote themselves back.
 * - The site always keeps an active admin: the last admin who is not blocked, with
 *   a sign-in of their own, cannot be demoted, blocked or deleted. Nobody blocks,
 *   unblocks, deletes or changes the role of their own record here.
 * - A role above a member's needs a sign-in that is the person's: an email sign-in
 *   whose email nobody verified could have been made by anyone who typed the address,
 *   unless the admins hold its password (made by Add user, or a password set since by
 *   Edit user, adminSetPassword.ts). A phone or app sign-in has no email to doubt.
 *
 * The claims follow by themselves: onUserRoleChange (syncUserRole.ts) copies the new
 * role, or removes the claims of a blocked record, and ends the sessions of a blocked
 * or demoted person; onUserDeleted (onUserDelete.ts) cleans up after a delete.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { refuse } from '../auth/refusal.js';
import { KNOWN_ROLES, SELF_ASSIGNABLE_ROLES } from './syncUserRole.js';
import { isActiveAdmin, requireAnotherActiveAdmin } from './activeAdmins.js';

// The last-admin check, for the other places that remove or detach an account.
export { isActiveAdmin, LAST_ADMIN, requireAnotherActiveAdmin } from './activeAdmins.js';
import { APP_MANAGED, isLockedAppAccount } from './lockedAppAccount.js';
import { UNVERIFIED_ACCOUNT_REASON } from './adminCreateUser.js';
import { AUTH_OWNER } from './authOwner.js';
import { ADMIN_PASSWORD_FIELD } from './adminSetPassword.js';
import { USER_RECORD_CLAIM } from './claims.js';

export const OWN_RECORD = "You can't change your own access here. Another admin can.";
export const NOT_ACTIVE_ADMIN = 'Your admin access has ended. Sign in again.';
export const UNVERIFIED_ROLE = "This person's email was never verified, so the sign-in could belong to someone else. Ask them to verify their email, or set a new password for them first in Edit user.";
export const DETACHED = "This account is detached: its only email or number moved to another account, so it can't sign in. Delete it instead.";
export const NO_USER = 'That user no longer exists.';

/** The record id from the request, or the refusal for a missing or odd one. */
function readId(request: CallableRequest): string {
    const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'Which user? The record id is missing.');
    return id;
}

/**
 * The caller's own record, read in the transaction, which must be an active admin's.
 * Found by the `arccms_uid` claim and checked against the caller's uid; a token
 * without the claim is looked up by uid.
 */
async function requireActiveAdminCaller(tx: Transaction, request: CallableRequest): Promise<string> {
    const uid = request.auth!.uid;
    const claimed = (request.auth!.token as Record<string, unknown> | undefined)?.[USER_RECORD_CLAIM];
    let records: Array<{ id: string; data: Record<string, unknown> | undefined }>;
    if (typeof claimed === 'string' && claimed && !claimed.includes('/')) {
        const snap = await tx.get(db.collection('users').doc(claimed));
        records = snap.exists ? [{ id: snap.id, data: snap.data() }] : [];
    } else {
        const found = await tx.get(db.collection('users').where('uid', '==', uid));
        records = found.docs.map((d) => ({ id: d.id, data: d.data() }));
    }
    const mine = records.find((r) => r.data?.['uid'] === uid && isActiveAdmin(r.data));
    if (!mine) throw refuse('permission-denied', 'not-active-admin', NOT_ACTIVE_ADMIN);
    return mine.id;
}

/** Read the record in the transaction, or refuse when it is gone. */
async function readRecord(tx: Transaction, id: string) {
    const ref = db.collection('users').doc(id);
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data) throw new HttpsError('not-found', NO_USER);
    return { ref, data };
}

/** The target is the caller's own record (by id or by sign-in). */
function isOwn(request: CallableRequest, callerRecordId: string, id: string, data: Record<string, unknown>): boolean {
    return id === callerRecordId || data['uid'] === request.auth!.uid;
}

const changedBy = (request: CallableRequest) => ({ modifiedAt: Timestamp.now(), modifiedBy: request.auth!.uid });

/** Whether the admins hold the password of this record's sign-in: Add user made it, or Edit user set one since. */
export function adminHoldsPassword(data: Record<string, unknown>): boolean {
    const madeByAddUser = data['by'] === 'admin' && (data['authOwner'] ?? AUTH_OWNER.ARCCMS) === AUTH_OWNER.ARCCMS;
    return madeByAddUser || !!data[ADMIN_PASSWORD_FIELD];
}

/**
 * Refuse a role above a member's for an email sign-in nobody verified, unless the
 * admins hold its password. No sign-in, a sign-in that is gone, or one with no email
 * (a phone account) has no address to doubt.
 */
async function refuseUnverifiedRaise(data: Record<string, unknown>, role: string): Promise<void> {
    if (SELF_ASSIGNABLE_ROLES.includes(role)) return;
    const uid = typeof data['uid'] === 'string' ? data['uid'] : '';
    if (!uid) return;
    const account = await owner.getUser(uid).catch((err: unknown) => {
        if ((err as { code?: string })?.code === 'auth/user-not-found') return null;
        throw err;
    });
    if (account?.email && !account.emailVerified && !adminHoldsPassword(data)) {
        throw refuse('failed-precondition', UNVERIFIED_ACCOUNT_REASON, UNVERIFIED_ROLE);
    }
}

export const adminSetUserRole = onCall(async (request) => {
    await requireAdmin(request);
    const id = readId(request);
    const role = typeof request.data?.role === 'string' ? request.data.role : '';
    if (!KNOWN_ROLES.includes(role)) throw new HttpsError('invalid-argument', `Unknown role: ${role || 'none'}.`);

    // The sign-in is checked before the transaction: it is not in Firestore.
    const first = await db.collection('users').doc(id).get();
    const firstData = first.data();
    if (!first.exists || !firstData) throw new HttpsError('not-found', NO_USER);
    if (firstData['role'] === role) return { role, changed: false };
    if (isLockedAppAccount(firstData)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
    await refuseUnverifiedRaise(firstData, role);

    await db.runTransaction(async (tx) => {
        const callerRecord = await requireActiveAdminCaller(tx, request);
        const { ref, data } = await readRecord(tx, id);
        if (isOwn(request, callerRecord, id, data)) throw refuse('failed-precondition', 'own-account', OWN_RECORD);
        // What was checked above must still be so.
        if (data['uid'] !== firstData['uid'] || adminHoldsPassword(data) !== adminHoldsPassword(firstData)) {
            throw new HttpsError('aborted', 'This user changed meanwhile. Please try again.');
        }
        if (isActiveAdmin(data) && role !== 'admin') await requireAnotherActiveAdmin(tx, id, data['uid']);
        tx.update(ref, { role, ...changedBy(request) });
    });
    logger.info(`adminSetUserRole: users/${id} is now ${role}, set by ${request.auth!.uid}.`);
    return { role, changed: true };
});

export const adminSetUserBlocked = onCall(async (request) => {
    await requireAdmin(request);
    const id = readId(request);
    if (typeof request.data?.blocked !== 'boolean') throw new HttpsError('invalid-argument', 'Block or unblock? Send blocked: true or false.');
    const blocked: boolean = request.data.blocked;

    await db.runTransaction(async (tx) => {
        const callerRecord = await requireActiveAdminCaller(tx, request);
        const { ref, data } = await readRecord(tx, id);
        if (isOwn(request, callerRecord, id, data)) throw refuse('failed-precondition', 'own-account', OWN_RECORD);
        if (blocked) {
            if (isActiveAdmin(data)) await requireAnotherActiveAdmin(tx, id, data['uid']);
        } else if (data['status'] === 'Detached') {
            // isActive alone cannot open it: its sign-in moved away.
            throw refuse('failed-precondition', 'detached', DETACHED);
        }
        tx.update(ref, { isActive: !blocked, ...changedBy(request) });
    });
    logger.info(`adminSetUserBlocked: users/${id} ${blocked ? 'blocked' : 'unblocked'} by ${request.auth!.uid}.`);
    return { blocked };
});

/**
 * Deletes the record. onUserDeleted then ends the person's sessions and removes
 * their sign-in (unless another app shares it) and everything stored for them
 * (docs/app/account-contract.html, "Deleting an account"). A locked app account is
 * its app's to delete (deleteAppAccount).
 */
export const adminDeleteUser = onCall(async (request) => {
    await requireAdmin(request);
    const id = readId(request);

    await db.runTransaction(async (tx) => {
        const callerRecord = await requireActiveAdminCaller(tx, request);
        const { ref, data } = await readRecord(tx, id);
        if (isOwn(request, callerRecord, id, data)) throw refuse('failed-precondition', 'own-account', OWN_RECORD);
        if (isLockedAppAccount(data)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
        if (isActiveAdmin(data)) await requireAnotherActiveAdmin(tx, id, data['uid']);
        tx.delete(ref);
    });
    logger.info(`adminDeleteUser: users/${id} deleted by ${request.auth!.uid}.`);
    return { deleted: true };
});
