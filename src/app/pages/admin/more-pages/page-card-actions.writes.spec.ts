/** What PageCardActions writes (page-card-actions.ts, VE-D54): Add, Remove and a card's publish. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

const updates: { path: string; data: Record<string, unknown> }[] = [];
const stored: Record<string, Record<string, unknown> | null> = {};
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    getDoc: async (ref: { path: string }) => ({ exists: () => !!stored[ref.path], data: () => stored[ref.path], id: ref.path.split('/').pop() }),
    updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
        updates.push({ path: ref.path, data });
    },
    deleteField: () => '<delete>',
    runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => run({
        get: async (ref: { path: string }) => ({ exists: () => !!stored[ref.path], data: () => stored[ref.path] }),
        update: (ref: { path: string }, data: Record<string, unknown>) => updates.push({ path: ref.path, data }),
    }),
}));

import { Firestore } from '@angular/fire/firestore';
import { PageCardActions } from './page-card-actions';
import { DraftContentsStore } from '../contents/draft-content-store/draft-contents.store';
import { PublishQueueService } from '../contents/publish-queue/publish-queue.service';
import { EntryOrderService } from '../contents/entry-order/entry-order.service';
import type { ContentType } from '../contents/content-types/content-types.model';

describe('PageCardActions writes', () => {
    let actions: PageCardActions;
    const createDraft = vi.fn(() => of('new-id'));
    const enqueue = vi.fn(async () => undefined);
    const order = { load: vi.fn(async () => [{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 4 }]), save: vi.fn(async () => undefined) };

    beforeEach(() => {
        updates.length = 0;
        for (const key of Object.keys(stored)) delete stored[key];
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: DraftContentsStore, useValue: { createDraft } },
                { provide: PublishQueueService, useValue: { enqueue } },
                { provide: EntryOrderService, useValue: order },
            ],
        });
        actions = TestBed.inject(PageCardActions);
    });

    it('Add: a draft on this page, never published, last in the type\'s own order', async () => {
        const id = await actions.add({ slug: 'quotes', entryOrder: 'manual' } as unknown as ContentType, 'home', '[Replace: new quote]');
        expect(id).toBe('new-id');
        expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
            title: '[Replace: new quote]', status: 'draft', publishedStatus: false, addedOnPage: 'home', sortOrder: 5,
        }), 'quotes');
        await actions.add({ slug: 'quotes', entryOrder: 'manual' } as unknown as ContentType, 'home', 'x', 'a');
        expect(createDraft).toHaveBeenLastCalledWith(expect.objectContaining({ sortOrder: 2.5 }), 'quotes');
    });

    it('Remove: a published card is unpublished as the list does it; a new one only leaves the page', async () => {
        stored['arc_quotes_drafts/a'] = { publishedStatus: true };
        await actions.remove({ type: 'quotes', id: 'a' });
        expect(updates[0]).toEqual({ path: 'arc_quotes_drafts/a', data: { status: 'draft', publishedStatus: false, addedOnPage: '<delete>' } });
        expect(enqueue).toHaveBeenCalledWith('unpublish', 'quotes', 'a');
        stored['arc_quotes_drafts/n'] = { publishedStatus: false, addedOnPage: 'home' };
        await actions.remove({ type: 'quotes', id: 'n' });
        expect(updates[1]).toEqual({ path: 'arc_quotes_drafts/n', data: { addedOnPage: '<delete>' } });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('publish: as the entry editor publishes, keeping the first publish date', async () => {
        const draft = { status: 'draft', publishedStatus: true, publishedOn: '2026-01-01', modifiedAt: 5 };
        stored['arc_quotes_drafts/a'] = draft;
        expect(await actions.publish({ type: 'quotes', id: 'a' }, { ...draft }, 'home')).toBe(true);
        expect(updates[0].data).toEqual(expect.objectContaining({ status: 'publish', publishedStatus: true, publishedOn: '2026-01-01', addedOnPage: '<delete>' }));
        expect(enqueue).toHaveBeenCalledWith('publish', 'quotes', 'a');
    });

    it('publish: nothing when the card was saved or unpublished after it was checked', async () => {
        stored['arc_quotes_drafts/a'] = { status: 'draft', publishedStatus: true, modifiedAt: 6 };
        expect(await actions.publish({ type: 'quotes', id: 'a' }, { status: 'draft', publishedStatus: true, modifiedAt: 5 }, 'home')).toBe(false);
        stored['arc_quotes_drafts/a'] = { status: 'draft', publishedStatus: false, modifiedAt: 5, lastPublishedAt: 1 };
        expect(await actions.publish({ type: 'quotes', id: 'a' }, { status: 'draft', publishedStatus: true, modifiedAt: 5 }, 'home')).toBe(false);
        expect(updates).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('publish and Remove: the draft is put back when the queue cannot take it', async () => {
        const draft = { status: 'draft', publishedStatus: false, addedOnPage: 'home', modifiedAt: 5 };
        stored['arc_quotes_drafts/n'] = draft;
        enqueue.mockRejectedValueOnce(new Error('offline'));
        await expect(actions.publish({ type: 'quotes', id: 'n' }, { ...draft }, 'home')).rejects.toThrow('offline');
        expect(updates[1].data).toEqual({ status: 'draft', publishedStatus: false, publishedOn: '<delete>', modifiedAt: 5, updatedAt: '<delete>', addedOnPage: 'home' });

        updates.length = 0;
        stored['arc_quotes_drafts/a'] = { status: 'draft', publishedStatus: true };
        enqueue.mockRejectedValueOnce(new Error('offline'));
        await expect(actions.remove({ type: 'quotes', id: 'a' })).rejects.toThrow('offline');
        expect(updates[1].data).toEqual({ status: 'draft', publishedStatus: true });
    });

    it('Move: beside its neighbour, saved as Arrange saves', async () => {
        await actions.move({ type: 'quotes', id: 'b' }, 'a', false);
        expect(order.save).toHaveBeenCalledWith('quotes', ['b', 'a']);
    });
});
