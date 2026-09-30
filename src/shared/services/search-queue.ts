/**
 * The draft search queue, browser side (specs/feature-flags-spec.md 6.5).
 *
 * Drafts live in one collection per content type, created at runtime, so no
 * Cloud Function trigger can name them. Every draft write therefore adds an
 * entry to `_search_queue` in the same batch or transaction, and the
 * onSearchQueued function indexes the draft as it is then. The entry's id is
 * fixed per draft, so quick saves update one entry instead of piling up.
 */
import { doc, Firestore, type DocumentReference } from '@angular/fire/firestore';
import { isOn } from '../../app/core/features/features';

export const SEARCH_QUEUE_COLLECTION = '_search_queue';

const DRAFTS = /^arc_.+_drafts$/;

export interface SearchQueueEntry {
    ref: DocumentReference;
    data: { collection: string; docId: string; at: Date };
}

/**
 * The queue entry for a write at `path` (a draft or one of its translations),
 * or null when nothing needs indexing: not a draft, or search or content is off.
 * Call it inside an injection context, like any other `doc()`.
 */
export function draftQueueEntry(firestore: Firestore, path: string): SearchQueueEntry | null {
    if (!isOn('search') || !isOn('content')) return null;
    const [collection, docId] = path.split('/');
    if (!DRAFTS.test(collection) || !docId) return null;
    return {
        ref: doc(firestore, SEARCH_QUEUE_COLLECTION, `${collection}~${docId}`),
        data: { collection, docId, at: new Date() },
    };
}
