import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { set, runTransaction } = vi.hoisted(() => {
    const set = vi.fn();
    return { set, runTransaction: vi.fn(async (_fs: unknown, fn: (t: { set: typeof set }) => Promise<void>) => fn({ set })) };
});
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: vi.fn(() => 'queue'),
    doc: vi.fn(() => ({ id: 'q1' })),
    addDoc: vi.fn(),
    runTransaction,
}));

import { Firestore } from '@angular/fire/firestore';
import { PublishQueueService } from './publish-queue.service';

// RF4 review M6: a publish asked for without a connection fails at once.
describe('PublishQueueService.enqueue', () => {
    beforeEach(() => {
        set.mockClear();
        runTransaction.mockClear();
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
    });

    it('writes the queue item in a transaction, which fails at once offline instead of waiting', async () => {
        const service = TestBed.inject(PublishQueueService);
        await service.enqueue('publish', 'blog', 'd1');
        expect(runTransaction).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith({ id: 'q1' }, expect.objectContaining({ action: 'publish', contentTypeSlug: 'blog', docId: 'd1' }));

        runTransaction.mockRejectedValueOnce(new Error('client is offline'));
        await expect(service.enqueue('publish', 'blog', 'd1')).rejects.toThrow('offline');
    });
});
