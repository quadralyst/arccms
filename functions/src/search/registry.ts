/**
 * Every search source the site knows about.
 *
 * Adding a source is one import and one array entry here, then a reindex
 * from Admin, Settings, Search. The order matters only for display in the
 * settings page.
 *
 * Spec: docs/search-spec.md, decision S-D7.
 */

import type { SearchSource } from './source.js';
import { sourceMatches } from './source.js';
import { contentSource } from './sources/content.js';
import { contentDraftsSource } from './sources/content-drafts.js';

export const SEARCH_SOURCES: readonly SearchSource[] = [
    contentSource,
    contentDraftsSource,
];

/** Every registered source that watches a collection. A collection may feed several. */
export function findSources(
    collection: string,
    sources: readonly SearchSource[] = SEARCH_SOURCES,
): SearchSource[] {
    return sources.filter(source => sourceMatches(source, collection));
}

export function findSource(
    id: string,
    sources: readonly SearchSource[] = SEARCH_SOURCES,
): SearchSource | undefined {
    return sources.find(source => source.id === id);
}
