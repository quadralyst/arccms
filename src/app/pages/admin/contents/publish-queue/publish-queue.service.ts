import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc } from '@angular/fire/firestore';

/**
 * `redeploy` regenerates the static pages from what is already published,
 * without touching drafts — the repair after a `firebase deploy --only
 * hosting`, which drops every page this pipeline wrote.
 *
 * `order` is for a whole content type, with no document: its entries were put
 * in a new order (specs/site-sections-spec.md, SS2).
 */
export type PublishAction = 'publish' | 'unpublish' | 'update' | 'delete' | 'redeploy' | 'redeploy-all' | 'order';

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
     * Each call adds a new document (a new id), so every publish fires the
     * trigger afresh. The function deletes the document when it is done; the
     * rules let the app create queue documents only, never read, change or
     * delete them (firestore.rules, `_publish_queue`).
     */
    async enqueue(action: PublishAction, contentTypeSlug: string, docId: string): Promise<void> {
        const item: PublishQueueItem = {
            action,
            contentTypeSlug,
            docId,
            timestamp: new Date(),
        };
        await addDoc(collection(this.firestore, '_publish_queue'), item);
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
        await this.addSiteItem('redeploy-all', '');
    }

    /**
     * The pages that show a content type's entries follow their new order, or
     * the type's changed entry order (specs/site-sections-spec.md, SS2). Added
     * like redeployAll: it names no document.
     */
    async reorder(contentTypeSlug: string): Promise<void> {
        await this.addSiteItem('order', contentTypeSlug);
    }

    private async addSiteItem(action: 'redeploy-all' | 'order', contentTypeSlug: string): Promise<void> {
        await addDoc(collection(this.firestore, '_publish_queue'), {
            action,
            contentTypeSlug,
            docId: '',
            timestamp: new Date(),
        });
    }
}
