/**
 * What Admin, Settings, Search shows (docs/feature-flags-spec.md, section 6.4):
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
import { isFeatureOn } from '../feature-flags.js';
import { CUSTOM_SEARCH_SOURCES, SEARCH_COLLECTIONS } from '../custom/search-sources.js';

export type CollectionState = 'content' | 'searchable' | 'needs_setup' | 'code' | 'not_listed' | 'refused';

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
    if (SEARCH_COLLECTIONS.includes(name)) {
        const setup = setups[name];
        return setup
            ? { name, state: 'searchable', sourceId: collectionSourceId(name), label: setup.label || name, setup }
            : { name, state: 'needs_setup', sourceId: collectionSourceId(name) };
    }
    return { name, state: 'not_listed' };
}

export const listSearchCollections = onCall(async (request) => {
    await requireAdmin(request);
    const [refs, setups] = await Promise.all([db.listCollections(), readCollectionSetups(true)]);
    // Named collections show even before they hold a document.
    const names = [...new Set([...refs.map((ref) => ref.id), ...SEARCH_COLLECTIONS])].sort((a, b) => a.localeCompare(b));
    return { collections: names.map((name) => collectionState(name, setups)) };
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
    if (typeof collection !== 'string' || !SEARCH_COLLECTIONS.includes(collection)) {
        throw new HttpsError('invalid-argument', 'Name a collection listed in SEARCH_COLLECTIONS.');
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
