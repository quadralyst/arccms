/**
 * Admin: set a person's password, from Users > Edit user.
 *
 * The password goes to their sign-in account only; nothing named password is
 * ever written to Firestore (the rules refuse it on a user record). It meets the
 * rule every new password meets (shared/password-rule.ts). Firebase signs the
 * person out of their other sessions when the password changes.
 *
 * Refused for an account Arc CMS does not own (a sign-in shared with another
 * app: that app changes it), a locked app account (its app manages it), an
 * account with no email, which a password could not sign in to, and a record
 * whose sign-in account is gone.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { arccmsOwnsAuthAccount } from './authOwner.js';
import { APP_MANAGED, isLockedAppAccount } from './lockedAppAccount.js';
import { refuse } from '../auth/refusal.js';
import { PASSWORD_PROBLEM_TEXT, passwordProblem } from '../shared/password-rule.js';

export const SHARED_ACCOUNT = "This person's sign-in is shared with another app, so their password is changed there.";
export const NO_ACCOUNT = 'This person has no sign-in account, so there is no password to set.';
export const NO_EMAIL = 'This person has no email to sign in with, so a password would not work.';

export const adminSetPassword = onCall(async (request) => {
    await requireAdmin(request);
    const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    const password = typeof request.data?.password === 'string' ? request.data.password : '';
    if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'Which user? The record id is missing.');

    const snap = await db.collection('users').doc(id).get();
    const record = snap.data();
    if (!snap.exists || !record) throw new HttpsError('not-found', 'That user no longer exists.');
    if (!arccmsOwnsAuthAccount(record)) throw refuse('failed-precondition', 'shared-account', SHARED_ACCOUNT);
    if (isLockedAppAccount(record)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
    const uid = typeof record['uid'] === 'string' ? record['uid'] : '';
    if (!uid) throw refuse('failed-precondition', 'no-account', NO_ACCOUNT);

    const account = await owner.getUser(uid).catch((err: unknown) => {
        if ((err as { code?: string })?.code === 'auth/user-not-found') throw refuse('failed-precondition', 'no-account', NO_ACCOUNT);
        throw err;
    });
    if (!account.email) throw refuse('failed-precondition', 'no-email', NO_EMAIL);

    const problem = passwordProblem(password, { email: account.email, name: typeof record['name'] === 'string' ? record['name'] : '' });
    if (problem) throw refuse('invalid-argument', 'weak-password', PASSWORD_PROBLEM_TEXT[problem], { problem });

    await owner.updateUser(uid, { password });
    return { updated: true };
});
