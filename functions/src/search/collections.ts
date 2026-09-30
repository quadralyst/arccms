/**
 * Collections made searchable from Admin, Settings, Search (specs/feature-flags-spec.md,
 * section 6). The collection is named in functions/src/custom/search-sources.ts,
 * which gives it a trigger; its setup (fields, result, scope) lives in
 * `Settings/search_collections` and applies on Rebuild, with no deploy.
 */

import { db } from '../init.js';
import { readPath, SEARCH_SCOPES, type SearchDocument, type SearchScope, type SearchSource } from './source.js';

export const SEARCH_COLLECTIONS_DOC = 'search_collections';

export interface CollectionField {
    path: string;
    /** high: weight 3 with type-ahead; normal: weight 1. */
    weight: 'high' | 'normal';
}

export interface CollectionSetup {
    label?: string;
    fields: CollectionField[];
    /** Field shown as the result's title. Required. */
    title: string;
    snippet?: string;
    /** Where a result opens, with {id} and {field} placeholders. None: the result does not open. */
    link?: string;
    scope: SearchScope;
}

/** A collection's source id: part of every entry id and of the status document. */
export function collectionSourceId(collection: string): string {
    return `collection-${collection}`;
}

function text(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(', ');
    if (typeof value === 'number') return String(value);
    return '';
}

/** Fills `{id}` and `{field}` placeholders, each value URL-encoded. */
export function fillLink(pattern: string, doc: SearchDocument, docId: string): string {
    return pattern.replace(/\{([^}]+)\}/g, (_match, key: string) =>
        encodeURIComponent(key === 'id' ? docId : text(readPath(doc, key))));
}

/** A stored setup, or null when it is not complete enough to index with. */
export function validSetup(raw: unknown): CollectionSetup | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const fields = Array.isArray(r['fields'])
        ? (r['fields'] as unknown[])
            .map((f) => f as Record<string, unknown>)
            .filter((f) => typeof f?.['path'] === 'string' && f['path'])
            .map((f): CollectionField => ({ path: String(f['path']), weight: f['weight'] === 'high' ? 'high' : 'normal' }))
        : [];
    const title = typeof r['title'] === 'string' ? r['title'] : '';
    const scope = SEARCH_SCOPES.includes(r['scope'] as SearchScope) ? (r['scope'] as SearchScope) : null;
    if (!fields.length || !title || !scope) return null;
    return {
        label: typeof r['label'] === 'string' && r['label'] ? r['label'] : undefined,
        fields,
        title,
        snippet: typeof r['snippet'] === 'string' && r['snippet'] ? r['snippet'] : undefined,
        link: typeof r['link'] === 'string' && r['link'] ? r['link'] : undefined,
        scope,
    };
}

/** The source a setup describes. */
export function buildCollectionSource(collection: string, setup: CollectionSetup): SearchSource {
    return {
        id: collectionSourceId(collection),
        label: setup.label || collection,
        collection,
        scope: setup.scope,
        fields: setup.fields.map((f) => ({ path: f.path, weight: f.weight === 'high' ? 3 : 1, prefix: f.weight === 'high' })),
        display: (doc, ctx) => ({
            title: text(readPath(doc, setup.title)),
            snippet: setup.snippet ? text(readPath(doc, setup.snippet)) : '',
            badge: setup.label || collection,
            link: setup.link ? fillLink(setup.link, doc, ctx.docId) : '',
            sortAt: doc['modifiedAt'] ?? doc['updatedAt'] ?? doc['createdAt'],
        }),
    };
}

const CACHE_TTL_MS = 60 * 1000;
let cache: { data: Record<string, CollectionSetup>; at: number } | null = null;

/** Every complete setup, keyed by collection. Cached for a minute. */
export async function readCollectionSetups(force = false): Promise<Record<string, CollectionSetup>> {
    if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
    const snap = await db.collection('Settings').doc(SEARCH_COLLECTIONS_DOC).get();
    const raw = (snap.data()?.['collections'] as Record<string, unknown> | undefined) ?? {};
    const data: Record<string, CollectionSetup> = {};
    for (const [collection, value] of Object.entries(raw)) {
        const setup = validSetup(value);
        if (setup) data[collection] = setup;
    }
    cache = { data, at: Date.now() };
    return data;
}
