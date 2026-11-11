/**
 * Admin: add an ArcCMS user (specs/coexistence-spec.md, CO6.6).
 *
 * Creates the sign-in account and the `users` record together, with the role,
 * and never stores a password. When sign-ups are off (the backend profile's
 * admin-only sign-in) this is the only way in.
 *
 * In a project shared with another app, the address may already have a sign-in
 * account (one of that app's users). It is then reused, and the record is marked
 * `authOwner: 'shared'` so deleting the ArcCMS user never deletes their account in
 * the other app (`onUserDelete`). A verified account is left untouched: they sign in
 * with the password they already have, and the one given here is not applied.
 *
 * An account whose address was never verified could belong to anyone who typed the
 * address. When Arc CMS made it (canTakeOver), it gets the password given here and
 * its sessions are ended (`reusedAccount: false`, `passwordSet: true`): only the
 * person the admin tells gets in. Any other account is reused untouched, exactly as
 * a verified one (`keepsOwnPassword: true`): another app's user in a shared sign-in
 * pool must never lose their password or sessions to an Arc CMS admin.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import type { UserRecord } from 'firebase-admin/auth';
import { AUTH_OWNER } from './authOwner.js';
import { authOwnerFor } from '../auth/googleAccount.js';
import { arcDatabaseId, DEFAULT_DATABASE_ID } from '../arc-config.js';
import { KNOWN_ROLES } from './syncUserRole.js';
import { setRecordClaims } from './claims.js';
import { isBlank } from '../shared/blank.js';
import { MIN_PASSWORD_LENGTH, minPasswordLength, passwordProblem, passwordProblemText } from '../shared/password-rule.js';
import { signInStrength } from '../sign-in-choice.js';

/** The same rule as every new password a member chooses (shared/password-rule.ts, F22). */
export { MIN_PASSWORD_LENGTH };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AdminCreateUserInput {
    name: string;
    email: string;
    password: string;
    role: string;
}

export function validateAdminCreateUser(raw: unknown): AdminCreateUserInput {
    const data = (raw ?? {}) as Record<string, unknown>;
    const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
    const email = typeof data['email'] === 'string' ? data['email'].trim().toLowerCase() : '';
    const password = typeof data['password'] === 'string' ? data['password'] : '';
    const role = typeof data['role'] === 'string' && data['role'] ? data['role'] : 'user';
    if (!name) throw new HttpsError('invalid-argument', 'A name is required.');
    if (isBlank(email) || !EMAIL_PATTERN.test(email)) throw new HttpsError('invalid-argument', 'A valid email address is required.');
    if (!KNOWN_ROLES.includes(role)) throw new HttpsError('invalid-argument', `Unknown role: ${role}.`);
    return { name, email, password, role };
}

/**
 * Whether an existing, unverified sign-in account is Arc CMS's to take over: a
 * password sign-in and nothing else, no claims of another app's (only `arccms_*`),
 * no Arc CMS record on it, and made by Arc CMS. Made by Arc CMS means: the install
 * has the project to itself (the `(default)` database: a shared install always has
 * its own, docs/app/shared-project.html), or the account is minutes old
 * (authOwnerFor, the rule Google sign-in uses).
 */
export function canTakeOver(account: Pick<UserRecord, 'emailVerified' | 'providerData' | 'customClaims' | 'metadata'>, now = Date.now()): boolean {
    if (account.emailVerified) return false;
    const providers = account.providerData ?? [];
    if (!providers.length || providers.some((p) => p.providerId !== 'password')) return false;
    if (Object.keys(account.customClaims ?? {}).some((key) => !key.startsWith('arccms_'))) return false;
    const ownProject = arcDatabaseId() === DEFAULT_DATABASE_ID;
    return ownProject || authOwnerFor(account.metadata?.creationTime, now) === AUTH_OWNER.ARCCMS;
}

/**
 * An email sign-in nobody verified and that Arc CMS did not make (canTakeOver):
 * whoever typed the address may hold it, so it never gets more than a member's
 * role, neither from Add user nor later from Edit user (adminSetUserRole).
 */
