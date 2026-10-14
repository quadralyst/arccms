import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { getPublishedCollectionName, getDraftCollectionName } from '../draftContent/collectionHelpers.js';
import { MissingTemplateFolderError } from '../shared/site-files.js';
import { generateAndDeployHomePage, homeShowsType } from '../pages/deployHomePage.js';
import { chromeCardsSignature, chromeShowsType } from '../pages/card-blocks.js';
import { generateAndDeployContentDetailPage, removeContentPage } from '../pages/deployContentPage.js';
import { HostingBatch, deployBatchToHosting } from '../pages/deployToHosting.js';
import { generateAndDeployContentListPage } from '../pages/deployContentListPage.js';
import { rebuildPagesShowingItemsOf, typesShowingItemsOf } from '../pages/items-from-type-pages.js';
import { generateAndDeployStaticPage, staticPageSlugs } from '../pages/deployStaticPage.js';
import { generateAndDeploySitemap } from '../pages/generateSitemap.js';
import { generateAndDeployRssFeeds } from '../pages/generateRssFeed.js';
import { generateAndDeployRobotsTxt } from '../pages/generateRobotsTxt.js';
import { generateAndDeployLlmsTxt } from '../pages/generateLlmsTxt.js';
import { ensureIndexNowKey, submitBatchToIndexNow } from '../pages/indexNow.js';
import { getDiscoverabilitySettings } from '../shared/discoverability-settings.js';
import { contentSource, CONTENT_SOURCE_ID } from '../search/sources/content.js';
import { CONTENT_DRAFTS_SOURCE_ID } from '../search/sources/content-drafts.js';
import { syncDocument } from '../search/sync.js';
import { buildSearchContext } from '../search/context.js';
import { indexDocument, removeSearchEntries } from '../search/writer.js';
import { runReindex } from '../search/reindexSearch.js';
import { isFeatureOn } from '../feature-flags.js';
import { arcDocument, arcHostingSite } from '../arc-config.js';
import { claimCoalesced, coalescedIdFor, finishCoalesced, requestCoalesced } from './coalesced-items.js';
import type { RebuildCursor } from '../pages/items-from-type-pages.js';
import type { ItemsFromTypeCache } from '../pages/published-entries.js';

interface QueueItem {
    action: 'publish' | 'unpublish' | 'update' | 'delete' | 'redeploy' | 'redeploy-all' | 'home' | 'order' | 'items-from';
    contentTypeSlug: string;
    docId: string;
    timestamp: Timestamp;
}

/**
 * What a standard page shows in the site's footer: whether it is published, and
 * its title in every language. A change to it changes every page.
 */
export async function footerSignature(publishedRef: DocumentReference): Promise<string> {
    const snap = await publishedRef.get();
    if (!snap.exists) return '';
    const translations = await publishedRef.collection('translations').get();
    const titles = translations.docs.map((doc) => `${doc.id}:${doc.data()?.['title'] ?? ''}`).sort();
    return JSON.stringify([snap.data()?.['title'] ?? '', titles]);
}

/**
 * Queues a whole-site republish, in a queue item of its own so its release cannot
 * race this one. It coalesces (coalesced-items.ts): a bulk publish of a hundred
 * entries the header shows asks a hundred times, and the site is republished
 * once, or once more when a change comes in while it runs. Returns whether a
 * republish that starts after this call is certain.
 */
export async function queueRedeployAll(reason: string): Promise<boolean> {
    try {
        const outcome = await requestCoalesced('redeploy-all');
        console.log(`Republishing the whole site (${outcome}): ${reason}`);
        return true;
    } catch (error) {
        console.error(`Could not queue the whole-site republish (${reason}):`, error);
        return false;
    }
}

/**
 * Queues a rebuild of the detail pages that show entries of this type
 * (data-arc-items-src), when any template does, in a queue item of its own so
 * its release cannot race this one. One per type, coalesced like the whole-site
 * republish: it reads the entries when it runs, so a change before then adds
 * nothing, and a change while it runs makes it run once more.
 */
