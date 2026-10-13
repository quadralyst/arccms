import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { getPublishedCollectionName, getDraftCollectionName } from '../draftContent/collectionHelpers.js';
import { arcDocument } from '../arc-config.js';
import { isFeatureOn } from '../feature-flags.js';
import { removeCollectionEntries } from '../search/writer.js';

const BATCH_LIMIT = 400;
// What lives under an entry: its other languages (drafts and published), and on a
// published copy its past versions and deploy logs. Firestore names are
// case-sensitive: the publisher writes `PublishedHistory`.
const ENTRY_SUBCOLLECTIONS = ['translations', 'PublishedHistory', 'DeploymentLogs'];

export const onContentTypeDeleted = onDocumentDeleted(
    arcDocument('ContentTypes/{contentTypeId}'),
    async (event) => {
        const deletedData = event.data?.data();
        if (!deletedData?.slug) return;

        const slug = deletedData.slug;
        // The entries belong to the slug, not to one type document. A site can hold
        // two types with one slug (made before slugs were checked, or by an import),
        // and deleting one of them must not take the other's entries with it.
        if (await slugStillUsed(slug, event.params.contentTypeId)) {
            console.log(`Content type ${event.params.contentTypeId} deleted; another type still uses "${slug}", so its entries stay.`);
            return;
        }
        await Promise.all([
            deleteCollection(getPublishedCollectionName(slug)),
            deleteCollection(getDraftCollectionName(slug)),
            deleteCollection(`Tags_${slug}`),
        ]);
        // Nothing watches these collections' writes (specs/feature-flags-spec.md 6.5),
        // so their search entries go here.
        if (isFeatureOn('search')) {
            await Promise.all([
                removeCollectionEntries(getPublishedCollectionName(slug)),
                removeCollectionEntries(getDraftCollectionName(slug)),
            ]);
        }
    }
);

async function slugStillUsed(slug: string, deletedId: string): Promise<boolean> {
    const snap = await db.collection('ContentTypes').where('slug', '==', slug).get();
    return snap.docs.some((doc) => doc.id !== deletedId);
}

async function deleteCollection(collectionName: string) {
    const snap = await db.collection(collectionName).get();

    if (snap.empty) return;

    let batch = db.batch();
    let opCount = 0;

    for (const doc of snap.docs) {
        // Deleting a document leaves its subcollections behind.
        for (const sub of ENTRY_SUBCOLLECTIONS) {
            const subSnap = await doc.ref.collection(sub).get();

            for (const subDoc of subSnap.docs) {
                batch.delete(subDoc.ref);
                opCount++;

                if (opCount >= BATCH_LIMIT) {
                    await batch.commit();
                    batch = db.batch();
                    opCount = 0;
                }
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
