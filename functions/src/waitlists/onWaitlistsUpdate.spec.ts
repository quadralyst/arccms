import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onWaitlistsUpdate } from './onWaitlistsUpdate.js';
import { db } from '../init.js';

vi.mock('../init', () => ({
    db: { collection: vi.fn() },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentUpdated: vi.fn((opts, handler) => handler),
}));

vi.mock('firebase-functions/v2', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('firebase-admin/firestore', () => ({
    Timestamp: { now: () => ({ __ts: true }) },
}));

describe('onWaitlistsUpdate', () => {
    const mockDb = db as any;
    let listSet: any;
    let listGet: any;
    let listDocFor: string | undefined;

    function setup(listExists: boolean): void {
        listSet = vi.fn().mockResolvedValue(undefined);
        listGet = vi.fn().mockResolvedValue({ exists: listExists });
        listDocFor = undefined;

        mockDb.collection.mockImplementation((name: string) => {
            if (name === 'Lists') {
                return {
                    doc: vi.fn((id: string) => {
                        listDocFor = id;
                        return { get: listGet, set: listSet };
                    }),
                };
            }
            return { doc: vi.fn() };
        });
    }

    function event(beforeName: unknown, afterName: unknown): any {
        return {
            data: {
                before: { data: () => ({ name: beforeName }) },
                after: { data: () => ({ name: afterName }) },
            },
            params: { waitlistsId: 'wl-123' },
        };
    }

    beforeEach(() => vi.clearAllMocks());

    it('renames the mirrored list when the waitlist name changes', async () => {
        setup(true);

        await (onWaitlistsUpdate as any)(event('Old Name', 'New Name'));

        expect(listDocFor).toBe('waitlist-wl-123');
        expect(listSet).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'New Name' }),
            { merge: true },
        );
    });

    it('does nothing when the name is unchanged', async () => {
        setup(true);

        await (onWaitlistsUpdate as any)(event('Same', 'Same'));

        expect(listSet).not.toHaveBeenCalled();
    });

    it('does not recreate a list that no longer exists', async () => {
        setup(false);

        await (onWaitlistsUpdate as any)(event('Old', 'New'));

        expect(listSet).not.toHaveBeenCalled();
    });

    it('ignores an update that clears the name', async () => {
        setup(true);

        await (onWaitlistsUpdate as any)(event('Old', ''));

        expect(listSet).not.toHaveBeenCalled();
    });

    it('swallows Firestore errors so the update is not retried forever', async () => {
        setup(true);
        listGet.mockRejectedValue(new Error('unavailable'));

        await expect((onWaitlistsUpdate as any)(event('Old', 'New'))).resolves.toBeUndefined();
    });
});