export async function queuePagesShowingItemsOf(slug: string): Promise<void> {
    try {
        if (!(await typesShowingItemsOf(slug)).length) return;
        const outcome = await requestCoalesced('items-from', slug);
        console.log(`Rebuilding the pages that show entries of ${slug} (${outcome})`);
    } catch (error) {
        console.error(`Could not queue the pages that show entries of ${slug}:`, error);
    }
}

/** How long an items-from run builds pages before it releases them and queues the rest: the function has 540s. */
export const ITEMS_FROM_BUILD_MS = 360_000;

/**
 * Copies each draft's `sortOrder` to its published copy (removing it where the
 * draft has none), then rebuilds the pages that show the type's entries: its
 * list page when it has public pages, the home page when it shows the type, and
 * every page (a queued whole-site republish) when the header or footer does.
 * Only `sortOrder` is written, so a draft's unpublished edits stay unpublished.
 * Returns whether it queued a whole-site republish.
 */
export async function applyEntryOrder(slug: string, batch: HostingBatch): Promise<boolean> {
    const [drafts, published, typeSnap] = await Promise.all([
        db.collection(getDraftCollectionName(slug)).get(),
        db.collection(getPublishedCollectionName(slug)).get(),
        db.collection('ContentTypes').where('slug', '==', slug).limit(1).get(),
    ]);
    const draftOrder = new Map(drafts.docs.map((doc) => [doc.id, doc.data().sortOrder]));

    const writes = published.docs.filter((doc) => doc.data().sortOrder !== draftOrder.get(doc.id));
    for (let i = 0; i < writes.length; i += 400) {
        const chunk = db.batch();
        for (const doc of writes.slice(i, i + 400)) {
            const value = draftOrder.get(doc.id);
            chunk.update(doc.ref, { sortOrder: typeof value === 'number' ? value : FieldValue.delete() });
        }
        await chunk.commit();
    }

    const typeData = typeSnap.empty ? null : typeSnap.docs[0].data();
    const hasPublicUrl = typeData?.hasPublicUrl !== false;
    if (hasPublicUrl) await generateAndDeployContentListPage(slug, batch);
    if (await homeShowsType(slug).catch(() => false)) await generateAndDeployHomePage(batch);
    // The footer lists the standard pages in this order (SS6). A card block in the
    // header or footer shows the type's entries in its order, which this item may
    // have changed without moving an entry (newest first to your own order).
    let siteRepublished = false;
    if (typeData?.standard === 'pages' && writes.length) siteRepublished = await queueRedeployAll(`standard pages put in a new order`);
    else if (await chromeShowsType(slug).catch(() => false)) siteRepublished = await queueRedeployAll(`${slug} in a new order in the header or footer`);
    console.log(`Entry order applied to ${slug}: ${writes.length} published entr${writes.length === 1 ? 'y' : 'ies'} changed`);
    return siteRepublished;
}

/**
 * Rebuilds every published page into one batch.
 *
 * One batch, and therefore one Hosting release, is the whole point. Releases
 * are built from the *previous* release's file list, so two of them finishing
 * within a second of each other silently drop one another's files — which is
 * exactly what a per-document repair loop does. Site-wide repair has to be a
 * single queue item.
 */
