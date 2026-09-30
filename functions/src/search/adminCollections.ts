/**
 * What Admin, Settings, Search shows (specs/feature-flags-spec.md, section 6.4):
 * every top-level collection with whether it is searchable, and the text fields
 * found in a sample of a collection's documents for its setup.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { requireAdmin } from './auth.js';
import { refusedReason } from './refused.js';
import { collectionSourceId, readCollectionSetups, type CollectionSetup } from './collections.js';
import { DRAFT_COLLECTION_REGEX } from './sources/content-drafts.js';
import { PUBLISHED_COLLECTION_REGEX } from './sources/content.js';
import { contentSearchFields } from './sources/content-fields.js';
import { loadContentTypes } from './context.js';
import type { SearchFieldSpec, SearchSource } from './source.js';
import { isFeatureOn } from '../feature-flags.js';
import { CUSTOM_SEARCH_SOURCES, SEARCH_COLLECTIONS } from '../custom/search-sources.js';

/**
 * content: content's own. searchable: named and set up. needs_setup: named, not set
 * up. waiting: set up in Search settings, not named yet, so no trigger indexes it.
 * code: a source written in code. not_listed: neither. refused: never searchable.
 */
export type CollectionState = 'content' | 'searchable' | 'needs_setup' | 'waiting' | 'code' | 'not_listed' | 'refused';

export interface SearchCollectionRow {
    name: string;
    state: CollectionState;
    /** The source whose entries it has, for Rebuild and the status counts. */
    sourceId?: string;
    label?: string;
    /** Why it can never be searchable (refused). */
    reason?: string;
    setup?: CollectionSetup;
}

/** A collection's state, from what the app named and what is set up. */
export function collectionState(name: string, setups: Record<string, CollectionSetup>): SearchCollectionRow {
    const reason = refusedReason(name);
    if (reason) return { name, state: 'refused', reason };
    if (isFeatureOn('content') && (DRAFT_COLLECTION_REGEX.test(name) || PUBLISHED_COLLECTION_REGEX.test(name))) {
        return { name, state: 'content', sourceId: DRAFT_COLLECTION_REGEX.test(name) ? 'content-drafts' : 'content' };
    }
    const code = CUSTOM_SEARCH_SOURCES.find((s) => s.collection === name);
    if (code) return { name, state: 'code', sourceId: code.id, label: code.label || code.id };
    const setup = setups[name];
    if (SEARCH_COLLECTIONS.includes(name)) {
        return setup
            ? { name, state: 'searchable', sourceId: collectionSourceId(name), label: setup.label || name, setup }
            : { name, state: 'needs_setup', sourceId: collectionSourceId(name) };
    }
    return setup
        ? { name, state: 'waiting', sourceId: collectionSourceId(name), label: setup.label || name, setup }
        : { name, state: 'not_listed' };
}

/** Whether an admin may set a collection up in Search settings: not refused, not content's, not written in code. */
export function canSetUp(state: CollectionState): boolean {
    return state === 'searchable' || state === 'needs_setup' || state === 'waiting' || state === 'not_listed';
}

export interface IndexedField {
    path: string;
    /** Counts most, with type-ahead. */
    high: boolean;
}

/** What each source tokenizes, for Search settings: per content type for content. */
export interface SourceFields {
    fields: IndexedField[] | null;
    byType?: { type: string; fields: IndexedField[] }[];
}

const fromSpecs = (specs: SearchFieldSpec[]): IndexedField[] => specs.map((s) => ({ path: s.path, high: s.weight >= 3 }));

export async function indexedFields(setups: Record<string, CollectionSetup>): Promise<Record<string, SourceFields>> {
    const out: Record<string, SourceFields> = {};
    if (isFeatureOn('content')) {
        const types = [...(await loadContentTypes(true)).values()].sort((a, b) => a.name.localeCompare(b.name));
        const byType = (list: typeof types) => list.map((t) => ({ type: t.name, fields: fromSpecs(contentSearchFields(t)) }));
        out['content'] = { fields: null, byType: byType(types.filter((t) => t.hasPublicUrl !== false)) };
        out['content-drafts'] = { fields: null, byType: byType(types) };
    }
    for (const source of CUSTOM_SEARCH_SOURCES as SearchSource[]) {
        // A source that picks its fields per document says so: "set in code".
        out[source.id] = { fields: Array.isArray(source.fields) ? fromSpecs(source.fields) : null };
    }
    for (const [collection, setup] of Object.entries(setups)) {
        out[collectionSourceId(collection)] = { fields: setup.fields.map((f) => ({ path: f.path, high: f.weight === 'high' })) };
    }
    return out;
}

export const listSearchCollections = onCall(async (request) => {
    await requireAdmin(request);
    const [refs, setups] = await Promise.all([db.listCollections(), readCollectionSetups(true)]);
    // Named collections show even before they hold a document.
    const names = [...new Set([...refs.map((ref) => ref.id), ...SEARCH_COLLECTIONS])].sort((a, b) => a.localeCompare(b));
    return { collections: names.map((name) => collectionState(name, setups)), fields: await indexedFields(setups) };
});

const SAMPLE_SIZE = 20;
const EXAMPLE_LENGTH = 120;

export interface SampledTextField {
    path: string;
    /** How many of the sampled documents have text there. */
    count: number;
    example: string;
}

/**
 * The text fields of some documents: strings and lists of strings, at the top
 * level and one level into maps (`address.city`). Numbers, dates, yes/no and
 * references cannot be searched as words, so they are left out.
 */
export function textFields(docs: Record<string, unknown>[]): SampledTextField[] {
    const found = new Map<string, SampledTextField>();
    const note = (path: string, value: unknown) => {
        const text = typeof value === 'string'
            ? value
            : Array.isArray(value) && value.length && value.every((v) => typeof v === 'string') ? value.join(', ') : '';
        if (!text.trim()) return;
        const field = found.get(path) ?? { path, count: 0, example: text.slice(0, EXAMPLE_LENGTH) };
        field.count++;
        found.set(path, field);
    };
    for (const doc of docs) {
        for (const [key, value] of Object.entries(doc)) {
            if (value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
                for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) note(`${key}.${inner}`, innerValue);
            } else {
                note(key, value);
            }
        }
    }
    return [...found.values()].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

export const sampleCollectionFields = onCall(async (request) => {
    await requireAdmin(request);
    const collection = (request.data as { collection?: unknown } | undefined)?.collection;
    // Any collection an admin may set up, named yet or not: never a refused one
    // (logs, codes, Settings), content's own, or one written in code.
    if (typeof collection !== 'string' || !/^[A-Za-z0-9_-]+$/.test(collection)
        || !canSetUp(collectionState(collection, await readCollectionSetups()).state)) {
        throw new HttpsError('invalid-argument', 'This collection cannot be set up for search.');
    }
    const snap = await db.collection(collection).limit(SAMPLE_SIZE).get();
    const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
    // The preview shows one of these as a result, so only its text fields leave the server.
    const samples = snap.docs.slice(0, 3).map((d) => {
        const values: Record<string, string> = {};
        for (const field of textFields([d.data() as Record<string, unknown>])) values[field.path] = field.example;
        return { id: d.id, values };
    });
    return { fields: textFields(docs), samples };
});
