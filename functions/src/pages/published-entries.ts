import { db } from '../init.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { entryOrderOf, sortForDisplay } from '../shared/display-order.js';

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
    type: { entryOrder?: unknown } | null | undefined,
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
