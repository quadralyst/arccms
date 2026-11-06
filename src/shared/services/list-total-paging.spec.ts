/**
 * The store's paging on DbService's real total, over a fake Firestore where the rows and
 * the count arrive apart, as they do: the rows from a live read, the total from a count
 * read some time later. page-cursors.spec.ts covers the moves with both arriving together.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';

const fake = vi.hoisted(() => {
    class DocumentSnapshot {
        constructor(public id: string, public row: { id: string; n: number }) {}
        data() { return this.row; }
    }
    type Row = { id: string; n: number };
    type Listener = { q: { constraints: any[] }; next: (s: unknown) => void; shown: string[]; closed: boolean };
    const state = {
        list: [] as Row[],
        countMs: 100,
        countFails: false,
        countHangs: false,
        counts: 0,
        listeners: [] as Listener[],
    };
    const windowOf = (q: { constraints: any[] }): Row[] => {
        const all = q.constraints ?? [];
        const pick = (key: string) => all.find((c) => c[key] !== undefined)?.[key];
        let rows = state.list;
        const after = pick('startAfter');
        const before = pick('endBefore');
        if (after) rows = rows.filter((row) => row.n > after.row.n);
        if (before) rows = rows.filter((row) => row.n < before.row.n);
        if (pick('limit')) rows = rows.slice(0, pick('limit'));
        if (pick('limitToLast')) rows = rows.slice(-pick('limitToLast'));
        return rows;
    };
    const answer = (listener: Listener, first: boolean) => {
        const rows = windowOf(listener.q);
        const ids = rows.map((row) => row.id);
        const changes = [
            ...ids.filter((id) => !listener.shown.includes(id)).map(() => ({ type: 'added' })),
            ...listener.shown.filter((id) => !ids.includes(id)).map(() => ({ type: 'removed' })),
        ];
        if (!first && !changes.length) return;
        listener.shown = ids;
        listener.next({ docs: rows.map((row) => new DocumentSnapshot(row.id, row)), docChanges: () => changes });
    };
    /** Every open read hears of the list as it now is. */
    const push = () => state.listeners.filter((l) => !l.closed).forEach((l) => answer(l, false));
    return { DocumentSnapshot, state, answer, push };
});

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    DocumentReference: class {},
    DocumentSnapshot: fake.DocumentSnapshot,
    collection: vi.fn(() => ({ path: 'things', constraints: [] })),
    doc: vi.fn((_ref: unknown, id: string) => ({ id, path: `things/${id}` })),
    where: vi.fn(() => ({ where: true })),
    orderBy: vi.fn(() => ({ orderBy: true })),
    limit: vi.fn((count: number) => ({ limit: count })),
    limitToLast: vi.fn((count: number) => ({ limitToLast: count })),
    startAfter: vi.fn((doc: unknown) => ({ startAfter: doc })),
    endBefore: vi.fn((doc: unknown) => ({ endBefore: doc })),
    query: vi.fn((ref: { constraints?: unknown[] }, ...constraints: unknown[]) => ({ constraints: [...(ref.constraints ?? []), ...constraints] })),
    waitForPendingWrites: vi.fn(() => Promise.resolve()),
    getCountFromServer: vi.fn(() => {
        fake.state.counts++;
        if (fake.state.countHangs) return new Promise(() => undefined);
        return new Promise((resolve, reject) => setTimeout(() => {
            if (fake.state.countFails) reject(new Error('unavailable'));
            else resolve({ data: () => ({ count: fake.state.list.length }) });
        }, fake.state.countMs));
    }),
    // The write is confirmed first, and the live read hears of it just after.
    runTransaction: vi.fn(async (_db: unknown, work: (t: unknown) => Promise<unknown>) => {
        const gone: string[] = [];
        const result = await work({
            get: async () => ({ exists: () => true }),
            delete: (ref: { id: string }) => gone.push(ref.id),
            update: () => undefined,
            set: () => undefined,
        });
        fake.state.list = fake.state.list.filter((row) => !gone.includes(row.id));
        setTimeout(fake.push, 20);
        return result;
    }),
    onSnapshot: vi.fn((q: { constraints: any[] }, next: (s: unknown) => void) => {
        const listener = { q, next, shown: [] as string[], closed: false };
        fake.state.listeners.push(listener);
        setTimeout(() => { if (!listener.closed) fake.answer(listener, true); }, 10);
        return () => { listener.closed = true; };
    }),
}));

