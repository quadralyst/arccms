import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { getPublishedCollectionName, getDraftCollectionName } from '../draftContent/collectionHelpers.js';

const BATCH_LIMIT = 400;

export const onContentTypeDeleted = onDocumentDeleted(
    'ContentTypes/{contentTypeId}',
    async (event) => {
        const deletedData = event.data?.data();
        if (!deletedData?.slug) return;

        const slug = deletedData.slug;
        await Promise.all([
            deleteCollection(getPublishedCollectionName(slug)),
            deleteCollection(getDraftCollectionName(slug)),
            deleteCollection(`Tags_${slug}`),
        ]);
    }
);

async function deleteCollection(collectionName: string) {
    const snap = await db.collection(collectionName).get();

    if (snap.empty) return;

    let batch = db.batch();
    let opCount = 0;

    for (const doc of snap.docs) {
        // Delete publishedHistory subcollection (if exists)
        const historySnap = await doc.ref
            .collection('publishedHistory')
            .get();

        for (const historyDoc of historySnap.docs) {
            batch.delete(historyDoc.ref);
            opCount++;

            if (opCount >= BATCH_LIMIT) {
                await batch.commit();
                batch = db.batch();
                opCount = 0;
            }
        }

        // Delete the parent document
        batch.delete(doc.ref);
        opCount++;

        if (opCount >= BATCH_LIMIT) {
            await batch.commit();
            batch = db.batch();
            opCount = 0;
        }
    }

    if (opCount > 0) {
        await batch.commit();
    }
}
