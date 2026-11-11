/**
 * Admin: set a person's password, from Users > Edit user.
 *
 * The password goes to their sign-in account only; nothing named password is
 * ever written to Firestore (the rules refuse it on a user record). It meets the
 * rule every new password meets (shared/password-rule.ts). Every session of the
 * person ends, so only someone told the new password signs in from now on.
 *
 * The record keeps when (`adminPasswordAt`, ADMIN_PASSWORD_FIELD): from then on the
 * admins hold the password of that sign-in, so it may be given a role above a
 * member's even with an unverified email (adminSetUserRole). Only the server writes it.
 *
 * Refused for an account Arc CMS does not own (a sign-in shared with another
 * app: that app changes it), a locked app account (its app manages it), an
 * account that signs in with a PIN while the site uses email PINs (not an admin),
 * an account with no email, which a password could not sign in to, and a record
 * whose sign-in account is gone.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { arccmsOwnsAuthAccount } from './authOwner.js';
import { APP_MANAGED, isLockedAppAccount } from './lockedAppAccount.js';
import { refuse, refuseWeakPassword } from '../auth/refusal.js';
import { keepsPassword } from '../auth/emailPinRules.js';
import { readSignInSettings } from '../auth/accounts.js';

export const SHARED_ACCOUNT = "This person's sign-in is shared with another app, so their password is changed there.";
export const NO_ACCOUNT = 'This person has no sign-in account, so there is no password to set.';
export const NO_EMAIL = 'This person has no email to sign in with, so a password would not work.';
/** When an admin last set this record's password (Admin SDK only; the rules refuse it from browsers). */
export const ADMIN_PASSWORD_FIELD = 'adminPasswordAt';

export const PIN_SIGN_IN = 'This site signs email accounts in with a PIN, so this person has no password to set.';

export const adminSetPassword = onCall(async (request) => {
    await requireAdmin(request);
    const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    const password = typeof request.data?.password === 'string' ? request.data.password : '';
    if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'Which user? The record id is missing.');

    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    const record = snap.data();
    if (!snap.exists || !record) throw new HttpsError('not-found', 'That user no longer exists.');
    if (!arccmsOwnsAuthAccount(record)) throw refuse('failed-precondition', 'shared-account', SHARED_ACCOUNT);
    if (isLockedAppAccount(record)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
    // A PIN account gets no password from here: it would be a second way in (specs/sign-in-pin-spec.md).
    if (!keepsPassword(record) && (await readSignInSettings()).emailPin) throw refuse('failed-precondition', 'pin-sign-in', PIN_SIGN_IN);
    const uid = typeof record['uid'] === 'string' ? record['uid'] : '';
    if (!uid) throw refuse('failed-precondition', 'no-account', NO_ACCOUNT);

    const account = await owner.getUser(uid).catch((err: unknown) => {
        if ((err as { code?: string })?.code === 'auth/user-not-found') throw refuse('failed-precondition', 'no-account', NO_ACCOUNT);
        throw err;
    });
    if (!account.email) throw refuse('failed-precondition', 'no-email', NO_EMAIL);

    refuseWeakPassword(password, { email: account.email, name: typeof record['name'] === 'string' ? record['name'] : '' });

    await owner.updateUser(uid, { password });
    await owner.revokeRefreshTokens(uid);
    await ref.update({ [ADMIN_PASSWORD_FIELD]: Timestamp.now(), modifiedAt: Timestamp.now(), modifiedBy: request.auth!.uid });
    return { updated: true };
});
