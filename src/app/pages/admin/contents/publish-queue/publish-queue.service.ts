import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, query, where, getDocs, deleteDoc } from '@angular/fire/firestore';

/**
 * `redeploy` regenerates the static pages from what is already published,
 * without touching drafts — the repair after a `firebase deploy --only
 * hosting`, which drops every page this pipeline wrote.
 */
export type PublishAction = 'publish' | 'unpublish' | 'update' | 'delete' | 'redeploy';

export interface PublishQueueItem {
    action: PublishAction;
    contentTypeSlug: string;
    docId: string;
    timestamp: Date;
}

/**
 * Writes trigger documents to the `_publish_queue` Firestore collection.
 *
 * A single Cloud Function watches this collection and syncs draft content
 * to the corresponding published collection (`arc_{slug}`).
 *
 * This avoids wildcard triggers that fire on every Firestore write.
 */
@Injectable({ providedIn: 'root' })
export class PublishQueueService {
    private firestore = inject(Firestore);

    /**
     * Enqueue a publish/unpublish/update/delete action for processing
     * by the Cloud Function.
     *
     * Deletes any existing stale queue items for the same docId first,
     * so re-publishing always creates a fresh trigger document and
     * resets any stuck state.
     */
    async enqueue(action: PublishAction, contentTypeSlug: string, docId: string): Promise<void> {
        const queueRef = collection(this.firestore, '_publish_queue');

        // Delete any existing stale queue items for the same document
        // This ensures re-publishing triggers a fresh onCreate event
        try {
            const staleQuery = query(queueRef, where('docId', '==', docId));
            const staleSnap = await getDocs(staleQuery);
            const deletePromises = staleSnap.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
        } catch (error) {
            // Non-critical: log but continue with the enqueue
            console.warn('Could not clean stale queue items:', error);
        }

        const item: PublishQueueItem = {
            action,
            contentTypeSlug,
            docId,
            timestamp: new Date(),
        };
        await addDoc(queueRef, item);
    }

    /**
     * Rebuilds every published page and releases them as one Hosting version.
     *
     * Run this after `firebase deploy --only hosting`. That deploy builds its
     * version from the previous *release's* file list, which holds only what
     * the CLI uploaded, so every page this pipeline wrote vanishes from the
     * live site — and the SPA fallback answers 200 for the missing URLs, so
     * nothing looks broken until someone reads the page.
     *
     * One queue item on purpose: a page-at-a-time repair races itself, each
     * release rebuilding from a file list that does not yet contain the last.
     */
    async redeployAll(): Promise<void> {
        await addDoc(collection(this.firestore, '_publish_queue'), {
            action: 'redeploy-all' as PublishAction,
            contentTypeSlug: '',
            docId: '',
            timestamp: new Date(),
        });
    }
}
