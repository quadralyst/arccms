import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Firestore, collection, doc, getDocs, writeBatch } from '@angular/fire/firestore';
import { sortForDisplay, timeOf } from '../../../../core/utils/display-order';
import { PublishQueueService } from '../publish-queue/publish-queue.service';

/** One draft as the Arrange dialog lists it. */
export interface OrderedEntry {
    id: string;
    title: string;
    /** Whether the entry is on the site: only published entries show there. */
    published: boolean;
    sortOrder?: number;
}

/** A draft's time for ordering: when it was published, else when it was created. */
const draftTime = (draft: Record<string, any>) => draft['publishedOn'] || draft['createdAt'];

const MAX_BATCH_OPS = 400;

/**
 * A content type kept in its own order (specs/site-sections-spec.md, SS2): the
 * order lives in `sortOrder` on each draft; publishing copies it, and the
 * `order` queue item copies it to the published entries already live and
 * rebuilds the pages that show them.
 *
 * Only `sortOrder` is written, never `modifiedAt`: moving an entry is not an
 * edit, so a published entry does not turn "Edited".
 */
@Injectable({ providedIn: 'root' })
export class EntryOrderService {
    private firestore = inject(Firestore);
    private injector = inject(EnvironmentInjector);
    private publishQueue = inject(PublishQueueService);

    /** Every draft of the type, in the order the site shows them. */
    async load(slug: string): Promise<OrderedEntry[]> {
        const [drafts, published] = await Promise.all([this.readDrafts(slug), this.publishedIds(slug)]);
        return sortForDisplay(drafts, 'manual', draftTime).map((draft) => ({
            id: draft['id'],
            title: draft['title'] || '',
            published: published.has(draft['id']),
            ...(typeof draft['sortOrder'] === 'number' ? { sortOrder: draft['sortOrder'] } : {}),
        }));
    }

    /** Saves this order (ids, first shown first) and republishes the pages that show it. */
    async save(slug: string, ids: string[]): Promise<void> {
        await this.writeOrder(slug, ids);
        await this.publishQueue.reorder(slug);
    }

    /**
     * A type switched to its own order keeps the order it had: every draft is
     * numbered newest first, as the site showed them.
     */
    async numberInCurrentOrder(slug: string): Promise<void> {
        const drafts = await this.readDrafts(slug);
        const newestFirst = [...drafts].sort((a, b) => timeOf(draftTime(b)) - timeOf(draftTime(a)));
        await this.writeOrder(slug, newestFirst.map((draft) => draft['id']));
    }

    /** Republishes the type's pages after its entry order changed either way. */
    async republish(slug: string): Promise<void> {
        await this.publishQueue.reorder(slug);
    }

    private async readDrafts(slug: string): Promise<Record<string, any>[]> {
        const snap = await runInInjectionContext(this.injector, () =>
            getDocs(collection(this.firestore, `arc_${slug}_drafts`)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    /** Which entries have a published copy: the draft's own flags can outlive an unpublish. */
    private async publishedIds(slug: string): Promise<Set<string>> {
        const snap = await runInInjectionContext(this.injector, () =>
            getDocs(collection(this.firestore, `arc_${slug}`)));
        return new Set(snap.docs.map((d) => d.id));
    }

    private async writeOrder(slug: string, ids: string[]): Promise<void> {
        for (let i = 0; i < ids.length; i += MAX_BATCH_OPS) {
            const batch = runInInjectionContext(this.injector, () => writeBatch(this.firestore));
            ids.slice(i, i + MAX_BATCH_OPS).forEach((id, j) => {
                const ref = runInInjectionContext(this.injector, () => doc(this.firestore, `arc_${slug}_drafts`, id));
                batch.update(ref, { sortOrder: i + j + 1 });
            });
            await batch.commit();
        }
    }
}
