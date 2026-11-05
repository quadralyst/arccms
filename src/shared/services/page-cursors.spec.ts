/**
 * Where a page of a list is read from (page-cursors.ts), and the store that uses it, on a
 * fake list that answers cursors as Firestore does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { map, Observable, startWith, Subject } from 'rxjs';
import { createGenericStore, followLandedPage } from './generic-store.service';
import { PageCursors, pageQueryShape } from './page-cursors';
import { AuthState } from '../../app/pages/(auth)/auth.store';
import { DbService } from './db.service';

interface Row { id: string }
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}` }));

/** Cursors, limits and counts as Firestore answers them, and answers again when the list changes, as a live read does. */
@Injectable({ providedIn: 'root' })
class FakeList {
    list: Row[] = rows(23);
    collection = 'things';
    countFails = false;
    readonly changed = new Subject<void>();
    getCollectionRef = () => ({ path: this.collection });
    getAll = vi.fn((q: any): Observable<any> => this.changed.pipe(startWith(undefined), map(() => this.answer(q))));

    private answer(q: any) {
        const { list } = this;
        let page: Row[];
        if (q.startAfterDoc) page = list.slice(list.indexOf(q.startAfterDoc) + 1, list.indexOf(q.startAfterDoc) + 1 + q.limitCount);
        else if (q.endBeforeDoc) page = list.slice(Math.max(0, list.indexOf(q.endBeforeDoc) - q.limitCount), list.indexOf(q.endBeforeDoc));
        else if (q.lastCount) page = list.slice(-q.lastCount);
        else page = list.slice(0, q.limitCount);
        return { collectionData: page, totalCount: this.countFails ? 0 : list.length, firstVisible: page[0] ?? null, lastVisible: page.at(-1) ?? null };
    }
}

/** Corrections wait a tick, so a live read's answer has settled first. */
const settled = () => new Promise((resolve) => setTimeout(resolve));

const ListStore = createGenericStore<any>(FakeList as unknown as typeof DbService as any);

describe('a list read page by page, by whatever move', () => {
    let list: FakeList;
    let store: InstanceType<typeof ListStore>;
    const ask = (page: number, extra: Record<string, unknown> = {}) =>
        store.getAll({ limitCount: 10, currentPageNumber: page, previousPageNumber: page - 1, orderByField: 'createdAt', orderByDirection: 'desc', whereConditions: [], ...extra });
    const first = () => (store.items()[0] as Row | undefined)?.id;
    const ids = () => (store.items() as Row[]).map((row) => row.id);

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [FakeList, { provide: AuthState, useValue: { currentUser: () => ({ id: 'u1' }) } }] });
        list = TestBed.inject(FakeList);
        store = TestBed.inject(ListStore);
    });

    it('walks forward and back, every tap on the page it says', async () => {
        await ask(0);
        await ask(1);
        expect(first()).toBe('r11');
        await ask(2);
        expect(first()).toBe('r21');
        await ask(1);
        expect(first()).toBe('r11');
        await ask(0);
        expect(first()).toBe('r1');
        expect(store.currentPageNumber()).toBe(0);
    });

    it('reads the same page again after a drawer closes, then Back still works (the "No user found" of the report)', async () => {
        await ask(0);
        await ask(1);
        await ask(2);
        await ask(2); // a drawer closed: the same page again
        expect(first()).toBe('r21');
        await ask(1);
        expect(first()).toBe('r11');
        expect(store.items()).toHaveLength(10);
    });

    it('Last lands on the real last page, and three taps back are each one page back', async () => {
        await ask(0);
        await ask(2); // Last, from the first page: 23 records, 10 a page
        expect(first()).toBe('r21');
        expect(store.items()).toHaveLength(3);
        await ask(1);
        expect(first()).toBe('r11');
        await ask(0);
        expect(first()).toBe('r1');
        await ask(1);
        expect(first()).toBe('r11');
    });

    it('a page it cannot reach (a number in an address after a reload) opens the first page, and says so', async () => {
        list.list = rows(100);
        await ask(5);
        expect(first()).toBe('r1');
        expect(store.currentPageNumber()).toBe(0);
    });

    it('another filter, sort or page size is another list: it opens on its first page', async () => {
        await ask(0);
        await ask(1);
        await ask(1, { limitCount: 5 });
        expect(first()).toBe('r1');
        expect(store.currentPageNumber()).toBe(0);
    });

    it('steps back when the last record of the last page has gone, rather than show an empty list', async () => {
        await ask(0);
        await ask(1);
        await ask(2);
        list.list = list.list.slice(0, 20);
        await ask(2);
        await settled();
        expect(first()).toBe('r11');
        expect(store.currentPageNumber()).toBe(1);
    });

    it('steps back to the page before, as it was, from a page the count promised and the list does not have', async () => {
        list.list = rows(20);
        await ask(0);
        await ask(1);
        // Records with no value in the sort field are counted and never listed.
        list.getAll.mockImplementationOnce(() => new Subject<any>().pipe(startWith({ collectionData: [], totalCount: 23, firstVisible: null, lastVisible: null })));
        await ask(2);
        await settled();
        expect(first()).toBe('r11');
        expect(store.currentPageNumber()).toBe(1);
    });

    describe('after Last, when the list changes', () => {
        it('deleting the only record on the last page lands on the page before, not past the end', async () => {
            list.list = rows(21);
            await ask(0);
            await ask(2);
            expect(ids()).toEqual(['r21']);

            list.list = list.list.slice(0, 20);
            list.changed.next();
            await settled();

            expect(store.currentPageNumber()).toBe(1);
            expect(first()).toBe('r11');
            expect(store.items()).toHaveLength(10);
        });

        it('deleting one of several shows the rest, with no record of the page before', async () => {
            list.list = rows(25);
            await ask(0);
            await ask(2);
            list.list = list.list.slice(0, 24);
            list.changed.next();
            await settled();
            expect(store.currentPageNumber()).toBe(2);
            expect(ids()).toEqual(['r21', 'r22', 'r23', 'r24']);
        });

        it('reads the same page again from the total as it is now', async () => {
            list.list = rows(25);
            await ask(0);
            await ask(2);
            list.list = list.list.slice(0, 23);
            await ask(2);
            await settled();
            expect(ids()).toEqual(['r21', 'r22', 'r23']);
        });

        it('stays the last page when the list grows', async () => {
            list.list = rows(25);
            await ask(0);
            await ask(2);
            list.list = rows(35);
            await ask(2);
            await settled();
            expect(store.currentPageNumber()).toBe(3);
            expect(ids()).toEqual(['r31', 'r32', 'r33', 'r34', 'r35']);
        });
    });

    it('moves from the records on screen, so what a new record pushes off a page is on the next one', async () => {
        await ask(0);
        await ask(1);
        await ask(0);
        // Newest first: three arrive, and page one now ends earlier than it did.
        list.list = [...rows(3).map((row) => ({ id: `new-${row.id}` })), ...list.list];
        list.changed.next();
        await ask(1);
        expect(first()).toBe('r8');
    });

    it('does not take a cursor from another collection, for a waitlist or content type with its own', async () => {
        await ask(0);
        await ask(1);
        list.collection = 'other-things';
        await ask(1);
        expect(store.currentPageNumber()).toBe(0);
        expect(first()).toBe('r1');
    });

    it('takes a failed count for no answer, not for an empty list', async () => {
        await ask(0);
        list.countFails = true;
        await ask(1);
        await settled();
        expect(store.currentPageNumber()).toBe(1);
        expect(first()).toBe('r11');
    });

    it('drops a correction once another read has been asked for', async () => {
        await ask(0);
        await ask(1);
        await ask(2);
        list.list = list.list.slice(0, 20);
        list.changed.next();
        await ask(0);
        await settled();
        expect(store.currentPageNumber()).toBe(0);
        expect(first()).toBe('r1');
    });

    it('a page can follow where the list landed', () => {
        const page = signal(5);
        const landed = signal(0);
        TestBed.runInInjectionContext(() => followLandedPage(landed, page));
        TestBed.tick();
        expect(page()).toBe(0);
        landed.set(2);
        TestBed.tick();
        expect(page()).toBe(2);
    });
});

