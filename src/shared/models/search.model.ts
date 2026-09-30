/**
 * The `search` callable's contract, mirrored for the client.
 *
 * Kept in step with functions/src/search/search.ts by hand: the two sides
 * share no build, and the client only ever renders what the function
 * returns, so drift shows up as a missing field rather than a crash.
 *
 * Spec: specs/search-spec.md, phase S3 item 1.
 */

export type SearchScope = 'public' | 'authenticated' | 'admin';

export interface SearchRequest {
    q: string;
    lang?: string;
    scope?: SearchScope;
    sources?: string[];
    /** With no `sources`: every source the scope may read except these. */
    except?: string[];
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
    /** Written by every rebuild since F5 (specs/feature-flags-spec.md 6.4). */
    label?: string;
    scope?: SearchScope | null;
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

/** Labels for core's own sources; an app's sources carry theirs in the status document. */
export const CORE_SOURCE_LABEL_KEYS: Record<string, string> = {
    content: 'admin.settings.search.source_content',
    'content-drafts': 'admin.settings.search.source_content_drafts',
};

/** How a collection stands in Search settings (functions/src/search/adminCollections.ts). */
export type SearchCollectionState = 'content' | 'searchable' | 'needs_setup' | 'waiting' | 'code' | 'not_listed' | 'refused';

/** A field a source tokenizes; `high` counts most, with type-ahead. */
export interface IndexedField {
    path: string;
    high: boolean;
}

/** What each source tokenizes (per content type for content); null fields: set in code. */
export interface SourceFields {
    fields: IndexedField[] | null;
    byType?: { type: string; fields: IndexedField[] }[];
}

export interface SearchCollectionList {
    collections: SearchCollectionRow[];
    fields: Record<string, SourceFields>;
}

export interface CollectionField {
    path: string;
    weight: 'high' | 'normal';
}

/** A collection's setup in `Settings/search_collections` (functions/src/search/collections.ts). */
export interface CollectionSetup {
    label?: string;
    fields: CollectionField[];
    title: string;
    snippet?: string;
    link?: string;
    scope: SearchScope;
}

export interface SearchCollectionRow {
    name: string;
    state: SearchCollectionState;
    sourceId?: string;
    label?: string;
    reason?: string;
    setup?: CollectionSetup;
}

export interface SampledTextField {
    path: string;
    count: number;
    example: string;
}

export interface CollectionSample {
    fields: SampledTextField[];
    samples: { id: string; values: Record<string, string> }[];
}

/** A collection's source id, as the functions make it. */
export function collectionSourceId(collection: string): string {
    return `collection-${collection}`;
}

/** Fills `{id}` and `{field}` in a link pattern, as the functions do. */
export function fillLinkPattern(pattern: string, values: Record<string, string>, docId: string): string {
    return pattern.replace(/\{([^}]+)\}/g, (_m, key: string) => encodeURIComponent(key === 'id' ? docId : values[key] ?? ''));
}

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