async function collectAllPublishedPages(batch: HostingBatch): Promise<number> {
    const contentTypes = await db.collection('ContentTypes').get();
    let pages = 0;
    // Entries of other types (data-arc-items-src) are read once for the whole site.
    const itemsFromTypeCache: ItemsFromTypeCache = new Map();

    for (const typeDoc of contentTypes.docs) {
        const { slug, hasPublicUrl } = typeDoc.data() as { slug?: string; hasPublicUrl?: boolean };
        if (!slug || hasPublicUrl === false) continue;

        const published = await db.collection(getPublishedCollectionName(slug)).get();
        if (published.empty) continue;

        for (const doc of published.docs) {
            try {
                await generateAndDeployContentDetailPage(slug, doc.id, batch, itemsFromTypeCache);
                pages++;
            } catch (error) {
                // One unbuildable page must not cost the other 23 their repair.
                console.error(`Could not rebuild ${slug}/${doc.id}:`, error);
            }
        }

        try {
            await generateAndDeployContentListPage(slug, batch);
        } catch (error) {
            console.error(`Could not rebuild the ${slug} list page:`, error);
        }
    }

    return pages;
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
        // The drafts index shows Draft, Published or Edited from this stamp, and
        // no trigger watches draft writes (specs/feature-flags-spec.md 6.5).
        if (isFeatureOn('search')) {
            const draft = await db.collection(draftCollection).doc(docId).get();
            await syncDocument(draftCollection, docId, draft.exists ? draft.data() ?? null : null);
        }
    } catch (error) {
        // A missing draft (deleted mid-publish) is not worth failing the run —
        // the status badge degrades to "Published", which is the safe default.
        console.warn(`Could not stamp lastPublishedAt on ${draftCollection}/${docId}:`, error);
    }
}

/**
 * Puts the published document into the search index, every language of it.
 *
 * Called from here rather than left to the wildcard trigger so that a failed
 * index write is logged beside the publish it belongs to (S-D12). Never
 * fails the publish: a page that deployed but cannot be searched is a far
 * smaller problem than one that was not deployed.
 */
async function indexPublished(publishedCollection: string, docId: string): Promise<void> {
    if (!isFeatureOn('search')) return; // specs/feature-flags-spec.md
    try {
        const snap = await db.collection(publishedCollection).doc(docId).get();
        const ctx = await buildSearchContext(publishedCollection, docId);
        const entries = await indexDocument(contentSource, snap.exists ? snap.data() : null, ctx);
        console.log(`Search index: ${entries} entr${entries === 1 ? 'y' : 'ies'} for ${publishedCollection}/${docId}`);
    } catch (error) {
        console.error(`Search index update failed for ${publishedCollection}/${docId}:`, error);
    }
}

