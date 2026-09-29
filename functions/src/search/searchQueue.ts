/**
 * The draft search queue (docs/feature-flags-spec.md, section 6.5).
 *
 * Drafts live in one collection per content type, created at runtime, so no
 * trigger can name them. Instead every draft save in the browser writes
 * `_search_queue/{collection}~{docId}` in the same batch as the draft, and this
 * trigger indexes the draft (with its translations) and deletes the entry. The
 * entry's id is fixed per draft, so quick saves update one entry; each update
 * fires this again and reads the draft as it is then.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { arcDocument } from '../arc-config.js';
import { syncDocument } from './sync.js';
import { DRAFT_COLLECTION_REGEX } from './sources/content-drafts.js';
import type { SearchDocument } from './source.js';

export const SEARCH_QUEUE_COLLECTION = '_search_queue';

export const onSearchQueued = onDocumentWritten(arcDocument(`${SEARCH_QUEUE_COLLECTION}/{id}`), async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // our own delete
    const { collection, docId } = (after.data() ?? {}) as { collection?: unknown; docId?: unknown };

    if (typeof collection === 'string' && DRAFT_COLLECTION_REGEX.test(collection) && typeof docId === 'string' && docId) {
        const snap = await db.collection(collection).doc(docId).get();
        await syncDocument(collection, docId, snap.exists ? (snap.data() as SearchDocument) : null);
    } else {
        console.warn(`Search queue: ignored an entry that names no draft (${event.params.id}).`);
    }
    await after.ref.delete();
});
