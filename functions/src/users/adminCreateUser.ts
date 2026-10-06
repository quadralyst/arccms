/**
 * Admin: add an ArcCMS user (specs/coexistence-spec.md, CO6.6).
 *
 * Creates the sign-in account and the `users` record together, with the role,
 * and never stores a password. When sign-ups are off (the backend profile's
 * admin-only sign-in) this is the only way in.
 *
 * In a project shared with another app, the address may already have a sign-in
 * account (one of that app's users). It is then reused, never altered, and the
 * record is marked `authOwner: 'shared'` so deleting the ArcCMS user never
 * deletes their account in the other app (`onUserDelete`). They sign in with the
 * password they already have; the one given here is not applied.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { AUTH_OWNER } from './authOwner.js';
import { KNOWN_ROLES } from './syncUserRole.js';
import { setRecordClaims } from './claims.js';
import { isBlank } from '../shared/blank.js';

/** Firebase Auth's own minimum. */
export const MIN_PASSWORD_LENGTH = 6;

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

function isUserNotFound(err: unknown): boolean {
    return (err as { code?: string })?.code === 'auth/user-not-found';
}

export const adminCreateUser = onCall(async (request) => {
    await requireAdmin(request);
    const input = validateAdminCreateUser(request.data);

    const existing = await db.collection('users').where('email', '==', input.email).limit(1).get();
    if (!existing.empty) throw new HttpsError('already-exists', 'An ArcCMS user with this email already exists.');

    let uid: string;
    let reusedAccount = false;
    let emailVerified = false;
    try {
        const account = await owner.getUserByEmail(input.email);
        uid = account.uid;
        emailVerified = account.emailVerified;
        reusedAccount = true;
    } catch (err) {
        if (!isUserNotFound(err)) throw err;
        if (input.password.length < MIN_PASSWORD_LENGTH) {
            throw new HttpsError('invalid-argument', `The temporary password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        const account = await owner.createUser({ email: input.email, password: input.password, displayName: input.name });
        uid = account.uid;
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
            authOwner: reusedAccount ? AUTH_OWNER.SHARED : AUTH_OWNER.ARCCMS,
            by: 'admin',
            createdBy: request.auth!.uid,
            modifiedBy: request.auth!.uid,
            createdAt: now,
            modifiedAt: now,
        });
    } catch (err) {
        // Never leave a sign-in account behind that no record points to.
        if (!reusedAccount) await owner.deleteUser(uid).catch(() => undefined);
        throw err;
    }
    // In the first ID token they get, whenever they first sign in.
    await setRecordClaims(uid, input.role, ref.id);
    return { id: ref.id, uid, reusedAccount };
});
