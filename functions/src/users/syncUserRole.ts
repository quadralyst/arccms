/**
 * Cloud Function triggers to sync user roles from Firestore to Firebase Auth custom claims.
 *
 * Firestore security rules cannot query collections — they can only `get()` by document path.
 * Since user documents use auto-generated IDs (not the Auth UID), the rules can't look up
 * users/{request.auth.uid} to check the role.
 *
 * Instead, we sync the role to Firebase Auth custom claims whenever it changes, and the
 * Firestore rules check `request.auth.token.role` (which is populated from custom claims).
 *
 * Because the claim IS the admin gate, this file is security critical:
 *
 * - The rules are the first line: a signed-in user may create only their own document with
 *   `role` absent or `'user'`, and may never change `role` afterwards. Only admins (by the
 *   claim) and the Admin SDK can set a role.
 * - `onUserRoleChange` is the second line. It still refuses to grant an elevated role unless
 *   the write came from the Admin SDK or from someone who already holds the admin claim, and
 *   reverts the document if it did not. If the rules ever regress, the claim does not follow.
 * - The first admin of a fresh install cannot come from either path (nobody is an admin yet),
 *   so the onboarding wizard calls `claimFirstAdmin`, which grants admin exactly once.
 * - Claims are merged, never replaced, so claims set by anything else survive
 *   (docs/coexistence-spec.md, CO-D7).
 */
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { owner, db } from '../init.js';

/** Roles anyone may hold without an admin granting them. Keep in step with firestore.rules. */
export const SELF_ASSIGNABLE_ROLES: readonly string[] = ['', 'user'];

/** Roles the app knows (UserRole in src/shared/components/base/base.component.ts). */
export const KNOWN_ROLES: readonly string[] = ['admin', 'user', 'propertyOwner', 'facilityManager'];

/** Sentinel written once, by `claimFirstAdmin`, when the first admin is created. Admin SDK only. */
export const FIRST_ADMIN_SENTINEL = { collection: '_system', doc: 'first_admin' } as const;

/**
 * Set the `role` claim, keeping every other claim the user already has.
 * An empty role removes the key rather than storing `role: ''`.
 */
export async function setRoleClaim(uid: string, role: string): Promise<void> {
    const user = await owner.getUser(uid);
    const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
    if (role) {
        claims['role'] = role;
    } else {
        delete claims['role'];
    }
    await owner.setCustomUserClaims(uid, claims);
}

/**
 * Did this write come from someone allowed to grant roles?
 *
 * Admin SDK writes (other functions, scripts, the console) arrive as `service_account` or
 * `system`. A client write carries the writer's uid in `authId`, and is trusted only if that
 * user holds the admin claim right now. Anything else, including a missing `authId`, is not.
 */
export async function isTrustedRoleWriter(authType: string | undefined, authId: string | undefined): Promise<boolean> {
    if (authType === 'service_account' || authType === 'system') return true;
    if (!authId) return false;
    try {
        const writer = await owner.getUser(authId);
        return writer.customClaims?.['role'] === 'admin';
    } catch {
        return false;
    }
}

/**
 * When a user document is created or updated, sync the role to Firebase Auth custom claims.
 */
export const onUserRoleChange = onDocumentWrittenWithAuthContext(
    'users/{docId}',
    async (event) => {
        const afterSnap = event.data?.after;
        const afterData = afterSnap?.data();
        const beforeData = event.data?.before?.data();

        // Skip if document was deleted
        if (!afterSnap || !afterData) return;

        const uid = afterData.uid;
        if (!uid) return;

        const newRole: string = afterData.role || '';
        const oldRole: string = beforeData?.role || '';
        const isCreate = !beforeData;

        // Self sign-up: apply the site's configured default role (Settings/users.defaultRole).
        // The client can only create a 'user' document, so the upgrade happens here, with the
        // Admin SDK. The rewrite re-fires this trigger, which then syncs the claim.
        if (isCreate && SELF_ASSIGNABLE_ROLES.includes(newRole) && event.authId === uid) {
            const defaultRole = await readDefaultRole();
            if (defaultRole && defaultRole !== 'user' && defaultRole !== newRole) {
                await afterSnap.ref.update({ role: defaultRole });
                return;
            }
        }

        // Only sync if role actually changed (or on create)
        if (!isCreate && newRole === oldRole) return;

        const escalation = !SELF_ASSIGNABLE_ROLES.includes(newRole);
        if (escalation && !(await isTrustedRoleWriter(event.authType, event.authId))) {
            console.error(
                `Refused role '${newRole}' for user ${uid}: written by ${event.authType}:${event.authId ?? 'none'}, ` +
                'who is not an admin. Reverting the document.',
            );
            await afterSnap.ref.update({ role: isCreate ? 'user' : oldRole || 'user' });
            return;
        }

        try {
            await setRoleClaim(uid, newRole);
            console.log(`Custom claims set for user ${uid}: role=${newRole}`);
        } catch (error) {
            console.error(`Failed to set custom claims for user ${uid}:`, error);
        }
    }
);