/** Takes a document out of the published search index (and, on delete, the drafts index too). */
async function unindexPublished(contentTypeSlug: string, docId: string, alsoDrafts = false): Promise<void> {
    if (!isFeatureOn('search')) return; // specs/feature-flags-spec.md
    try {
        await removeSearchEntries(CONTENT_SOURCE_ID, getPublishedCollectionName(contentTypeSlug), docId);
        if (alsoDrafts) await removeSearchEntries(CONTENT_DRAFTS_SOURCE_ID, getDraftCollectionName(contentTypeSlug), docId);
    } catch (error) {
        console.error(`Search index removal failed for ${docId}:`, error);
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
/**
 * robots.txt, llms.txt and the IndexNow key file ride in every publish
 * release (specs/discoverability-spec.md, D3), so a settings change reaches
 * Hosting at the next publish even if the admin never pressed "apply".
 */
async function addDiscoverabilityFiles(batch: HostingBatch): Promise<void> {
    const steps: Array<[string, () => Promise<unknown>]> = [
        ['robots.txt', () => generateAndDeployRobotsTxt(batch)],
        ['llms.txt', () => generateAndDeployLlmsTxt(batch)],
        ['IndexNow key', async () => {
            const settings = await getDiscoverabilitySettings();
            if (settings.indexNow.enabled) await ensureIndexNowKey(batch);
        }],
    ];
    // Each file on its own: one failing must not cost the others, and none
    // may cost the pages already in the batch.
    for (const [name, step] of steps) {
        try {
            await step();
        } catch (error) {
            console.error(`${name} regeneration failed:`, error);
        }
    }
}

/**
 * Marks an item whose page could not be built as failed, with the reason, for the
 * editor to show (its deploy status badge). A template folder the live site does
 * not have says so in words an editor can act on (MissingTemplateFolderError).
 */
async function recordPageFailure(collectionName: string, docId: string, error: unknown): Promise<void> {
    const err = error as { message?: string; code?: string };
    try {
        await db.collection(collectionName).doc(docId).update({
            deployStatus: 'failed',
            deployedAt: new Date(),
            deployError: err?.message || 'The page could not be built.',
            deployErrorCode: error instanceof MissingTemplateFolderError ? 'TEMPLATE_FOLDER_MISSING' : (err?.code || 'PAGE_BUILD_FAILED'),
        });
    } catch (stampErr) {
        console.error(`Could not record the failed deploy on ${collectionName}/${docId}:`, stampErr);
    }
}

export const processPublishQueue = onDocumentCreated({
    ...arcDocument('_publish_queue/{queueId}'),
    // A 'redeploy-all' rebuilds every published page in one invocation —
    // template fetches and all — which does not fit in the 60s default.
    timeoutSeconds: 540,
    memory: '512MiB',
}, async (event) => {
    const queueData = event.data?.data() as QueueItem | undefined;
    if (!queueData) return;

    const { action, contentTypeSlug, docId } = queueData;
    const queueDocRef = event.data?.ref;
    const queueId = queueDocRef?.id ?? event.params?.queueId ?? '';

    // 'redeploy-all' and 'home' are site-wide, so they name no content type and no
    // document; 'order' is about a whole content type, so it names no document.
    const siteWide = action === 'redeploy-all' || action === 'home';
    const typeWide = action === 'order' || action === 'items-from';
    if (!action || (!siteWide && (!contentTypeSlug || (!typeWide && !docId)))) {
        console.error('Invalid queue item — missing required fields:', queueData);
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // Everything this queue item touches — every language variant, the list
    // pages, the sitemap and the feeds — goes out as ONE Hosting release.
    // Deploying them one at a time raced: a later deploy could be built from
    // a release list that had not caught up and silently drop an earlier
    // file, which cost a translated page (specs/_todo.md item 3c).
    const batch = new HostingBatch();
    /** Why this item's own page could not be built, if it could not (recordPageFailure). */
    let pageError: unknown = null;

    // The home page alone, after a setting it shows changed (onSiteSettingsWritten).
    if (action === 'home') {
        try {
            await generateAndDeployHomePage(batch);
            if (!batch.isEmpty) await deployBatchToHosting(arcHostingSite(), batch, '', '');
        } catch (error) {
            console.error('Home page republish failed:', error);
        }
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // A whole-site republish and a rebuild of the pages showing a type's entries
    // coalesce (coalesced-items.ts): each is one queue document with a fixed id.
    // One added any other way (the admin's Republish button, a settings change)
    // joins it, so it cannot run beside it and race its release.
    const coalescedId = coalescedIdFor(action, contentTypeSlug);
    if (coalescedId && queueId !== coalescedId) {
        if (action === 'redeploy-all') await queueRedeployAll(`asked for by queue item ${queueId}`);
        else await requestCoalesced('items-from', contentTypeSlug).catch((error) =>
            console.error(`Could not queue the pages that show entries of ${contentTypeSlug}:`, error));
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // Handled ahead of the per-document setup below, which needs a document to
    // point at. This one is about the site, not about a document.
    if (action === 'redeploy-all') {
        // Nothing to run when another delivery of the same trigger is running it.
        if (!(await claimCoalesced(coalescedId))) return;
        try {
            const pages = await collectAllPublishedPages(batch);
            // The home page is part of the site, whatever it shows.
            try {
                await generateAndDeployHomePage(batch);
            } catch (homeErr) {
                console.error('Home page rebuild failed during redeploy-all:', homeErr);
            }
            // So are the static pages (privacy policy, terms): they show the
            // header, footer and site styles too.
            for (const slug of await staticPageSlugs().catch(() => [] as string[])) {
                try {
                    await generateAndDeployStaticPage(slug, batch);
                } catch (pageErr) {
                    console.error(`Static page ${slug} rebuild failed during redeploy-all:`, pageErr);
                }
            }
            // Sitemap, feeds, robots/llms and IndexNow are the seo feature's.
            if (isFeatureOn('seo')) {
                await generateAndDeploySitemap(batch);
                await generateAndDeployRssFeeds(batch);
                await addDiscoverabilityFiles(batch);
            }
            if (!batch.isEmpty) {
                await deployBatchToHosting(arcHostingSite(), batch, '', '');
                if (isFeatureOn('seo')) await submitBatchToIndexNow(batch.files.map(f => f.path), batch.removedPaths);
            }
            console.log(`Redeployed ${pages} page(s) in ${batch.size} file(s)`);
        } catch (error) {
            console.error('Site-wide redeploy failed:', error);
        }
        // The published search index is rebuilt with the pages: a site-wide
        // repair should leave nothing behind that a search cannot find.
        if (isFeatureOn('search')) try {
            await runReindex({ source: CONTENT_SOURCE_ID });
        } catch (error) {
            console.error('Search reindex after redeploy-all failed:', error);
        }
        // Removed whether it worked or not, and queued once more if a change came in meanwhile.
        await finishCoalesced(coalescedId);
        return;
    }

    // A content type's entries were put in a new order (the Arrange dialog), or its
    // entry order changed: the pages that show them follow (specs/site-sections-spec.md, SS2).
    if (action === 'order') {
        let siteRepublished = false;
        try {
            siteRepublished = await applyEntryOrder(contentTypeSlug, batch);
            if (!batch.isEmpty) await deployBatchToHosting(arcHostingSite(), batch, '', '');
        } catch (error) {
            console.error(`Entry order update failed for ${contentTypeSlug}:`, error);
        }
        if (queueDocRef) await queueDocRef.delete();
        // A whole-site republish rebuilds those pages too.
        if (!siteRepublished) await queuePagesShowingItemsOf(contentTypeSlug);
        return;
    }

    // Entries of this type changed: the detail pages that show them
    // (data-arc-items-src) are built again, in one release. A change made while
    // this runs marks the item, and it runs once more (coalesced-items.ts). A
    // type with more pages than fit in one run releases what it built and queues
    // the rest, from where it stopped.
    if (action === 'items-from') {
        const claimed = await claimCoalesced(coalescedId);
        if (!claimed) return;
        let continuation: Record<string, unknown> | undefined;
        try {
            const after = claimed['after'] as RebuildCursor | undefined;
            const result = await rebuildPagesShowingItemsOf(contentTypeSlug, batch, { after, deadline: Date.now() + ITEMS_FROM_BUILD_MS });
            if (!batch.isEmpty) await deployBatchToHosting(arcHostingSite(), batch, '', '');
            console.log(`Rebuilt ${result.pages} page(s) that show entries of ${contentTypeSlug}`
                + (result.dropped ? `, leaving out ${result.dropped} unpublished meanwhile` : '')
                + (result.next ? `; the rest follow after ${result.next.type}/${result.next.id}` : ''));
            if (result.next) continuation = { after: result.next };
        } catch (error) {
            console.error(`Rebuilding the pages that show entries of ${contentTypeSlug} failed:`, error);
        }
        await finishCoalesced(coalescedId, continuation);
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
    // A standard page (SS6) is linked from every page's footer, and the terms
    // notice and cookie banner link to some of them: note what the footer shows
    // of it now, to republish the site if that changes.
    const isStandardPage = contentTypeData?.standard === 'pages';
    const footerBefore = isStandardPage ? await footerSignature(publishedRef) : '';
    // A card block in the header or footer shows the type's entries on every page:
    // note what it shows now, to republish the site if that changes ('' when none).
    const chromeBefore = await chromeCardsSignature(contentTypeSlug).catch(() => '');

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
                await indexPublished(publishedCollection, docId);

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                        await generateAndDeployContentListPage(contentTypeSlug, batch);
                    } catch (deployErr) {
                        pageError = deployErr;
                        console.error(`Static HTML deployment failed for publish ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                }
                break;
            }

            case 'redeploy': {
                // Regenerate the static pages from what is already published.
                //
                // A `firebase deploy --only hosting` builds its new version
                // from the previous *release's* file list, which contains only
                // what the CLI uploaded — so every page this pipeline wrote
                // disappears from the live site (specs/_todo.md item 3b). The
                // pages still need restoring, but the drafts behind them may
                // hold unreviewed edits, so 'publish' is the wrong repair:
                // it would push those edits live. This reads the published
                // document and touches no draft.
                if (!(await publishedRef.get()).exists) {
                    console.warn(`Nothing published to redeploy: ${publishedCollection}/${docId}`);
                    break;
                }
                if (hasPublicUrl) {
                    await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                    await generateAndDeployContentListPage(contentTypeSlug, batch);
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
                await indexPublished(publishedCollection, docId);

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                        await generateAndDeployContentListPage(contentTypeSlug, batch);
                    } catch (deployErr) {
                        pageError = deployErr;
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
                await unindexPublished(contentTypeSlug, docId);

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
                await unindexPublished(contentTypeSlug, docId, true);

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

        // The home page shows cards of some types, public pages or not: republish
        // it with them.
        if (await homeShowsType(contentTypeSlug).catch(() => false)) {
            try {
                await generateAndDeployHomePage(batch);
            } catch (homeErr) {
                console.error(`Home page rebuild failed after ${action} ${contentTypeSlug}/${docId}:`, homeErr);
            }
        }

        // Regenerate sitemap and RSS feeds after any content change
        // so SEO files stay current with published content (the seo feature).
        if (hasPublicUrl && isFeatureOn('seo')) {
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
            try {
                await addDiscoverabilityFiles(batch);
            } catch (discoverabilityErr) {
                console.error('Discoverability files regeneration failed:', discoverabilityErr);
            }
        }
    } catch (error) {
        console.error(`Error processing queue item (${action} ${publishedCollection}/${docId}):`, error);
    }

    // Single release for the whole queue item. When the item's own page could
    // not be built, the rest (list page, sitemap, feeds) still goes out, but the
    // release must not stamp the item "deployed": its failure is recorded below.
    if (!batch.isEmpty) {
        try {
            // First argument is the Hosting *site*, not the collection — the
            // deploy silently targets a site that does not exist otherwise.
            const siteId = arcHostingSite();
            const released = await deployBatchToHosting(
                siteId, batch, pageError ? '' : publishedCollection, pageError ? '' : docId);
            // Only after the release succeeded: a ping for pages that never
            // went live would send the engines to a 404 (D-D9). deployBatchToHosting
            // records a failure (or hosting being off) rather than throwing, so the
            // answer has to come from its return value.
            if (released) {
                console.log(`Released ${batch.size} file(s) for ${action} ${contentTypeSlug}/${docId}`);
                if (isFeatureOn('seo')) await submitBatchToIndexNow(batch.files.map(f => f.path), batch.removedPaths);
            }
        } catch (deployErr) {
            console.error(`Hosting release failed for ${action} ${contentTypeSlug}/${docId}:`, deployErr);
        }
    }

    if (pageError) await recordPageFailure(publishedCollection, docId, pageError);

    // The footer of every page lists the standard pages: when this one went live,
    // came down or changed its title, every page is republished, in a queue item
    // of its own so its release cannot race this one. The same when the header's
    // or footer's card blocks of this type now show something else.
    let siteRepublished = false;
    if (isStandardPage && (await footerSignature(publishedRef)) !== footerBefore) {
        siteRepublished = await queueRedeployAll(`standard page ${docId} changed in the footer`);
    } else if (chromeBefore && (await chromeCardsSignature(contentTypeSlug).catch(() => '')) !== chromeBefore) {
        siteRepublished = await queueRedeployAll(`${contentTypeSlug}/${docId} changed a card block in the header or footer`);
    }

    // Detail pages of any type may show this type's entries (data-arc-items-src):
    // they are rebuilt in a queue item of their own, unless the whole site is
    // republished, which rebuilds them anyway. A redeploy changes no entry.
    if (action !== 'redeploy' && !siteRepublished) await queuePagesShowingItemsOf(contentTypeSlug);

    // Always clean up the queue document
    if (queueDocRef) {
        await queueDocRef.delete();
    }
});
