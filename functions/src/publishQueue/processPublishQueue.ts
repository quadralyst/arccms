import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { getPublishedCollectionName, getDraftCollectionName } from '../draftContent/collectionHelpers.js';
import { generateAndDeployContentDetailPage, removeContentPage } from '../pages/deployContentPage.js';
import { HostingBatch, deployBatchToHosting } from '../pages/deployToHosting.js';
import { generateAndDeployContentListPage } from '../pages/deployContentListPage.js';
import { generateAndDeploySitemap } from '../pages/generateSitemap.js';
import { generateAndDeployRssFeeds } from '../pages/generateRssFeed.js';

interface QueueItem {
    action: 'publish' | 'unpublish' | 'update' | 'delete';
    contentTypeSlug: string;
    docId: string;
    timestamp: Timestamp;
}

/**
 * Mirrors the draft's language variants onto the published document, so the
 * per-language deploy and the SPA fallback both read from the published side.
 *
 * Languages removed from the draft are deleted from the published copy —
 * otherwise clearing a translation would leave its page deploying forever.
 */
async function syncTranslations(
    draftCollection: string,
    publishedCollection: string,
    docId: string,
): Promise<void> {
    try {
        const draftTranslations = await db
            .collection(draftCollection).doc(docId).collection('translations').get();
        const publishedRef = db.collection(publishedCollection).doc(docId).collection('translations');
        const publishedTranslations = await publishedRef.get();

        const draftLangs = new Set(draftTranslations.docs.map(d => d.id));
        const batch = db.batch();

        draftTranslations.docs.forEach(doc => {
            batch.set(publishedRef.doc(doc.id), doc.data());
        });
        publishedTranslations.docs
            .filter(doc => !draftLangs.has(doc.id))
            .forEach(doc => batch.delete(doc.ref));

        await batch.commit();
    } catch (error) {
        // A translation sync failure must not abort the publish — the default
        // language still deploys, which is the pre-multilingual behaviour.
        console.error(`Could not sync translations for ${publishedCollection}/${docId}:`, error);
    }
}

