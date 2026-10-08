/**
 * Google sign-in: the browser signs in with Firebase's Google provider, then
 * calls this to make sure the person has an ArcCMS record.
 *
 * Firebase keeps one account per email, so a Google sign-in with the address of
 * an existing account lands on that account, and there is nothing to do. A new
 * person gets a record straight from the verified Google profile: no form.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { AUTH_OWNER } from '../users/authOwner.js';
import { applyNewAccountClaims, findUserByEmail, findUserByUid, readSignInSettings } from './accounts.js';
import { isWarmUp, WARM } from './warmUp.js';
import { refuseOtherSignIn } from './appAccountLock.js';
import { refuse } from './refusal.js';

/**
 * A sign-in account older than this was not made by the Google sign-in that
 * just happened: in a project shared with another app it is that app's user
 * (specs/coexistence-spec.md, CO-D16), so ArcCMS must never delete it.
 */
export const FRESH_ACCOUNT_MS = 10 * 60 * 1000;

export function authOwnerFor(creationTime: string | undefined, now = Date.now()): string {
    const created = creationTime ? Date.parse(creationTime) : now;
    return now - created > FRESH_ACCOUNT_MS ? AUTH_OWNER.SHARED : AUTH_OWNER.ARCCMS;
}

export const ensureGoogleAccount = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const uid = request.auth?.uid;
    if (!uid) throw refuse('unauthenticated', 'sign-in-again', 'Please sign in again.');
    const existing = await findUserByUid(uid);
    if (existing) {
        // A locked app account with Google linked to it in the browser (appAccountLock.ts).
        await refuseOtherSignIn(request, existing);
        return { created: false };
    }

    const token = request.auth!.token as { email?: string; email_verified?: boolean; name?: string; picture?: string; firebase?: { sign_in_provider?: string } };
    const email = String(token.email ?? '').trim().toLowerCase();
    if (token.firebase?.sign_in_provider !== 'google.com' || !email || token.email_verified !== true) {
        throw refuse('failed-precondition', 'sign-in-again', 'Please sign in with Google again.');
    }

    const settings = await readSignInSettings();
    if (!settings.googleSignIn) throw refuse('failed-precondition', 'google-off', 'Google sign-in is not turned on for this site.');
    if (!settings.signupOpen) {
        throw new HttpsError('failed-precondition', "New accounts can't be created on this site right now.", { reason: 'signup-closed' });
    }
    if (await findUserByEmail(email)) {
        throw refuse('already-exists', 'google-email-taken', 'An account with this email already exists. Sign in with your password.');
    }

    const account = await owner.getUser(uid);
    const ref = db.collection('users').doc();
    const now = Timestamp.now();
    await ref.set({
        id: ref.id,
        uid,
        name: token.name || account.displayName || email.split('@')[0],
        email,
        emailVerified: true,
        ...(token.picture ? { photo: token.picture } : {}),
        role: settings.defaultRole,
        status: 'Active',
        isActive: true,
        authOwner: authOwnerFor(account.metadata.creationTime),
        by: 'google',
        createdBy: uid,
        modifiedBy: uid,
        createdAt: now,
        modifiedAt: now,
    });
    await applyNewAccountClaims(uid, ref.id, settings.defaultRole);
    return { created: true };
});
