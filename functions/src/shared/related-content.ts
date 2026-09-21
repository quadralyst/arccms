/**
 * "Related" items for a detail page, chosen at publish time from the search
 * index (docs/discoverability-spec.md, D-D15): the item's title and tags go
 * through the same ranking the header search uses, the item itself is
 * dropped, and the top few come back as links. Static pages stay static;
 * the SPA twin asks the callable at render time.
 *
 * Never throws: a search failure means no Related block, not a failed publish.
 */
import { parseRequest, runSearch, type SearchResult } from '../search/search.js';
import { CONTENT_SOURCE_ID } from '../search/sources/content.js';
import { tokenize } from '../search/tokenizer.js';

export interface RelatedItem {
    title: string;
    snippet: string;
    /** Site-relative link, language prefix included, as the search source builds it. */
    url: string;
    badge: string;
}

export const RELATED_LIMIT = 4;

/** The query for an item: its title's words plus its tags, capped like a search box entry. */
export function relatedQuery(title: string, tags: string[]): string {
    const words = [...tokenize(title || '', { maxWords: 8 }), ...(tags || []).flatMap(t => tokenize(t, { maxWords: 3 }))];
    return [...new Set(words)].join(' ').slice(0, 120);
}

/** Drops the item itself and shapes the hits. Pure, for the tests. */
export function pickRelated(
    results: SearchResult[],
    self: { contentType: string; urlSlug: string },
    limit = RELATED_LIMIT,
): RelatedItem[] {
    return results
        .filter(r => !(r.meta?.['contentType'] === self.contentType && r.meta?.['urlSlug'] === self.urlSlug))
        .slice(0, limit)
        .map(r => ({ title: r.title, snippet: r.snippet || '', url: r.link, badge: r.badge || '' }));
}

export async function findRelated(input: {
    title: string;
    tags: string[];
    contentType: string;
    urlSlug: string;
    lang: string;
}): Promise<RelatedItem[]> {
    const q = relatedQuery(input.title, input.tags);
    if (!q) return [];
    try {
        const parsed = parseRequest({ q, lang: input.lang, scope: 'public', sources: [CONTENT_SOURCE_ID], limit: RELATED_LIMIT + 1 });
        const response = await runSearch(parsed);
        return pickRelated(response.results, { contentType: input.contentType, urlSlug: input.urlSlug });
    } catch (error) {
        console.error(`Related content lookup failed for ${input.contentType}/${input.urlSlug}:`, error);
        return [];
    }
}
