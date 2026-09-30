/**
 * Keeps the index in step with one document, for every source that watches its
 * collection. Called by the per-collection triggers and the draft queue
 * (specs/feature-flags-spec.md, section 6.5); nothing watches every write.
 */

import { refreshSearchSources, findSources } from './registry.js';
import { buildSearchContext } from './context.js';
import { indexDocument } from './writer.js';
import type { SearchDocument } from './source.js';

/** Indexes one document (or removes it, for null) for every source that watches its collection. */
export async function syncDocument(
    collection: string,
    docId: string,
    doc: SearchDocument | null,
): Promise<void> {
    await refreshSearchSources();
    const sources = findSources(collection);
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