async function readDefaultRole(): Promise<string | null> {
    try {
        const snap = await db.collection('Settings').doc('users').get();
        const role = snap.exists ? snap.data()?.['defaultRole'] : null;
        return typeof role === 'string' && KNOWN_ROLES.includes(role) ? role : null;
    } catch (error) {
        console.warn('Could not read Settings/users.defaultRole:', error);
        return null;
    }
}

/**
 * Make the caller the site's first admin. Used by the onboarding wizard on a fresh install.
 *
 * Succeeds only when no admin has ever been created: no `_system/first_admin` sentinel and no
 * `users` document with `role: 'admin'` (the second check covers installs that predate the
 * sentinel). Everything runs in one transaction, so two racing callers cannot both win.
 *
 * Idempotent for the winner: calling it again as the existing first admin just re-applies the
 * claim, which lets the wizard retry after a network failure.
 */
export const claimFirstAdmin = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = request.auth.uid;

    const sentinelRef = db.collection(FIRST_ADMIN_SENTINEL.collection).doc(FIRST_ADMIN_SENTINEL.doc);

    await db.runTransaction(async (tx) => {
        const sentinel = await tx.get(sentinelRef);
        const mine = await tx.get(db.collection('users').where('uid', '==', uid).limit(1));
        if (mine.empty) {
            throw new HttpsError('failed-precondition', 'Create your user profile before claiming admin.');
        }
        const myDoc = mine.docs[0];

        if (sentinel.exists) {
            if (sentinel.data()?.['uid'] === uid && myDoc.data()['role'] === 'admin') return;
            throw new HttpsError('permission-denied', 'This site already has an administrator.');
        }

        const admins = await tx.get(db.collection('users').where('role', '==', 'admin').limit(1));
        if (!admins.empty) {
            throw new HttpsError('permission-denied', 'This site already has an administrator.');
        }

        tx.set(sentinelRef, { uid, claimedAt: FieldValue.serverTimestamp() });
        tx.update(myDoc.ref, { role: 'admin' });
    });

    // Set the claim here as well as in the trigger, so the wizard can refresh its token
    // straight away instead of polling for the trigger to land.
    await setRoleClaim(uid, 'admin');
    return { role: 'admin' };
});

/**
 * One-time callable function to sync roles for all existing users.
 * Call this once after deploying, then it can be removed.
 */
export const syncAllUserRoles = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    // Check caller is admin by querying the users collection. Safe because the rules let
    // only admins and the Admin SDK write `role`.
    const callerQuery = await db.collection('users')
        .where('uid', '==', request.auth.uid)
        .where('role', '==', 'admin')
        .limit(1)
        .get();

    if (callerQuery.empty) {
        throw new HttpsError('permission-denied', 'Must be an admin');
    }

    const usersSnap = await db.collection('users').get();
    let synced = 0;
    let skipped = 0;

    for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const uid = data.uid;
        const role = data.role;

        if (!uid || !role) {
            skipped++;
            continue;
        }

        try {
            await setRoleClaim(uid, role);
            synced++;
        } catch (error) {
            console.error(`Failed to sync claims for ${uid}:`, error);
            skipped++;
        }
    }

    return { synced, skipped, total: usersSnap.size };
});