describe('PageCursors', () => {
    const move = { shape: 'a', current: 1, firstVisible: 'f', lastVisible: 'l', total: 95, limit: 10, ordered: true };
    const onPageOne = () => {
        const c = new PageCursors();
        c.landed('a', { page: 1, read: { kind: 'after', cursor: 'old' } }, 10, 95, 10);
        return c;
    };

    it('reads the last page from the end only when the query has an order', () => {
        expect(onPageOne().plan({ ...move, target: 9 })).toEqual({ page: 9, read: { kind: 'fromEnd', count: 5 } });
        expect(onPageOne().plan({ ...move, target: 9, ordered: false })).toEqual({ page: 0, read: { kind: 'first' } });
    });

    it('reads the page on screen the way it was read, and its neighbours from the records on screen', () => {
        expect(onPageOne().plan({ ...move, target: 1 }).read).toEqual({ kind: 'after', cursor: 'old' });
        expect(onPageOne().plan({ ...move, target: 2 }).read).toEqual({ kind: 'after', cursor: 'l' });
        const backFromThree = onPageOne();
        backFromThree.landed('a', { page: 3, read: { kind: 'after', cursor: 'x' } }, 10, 95, 10);
        expect(backFromThree.plan({ ...move, current: 3, target: 2 }).read).toEqual({ kind: 'before', cursor: 'f' });
    });

    it('never uses a cursor of another list', () => {
        const c = new PageCursors();
        c.landed('other', { page: 1, read: { kind: 'after', cursor: 'x' } }, 10, 95, 10);
        expect(c.plan({ ...move, target: 2 })).toEqual({ page: 0, read: { kind: 'first' } });
    });

    it('says which page to read instead when the list has changed under a page', () => {
        const at = (page: number, rows: number, total: number, read: any = { kind: 'first' }) => new PageCursors().landed('a', { page, read }, rows, total, 10);
        expect(at(0, 0, 0)).toBeNull();
        expect(at(3, 10, 40)).toBeNull();
        expect(at(3, 0, 40)).toBe(2);
        expect(at(4, 1, 40)).toBe(3);
        expect(at(4, 1, 0)).toBeNull();
        expect(at(2, 5, 25, { kind: 'fromEnd', count: 5 })).toBeNull();
        expect(at(2, 5, 24, { kind: 'fromEnd', count: 5 })).toBe(2);
    });

    it('tells lists apart by collection, filter, order and size, not by page', () => {
        const q = { whereConditions: [{ field: 'status', operator: '==', value: 'a' }], orderByField: 'createdAt', orderByDirection: 'desc', limitCount: 10 };
        expect(pageQueryShape(q)).toBe(pageQueryShape({ ...q }));
        expect(pageQueryShape(q)).not.toBe(pageQueryShape({ ...q, limitCount: 25 }));
        expect(pageQueryShape(q, 'tags_a')).not.toBe(pageQueryShape(q, 'tags_b'));
    });
});
