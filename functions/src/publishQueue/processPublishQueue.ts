import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { getPublishedCollectionName, getDraftCollectionName } from '../draftContent/collectionHelpers.js';
import { MissingTemplateFolderError } from '../shared/site-files.js';
import { generateAndDeployHomePage, homeShowsType } from '../pages/deployHomePage.js';
import { chromeCardsSignature, chromeShowsType } from '../pages/card-blocks.js';
import { generateAndDeployContentDetailPage, removeContentPage } from '../pages/deployContentPage.js';
import { HostingBatch, deployBatchToHosting, type DeployBatchOptions } from '../pages/deployToHosting.js';
import { generateAndDeployContentListPage } from '../pages/deployContentListPage.js';
import { moveContentPage } from '../pages/moved-page.js';
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
import { claimCoalesced, coalescedIdFor, finishCoalesced, requestCoalesced, rerunCoalesced } from './coalesced-items.js';
import { markPageTextLive, markPageTextUnreleased, pageOfPageTextId, publishedPageTextStamp, publishPageTextDraft } from '../pages/page-text-store.js';
import { pageTextId } from '../shared/page-text.js';
import type { RebuildCursor } from '../pages/items-from-type-pages.js';
import type { ItemsFromTypeCache } from '../pages/published-entries.js';