/** Removes every language variant of a published document. */
async function deleteTranslations(publishedCollection: string, docId: string): Promise<void> {
    try {
        const ref = db.collection(publishedCollection).doc(docId).collection('translations');
        const snap = await ref.get();
        if (snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    } catch (error) {
        console.error(`Could not delete translations for ${publishedCollection}/${docId}:`, error);
    }
}

/**
 * Records on the draft that it has just been published.
 *
 * The admin list distinguishes "Published" from "Edited" by comparing the
 * draft's `modifiedAt` against this stamp. Writing it here — after the
 * published copy is committed, and from the server rather than the client —
 * guarantees it lands at or after the `modifiedAt` of the write that triggered
 * the publish, so a freshly published item can never read as edited.
 *
 * Deliberately a narrow `update`: touching any other field (or `modifiedAt`)
 * would defeat the comparison it exists to support.
 */
async function stampLastPublishedAt(draftCollection: string, docId: string): Promise<void> {
    try {
        await db.collection(draftCollection).doc(docId).update({
            lastPublishedAt: Timestamp.now(),
        });
    } catch (error) {
        // A missing draft (deleted mid-publish) is not worth failing the run —
        // the status badge degrades to "Published", which is the safe default.
        console.warn(`Could not stamp lastPublishedAt on ${draftCollection}/${docId}:`, error);
    }
}

/**
 * Processes publish queue items.
 *
 * The admin app writes a trigger document to `_publish_queue` whenever
 * content is published, unpublished, updated, or deleted.
 * This function watches that single collection and syncs the draft content
 * to the corresponding published collection.
 *
 * This replaces the old wildcard triggers that fired for every Firestore write.
 */
export const processPublishQueue = onDocumentCreated('_publish_queue/{queueId}', async (event) => {
    const queueData = event.data?.data() as QueueItem | undefined;
    if (!queueData) return;

    const { action, contentTypeSlug, docId } = queueData;
    const queueDocRef = event.data?.ref;

    if (!contentTypeSlug || !docId || !action) {
        console.error('Invalid queue item — missing required fields:', queueData);
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // Everything this queue item touches — every language variant, the list
    // pages, the sitemap and the feeds — goes out as ONE Hosting release.
    // Deploying them one at a time raced: a later deploy could be built from
    // a release list that had not caught up and silently drop an earlier
    // file, which cost a translated page (docs/_todo.md item 3c).
    const batch = new HostingBatch();

    const publishedCollection = getPublishedCollectionName(contentTypeSlug);
    const draftCollection = getDraftCollectionName(contentTypeSlug);
    const publishedRef = db.collection(publishedCollection).doc(docId);

    // Look up ContentType to check hasPublicUrl
    const contentTypeSnap = await db.collection('ContentTypes')
        .where('slug', '==', contentTypeSlug).limit(1).get();
    const contentTypeData = contentTypeSnap.empty ? null : contentTypeSnap.docs[0].data();
    const hasPublicUrl = contentTypeData?.hasPublicUrl !== false;

    try {
        switch (action) {
            case 'publish': {
                // Read the draft and copy it to the published collection
                const draftDoc = await db.collection(draftCollection).doc(docId).get();
                if (!draftDoc.exists) {
                    console.warn(`Draft not found: ${draftCollection}/${docId}`);
                    break;
                }
                const draftData = draftDoc.data()!;
                draftData.publishedOn = Timestamp.now();

                // Batch the publish + history writes for atomicity
                const publishBatch = db.batch();
                publishBatch.set(publishedRef, { ...draftData, id: docId });
                publishBatch.set(publishedRef.collection('PublishedHistory').doc(), draftData);
                await publishBatch.commit();
                console.log(`Published: ${publishedCollection}/${docId}`);
                await syncTranslations(draftCollection, publishedCollection, docId);
                await stampLastPublishedAt(draftCollection, docId);

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                        await generateAndDeployContentListPage(contentTypeSlug, batch);
                    } catch (deployErr) {
                        console.error(`Static HTML deployment failed for publish ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                }
                break;
            }

            case 'update': {
                // Read the draft and update only changed fields in the published doc
                const draftSnap = await db.collection(draftCollection).doc(docId).get();
                const publishedSnap = await publishedRef.get();

                if (!draftSnap.exists) {
                    console.warn(`Draft not found for update: ${draftCollection}/${docId}`);
                    break;
                }

                const draftFields = draftSnap.data()!;

                // Batch the update + history writes for atomicity
                const updateBatch = db.batch();

                if (!publishedSnap.exists) {
                    // Published doc doesn't exist yet — do a full publish
                    draftFields.publishedOn = Timestamp.now();
                    updateBatch.set(publishedRef, { ...draftFields, id: docId });
                } else {
                    // Compute changed fields
                    const existingData = publishedSnap.data()!;
                    const changedFields: Record<string, unknown> = {};

                    Object.keys(draftFields).forEach((key) => {
                        if (JSON.stringify(existingData[key]) !== JSON.stringify(draftFields[key])) {
                            changedFields[key] = draftFields[key];
                        }
                    });

                    if (Object.keys(changedFields).length > 0) {
                        updateBatch.update(publishedRef, changedFields);
                        console.log(`Updated fields in ${publishedCollection}/${docId}:`, Object.keys(changedFields));
                    }
                }

                // Add to published history
                updateBatch.set(publishedRef.collection('PublishedHistory').doc(), draftFields);
                await updateBatch.commit();
                await syncTranslations(draftCollection, publishedCollection, docId);
                await stampLastPublishedAt(draftCollection, docId);

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                        await generateAndDeployContentListPage(contentTypeSlug, batch);
                    } catch (deployErr) {
                        console.error(`Static HTML deployment failed for update ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                }
                break;
            }

            case 'unpublish': {
                // Read urlSlug before deleting so we can remove the static page
                const doc = await publishedRef.get();
                const urlSlug = doc.exists ? doc.data()?.urlSlug : null;
                if (doc.exists) {
                    // Subcollections are not deleted with their parent.
                    await deleteTranslations(publishedCollection, docId);
                    await publishedRef.delete();
                    console.log(`Unpublished: ${publishedCollection}/${docId}`);
                }

                // Remove static HTML and regenerate list page
                if (hasPublicUrl) {
                    try {
                        if (urlSlug) {
                            await removeContentPage(contentTypeSlug, urlSlug, batch);
                        }
                        await generateAndDeployContentListPage(contentTypeSlug, batch);
                    } catch (deployErr) {
                        console.error(`Static HTML removal failed for unpublish ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                }
                break;
            }

            case 'delete': {
                // Read urlSlug before deleting so we can remove the static page
                const delDoc = await publishedRef.get();
                const delUrlSlug = delDoc.exists ? delDoc.data()?.urlSlug : null;
                if (delDoc.exists) {
                    // Subcollections are not deleted with their parent.
                    await deleteTranslations(publishedCollection, docId);
                    await publishedRef.delete();
                    console.log(`Deleted published: ${publishedCollection}/${docId}`);
                }

                // Safety net: also delete draft if it still exists
                // (The frontend normally deletes the draft first, but this ensures
                //  no orphaned drafts if the frontend call fails.)
                try {
                    const draftRef = db.collection(draftCollection).doc(docId);
                    const draftSnap = await draftRef.get();
                    if (draftSnap.exists) {
                        await draftRef.delete();
                        console.log(`Deleted draft (safety net): ${draftCollection}/${docId}`);
                    }
                } catch (draftErr) {
                    console.warn(`Could not delete draft ${draftCollection}/${docId}:`, draftErr);
                }

                // Remove static HTML and regenerate list page
                if (hasPublicUrl) {
                    try {
                        if (delUrlSlug) {
                            await removeContentPage(contentTypeSlug, delUrlSlug, batch);
                        }
                        await generateAndDeployContentListPage(contentTypeSlug, batch);
                    } catch (deployErr) {
                        console.error(`Static HTML removal failed for delete ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                }
                break;
            }

            default:
                console.warn(`Unknown action: ${action}`);
        }

        // Regenerate sitemap and RSS feeds after any content change
        // so SEO files stay current with published content.
        if (hasPublicUrl) {
            try {
                await generateAndDeploySitemap(batch);
            } catch (sitemapErr) {
                console.error('Sitemap regeneration failed:', sitemapErr);
            }
            try {
                await generateAndDeployRssFeeds(batch);
            } catch (rssErr) {
                console.error('RSS feed regeneration failed:', rssErr);
            }
        }
    } catch (error) {
        console.error(`Error processing queue item (${action} ${publishedCollection}/${docId}):`, error);
    }

    // Single release for the whole queue item.
    if (!batch.isEmpty) {
        try {
            await deployBatchToHosting(publishedCollection, batch, publishedCollection, docId);
            console.log(`Released ${batch.size} file(s) for ${action} ${contentTypeSlug}/${docId}`);
        } catch (deployErr) {
            console.error(`Hosting release failed for ${action} ${contentTypeSlug}/${docId}:`, deployErr);
        }
    }

    // Always clean up the queue document
    if (queueDocRef) {
        await queueDocRef.delete();
    }
});
