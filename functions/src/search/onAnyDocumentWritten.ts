/**
 * Keeps the search index in step with every registered collection.
 *
 * One wildcard trigger instead of one per collection, because the
 * collections a site has are not known at deploy time: a content type
 * created tomorrow gets `arc_{slug}_drafts`, and it has to be searchable
 * without a redeploy. The cost is an invocation per top-level write in the
 * database, nearly all of which return on the first line (S-D13).
 *
 * Writes to SearchIndex itself land here too and match no source.
 *
 * Spec: docs/search-spec.md, decisions S-D12 and S-D13.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { findSources } from './registry.js';
import { buildSearchContext } from './context.js';
import { indexDocument } from './writer.js';
import type { SearchDocument } from './source.js';

/** Indexes one document for every triggered source that watches its collection. */
export async function syncDocument(
    collection: string,
    docId: string,
    doc: SearchDocument | null,
): Promise<void> {
    const sources = findSources(collection).filter(source => source.trigger !== false);
    if (sources.length === 0) return;

    const ctx = await buildSearchContext(collection, docId);
    for (const source of sources) {
        try {
            await indexDocument(source, doc, ctx);
        } catch (error) {
            console.error(`Search index update failed for ${source.id} ${collection}/${docId}:`, error);
        }
    }
}

export const onAnyDocumentWritten = onDocumentWritten('{collection}/{docId}', async (event) => {
    const { collection, docId } = event.params;
    if (findSources(collection).length === 0) return;

    const after = event.data?.after;
    const doc = after?.exists ? (after.data() as SearchDocument) : null;
    await syncDocument(collection, docId, doc);
});

/**
 * A translation is a sibling document, written after its parent. The parent
 * trigger may have read the subcollection before the new translation landed,
 * so a translation write re-indexes the parent.
 */
export const onTranslationWritten = onDocumentWritten(
    '{collection}/{docId}/translations/{lang}',
    async (event) => {
        const { collection, docId } = event.params;
        if (findSources(collection).length === 0) return;

        const parent = event.data?.after?.ref.parent.parent;
        if (!parent) return;
        const snap = await parent.get();
        await syncDocument(collection, docId, snap.exists ? (snap.data() as SearchDocument) : null);
    },
);