import { COLLECTION_NAME, DbService, FIRST_COUNT_WAIT_MS } from './db.service';
import { createGenericStore } from './generic-store.service';
import { AuthState } from '../../app/pages/(auth)/auth.store';

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${i + 1}`, n: i + 1 }));
const ListStore = createGenericStore<any>(DbService as any);

describe('paging on a total that arrives after the rows', () => {
    let store: InstanceType<typeof ListStore>;
    /** Long enough for a read, its count and any correction to settle, and short of the wait between counts on a changing list. */
    const settle = () => vi.advanceTimersByTimeAsync(1000);
    const ask = async (page: number) => {
        void store.getAll({ limitCount: 10, currentPageNumber: page, previousPageNumber: page - 1, orderByField: 'n', orderByDirection: 'asc', whereConditions: [] });
        await settle();
    };
    const ids = () => (store.items() as { id: string }[]).map((row) => row.id);
    const someoneElse = async (list: { id: string; n: number }[]) => {
        fake.state.list = list;
        fake.push();
        await settle();
    };
    const remove = async (id: string) => {
        store.delete(id).subscribe();
        await settle();
    };

    beforeEach(() => {
        vi.useFakeTimers();
        Object.assign(fake.state, { list: rows(23), countMs: 100, countFails: false, countHangs: false, counts: 0, listeners: [] });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        TestBed.configureTestingModule({
            providers: [
                DbService,
                { provide: COLLECTION_NAME, useValue: 'things' },
                { provide: Firestore, useValue: {} },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: AuthState, useValue: { currentUser: () => ({ id: 'u1' }) } },
            ],
        });
        store = TestBed.inject(ListStore);
    });

    afterEach(() => {
        store.unsubscribeStore();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('delete after Last', () => {
        it('the only record on the last page: the page before, whole', async () => {
            fake.state.list = rows(21);
            await ask(0);
            await ask(2);
            expect(ids()).toEqual(['r21']);

            await remove('r21');

            expect(store.currentPageNumber()).toBe(1);
            expect(ids()).toEqual(rows(20).slice(10).map((row) => row.id));
            expect(store.totalRecords()).toBe(20);
        });

        it('one of several: the rest, with no record of the page before', async () => {
            fake.state.list = rows(25);
            await ask(0);
            await ask(2);

            await remove('r25');

            expect(store.currentPageNumber()).toBe(2);
            expect(ids()).toEqual(['r21', 'r22', 'r23', 'r24']);
            expect(store.totalRecords()).toBe(24);
        });

        it('the page reads itself again straight after, as the tag pages do, on the total from before the delete', async () => {
            fake.state.list = rows(25);
            await ask(0);
            await ask(2);

            store.delete('r25').subscribe(() => void ask(2));
            await settle();

            expect(store.currentPageNumber()).toBe(2);
            expect(ids()).toEqual(['r21', 'r22', 'r23', 'r24']);
            expect(store.totalRecords()).toBe(24);
        });
    });

    it('delete of the only record on a last page reached by Next: the page before, not the first page', async () => {
        fake.state.list = rows(21);
        await ask(0);
        await ask(1);
        await ask(2);
        expect(ids()).toEqual(['r21']);

        await remove('r21');

        expect(store.currentPageNumber()).toBe(1);
        expect(ids()).toEqual(rows(20).slice(10).map((row) => row.id));
        expect(store.totalRecords()).toBe(20);
    });

    it('someone else deletes after Last: corrected as soon as the count answers, not at the next wait', async () => {
        fake.state.list = rows(25);
        await ask(0);
        await ask(2);

        await someoneElse(rows(24));

        expect(ids()).toEqual(['r21', 'r22', 'r23', 'r24']);
        expect(store.totalRecords()).toBe(24);
    });

    it('the list grows after Last: still the last page, of the list as it now is', async () => {
        fake.state.list = rows(30);
        await ask(0);
        await ask(2);

        await someoneElse(rows(32));

        expect(store.currentPageNumber()).toBe(3);
        expect(ids()).toEqual(['r31', 'r32']);
        expect(store.totalRecords()).toBe(32);
    });

    it('a delete off the page on screen updates the total and leaves the page alone', async () => {
        await ask(0);
        await ask(1);

        await remove('r1');

        expect(store.currentPageNumber()).toBe(1);
        expect(store.totalRecords()).toBe(22);
    });

    describe('a count with no answer says nothing about the page', () => {
        const toPageTwoThen = async (trouble: () => void) => {
            await ask(0);
            await ask(1);
            trouble();
            await ask(2);
        };

        it('a failed count on a move stays on that page and keeps the total', async () => {
            await toPageTwoThen(() => { fake.state.countFails = true; });

            expect(store.currentPageNumber()).toBe(2);
            expect(ids()).toEqual(['r21', 'r22', 'r23']);
            expect(store.totalRecords()).toBe(23);
        });

        it('a slow count on a move stays on that page and keeps the total, then answers', async () => {
            await toPageTwoThen(() => { fake.state.countMs = FIRST_COUNT_WAIT_MS + 2000; });
            await vi.advanceTimersByTimeAsync(FIRST_COUNT_WAIT_MS);

            expect(store.currentPageNumber()).toBe(2);
            expect(ids()).toEqual(['r21', 'r22', 'r23']);
            expect(store.totalRecords()).toBe(23);

            fake.state.list = rows(24);
            await vi.advanceTimersByTimeAsync(2000);
            expect(store.currentPageNumber()).toBe(2);
            expect(store.totalRecords()).toBe(24);
        });

        it('a count that never answers does not hold back the first page, which counts the rows it has', async () => {
            fake.state.countHangs = true;
            await ask(0);
            expect(ids()).toEqual([]);

            await vi.advanceTimersByTimeAsync(FIRST_COUNT_WAIT_MS);
            expect(ids()).toHaveLength(10);
            expect(store.totalRecords()).toBe(10);
        });

        it('an emptied list is empty, not its old total', async () => {
            await ask(0);
            fake.state.countFails = true;

            await someoneElse([]);
            await ask(0);

            expect(ids()).toEqual([]);
            expect(store.totalRecords()).toBe(0);
        });
    });

    it('one delete reads the total once', async () => {
        fake.state.list = rows(25);
        await ask(0);
        await ask(1);
        const before = fake.state.counts;

        await remove('r11');
        await vi.advanceTimersByTimeAsync(10000);

        expect(fake.state.counts - before).toBe(1);
    });
});
