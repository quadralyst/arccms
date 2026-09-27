/**
 * Rebuilds the search index for one source, one collection, or everything.
 *
 * Used for the first backfill, after a source's fields change, and as the
 * repair tool when anything looks wrong. Every entry is rewritten and every
 * entry whose document no longer exists is deleted, so the result is exactly
 * what the sources say it should be.
 *
 * Spec: docs/search-spec.md, phase S1 item 7.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { requireAdmin } from './auth.js';
import { SEARCH_SOURCES, findSource } from './registry.js';
import { buildSearchContext, clearSearchContextCache } from './context.js';
import { buildEntries } from './writer.js';
import {
    SEARCH_INDEX_COLLECTION,
    SEARCH_STATUS_DOC,
    searchEntryId,
    sourceMatches,
    type SearchDocument,
    type SearchIndexEntry,
    type SearchSource,
} from './source.js';

const PAGE_SIZE = 200;
const BATCH_LIMIT = 400;

export interface ReindexRequest {
    /** Limit to one source. Omit for every source. */
    source?: string;
    /** Limit to one collection of that source, for example after one content type changed. */
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

/** The collections a source spans right now. */
export async function collectionsFor(source: SearchSource): Promise<string[]> {
    if (typeof source.collection === 'string') return [source.collection];
    if (source.expandCollections) return source.expandCollections();
    const all = await db.listCollections();
    return all.map(ref => ref.id).filter(id => sourceMatches(source, id));
}

async function commitInChunks(
    ops: ((batch: FirebaseFirestore.WriteBatch) => void)[],
): Promise<void> {
    for (let start = 0; start < ops.length; start += BATCH_LIMIT) {
        const batch = db.batch();
        ops.slice(start, start + BATCH_LIMIT).forEach(op => op(batch));
        await batch.commit();
    }
}

/**
 * Rewrites every entry of a source. With `onlyCollection`, other collections
 * of the same source keep their entries and are not walked.
 */
export async function reindexSource(
    source: SearchSource,
    onlyCollection?: string,
): Promise<SourceReindexResult> {
    const started = Date.now();
    const collections = onlyCollection
        ? [onlyCollection].filter(id => sourceMatches(source, id))
        : await collectionsFor(source);

    const written = new Set<string>();
    let documents = 0;
    let entries = 0;

    for (const collection of collections) {
        let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
        for (;;) {
            let query = db.collection(collection).orderBy('__name__').limit(PAGE_SIZE);
            if (last) query = query.startAfter(last);
            const page = await query.get();
            if (page.empty) break;

            const ops: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for (const doc of page.docs) {
                documents++;
                const ctx = await buildSearchContext(collection, doc.id);
                let built: SearchIndexEntry[] = [];
                try {
                    built = await buildEntries(source, doc.data() as SearchDocument, ctx);
                } catch (error) {
                    console.error(`Could not index ${source.id} ${collection}/${doc.id}:`, error);
                }
                for (const entry of built) {
                    const id = searchEntryId(source.id, collection, doc.id, entry.lang);
                    written.add(id);
                    ops.push(batch => batch.set(db.collection(SEARCH_INDEX_COLLECTION).doc(id), entry));
                    entries++;
                }
            }
            await commitInChunks(ops);

            last = page.docs[page.docs.length - 1];
            if (page.size < PAGE_SIZE) break;
        }
    }

    // Orphans: entries of this source (and, when narrowed, this collection)
    // that no walked document produced.
    let stale = db.collection(SEARCH_INDEX_COLLECTION).where('source', '==', source.id);
    if (onlyCollection) stale = stale.where('collection', '==', onlyCollection);
    const staleSnap = await stale.get();
    const deletions = staleSnap.docs
        .filter(doc => !written.has(doc.id))
        .map(doc => (batch: FirebaseFirestore.WriteBatch) => batch.delete(doc.ref));
    await commitInChunks(deletions);

    return {
        source: source.id,
        collections,
        documents,
        entries,
        removed: deletions.length,
        durationMs: Date.now() - started,
    };
}

async function recordStatus(results: SourceReindexResult[]): Promise<void> {
    const update: Record<string, unknown> = {};
    for (const result of results) {
        update[`sources.${result.source}`] = {
            collections: result.collections,
            documents: result.documents,
            entries: result.entries,
            removed: result.removed,
            durationMs: result.durationMs,
            reindexedAt: Timestamp.now(),
        };
    }
    update['updatedAt'] = Timestamp.now();
    await db.collection('Settings').doc(SEARCH_STATUS_DOC).set(update, { merge: true });
}

/** Rebuilds the index and records the outcome. Shared with the publish queue. */
export async function runReindex(input: ReindexRequest = {}): Promise<SourceReindexResult[]> {
    clearSearchContextCache();
    const targets = input.source
        ? [findSource(input.source)].filter((s): s is SearchSource => !!s)
        : [...SEARCH_SOURCES];
    if (input.source && targets.length === 0) {
        throw new HttpsError('not-found', `Unknown search source: ${input.source}`);
    }

    const results: SourceReindexResult[] = [];
    for (const source of targets) {
        results.push(await reindexSource(source, input.collection));
    }
    await recordStatus(results);
    return results;
}

export const reindexSearch = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
    await requireAdmin(request);

    const data = (request.data ?? {}) as ReindexRequest;
    const input: ReindexRequest = {};
    if (data.source !== undefined) {
        if (typeof data.source !== 'string') throw new HttpsError('invalid-argument', 'source must be a string.');
        input.source = data.source;
    }
    if (data.collection !== undefined) {
        if (typeof data.collection !== 'string') throw new HttpsError('invalid-argument', 'collection must be a string.');
        input.collection = data.collection;
    }

    const results = await runReindex(input);
    console.log('Search reindex:', results);
    return { results };
});
