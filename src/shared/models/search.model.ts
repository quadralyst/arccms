/**
 * The `search` callable's contract, mirrored for the client.
 *
 * Kept in step with functions/src/search/search.ts by hand: the two sides
 * share no build, and the client only ever renders what the function
 * returns, so drift shows up as a missing field rather than a crash.
 *
 * Spec: docs/search-spec.md, phase S3 item 1.
 */

export type SearchScope = 'public' | 'authenticated' | 'admin';

export interface SearchRequest {
    q: string;
    lang?: string;
    scope?: SearchScope;
    sources?: string[];
    limit?: number;
}

/** Character ranges in `title` and `snippet` the query matched. */
export interface SearchHighlights {
    title: [number, number][];
    snippet: [number, number][];
}

export interface SearchResult {
    source: string;
    docId: string;
    lang: string;
    title: string;
    snippet?: string;
    badge?: string;
    link: string;
    meta?: Record<string, unknown>;
    score: number;
    highlights: SearchHighlights;
}

export interface SearchResponse {
    results: SearchResult[];
    tookMs: number;
    /** The shortened token, when the typo fallback produced the results. */
    fallbackUsed?: string;
}

export interface ReindexRequest {
    source?: string;
    collection?: string;
}

export interface SourceReindexResult {
    source: string;
    collections: string[];
    documents: number;
    entries: number;
    removed: number;
    durationMs: number;
}

/** One source's block in `Settings/search_status`. */
export interface SearchSourceStatus {
    collections: string[];
    documents: number;
    entries: number;
    removed: number;
    durationMs: number;
    reindexedAt?: { toDate?: () => Date; seconds?: number } | Date | null;
}

export interface SearchStatus {
    sources?: Record<string, SearchSourceStatus>;
    updatedAt?: unknown;
}

/**
 * The sources the admin UI knows how to name. The registry lives in the
 * functions code; this list only supplies labels for the settings page and
 * is safe to be behind.
 */
export const KNOWN_SEARCH_SOURCES: { id: string; labelKey: string; scope: SearchScope }[] = [
    { id: 'content', labelKey: 'admin.settings.search.source_content', scope: 'public' },
    { id: 'content-drafts', labelKey: 'admin.settings.search.source_content_drafts', scope: 'admin' },
    { id: 'products', labelKey: 'admin.settings.search.source_products', scope: 'public' },
];

/** Splits a string into plain and highlighted segments from character ranges. */
export function highlightSegments(
    text: string,
    ranges: [number, number][] | undefined,
): { text: string; hit: boolean }[] {
    if (!text) return [];
    if (!ranges || ranges.length === 0) return [{ text, hit: false }];

    const sorted = [...ranges]
        .filter(([start, end]) => end > start && start >= 0 && start < text.length)
        .sort((a, b) => a[0] - b[0]);
    const segments: { text: string; hit: boolean }[] = [];
    let cursor = 0;
    for (const [start, rawEnd] of sorted) {
        const end = Math.min(rawEnd, text.length);
        if (start < cursor) continue;
        if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
        segments.push({ text: text.slice(start, end), hit: true });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
    return segments;
}
