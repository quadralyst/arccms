/**
 * The search source contract.
 *
 * A source is the whole of what the engine knows about a collection: which
 * documents to index, which of their fields, and how a hit is shown. The
 * tokenizer, the index collection, the callable and the search box never
 * change when a source is added. See docs/search-developer-guide.md for the
 * walkthrough and functions/src/search/sources/_template.ts for a starting
 * point.
 *
 * Spec: docs/search-spec.md, decisions S-D7, S-D8, S-D10 and S-D12.
 */

import type { LocalizationSettings } from '../shared/site-settings.js';

/** Who may search a source. Enforced inside the callable (S-D8). */
export type SearchScope = 'public' | 'authenticated' | 'admin';

export const SEARCH_SCOPES: readonly SearchScope[] = ['public', 'authenticated', 'admin'];

/** The index collection. Client access is denied by rules. */
export const SEARCH_INDEX_COLLECTION = 'SearchIndex';

/** Per-source counts and timestamps written by reindexSearch. */
export const SEARCH_STATUS_DOC = 'search_status';

/** Language of entries that belong to no language in particular (S-D10). */
export const ANY_LANGUAGE = '*';

export interface SearchFieldSpec {
    /**
     * Where the text lives in the document. Dotted paths reach into maps:
     * `customFields.people_city`.
     */
    path: string;
    /** How much a hit in this field is worth. Titles 3, summaries 2, the rest 1. */
    weight: number;
    /** Index prefixes too, so type-ahead finds "Karun" from "kar". */
    prefix?: boolean;
}

/** A plain document as read from Firestore. */
export type SearchDocument = Record<string, unknown>;

/** Everything a search hit shows. `display` returns it; the client renders it as is. */
export interface SearchDisplay {
    title: string;
    snippet?: string;
    /** Short label beside the title: a content type name, "Directory", a price. */
    badge?: string;
    /** Where clicking the hit goes. Root-relative for public sources. */
    link: string;
    /** Anything else the client may want. Never private data: the client sees it. */
    meta?: Record<string, unknown>;
    /**
     * Recency for tie-breaking and for the candidate query's order. A Date, a
     * Firestore Timestamp or anything with `toDate()`. Falls back to now.
     */
    sortAt?: unknown;
}

/** One language rendering of a document, produced by `variants`. */
export interface SearchVariant {
    lang: string;
    doc: SearchDocument;
}

/**
 * Minimal view of a content type for sources that need one. Loaded once per
 * invocation and cached, so sources never fetch settings themselves.
 */
export interface SearchContentType {
    id: string;
    slug: string;
    name: string;
    singularName?: string;
    hasPublicUrl?: boolean;
    nameTranslations?: Record<string, { name?: string; singularName?: string }>;
    fields: { key: string; type: string; label?: string }[];
    searchFields?: string[];
}

export interface SearchContext {
    /** The collection the document was read from. */
    collection: string;
    docId: string;
    localization: LocalizationSettings;
    /** Content types by slug. Empty when none exist. */
    contentTypes: Map<string, SearchContentType>;
}

export interface SearchSource {
    /** Stable identifier. Part of every index document ID, so never rename casually. */
    id: string;
    /**
     * The collection to watch, or a pattern for a family of collections such
     * as `/^arc_(.+)_drafts$/`. Top-level collections only.
     */
    collection: string | RegExp;
    scope: SearchScope;
    /**
     * Fields to index, with weights. A function when the fields depend on the
     * document, as they do for content types with admin-chosen search fields.
     */
    fields: SearchFieldSpec[] | ((doc: SearchDocument, ctx: SearchContext) => SearchFieldSpec[]);
    /** What a hit shows. Called once per language variant. */
    display: (doc: SearchDocument, ctx: SearchContext, lang: string) => SearchDisplay;
    /**
     * The document's language, for sources whose documents each carry one.
     * Default: ANY_LANGUAGE. Ignored when `variants` is set.
     */
    lang?: (doc: SearchDocument, ctx: SearchContext) => string;
    /**
     * One entry per language for multilingual sources. Each variant's `doc`
     * is what `fields` and `display` see for that language.
     */
    variants?: (doc: SearchDocument, ctx: SearchContext) => Promise<SearchVariant[]>;
    /** Leave a document out (an inactive row, a hidden type). Default: index everything. */
    include?: (doc: SearchDocument, ctx: SearchContext) => boolean | Promise<boolean>;
    /** Multiplier on the final score, for ranking one source above another. Default 1. */
    boost?: number;
    /**
     * Whether the wildcard Firestore trigger indexes this source. Default true.
     * Set false for a collection that only a Cloud Function writes, and index
     * it from that function with `upsertSearchEntries` instead.
     */
    trigger?: boolean;
    /**
     * Collections to walk during a reindex. Only needed for a pattern source
     * whose collections cannot be found by listing the database.
     */
    expandCollections?: () => Promise<string[]>;
}

/** A document in the SearchIndex collection. */
export interface SearchIndexEntry {
    source: string;
    scope: SearchScope;
    lang: string;
    collection: string;
    docId: string;
    tokens: string[];
    /** Indexed text per field path, trimmed, for ranking and highlighting. */
    fields: Record<string, string>;
    /** Field weights, so an entry ranks itself without its source. */
    weights: Record<string, number>;
    boost: number;
    title: string;
    snippet: string;
    badge: string;
    link: string;
    meta: Record<string, unknown>;
    sortAt: unknown;
    indexedAt: unknown;
}

/**
 * Document ID of an index entry: unique per (source, collection, document,
 * language). The collection is part of it because a pattern source spans
 * many collections and imported documents may reuse IDs across them.
 */
export function searchEntryId(sourceId: string, collection: string, docId: string, lang: string): string {
    return `${sourceId}:${collection}:${docId}:${lang}`;
}

/** Whether a collection name belongs to a source. */
export function sourceMatches(source: SearchSource, collection: string): boolean {
    return typeof source.collection === 'string'
        ? source.collection === collection
        : source.collection.test(collection);
}

/** Reads a dotted path out of a document. */
export function readPath(doc: SearchDocument, path: string): unknown {
    let current: unknown = doc;
    for (const part of path.split('.')) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/** The text of a field value: strings as is, numbers printed, arrays of strings joined. */
export function fieldText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return value.map(fieldText).filter(Boolean).join(' ');
    }
    return '';
}
