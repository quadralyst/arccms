import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';

/**
 * Callable cloud function to purge old email logs.
 * Deletes EmailLogs documents older than the specified number of days.
 * Requires admin authentication.
 */
export const purgeEmailLogs = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const userRecord = await owner.getUser(request.auth.uid);
    const isAdmin = userRecord.customClaims?.role === 'admin';
    if (!isAdmin) {
        throw new HttpsError('permission-denied', 'Admin access required.');
    }

    const daysOld = request.data?.daysOld || 60;
    if (typeof daysOld !== 'number' || daysOld < 1) {
        throw new HttpsError('invalid-argument', 'daysOld must be a positive number.');
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    const batchSize = 500;
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
        const snapshot = await db
            .collection('EmailLogs')
            .where('createdAt', '<', cutoffTimestamp)
            .limit(batchSize)
            .get();

        if (snapshot.empty) {
            hasMore = false;
            break;
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        totalDeleted += snapshot.size;

        if (snapshot.size < batchSize) {
            hasMore = false;
        }
    }

    return { success: true, deletedCount: totalDeleted, daysOld };
});
