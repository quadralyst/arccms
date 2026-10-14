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

/** A type and its entries as read once for a page, shared by its languages and loops. */
export type ItemsFromTypeCache = Map<string, Promise<{ type: Record<string, any> | null; entries: Record<string, any>[] }>>;

/**
 * The rows of each data-arc-items-src loop of a detail page (shared/items-from-type.ts),
 * by loop name: the type's published entries in its display order, without the
 * page's own entry, translated into the page's language where a translation
 * exists, as cards (content-cards.ts). A type that does not exist, or cannot be
 * read, gives no rows. Pass the same `cache` for every language of a page so the
 * entries are read once.
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
            const key = `${loop.type}:${loop.limit}:${exclude}`;
            if (!cache.has(key)) cache.set(key, readTypeEntries(loop.type, loop.limit + (exclude ? 1 : 0)));
            const { type, entries } = await cache.get(key)!;
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
                    const tr = await collection.doc(entry['id']).collection('translations').doc(page.lang).get();
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
