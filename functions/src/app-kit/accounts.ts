/**
 * Accounts an app creates for people who have no email and no phone, such as shop staff
 * (specs/app-accounts-spec.md, docs/app/app-accounts.html).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { findUserByUid, newUserRecord } from '../auth/accounts.js';
import { APP_ACCOUNT_BY, SELF_SERVICE } from '../users/lockedAppAccount.js';
import { appClaimProblems, mergeClaims, MAX_CLAIMS_BYTES, ROLE_CLAIM, USER_RECORD_CLAIM } from '../users/claims.js';

/** What sets an app account apart in the users list. */
export const APP_ACCOUNT = APP_ACCOUNT_BY;

export interface CreateAppAccountInput {
    /** The name shown in the admin and the member area. */
    displayName: string;
    /** The app's own claims, written with ArcCMS's in one write. No `arccms_` names. */
    claims?: Record<string, unknown>;
    /** The Firebase Auth uid to use, for an app that keys people by its own ids. Default: a new one. */
    uid?: string;
    /**
     * Let this person change their own account like any member: name, photo, sign-in
     * methods, deleting it. Default false: the account is locked and only the app's
     * own functions change it (docs/app/app-accounts.html).
     */
    selfService?: boolean;
}

export interface AppAccount {
    /** The Firebase Auth uid: what issueSignInToken() and the claims take. */
    uid: string;
    /** The id of the person's `users` record (the `arccms_uid` claim). */
    userDocId: string;
}

const MAX_NAME_LENGTH = 100;

/**
 * Creates a sign-in account and its `users` record for a person with no email and no
 * phone. The record has ArcCMS role `user` (always: an app's own roles are its claims),
 * `by: 'app'`, and the `arccms_uid` and `arccms_role` claims, plus the app's own claims,
 * all in one claims write. Sign the person in with issueSignInToken(uid).
 *
 * The account is locked (`selfService: false`): it cannot change its name, photo or
 * sign-in methods, or delete itself. `selfService: true` lets it change itself as any member can.
 */
export async function createAppAccount(input: CreateAppAccountInput): Promise<AppAccount> {
    const name = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
    if (!name) throw new HttpsError('invalid-argument', 'A display name is required.');
    if (name.length > MAX_NAME_LENGTH) throw new HttpsError('invalid-argument', `A display name can be at most ${MAX_NAME_LENGTH} characters.`);
    const appClaims = input.claims ?? {};
    if (Object.keys(appClaims).length) {
        const problems = appClaimProblems(appClaims);
        if (problems.length) throw new HttpsError('invalid-argument', problems.join(' '));
    }

    const account = await owner.createUser({ displayName: name, ...(input.uid ? { uid: input.uid } : {}) });
    const uid = account.uid;
    const ref = db.collection('users').doc();
    try {
        // Claims first, so the first sign-in's token already has them all.
        await mergeClaims(uid, { ...appClaims, [ROLE_CLAIM]: 'user', [USER_RECORD_CLAIM]: ref.id }, (next) => {
            const bytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
            if (bytes > MAX_CLAIMS_BYTES) {
                throw new HttpsError('invalid-argument', `These claims would take ${bytes} bytes; Firebase allows ${MAX_CLAIMS_BYTES} for all of an account's claims.`);
            }
        });
        await ref.set({
            ...newUserRecord({ id: ref.id, uid, name, role: 'user', by: APP_ACCOUNT, now: Timestamp.now() }),
            [SELF_SERVICE]: input.selfService === true,
        });
    } catch (err) {
        // Never leave a sign-in account behind that no record points to.
        await owner.deleteUser(uid).catch(() => undefined);
        throw err;
    }
    return { uid, userDocId: ref.id };
}

/**
 * Deletes a person's account by their Auth uid: their `users` record goes, and ArcCMS's
 * account deletion does the rest (the sign-in, a PIN, contact data), then announces
 * `user.deleted` (docs/app/account-contract.html).
 */
export async function deleteAppAccount(uid: string): Promise<void> {
    const record = await findUserByUid(uid);
    if (!record) throw new HttpsError('not-found', 'No account has this uid.');
    await record.ref.delete();
}