interface QueueItem {
    action: 'publish' | 'unpublish' | 'update' | 'delete' | 'redeploy' | 'redeploy-all' | 'home' | 'list' | 'order' | 'items-from' | 'page-text' | 'purge-draft';
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

/**
 * Queues a rebuild of the home page in every language, coalesced
 * (coalesced-items.ts, specs/visual-editing-spec.md VE-D57): five cards and the
 * page text published together make one release of the home page, not one each.
 */
export async function queueHomePage(reason: string): Promise<boolean> {
    try {
        const outcome = await requestCoalesced('home');
        console.log(`Rebuilding the home page (${outcome}): ${reason}`);
        return true;
    } catch (error) {
        console.error(`Could not queue the home page rebuild (${reason}):`, error);
        return false;
    }
}

/**
 * Queues a rebuild of a type's list page in every language, coalesced
 * (specs/visual-editing-spec.md, VE-D63): its words were published.
 */
export async function queueListPage(slug: string, reason: string): Promise<boolean> {
    try {
        const outcome = await requestCoalesced('list', slug);
        console.log(`Rebuilding the ${slug} list page (${outcome}): ${reason}`);
        return true;
    } catch (error) {
        console.error(`Could not queue the ${slug} list page rebuild (${reason}):`, error);
        return false;
    }
}

/** Whether a type has a list page: it exists, and has public pages. */
async function hasListPage(slug: string): Promise<boolean> {
    const snap = await db.collection('ContentTypes').where('slug', '==', slug).limit(1).get();
    return !snap.empty && snap.docs[0].data()?.hasPublicUrl !== false;
}

/**
 * The list pages one run built into its own release, and the mark of the words each
 * was built with (publishedPageTextStamp). An entry's list page goes out with the
 * entry, so it shows there as soon as the entry is live; only a publish of the list
 * page's words is a coalesced item. The two can cross, so each makes sure the other
 * is on the page: `buildListPage` runs a list rebuild under way again (it may have
 * read the entries before this one), and `rebuildListsChanged`, after the release,
 * queues one when words were published since this page was built.
 */
export type ListBuilds = Map<string, string>;

/** The page's words are out (markPageTextLive); a mark that fails costs only a later "Published". */
async function wordsLive(pageId: string, stamp: string): Promise<void> {
    await markPageTextLive(pageId, stamp).catch((error) => console.error(`Could not mark ${pageId} as live:`, error));
}

const listStamp = (slug: string): Promise<string> => publishedPageTextStamp(pageTextId.listPage(slug));

async function buildListPage(slug: string, batch: HostingBatch, builds: ListBuilds): Promise<void> {
    try {
        builds.set(slug, await listStamp(slug));
        if (await rerunCoalesced('list', slug)) console.log(`The ${slug} list page is being rebuilt; it runs again with this change`);
    } catch (error) {
        console.error(`Could not check for a rebuild of the ${slug} list page:`, error);
    }
    await generateAndDeployContentListPage(slug, batch);
}

async function rebuildListsChanged(builds: ListBuilds): Promise<void> {
    for (const [slug, stamp] of builds) {
        try {
            if ((await listStamp(slug)) !== stamp) await queueListPage(slug, 'its words were published while it was being released');
        } catch (error) {
            console.error(`Could not check the words of the ${slug} list page:`, error);
        }
    }
}

/** The queue function's timeout (timeoutSeconds below), in ms. */
export const QUEUE_TIMEOUT_MS = 540_000;

/**
 * When a run's release must be done, counted from the start of the run: the
 * rest of the timeout is kept for what follows the release (IndexNow, finishing
 * a coalesced item). The wait for the release lock is cut to fit
 * (DeployBatchOptions.deadline).
 */
export const RELEASE_BY_MS = QUEUE_TIMEOUT_MS - 60_000;

/**
 * How long a coalesced run (redeploy-all, items-from) builds pages before it
 * releases what it built and queues the rest. With the wait for the release
 * lock (at most RELEASE_BY_MS - this - RELEASE_TIME_MS, so 150s) and the release
 * itself, the run fits in the function's 540s.
 */
export const COALESCED_BUILD_MS = 240_000;

/**
 * The release of an ordinary queue item: done before the run's time is up,
 * and when another release still holds the lock after the full wait, one more
 * wait while time is left, so a publish does not fail for a release queue that
 * was only long (DeployBatchOptions.busyRetries).
 */
function itemRelease(runStart: number): DeployBatchOptions {
    return { deadline: runStart + RELEASE_BY_MS, busyRetries: 1 };
}

/**
 * Releases a coalesced run's batch before the run's time is up. Resolves with
 * whether it went out, and why not. Nothing to release, or Hosting turned off
 * for this install, is no failure: there is nothing to run again for.
 */
async function releaseRun(batch: HostingBatch, runStart: number): Promise<{ released: boolean; failure: string }> {
    if (batch.isEmpty) return { released: false, failure: '' };
    const siteId = arcHostingSite();
    let failure = '';
    const released = await deployBatchToHosting(siteId, batch, '', '', {
        deadline: runStart + RELEASE_BY_MS,
        onFailure: (f) => { failure = `${f.code}: ${f.message}`; },
    });
    if (!siteId) return { released: false, failure: '' };
    return { released, failure: released ? '' : (failure || 'the release did not go out') };
}

/**
 * Copies each draft's `sortOrder` to its published copy (removing it where the
 * draft has none), then rebuilds the pages that show the type's entries: its
 * list page when it has public pages, the home page when it shows the type, and
 * every page (a queued whole-site republish) when the header or footer does.
 * Only `sortOrder` is written, so a draft's unpublished edits stay unpublished.
 * Returns whether it queued a whole-site republish.
 */
export async function applyEntryOrder(slug: string, batch: HostingBatch, builds: ListBuilds = new Map()): Promise<boolean> {
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
    if (hasPublicUrl) await buildListPage(slug, batch, builds);
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

/** Where a whole-site rebuild stopped: the last entry it went through (as items-from's cursor). */
type SiteCursor = RebuildCursor;

const bySlug = (a: { slug: string }, b: { slug: string }) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
const byDocId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Rebuilds every published detail and list page into one batch.
 *
 * One batch per run: releases are built from the *previous* release's file
 * list, and a per-document repair loop would make one release per page. Types
 * go by slug and entries by id, so a run that reaches `deadline` returns where
 * it stopped (`next`) and a continuation goes on from `after`; each part is one
 * release, and the release lock makes each build on the one before.
 */
async function collectAllPublishedPages(
    batch: HostingBatch,
    options: { after?: SiteCursor; deadline?: number; builds?: ListBuilds } = {},
): Promise<{ pages: number; next?: SiteCursor }> {
    const { after, deadline = Infinity, builds = new Map() } = options;
    const contentTypes = (await db.collection('ContentTypes').get()).docs
        .map((doc) => doc.data() as { slug?: string; hasPublicUrl?: boolean })
        .filter((type): type is { slug: string; hasPublicUrl?: boolean } => !!type.slug && type.hasPublicUrl !== false)
        .sort(bySlug);
    let pages = 0;
    /** The last entry gone through, built or not: where a continuation goes on from. */
    let cursor: SiteCursor | undefined;
    /** Entries gone through: each part goes through at least one, so the rebuild always moves on. */
    let seen = 0;
    // Entries of other types (data-arc-items-src) are read once for the whole run.
    const itemsFromTypeCache: ItemsFromTypeCache = new Map();

    for (const { slug } of contentTypes) {
        if (after && slug < after.type) continue;

        const published = await db.collection(getPublishedCollectionName(slug)).get();
        if (published.empty) continue;

        for (const doc of [...published.docs].sort(byDocId)) {
            if (after && slug === after.type && doc.id <= after.id) continue;
            if (Date.now() >= deadline && seen) return { pages, next: cursor };
            cursor = { type: slug, id: doc.id };
            seen++;
            try {
                await generateAndDeployContentDetailPage(slug, doc.id, batch, itemsFromTypeCache);
                pages++;
            } catch (error) {
                // One unbuildable page must not cost the other 23 their repair.
                console.error(`Could not rebuild ${slug}/${doc.id}:`, error);
            }
        }

        try {
            await buildListPage(slug, batch, builds);
        } catch (error) {
            console.error(`Could not rebuild the ${slug} list page:`, error);
        }
    }

    return { pages };
}

/**
 * Mirrors the draft's language variants onto the published document, so the
 * per-language deploy and the SPA fallback both read from the published side.
 *
 * Languages removed from the draft are deleted from the published copy —
 * otherwise clearing a translation would leave its page deploying forever.
 * Resolves with the words it copied (translationWords), null when it could not.
 */
async function syncTranslations(
    draftCollection: string,
    publishedCollection: string,
    docId: string,
): Promise<Map<string, string> | null> {
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
        return translationWords(draftTranslations.docs);
    } catch (error) {
        // A translation sync failure must not abort the publish — the default
        // language still deploys, which is the pre-multilingual behaviour. The draft
        // still reads as not published, since its translations may not be live.
        console.error(`Could not sync translations for ${publishedCollection}/${docId}:`, error);
        return null;
    }
}

/** What an entry's translations say, per language, to tell whether one was saved since. */
function translationWords(docs: { id: string; data(): Record<string, any> }[]): Map<string, string> {
    return new Map(docs.map((doc) => [doc.id, stableWords(doc.data())]));
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
 * Removes everything under an entry that is deleted: its draft's other languages and
 * the drafts kept before take overs and discards (VE-D84), each with its own. What is
 * under a document outlives it.
 */
async function deleteUnderDraft(draftCollection: string, docId: string): Promise<void> {
    try {
        await db.recursiveDelete(db.collection(draftCollection).doc(docId));
    } catch (error) {
        console.error(`Could not delete what is under ${draftCollection}/${docId}:`, error);
    }
}

/**
 * The entry was taken off the site. A save of its editor that landed between the
 * Unpublish and the published copy's removal (an auto-save, or one that let go of the
 * entry) says it is published again: it is not. A Publish asked for since is
 * left alone: its own item puts the entry back.
 */
async function markUnpublished(draftCollection: string, contentTypeSlug: string, docId: string): Promise<void> {
    try {
        const ref = db.collection(draftCollection).doc(docId);
        if ((await ref.get()).data()?.['publishedStatus'] !== true) return;
        const waiting = await db.collection('_publish_queue').where('docId', '==', docId).get();
        if (waiting.docs.some((item) => item.data()['contentTypeSlug'] === contentTypeSlug && ['publish', 'update'].includes(item.data()['action']))) return;
        await db.runTransaction(async (tx) => {
            const now = (await tx.get(ref)).data();
            if (now?.['publishedStatus'] === true) tx.update(ref, { publishedStatus: false, status: 'draft' });
        });
    } catch (error) {
        console.error(`Could not mark ${draftCollection}/${docId} as unpublished:`, error);
    }
}

/**
 * What belongs to the draft alone, and is never copied to what visitors, History or
 * the published search read: the address choice of one publish, who holds the draft
 * (a person's name and account, VE-D78), and the page a card was changed on (VE-D72).
 */
export function publishableDraft(draft: Record<string, any>): { redirectOldAddress: unknown; data: Record<string, any> } {
    const { redirectOldAddress, editing: _editing, changedOnPage: _changedOnPage, ...data } = draft;
    return { redirectOldAddress, data };
}

/**
 * The fields of a draft that are not its words: where it stands, who saved it, and
 * what the CMS keeps beside them. The links of a series are words: they show on the page.
 */
const NOT_WORDS = new Set([
    'modifiedAt', 'updatedAt', 'modifiedBy', 'createdAt', 'createdBy', 'id', 'status', 'publishedStatus', 'publishedOn', 'lastPublishedAt',
    'editing', 'changedOnPage', 'addedOnPage', 'redirectOldAddress', 'sortOrder', 'isFeatured',
]);

/**
 * What a draft or a translation says, as one text to compare: key order, empty values
 * and how a time is stored make no difference, nor do the copies of other entries the
 * CMS keeps in step (`_ref_*`).
 */
export function stableWords(data: Record<string, any>): string {
    const norm = (value: any): unknown => {
        if (value === null || value === undefined || value === '') return undefined;
        if (typeof value !== 'object') return value;
        if (typeof value.toMillis === 'function') return { time: value.toMillis() };
        if (value instanceof Date) return { time: value.getTime() };
        if (Array.isArray(value)) return value.length ? value.map((item) => norm(item) ?? null) : undefined;
        const entries = Object.keys(value).filter((key) => !key.startsWith('_ref_')).sort()
            .map((key) => [key, norm(value[key])] as const).filter(([, item]) => item !== undefined);
        return entries.length ? Object.fromEntries(entries) : undefined;
    };
    return JSON.stringify(norm(Object.fromEntries(Object.entries(data).filter(([key]) => !NOT_WORDS.has(key)))) ?? {});
}

/** The same languages, saying the same. */
function sameTranslations(a: Map<string, string>, b: Map<string, string>): boolean {
    return a.size === b.size && [...a].every(([lang, words]) => b.get(lang) === words);
}

/** A stored time in milliseconds: a Timestamp, a copy of one, or a Date. */
function millisOf(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1e6);
    return value instanceof Date ? value.getTime() : 0;
}

/**
 * Records on the draft that it has just been published, and lets go of it
 * (specs/visual-editing-spec.md, VE-D76): whoever held it has nothing unpublished
 * left, and a card changed on a page is out.
 *
 * The admin list distinguishes "Published" from "Edited" by comparing the
 * draft's `modifiedAt` against this stamp. Writing it here — after the
 * published copy is committed, and from the server rather than the client —
 * guarantees it lands at or after the `modifiedAt` of the write that triggered
 * the publish, so a freshly published item can never read as edited.
 *
 * What went out is compared with what is stored by its words, not its dates
 * (`copied`, read at `readAt`, and `translations`, the languages copied, null when they
 * could not be): a reference kept in step moves the dates alone. A draft saved
 * meanwhile holds words that are not live, put back to earlier ones too, or in
 * another language: it is stamped with the time it was read, reads as edited (its
 * `modifiedAt` is moved only when it would not), and whoever saved it keeps it.
 */
async function stampLastPublishedAt(
    draftCollection: string, docId: string, copied: Record<string, any>, readAt: Timestamp, translations: Map<string, string> | null,
): Promise<void> {
    try {
        const ref = db.collection(draftCollection).doc(docId);
        await db.runTransaction(async (tx) => {
            const now = (await tx.get(ref)).data();
            if (!now) throw new Error('the draft is gone');
            const stored = translationWords((await tx.get(ref.collection('translations'))).docs);
            const landed = !!translations && sameTranslations(translations, stored) && stableWords(now) === stableWords(copied);
            if (landed) {
                tx.update(ref, { lastPublishedAt: Timestamp.now(), editing: FieldValue.delete(), changedOnPage: FieldValue.delete() });
                return;
            }
            tx.update(ref, {
                lastPublishedAt: readAt,
                ...(millisOf(now['modifiedAt']) > millisOf(readAt) ? {} : { modifiedAt: Timestamp.now() }),
                ...(now['status'] === 'draft' ? {} : { status: 'draft' }),
            });
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

/** The address of an entry's live page, '' when it has none. */
async function publishedSlug(publishedRef: DocumentReference): Promise<string> {
    try {
        const snap = await publishedRef.get();
        return snap.exists ? String(snap.data()?.['urlSlug'] || '') : '';
    } catch (error) {
        console.error(`Could not read the live address of ${publishedRef.path}:`, error);
        return '';
    }
}

/**
 * The entry's address changed since its page went live: the old address sends
 * visitors to the new one, or comes down when the editor's "Send the old
 * address to the new one" was unticked (moved-page.ts). A failure here never
 * holds back the new page.
 */
async function moveOldAddress(
    publishedRef: DocumentReference,
    contentTypeSlug: string,
    docId: string,
    from: string,
    to: unknown,
    redirect: unknown,
    batch: HostingBatch,
    movedPaths: Set<string>,
): Promise<void> {
    const next = typeof to === 'string' ? to : '';
    if (!from || !next || from === next) return;
    try {
        // Another published entry may hold the old address by now (this one's
        // draft moved before it was published again): its page is left alone.
        const holders = await publishedRef.parent.where('urlSlug', '==', from).limit(2).get();
        if (holders.docs.some((holder) => holder.id !== docId)) {
            console.log(`${contentTypeSlug}/${docId} moved from ${from}, which another entry now has: left as it is`);
            return;
        }
        // Only the languages this entry had a page in: the default one and its translations.
        const translations = await publishedRef.collection('translations').get();
        const added = await moveContentPage(contentTypeSlug, from, next, redirect !== false, batch,
            translations.docs.map((translation) => translation.id));
        for (const path of added) movedPaths.add(path);
        console.log(`${contentTypeSlug}/${docId} moved from ${from} to ${next}`
            + (redirect !== false ? ', the old address sends visitors on' : ', the old address removed'));
    } catch (error) {
        console.error(`Could not move the old address of ${contentTypeSlug}/${docId}:`, error);
    }
}

/**
 * The editor's "Send the old address to the new one" applies to the publish it
 * came with only: a later publish from anywhere else uses the default again.
 */
async function clearRedirectChoice(draftCollection: string, docId: string, choice: unknown): Promise<void> {
    if (choice === undefined) return;
    try {
        await db.collection(draftCollection).doc(docId).update({ redirectOldAddress: FieldValue.delete() });
    } catch (error) {
        console.warn(`Could not clear the redirect choice on ${draftCollection}/${docId}:`, error);
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
    timeoutSeconds: QUEUE_TIMEOUT_MS / 1000,
    memory: '512MiB',
}, async (event) => {
    /** When this run started: its release and its build have budgets counted from here. */
    const runStart = Date.now();
    const queueData = event.data?.data() as QueueItem | undefined;
    if (!queueData) return;

    const { action, contentTypeSlug, docId } = queueData;
    const queueDocRef = event.data?.ref;
    const queueId = queueDocRef?.id ?? event.params?.queueId ?? '';

    // 'redeploy-all' and 'home' are site-wide, so they name no content type and no
    // document; 'order' is about a whole content type, so it names no document;
    // 'page-text' names a page (`home`, `p-{name}`, `list-{slug}`) and no content type.
    const siteWide = action === 'redeploy-all' || action === 'home';
    const typeWide = action === 'order' || action === 'items-from' || action === 'list';
    const pageWide = action === 'page-text';
    if (!action || (pageWide ? !docId : (!siteWide && (!contentTypeSlug || (!typeWide && !docId))))) {
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
    /** The list pages built into this release (buildListPage). */
    const listBuilds: ListBuilds = new Map();
    /** Pages left at an old address (moved-page.ts): not sent to IndexNow as new pages. */
    const movedPaths = new Set<string>();

    // A page's text was published (specs/visual-editing-spec.md, VE-D57): its draft
    // becomes the published copy, kept in History, and the page is rebuilt. The
    // home page joins the coalesced home page rebuild, with any cards published
    // with it, and a list page its own coalesced rebuild (VE-D63); a static page
    // goes out in this item's own release.
    if (action === 'page-text') {
        const page = pageOfPageTextId(docId);
        let published = false;
        try {
            if (!page) throw new Error(`not a page: ${docId}`);
            if (page.kind === 'list' && !(await hasListPage(page.slug))) throw new Error(`${page.slug} has no list page`);
            await publishPageTextDraft(docId, queueId || undefined);
            published = true;
            if (page.kind === 'home') {
                // Not queued: the words are copied but will not go out, so the admin must not say Published (review M1).
                if (!(await queueHomePage('its page text was published'))) throw new Error('the home page rebuild could not be queued');
            } else if (page.kind === 'list') {
                if (!(await queueListPage(page.slug, 'its words were published'))) throw new Error('the list page rebuild could not be queued');
            } else {
                const words = await publishedPageTextStamp(docId);
                await generateAndDeployStaticPage(page.name, batch);
                const released = !batch.isEmpty
                    && await deployBatchToHosting(arcHostingSite(), batch, 'static_pages', page.name, itemRelease(runStart));
                if (!released) throw new Error(`the page ${page.name} did not go live`);
                await wordsLive(docId, words);
            }
        } catch (error) {
            console.error(`Publishing the page text of ${docId} failed:`, error);
            // Copied but not live: the admin shows the page as not published, so Publish can run again.
            if (published) await markPageTextUnreleased(docId).catch((e) => console.error(`Could not mark ${docId} as not live:`, e));
        }
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // A whole-site republish, a rebuild of the pages showing a type's entries and
    // a rebuild of the home page coalesce (coalesced-items.ts): each is one queue
    // document with a fixed id. One added any other way (the admin's Republish
    // button, a settings change) joins it, so it cannot run beside it and race
    // its release.
    const coalescedId = coalescedIdFor(action, contentTypeSlug);
    if (coalescedId && queueId !== coalescedId) {
        if (action === 'redeploy-all') await queueRedeployAll(`asked for by queue item ${queueId}`);
        else if (action === 'home') await queueHomePage(`asked for by queue item ${queueId}`);
        else if (action === 'list') await queueListPage(contentTypeSlug, `asked for by queue item ${queueId}`);
        else await requestCoalesced('items-from', contentTypeSlug).catch((error) =>
            console.error(`Could not queue the pages that show entries of ${contentTypeSlug}:`, error));
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // The home page in every language: after a setting it shows changed
    // (onSiteSettingsWritten), its cards' entries changed, or its page text was
    // published. However many asked, one run builds it from what is published then.
    if (action === 'home') {
        const claimed = await claimCoalesced(coalescedId);
        if (!claimed) return;
        let failure = '';
        let words = '';
        try {
            words = await publishedPageTextStamp('home');
            await generateAndDeployHomePage(batch);
            const run = await releaseRun(batch, runStart);
            failure = run.failure;
            // Search engines hear of the new home page, as they did when it went out with an entry.
            if (run.released && isFeatureOn('seo')) await submitBatchToIndexNow(batch.files.map((f) => f.path), batch.removedPaths);
        } catch (error: any) {
            failure = error?.message || String(error);
            console.error('Home page republish failed:', error);
        }
        if (failure) {
            const givenUp = await finishCoalesced(coalescedId, undefined, { failed: true, error: failure });
            // The home page did not go out and will not be tried again: its published words are
            // shown as not live, so the admin offers Publish again rather than saying Published (review M1).
            if (givenUp) await markPageTextUnreleased('home').catch((e) => console.error('Could not mark the home page text as not live:', e));
        } else {
            await wordsLive('home', words);
            await finishCoalesced(coalescedId);
        }
        return;
    }

    // A type's list page in every language, after its words were published (VE-D63).
    // However many asked, one run builds it from what is published then. A type
    // deleted, or with its public pages turned off, meanwhile has none to build.
    if (action === 'list') {
        const claimed = await claimCoalesced(coalescedId);
        if (!claimed) return;
        let failure = '';
        let words = '';
        try {
            if (await hasListPage(contentTypeSlug)) {
                words = await listStamp(contentTypeSlug);
                await generateAndDeployContentListPage(contentTypeSlug, batch);
                const run = await releaseRun(batch, runStart);
                failure = run.failure;
                if (run.released && isFeatureOn('seo')) await submitBatchToIndexNow(batch.files.map((f) => f.path), batch.removedPaths);
            }
        } catch (error: any) {
            failure = error?.message || String(error);
            console.error(`Rebuilding the ${contentTypeSlug} list page failed:`, error);
        }
        if (failure) {
            const givenUp = await finishCoalesced(coalescedId, undefined, { failed: true, error: failure });
            // As for the home page: not live and not tried again, so the admin offers Publish again.
            if (givenUp) {
                await markPageTextUnreleased(pageTextId.listPage(contentTypeSlug))
                    .catch((e) => console.error(`Could not mark the ${contentTypeSlug} list page text as not live:`, e));
            }
        } else {
            await wordsLive(pageTextId.listPage(contentTypeSlug), words);
            await finishCoalesced(coalescedId);
        }
        return;
    }

    // Handled ahead of the per-document setup below, which needs a document to
    // point at. This one is about the site, not about a document.
    if (action === 'redeploy-all') {
        // Nothing to run when another delivery of the same trigger is running it.
        const claimed = await claimCoalesced(coalescedId);
        if (!claimed) return;
        const after = claimed['after'] as SiteCursor | undefined;
        let continuation: Record<string, unknown> | undefined;
        let failure = '';
        try {
            // A site with more pages than fit in one run releases what it built
            // and goes on in a new run from where it stopped (as items-from).
            const { pages, next } = await collectAllPublishedPages(batch, { after, deadline: runStart + COALESCED_BUILD_MS, builds: listBuilds });
            if (!next) {
                // The last part: the home page is part of the site, whatever it shows.
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
                // Sitemap, feeds, robots/llms and IndexNow are the seo feature's. Each
                // on its own, as for one entry: a file that cannot be built must not
                // hold back the pages, and running the part again would not fix it.
                if (isFeatureOn('seo')) {
                    for (const [name, step] of [
                        ['Sitemap', () => generateAndDeploySitemap(batch)],
                        ['RSS feed', () => generateAndDeployRssFeeds(batch)],
                        ['Discoverability files', () => addDiscoverabilityFiles(batch)],
                    ] as Array<[string, () => Promise<void>]>) {
                        try {
                            await step();
                        } catch (seoErr) {
                            console.error(`${name} regeneration failed during redeploy-all:`, seoErr);
                        }
                    }
                }
            }
            const run = await releaseRun(batch, runStart);
            failure = run.failure;
            if (run.released && isFeatureOn('seo')) await submitBatchToIndexNow(batch.files.map(f => f.path), batch.removedPaths);
            if (!failure && next) continuation = { after: next };
            console.log(`Redeployed ${pages} page(s) in ${batch.size} file(s)`
                + (failure ? `, but the release did not go out (${failure})` : '')
                + (next && !failure ? `; the rest follow after ${next.type}/${next.id}` : ''));
        } catch (error: any) {
            failure = error?.message || String(error);
            console.error('Site-wide redeploy failed:', error);
        }
        await rebuildListsChanged(listBuilds);
        // The published search index is rebuilt with the pages, once they all
        // went out: a site-wide repair should leave nothing behind that a search
        // cannot find.
        if (!failure && !continuation && isFeatureOn('search')) try {
            await runReindex({ source: CONTENT_SOURCE_ID });
        } catch (error) {
            console.error('Search reindex after redeploy-all failed:', error);
        }
        // Removed whether it worked or not, and queued again for the rest, for a
        // change that came in meanwhile, or (a failed run) to try the same part again.
        if (failure) await finishCoalesced(coalescedId, after ? { after } : undefined, { failed: true, error: failure });
        else await finishCoalesced(coalescedId, continuation);
        return;
    }

    // A draft with no live page was deleted: what is under it (its other languages, kept
    // drafts) goes too. Nothing on the site changes. A draft that is still there, or is
    // again, keeps everything.
    if (action === 'purge-draft') {
        const draftCollection = getDraftCollectionName(contentTypeSlug);
        try {
            if ((await db.collection(draftCollection).doc(docId).get()).exists) console.warn(`Not purging ${draftCollection}/${docId}: the draft is there`);
            else await deleteUnderDraft(draftCollection, docId);
        } catch (error) {
            console.error(`Could not purge ${draftCollection}/${docId}:`, error);
        }
        if (queueDocRef) await queueDocRef.delete();
        return;
    }

    // A content type's entries were put in a new order (the Arrange dialog), or its
    // entry order changed: the pages that show them follow (specs/site-sections-spec.md, SS2).
    if (action === 'order') {
        let siteRepublished = false;
        try {
            siteRepublished = await applyEntryOrder(contentTypeSlug, batch, listBuilds);
            if (!batch.isEmpty) await deployBatchToHosting(arcHostingSite(), batch, '', '', itemRelease(runStart));
        } catch (error) {
            console.error(`Entry order update failed for ${contentTypeSlug}:`, error);
        }
        await rebuildListsChanged(listBuilds);
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
        const after = claimed['after'] as RebuildCursor | undefined;
        let continuation: Record<string, unknown> | undefined;
        let failure = '';
        try {
            const result = await rebuildPagesShowingItemsOf(contentTypeSlug, batch, { after, deadline: runStart + COALESCED_BUILD_MS });
            failure = (await releaseRun(batch, runStart)).failure;
            console.log(`Rebuilt ${result.pages} page(s) that show entries of ${contentTypeSlug}`
                + (result.dropped ? `, leaving out ${result.dropped} unpublished meanwhile` : '')
                + (failure ? `, but the release did not go out (${failure})` : '')
                + (result.next && !failure ? `; the rest follow after ${result.next.type}/${result.next.id}` : ''));
            if (!failure && result.next) continuation = { after: result.next };
        } catch (error: any) {
            failure = error?.message || String(error);
            console.error(`Rebuilding the pages that show entries of ${contentTypeSlug} failed:`, error);
        }
        // A failed run is run again from where it started (MAX_FAILED_RUNS).
        if (failure) await finishCoalesced(coalescedId, after ? { after } : undefined, { failed: true, error: failure });
        else await finishCoalesced(coalescedId, continuation);
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
                const readAt = Timestamp.now();
                const draftDoc = await db.collection(draftCollection).doc(docId).get();
                if (!draftDoc.exists) {
                    console.warn(`Draft not found: ${draftCollection}/${docId}`);
                    break;
                }
                const copied = draftDoc.data()!;
                const { redirectOldAddress, data: draftData } = publishableDraft(copied);
                draftData.publishedOn = Timestamp.now();
                // The live page's address before this publish, to move it when it changed.
                const liveSlug = await publishedSlug(publishedRef);

                // Batch the publish + history writes for atomicity
                const publishBatch = db.batch();
                publishBatch.set(publishedRef, { ...draftData, id: docId });
                publishBatch.set(publishedRef.collection('PublishedHistory').doc(), draftData);
                await publishBatch.commit();
                console.log(`Published: ${publishedCollection}/${docId}`);
                const translations = await syncTranslations(draftCollection, publishedCollection, docId);
                await stampLastPublishedAt(draftCollection, docId, copied, readAt, translations);
                await clearRedirectChoice(draftCollection, docId, redirectOldAddress);
                await indexPublished(publishedCollection, docId);

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                        await buildListPage(contentTypeSlug, batch, listBuilds);
                    } catch (deployErr) {
                        pageError = deployErr;
                        console.error(`Static HTML deployment failed for publish ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                    // Only once the new page is built: a failed build leaves the old address as it was.
                    if (!pageError) {
                        await moveOldAddress(publishedRef, contentTypeSlug, docId, liveSlug, draftData['urlSlug'], redirectOldAddress, batch, movedPaths);
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
                    await buildListPage(contentTypeSlug, batch, listBuilds);
                }
                break;
            }

            case 'update': {
                // Read the draft and update only changed fields in the published doc
                const readAt = Timestamp.now();
                const draftSnap = await db.collection(draftCollection).doc(docId).get();
                const publishedSnap = await publishedRef.get();

                if (!draftSnap.exists) {
                    console.warn(`Draft not found for update: ${draftCollection}/${docId}`);
                    break;
                }

                const copied = draftSnap.data()!;
                const { redirectOldAddress, data: draftFields } = publishableDraft(copied);
                const liveSlug = publishedSnap.exists ? String(publishedSnap.data()?.urlSlug || '') : '';

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
                const translations = await syncTranslations(draftCollection, publishedCollection, docId);
                await stampLastPublishedAt(draftCollection, docId, copied, readAt, translations);
                await clearRedirectChoice(draftCollection, docId, redirectOldAddress);
                await indexPublished(publishedCollection, docId);

                // Deploy static HTML (detail + list pages)
                // Skip entirely when ContentType.hasPublicUrl is false
                if (hasPublicUrl) {
                    try {
                        await generateAndDeployContentDetailPage(contentTypeSlug, docId, batch);
                        await buildListPage(contentTypeSlug, batch, listBuilds);
                    } catch (deployErr) {
                        pageError = deployErr;
                        console.error(`Static HTML deployment failed for update ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                    if (!pageError) {
                        await moveOldAddress(publishedRef, contentTypeSlug, docId, liveSlug, draftFields['urlSlug'], redirectOldAddress, batch, movedPaths);
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
                await markUnpublished(draftCollection, contentTypeSlug, docId);

                // Remove static HTML and regenerate list page
                if (hasPublicUrl) {
                    try {
                        if (urlSlug) {
                            await removeContentPage(contentTypeSlug, urlSlug, batch);
                        }
                        await buildListPage(contentTypeSlug, batch, listBuilds);
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
                await deleteUnderDraft(draftCollection, docId);

                // Remove static HTML and regenerate list page
                if (hasPublicUrl) {
                    try {
                        if (delUrlSlug) {
                            await removeContentPage(contentTypeSlug, delUrlSlug, batch);
                        }
                        await buildListPage(contentTypeSlug, batch, listBuilds);
                    } catch (deployErr) {
                        console.error(`Static HTML removal failed for delete ${contentTypeSlug}/${docId}:`, deployErr);
                    }
                }
                break;
            }

            default:
                console.warn(`Unknown action: ${action}`);
        }

        // The home page shows cards of some types, public pages or not: it is
        // rebuilt in a coalesced item of its own (VE-D57), so many entries
        // published together make one release of it.
        if (await homeShowsType(contentTypeSlug).catch(() => false)) {
            await queueHomePage(`${action} ${contentTypeSlug}/${docId}`);
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
                siteId, batch, pageError ? '' : publishedCollection, pageError ? '' : docId, itemRelease(runStart));
            // Only after the release succeeded: a ping for pages that never
            // went live would send the engines to a 404 (D-D9). deployBatchToHosting
            // records a failure (or hosting being off) rather than throwing, so the
            // answer has to come from its return value.
            if (released) {
                console.log(`Released ${batch.size} file(s) for ${action} ${contentTypeSlug}/${docId}`);
                if (isFeatureOn('seo')) {
                    await submitBatchToIndexNow(batch.files.map(f => f.path).filter((path) => !movedPaths.has(path)), batch.removedPaths);
                }
            }
        } catch (deployErr) {
            console.error(`Hosting release failed for ${action} ${contentTypeSlug}/${docId}:`, deployErr);
        }
    }

    await rebuildListsChanged(listBuilds);
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
