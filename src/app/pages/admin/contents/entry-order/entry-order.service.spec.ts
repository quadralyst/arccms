/**
 * A content type kept in its own order (specs/site-sections-spec.md, SS2).
 */
import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetDocs, mockUpdate, mockCommit } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockUpdate: vi.fn(),
    mockCommit: vi.fn(),
}));
vi.mock('@angular/fire/firestore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@angular/fire/firestore')>()),
    collection: vi.fn((_fs: unknown, path: string) => ({ path })),
    doc: vi.fn((_fs: unknown, path: string, id: string) => ({ path: `${path}/${id}` })),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    writeBatch: () => ({ update: mockUpdate, commit: mockCommit }),
}));

import { EntryOrderService } from './entry-order.service';
import { PublishQueueService } from '../publish-queue/publish-queue.service';

const day = (n: number) => ({ seconds: 1767600000 + n * 86400 });
const snap = (docs: Record<string, unknown>[]) => ({ docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) });

const DRAFTS = [
    { id: 'old', title: 'Old', publishedOn: day(1) },
    { id: 'new', title: 'New', publishedOn: day(5) },
    { id: 'draft', title: 'Never published', createdAt: day(3) },
];

describe('EntryOrderService', () => {
    let service: EntryOrderService;
    const reorder = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockCommit.mockResolvedValue(undefined);
        reorder.mockResolvedValue(undefined);
        mockGetDocs.mockImplementation(async (ref: { path: string }) =>
            ref.path.endsWith('_drafts') ? snap(DRAFTS) : snap([{ id: 'old' }, { id: 'new' }]));
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: PublishQueueService, useValue: { reorder } },
            ],
        });
        service = TestBed.inject(EntryOrderService);
    });

    it('numbers a type switched to its own order newest first, as the site showed it', async () => {
        await service.numberInCurrentOrder('services');
        expect(mockUpdate.mock.calls.map(([ref, data]) => [ref.path, data.sortOrder])).toEqual([
            ['arc_services_drafts/new', 1],
            ['arc_services_drafts/draft', 2],
            ['arc_services_drafts/old', 3],
        ]);
        // Only the order: moving an entry is not an edit.
        expect(Object.keys(mockUpdate.mock.calls[0][1])).toEqual(['sortOrder']);
    });

    it('saves the arranged order and republishes the type\'s pages', async () => {
        await service.save('services', ['old', 'draft', 'new']);
        expect(mockUpdate.mock.calls.map(([ref, data]) => [ref.path, data.sortOrder])).toEqual([
            ['arc_services_drafts/old', 1],
            ['arc_services_drafts/draft', 2],
            ['arc_services_drafts/new', 3],
        ]);
        expect(mockCommit).toHaveBeenCalledTimes(1);
        expect(reorder).toHaveBeenCalledWith('services');
    });

    it('lists the drafts in the site\'s order, saying which are not on the site', async () => {
        mockGetDocs.mockImplementation(async (ref: { path: string }) => ref.path.endsWith('_drafts')
            ? snap([{ ...DRAFTS[0], sortOrder: 2 }, { ...DRAFTS[1], sortOrder: 1 }, DRAFTS[2]])
            : snap([{ id: 'old' }, { id: 'new' }]));
        const entries = await service.load('services');
        expect(entries).toEqual([
            { id: 'new', title: 'New', published: true, sortOrder: 1 },
            { id: 'old', title: 'Old', published: true, sortOrder: 2 },
            { id: 'draft', title: 'Never published', published: false },
        ]);
    });

    it('writes in batches small enough for Firestore', async () => {
        const ids = Array.from({ length: 450 }, (_, i) => `e${i}`);
        await service.save('services', ids);
        expect(mockCommit).toHaveBeenCalledTimes(2);
        expect(mockUpdate.mock.calls[449][1]).toEqual({ sortOrder: 450 });
    });
});
