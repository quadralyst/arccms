/**
 * DbService.getAll: the total of a paged list comes from an aggregate count, never from a
 * live read of every record, and is read again when the list may have changed length.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import type { Subscription } from 'rxjs';

const fire = vi.hoisted(() => ({
    next: (_snapshot: unknown) => undefined as void,
    stop: vi.fn(),
}));
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    DocumentReference: class {},
    DocumentSnapshot: class {},
    collection: vi.fn(() => ({ path: 'items' })),
    doc: vi.fn(() => ({ id: 'new-id', path: 'items/new-id' })),
    where: vi.fn((...args: unknown[]) => ({ where: args })),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn((count: number) => ({ limit: count })),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    getCountFromServer: vi.fn(),
    waitForPendingWrites: vi.fn(() => Promise.resolve()),
    runTransaction: vi.fn(async (_db: unknown, work: (t: unknown) => Promise<unknown>) => work({
        get: async () => ({ exists: () => true }),
        delete: () => undefined,
        update: () => undefined,
        set: () => undefined,
    })),
    addDoc: vi.fn(async () => ({ id: 'new-id', path: 'items/new-id' })),
    writeBatch: vi.fn(() => ({ set: () => undefined, commit: async () => undefined })),
    onSnapshot: vi.fn((_query: unknown, next: (s: unknown) => void) => {
        fire.next = next;
        return fire.stop;
    }),
}));

import { getCountFromServer, onSnapshot, waitForPendingWrites, where } from '@angular/fire/firestore';
import { COLLECTION_NAME, DbService, FIRST_COUNT_WAIT_MS, LIST_CHANGE_COUNT_WAIT_MS, WRITE_COUNT_WAIT_MS } from './db.service';

type Row = { id: string; name?: string };
type Change = 'added' | 'removed' | 'modified';

const snapshot = (rows: Row[], changes: Change[] = []) => ({
    docs: rows.map((row) => ({ id: row.id, data: () => row })),
    docChanges: () => changes.map((type) => ({ type })),
});
const counts = (count: number) => ({ data: () => ({ count }) });
const count = vi.mocked(getCountFromServer);

describe('DbService.getAll: the total of a list', () => {
    let service: DbService<any>;
    let reading: Subscription | undefined;
    let totals: number[];

    /** Opens a list, and answers its first read with `rows`. */
    const open = async (rows: Row[] = [{ id: 'a' }, { id: 'b' }], params: Record<string, unknown> = {}) => {
        reading = service.getAll({ limitCount: 2, currentPageNumber: 0, previousPageNumber: -1, ...params }).subscribe((result) => {
            totals.push(result.totalCount);
        });
        fire.next(snapshot(rows));
        await vi.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        totals = [];
        count.mockResolvedValue(counts(300) as never);
        TestBed.configureTestingModule({
            providers: [
                DbService,
                { provide: Firestore, useValue: {} },
                { provide: COLLECTION_NAME, useValue: 'items' },
                { provide: PLATFORM_ID, useValue: 'browser' },
            ],
        });
        service = TestBed.inject(DbService);
    });

    afterEach(() => {
        reading?.unsubscribe();
        reading = undefined;
        vi.useRealTimers();
    });

    it('comes from one aggregate count, and only the page itself is read live', async () => {
        await open();

        expect(totals).toEqual([300]);
        expect(count).toHaveBeenCalledTimes(1);
        // The page's listener and nothing else: no listener over every matching record.
        expect(onSnapshot).toHaveBeenCalledTimes(1);
    });

    it('counts what the list filters on, without its page size', async () => {
        await open(undefined, { whereConditions: [{ field: 'status', operator: '==', value: 'live' }] });

        expect(where).toHaveBeenCalledWith('status', '==', 'live');
        const counted = count.mock.calls[0][0] as unknown as { constraints: unknown[] };
        expect(counted.constraints).toEqual([{ where: ['status', '==', 'live'] }]);
    });

    it('reads again when a record arrives on the page', async () => {
        await open();
        count.mockResolvedValue(counts(301) as never);

        fire.next(snapshot([{ id: 'new' }, { id: 'a' }], ['added', 'removed']));
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS);

        expect(count).toHaveBeenCalledTimes(2);
        expect(totals.at(-1)).toBe(301);
    });

    it('reads again when a record leaves the page', async () => {
        await open();
        count.mockResolvedValue(counts(299) as never);

        fire.next(snapshot([{ id: 'a' }], ['removed']));
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS);

        expect(totals.at(-1)).toBe(299);
    });

    it('does not count again for an edit in place', async () => {
        await open();

        fire.next(snapshot([{ id: 'a', name: 'edited' }, { id: 'b' }], ['modified']));
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS * 2);

        expect(count).toHaveBeenCalledTimes(1);
    });

    it('reads at once for the first change, then at most once per wait while a list keeps changing', async () => {
        await open();

        fire.next(snapshot([{ id: 'new' }, { id: 'a' }], ['added', 'removed']));
        await vi.advanceTimersByTimeAsync(0);
        expect(count).toHaveBeenCalledTimes(2);

        for (let i = 0; i < 9; i++) {
            fire.next(snapshot([{ id: `new-${i}` }, { id: 'a' }], ['added', 'removed']));
            await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS / 10);
        }
        expect(count).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS / 10);
        expect(count).toHaveBeenCalledTimes(3);
    });

    it('waits for this device\'s writes to reach the server before counting', async () => {
        await open();
        let confirmed = () => undefined as void;
        vi.mocked(waitForPendingWrites).mockReturnValueOnce(new Promise<void>((resolve) => { confirmed = resolve; }));
        count.mockResolvedValue(counts(301) as never);

        fire.next(snapshot([{ id: 'new' }, { id: 'a' }], ['added', 'removed']));
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS);
        expect(count).toHaveBeenCalledTimes(1);

        confirmed();
        await vi.advanceTimersByTimeAsync(0);
        expect(count).toHaveBeenCalledTimes(2);
        expect(totals.at(-1)).toBe(301);
    });

    it.each([
        ['add', () => service.add({ name: 'x' } as never)],
        ['addBatch', () => service.addBatch([{ name: 'x' } as never])],
        ['delete', () => service.delete('a')],
    ])('reads again after %s, even when the record is not on the page', async (_name, write) => {
        await open();
        count.mockResolvedValue(counts(301) as never);

        write().subscribe();
        await vi.advanceTimersByTimeAsync(WRITE_COUNT_WAIT_MS);

        expect(count).toHaveBeenCalledTimes(2);
        expect(totals.at(-1)).toBe(301);
    });

    it('shares one read between writes made together', async () => {
        await open();

        service.delete('a').subscribe();
        service.delete('b').subscribe();
        await vi.advanceTimersByTimeAsync(WRITE_COUNT_WAIT_MS * 2);

        expect(count).toHaveBeenCalledTimes(2);
    });

    it('reads once for this device\'s own delete: the server confirms it, and the page hears just after', async () => {
        await open();

        service.delete('a').subscribe();
        await vi.advanceTimersByTimeAsync(0);
        fire.next(snapshot([{ id: 'b' }], ['removed']));
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS * 2);

        expect(count).toHaveBeenCalledTimes(2);
    });

    it('reads again when the page heard of a write before the server confirmed it, since that count could miss it', async () => {
        await open();

        fire.next(snapshot([{ id: 'new' }, { id: 'a' }], ['added', 'removed']));
        await vi.advanceTimersByTimeAsync(0);
        service.add({ name: 'x' } as never).subscribe();
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS * 2);

        expect(count).toHaveBeenCalledTimes(3);
    });

    it('reads again for a change that comes in after the read for a write', async () => {
        await open();

        service.delete('a').subscribe();
        await vi.advanceTimersByTimeAsync(WRITE_COUNT_WAIT_MS);
        expect(count).toHaveBeenCalledTimes(2);

        fire.next(snapshot([{ id: 'c' }, { id: 'b' }], ['added']));
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS);

        expect(count).toHaveBeenCalledTimes(3);
    });

    it('keeps the newest answer when an older count comes back last', async () => {
        await open();
        let older = (_value: unknown) => undefined as void;
        count.mockReturnValueOnce(new Promise((resolve) => { older = resolve; }) as never);
        count.mockResolvedValue(counts(305) as never);

        service.delete('a').subscribe();
        await vi.advanceTimersByTimeAsync(WRITE_COUNT_WAIT_MS);
        service.delete('b').subscribe();
        await vi.advanceTimersByTimeAsync(WRITE_COUNT_WAIT_MS);
        older(counts(299));
        await vi.advanceTimersByTimeAsync(0);

        expect(totals.at(-1)).toBe(305);
    });

    it('keeps the last total when a later count fails', async () => {
        await open();
        count.mockRejectedValue(new Error('unavailable'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        service.delete('a').subscribe();
        await vi.advanceTimersByTimeAsync(WRITE_COUNT_WAIT_MS);

        expect(totals.at(-1)).toBe(300);
    });

    it('stays 0 beside rows when no count has answered, which the store takes for no answer', async () => {
        count.mockRejectedValue(new Error('unavailable'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await open();

        expect(totals).toEqual([0]);
    });

    it('does not hold back rows the device already has while the count hangs', async () => {
        count.mockReturnValue(new Promise(() => undefined) as never);

        await open();
        expect(totals).toEqual([]);

        await vi.advanceTimersByTimeAsync(FIRST_COUNT_WAIT_MS);
        expect(totals).toEqual([0]);
    });

    it('shows the count when it arrives after the rows stopped waiting', async () => {
        let answer = (_value: unknown) => undefined as void;
        count.mockReturnValue(new Promise((resolve) => { answer = resolve; }) as never);

        await open();
        await vi.advanceTimersByTimeAsync(FIRST_COUNT_WAIT_MS);
        answer(counts(300));
        await vi.advanceTimersByTimeAsync(0);

        expect(totals).toEqual([0, 300]);
    });

    it('stops reading when the list is closed', async () => {
        await open();
        reading!.unsubscribe();

        service.delete('a').subscribe();
        await vi.advanceTimersByTimeAsync(LIST_CHANGE_COUNT_WAIT_MS * 2);

        expect(count).toHaveBeenCalledTimes(1);
        expect(fire.stop).toHaveBeenCalled();
    });
});
