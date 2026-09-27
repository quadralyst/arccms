/**
 * Client mirror of functions/src/shared/related-content.ts for the SPA
 * fallback (docs/discoverability-spec.md, D-D15). The query builder here
 * is a plain word splitter rather than the search tokenizer; the callable
 * tokenizes the query itself, so the exact split does not matter.
 */
import type { SearchResult } from '../models/search.model';

export interface RelatedItem {
    title: string;
    snippet: string;
    url: string;
    badge: string;
}

export const RELATED_LIMIT = 4;

export function relatedQuery(title: string, tags: string[]): string {
    const words = (text: string, max: number) =>
        (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 3).slice(0, max);
    const all = [...words(title, 8), ...(tags || []).flatMap(t => words(t, 3))];
    return [...new Set(all)].join(' ').slice(0, 120);
}

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
