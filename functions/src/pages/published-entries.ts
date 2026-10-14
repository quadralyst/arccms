import { db } from '../init.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { entryOrderOf, sortForDisplay } from '../shared/display-order.js';
import { cardData } from '../shared/content-cards.js';
import { contentTypeName } from '../shared/content-type-names.js';
import { type ContentTranslation, langPrefix, mergeTranslation } from '../shared/content-translation.js';
import { type ItemsFromTypeLoop, pickItemsFromType } from '../shared/items-from-type.js';

/**
 * A type's published entries in its display order, at most `limit`, each as
 * `{ id, ...fields }`. Shared by the list page and the home page's card blocks
 * so both show the same entries in the same order (specs/site-sections-spec.md, SS2).
 *
 * Newest first is one query. Your own order reads every published entry and
 * sorts in memory: an orderBy on `sortOrder` would drop entries without one
 * and need an index, and a type kept in its own order is a short list.
 */
export async function readPublishedInDisplayOrder(
    slug: string,
    type: Record<string, unknown> | null | undefined,
    limit: number,
): Promise<Record<string, any>[]> {
    const collection = db.collection(getPublishedCollectionName(slug));
    if (entryOrderOf(type) === 'manual') {
        const all = await collection.get();
        const entries = all.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>));
        return sortForDisplay(entries, 'manual').slice(0, limit);
    }
    const newest = await collection.orderBy('publishedOn', 'desc').limit(limit).get();
    return newest.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>));
}

/** The page whose template holds the loops: its language, and its own entry, which is never shown. */
export interface ItemsFromTypePage {
    lang: string;
    defaultLang: string;
    type: string;
    id: string;
}

/**
 * What data-arc-items-src loops read (a type and its entries, an entry's
 * translation), kept by key so a read is made once: for every language and
 * loop of a page, and for every page of one rebuild (items-from-type-pages.ts).
 * Never kept across publishes: a publish changes the entries.
 */
export type ItemsFromTypeCache = Map<string, Promise<unknown>>;

function cached<T>(cache: ItemsFromTypeCache, key: string, read: () => Promise<T>): Promise<T> {
    if (!cache.has(key)) {
        const reading = read();
        // A failed read is not kept: the next page reads again.
        reading.catch(() => cache.delete(key));
        cache.set(key, reading);
    }
    return cache.get(key) as Promise<T>;
}

/**
 * The rows of each data-arc-items-src loop of a detail page (shared/items-from-type.ts),
 * by loop name: the type's published entries in its display order, without the
 * page's own entry, translated into the page's language where a translation
 * exists, as cards (content-cards.ts). A type that does not exist, or cannot be
 * read, gives no rows. Pass the same `cache` for every language of a page, and
 * for every page of a rebuild, so the entries are read once.
 */
export async function readItemsFromType(
    loops: ItemsFromTypeLoop[],
    page: ItemsFromTypePage,
    cache: ItemsFromTypeCache = new Map(),
): Promise<Record<string, Record<string, any>[]>> {
    const rows: Record<string, Record<string, any>[]> = {};
    const prefix = langPrefix(page.lang, page.defaultLang);
    for (const loop of loops) {
        try {
            const exclude = loop.type === page.type ? page.id : '';
            // One more than shown when the page's own entry may be among them: the
            // same read serves every page of the type, whichever entry it leaves out.
            const size = loop.limit + (exclude ? 1 : 0);
            const { type, entries } = await cached(cache, `type:${loop.type}:${size}`, () => readTypeEntries(loop.type, size));
            if (!type) {
                rows[loop.name] = [];
                continue;
            }
            const shown = pickItemsFromType(entries, entryOrderOf(type), loop.limit, exclude);
            const collection = db.collection(getPublishedCollectionName(loop.type));
            const typeName = contentTypeName(type, page.lang);
            rows[loop.name] = await Promise.all(shown.map(async (entry) => {
                let translation: ContentTranslation | undefined;
                if (page.lang !== page.defaultLang) {
                    const tr = await cached(cache, `translation:${loop.type}/${entry['id']}/${page.lang}`,
                        () => collection.doc(entry['id']).collection('translations').doc(page.lang).get());
                    if (tr.exists) translation = { ...(tr.data() as ContentTranslation), lang: page.lang };
                }
                return cardData({ ...mergeTranslation(entry, translation), id: entry['id'] }, loop.type, typeName, page.lang, prefix, type['hasPublicUrl'] !== false);
            }));
        } catch (error) {
            // One unreadable type must not cost the page: its loop is emptied.
            console.error(`Could not read the entries of '${loop.type}' for a data-arc-items-src loop:`, error);
            rows[loop.name] = [];
        }
    }
    return rows;
}

async function readTypeEntries(slug: string, limit: number): Promise<{ type: Record<string, any> | null; entries: Record<string, any>[] }> {
    const snap = await db.collection('ContentTypes').where('slug', '==', slug).limit(1).get();
    const type = snap.empty ? null : { ...snap.docs[0].data(), slug };
    if (!type) return { type: null, entries: [] };
    return { type, entries: await readPublishedInDisplayOrder(slug, type, limit) };
}
