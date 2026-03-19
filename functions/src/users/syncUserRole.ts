/**
 * Cloud Function triggers to sync user roles from Firestore to Firebase Auth custom claims.
 *
 * Firestore security rules cannot query collections — they can only `get()` by document path.
 * Since user documents use auto-generated IDs (not the Auth UID), the rules can't look up
 * users/{request.auth.uid} to check the role.
 *
 * Instead, we sync the role to Firebase Auth custom claims whenever it changes, and the
 * Firestore rules check `request.auth.token.role` (which is populated from custom claims).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { owner, db } from '../init.js';

/**
 * When a user document is created or updated, sync the role to Firebase Auth custom claims.
 */
export const onUserRoleChange = onDocumentWritten(
    'users/{docId}',
    async (event) => {
        const afterData = event.data?.after?.data();
        const beforeData = event.data?.before?.data();

        // Skip if document was deleted
        if (!afterData) return;

        const uid = afterData.uid;
        if (!uid) return;

        // Only sync if role actually changed (or on create)
        const newRole = afterData.role || '';
        const oldRole = beforeData?.role || '';
        if (beforeData && newRole === oldRole) return;

        try {
            await owner.setCustomUserClaims(uid, { role: newRole });
            console.log(`Custom claims set for user ${uid}: role=${newRole}`);
        } catch (error) {
            console.error(`Failed to set custom claims for user ${uid}:`, error);
        }
    }
);

/**
 * One-time callable function to sync roles for all existing users.
 * Call this once after deploying, then it can be removed.
 */
export const syncAllUserRoles = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    // Check caller is admin by querying the users collection
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
            await owner.setCustomUserClaims(uid, { role });
            synced++;
        } catch (error) {
            console.error(`Failed to sync claims for ${uid}:`, error);
            skipped++;
        }
    }

    return { synced, skipped, total: usersSnap.size };
});