export function unverifiedForeignSignIn(account: Pick<UserRecord, 'emailVerified' | 'providerData' | 'customClaims' | 'metadata'>, now = Date.now()): boolean {
    return !account.emailVerified && !canTakeOver(account, now);
}

/** Why an unverified sign-in gets no role above a member's (reason `unverified-account`). */
export const UNVERIFIED_ACCOUNT_REASON = 'unverified-account';

function isUserNotFound(err: unknown): boolean {
    return (err as { code?: string })?.code === 'auth/user-not-found';
}

/** Refuse a temporary password the member's own rule would refuse. */
function checkTemporaryPassword(input: AdminCreateUserInput): void {
    const strength = signInStrength();
    const problem = passwordProblem(input.password, { email: input.email, name: input.name }, strength);
    if (problem) {
        throw new HttpsError('invalid-argument', `The temporary password is too easy to guess. ${passwordProblemText(problem, strength)}`, {
            reason: 'weak-password', problem, min: minPasswordLength(strength),
        });
    }
}

export const adminCreateUser = onCall(async (request) => {
    await requireAdmin(request);
    const input = validateAdminCreateUser(request.data);

    // validateAdminCreateUser refuses an empty address already; '' must never match the records without one.
    if (isBlank(input.email)) throw new HttpsError('invalid-argument', 'A valid email address is required.');
    const existing = await db.collection('users').where('email', '==', input.email).limit(1).get();
    if (!existing.empty) throw new HttpsError('already-exists', 'An ArcCMS user with this email already exists.');

    let uid: string;
    // An account that already existed (never deleted when the record goes).
    let existingAccount = false;
    // The password given here is the one that signs them in.
    let passwordSet = false;
    let emailVerified = false;
    let found: UserRecord | null = null;
    try {
        found = await owner.getUserByEmail(input.email);
    } catch (err) {
        if (!isUserNotFound(err)) throw err;
    }
    if (found) {
        uid = found.uid;
        emailVerified = found.emailVerified;
        existingAccount = true;
        // A record already on this sign-in (an app account, or one whose email changed).
        const onAccount = await db.collection('users').where('uid', '==', uid).limit(1).get();
        if (!onAccount.empty) throw new HttpsError('already-exists', 'This sign-in account already belongs to an ArcCMS user.');
        if (canTakeOver(found)) {
            // Nobody proved the address, and Arc CMS made the account: whoever made it must not keep it.
            checkTemporaryPassword(input);
            await owner.updateUser(uid, { password: input.password });
            await owner.revokeRefreshTokens(uid);
            passwordSet = true;
        } else if (input.role !== 'user' && unverifiedForeignSignIn(found)) {
            // Kept untouched, whoever typed the address keeps its password; so it never
            // gets more than a member's role this way. Verified, it is the person's own.
            throw new HttpsError('failed-precondition',
                'This address already has a sign-in that was never verified, so it could belong to someone else. Ask the person to verify their email first, or add them as a User.',
                { reason: UNVERIFIED_ACCOUNT_REASON });
        }
    } else {
        checkTemporaryPassword(input);
        const account = await owner.createUser({ email: input.email, password: input.password, displayName: input.name });
        uid = account.uid;
        passwordSet = true;
    }

    const ref = db.collection('users').doc();
    const now = Timestamp.now();
    try {
        await ref.set({
            id: ref.id,
            uid,
            name: input.name,
            email: input.email,
            role: input.role,
            status: 'Active',
            isActive: true,
            emailVerified,
            authOwner: existingAccount ? AUTH_OWNER.SHARED : AUTH_OWNER.ARCCMS,
            by: 'admin',
            createdBy: request.auth!.uid,
            modifiedBy: request.auth!.uid,
            createdAt: now,
            modifiedAt: now,
        });
    } catch (err) {
        // Never leave a sign-in account behind that no record points to.
        if (!existingAccount) await owner.deleteUser(uid).catch(() => undefined);
        throw err;
    }
    // In the first ID token they get, whenever they first sign in.
    await setRecordClaims(uid, input.role, ref.id);
    // reusedAccount and keepsOwnPassword: they keep the password they already had
    // (the admin's success message says so).
    return { id: ref.id, uid, reusedAccount: !passwordSet, passwordSet, keepsOwnPassword: !passwordSet };
});
