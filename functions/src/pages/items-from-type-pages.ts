import { db } from '../init.js';
import { arcHostingSite } from '../arc-config.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { itemsFromTypeSources } from '../shared/items-from-type.js';
import { DEFAULT_TEMPLATE_FOLDER, getSiteFile, getSiteManifest, loadDetailTemplate, loadSiteTemplate } from '../shared/site-files.js';
import { generateAndDeployContentDetailPage } from './deployContentPage.js';
import type { ItemsFromTypeCache } from './published-entries.js';
import type { HostingBatch } from './deployToHosting.js';

/**
 * Keeping detail pages that show entries of another type fresh
 * (data-arc-items-src, shared/items-from-type.ts).
 *
 * A published detail page has those entries baked in, so when an entry of the
 * shown type is published, updated, unpublished, deleted or put in a new order,
 * the pages showing it are built again. Finding them is cheap: the detail
 * templates come from the live site and are cached by build hash. Only the types
 * whose templates name the changed type have their entries read, and of those,
 * only the entries whose own template (their layout, else the folder's
 * detail.html) names it are rebuilt, all in one release.
 */

/** A content type whose detail templates read entries of another type. */
export interface TypeShowingItems {
    slug: string;
    templateFolder: string;
}

/** Every detail template a type's entries can render with: the folder's detail.html and its layouts. */
async function detailTemplatesOf(folder: string): Promise<string[]> {
    const wanted = folder && folder !== DEFAULT_TEMPLATE_FOLDER ? folder : DEFAULT_TEMPLATE_FOLDER;
    const templates: string[] = [];
    try {
        templates.push(await loadSiteTemplate(folder, 'detail'));
    } catch {
        // A folder the live site lacks publishes nothing, so shows nothing either.
        return [];
    }
    const manifest = await getSiteManifest();
    for (const name of Object.keys(manifest?.layouts?.[wanted] ?? {})) {
        const html = await getSiteFile(`templates/${wanted}/detail-${name}.html`);
        if (html) templates.push(html);
    }
    return templates;
}

/**
 * The content types with public pages whose detail templates show entries of
 * `slug`. Empty with hosting off, or when nothing names it.
 */
export async function typesShowingItemsOf(slug: string): Promise<TypeShowingItems[]> {
    if (!slug || !arcHostingSite()) return [];
    const types = await db.collection('ContentTypes').get();
    const showing: TypeShowingItems[] = [];
    for (const doc of types.docs) {
        const type = doc.data() as { slug?: string; hasPublicUrl?: boolean; templateFolder?: string };
        if (!type.slug || type.hasPublicUrl === false) continue;
        const templates = await detailTemplatesOf(type.templateFolder || '');
        if (templates.some((html) => itemsFromTypeSources(html).includes(slug))) {
            showing.push({ slug: type.slug, templateFolder: type.templateFolder || '' });
        }
    }
    return showing;
}

/** Where a rebuild stopped: the last entry it went through, by type slug and document id. */
export interface RebuildCursor {
    type: string;
    id: string;
}

/** What a rebuild did, and where the next part starts when it ran out of time. */
export interface RebuildResult {
    /** Pages built into the batch, still published at the end. */
    pages: number;
    /** Pages built but left out of the batch: their entry was unpublished meanwhile. */
    dropped: number;
    /** Set when the deadline came first: the rebuild goes on after this entry. */
    next?: RebuildCursor;
}

export interface RebuildOptions {
    /** Go on after this entry (a continuation): types by slug, entries by id. */
    after?: RebuildCursor;
    /** Stop starting pages after this time (ms), leaving time for the release. */
    deadline?: number;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds again, into `batch`, every published detail page whose template shows
 * entries of `slug`. One page that cannot be built does not stop the others.
 *
 * The pages share one read cache, so the shown type, its entries and their
 * translations are read once for the rebuild, not once per page. Types go by
 * slug and entries by id, so a rebuild that reaches `deadline` returns where it
 * stopped (`next`) and a continuation picks it up from there. Right before
 * returning, each entry built is checked again: a page whose entry was
 * unpublished while the rebuild ran is taken out of the batch, so the release
 * does not put it back.
 */
export async function rebuildPagesShowingItemsOf(slug: string, batch: HostingBatch, options: RebuildOptions = {}): Promise<RebuildResult> {
    const { after, deadline = Infinity } = options;
    const cache: ItemsFromTypeCache = new Map();
    const built: Array<{ type: string; id: string; paths: string[] }> = [];
    const known = new Set(batch.paths);
    let next: RebuildCursor | undefined;
    /** The last entry gone through, built or not: where a continuation goes on from. */
    let cursor: RebuildCursor | undefined;

    const types = (await typesShowingItemsOf(slug)).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    outer: for (const type of types) {
        if (after && type.slug < after.type) continue;
        const shows = new Map<string, Promise<boolean>>();
        const showsFor = (layout: string) => {
            if (!shows.has(layout)) {
                shows.set(layout, loadDetailTemplate(type.templateFolder, layout)
                    .then((html) => itemsFromTypeSources(html).includes(slug))
                    .catch(() => false));
            }
            return shows.get(layout)!;
        };
        const published = (await db.collection(getPublishedCollectionName(type.slug)).get()).docs.sort(byId);
        for (const doc of published) {
            if (after && type.slug === after.type && doc.id <= after.id) continue;
            if (Date.now() >= deadline && built.length) {
                next = cursor;
                break outer;
            }
            cursor = { type: type.slug, id: doc.id };
            const layout = typeof doc.data()?.['layout'] === 'string' ? doc.data()['layout'].trim() : '';
            if (!(await showsFor(layout))) continue;
            try {
                await generateAndDeployContentDetailPage(type.slug, doc.id, batch, cache);
                const paths = batch.paths.filter((path) => !known.has(path));
                paths.forEach((path) => known.add(path));
                built.push({ type: type.slug, id: doc.id, paths });
            } catch (error) {
                console.error(`Could not rebuild ${type.slug}/${doc.id}, which shows entries of ${slug}:`, error);
            }
        }
    }

    // Still published? Read right before the release, so a page unpublished
    // during the rebuild is not put back by it.
    let dropped = 0;
    for (let i = 0; i < built.length; i += 50) {
        const chunk = built.slice(i, i + 50);
        const live = await Promise.all(chunk.map((page) =>
            db.collection(getPublishedCollectionName(page.type)).doc(page.id).get()
                .then((snap) => snap.exists).catch(() => true)));
        chunk.forEach((page, k) => {
            if (live[k]) return;
            dropped++;
            page.paths.forEach((path) => batch.discard(path));
            console.log(`Left ${page.type}/${page.id} out of the rebuild: it was unpublished while it ran`);
        });
    }
    return { pages: built.length - dropped, dropped, ...(next ? { next } : {}) };
}
