import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { isArcAdmin } from '../users/claims.js';
import { getDraftCollectionName } from '../draftContent/collectionHelpers.js';
import { requestContentListIndexes } from './contentListIndexes.js';

/**
 * Creates the indexes a content type's list needs to filter by status and stay sorted, when
 * an admin presses Create index on that list (docs/features/content.html#status-filter).
 */
export const createContentListIndexes = onCall(async (request) => {
    if (!isArcAdmin(request.auth?.token)) {
        throw new HttpsError('permission-denied', 'Admin role required.');
    }
    const slug = request.data?.slug;
    if (typeof slug !== 'string' || !slug) {
        throw new HttpsError('invalid-argument', 'A content type is required.');
    }
    // Only a type that exists: a database has a limited number of indexes.
    const type = await db.collection('ContentTypes').where('slug', '==', slug).limit(1).get();
    if (type.empty) throw new HttpsError('not-found', 'No such content type.');

    return { indexes: await requestContentListIndexes(getDraftCollectionName(slug)) };
});
