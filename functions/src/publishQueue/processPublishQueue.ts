import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { getPublishedCollectionName, getDraftCollectionName } from '../draftContent/collectionHelpers.js';
import { generateAndDeployContentDetailPage, removeContentPage } from '../pages/deployContentPage.js';
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

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId);
                        await generateAndDeployContentListPage(contentTypeSlug);
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

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId);
                        await generateAndDeployContentListPage(contentTypeSlug);
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
                    await publishedRef.delete();
                    console.log(`Unpublished: ${publishedCollection}/${docId}`);
                }

                // Remove static HTML and regenerate list page
                if (hasPublicUrl) {
                    try {
                        if (urlSlug) {
                            await removeContentPage(contentTypeSlug, urlSlug);
                        }
                        await generateAndDeployContentListPage(contentTypeSlug);
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
                            await removeContentPage(contentTypeSlug, delUrlSlug);
                        }
                        await generateAndDeployContentListPage(contentTypeSlug);
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
                await generateAndDeploySitemap();
            } catch (sitemapErr) {
                console.error('Sitemap regeneration failed:', sitemapErr);
            }
            try {
                await generateAndDeployRssFeeds();
            } catch (rssErr) {
                console.error('RSS feed regeneration failed:', rssErr);
            }
        }
    } catch (error) {
        console.error(`Error processing queue item (${action} ${publishedCollection}/${docId}):`, error);
    }

    // Always clean up the queue document
    if (queueDocRef) {
        await queueDocRef.delete();
    }
});
