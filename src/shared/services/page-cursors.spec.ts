/**
 * Where a page of a list is read from (page-cursors.ts), and the store that uses it, on a
 * fake list that answers cursors as Firestore does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { createGenericStore, followLandedPage } from './generic-store.service';
import { PageCursors, pageQueryShape } from './page-cursors';
import { AuthState } from '../../app/pages/(auth)/auth.store';
import { DbService } from './db.service';

interface Row { id: string }
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}` }));

/** Cursors, limits and counts as Firestore answers them. */
@Injectable({ providedIn: 'root' })
class FakeList {
    list: Row[] = rows(23);
    getAll = vi.fn((q: any): Observable<any> => {
        const { list } = this;
        let page: Row[];
        if (q.startAfterDoc) page = list.slice(list.indexOf(q.startAfterDoc) + 1, list.indexOf(q.startAfterDoc) + 1 + q.limitCount);
        else if (q.endBeforeDoc) page = list.slice(Math.max(0, list.indexOf(q.endBeforeDoc) - q.limitCount), list.indexOf(q.endBeforeDoc));
        else if (q.lastCount) page = list.slice(-q.lastCount);
        else page = list.slice(0, q.limitCount);
        return of({ collectionData: page, totalCount: list.length, firstVisible: page[0] ?? null, lastVisible: page.at(-1) ?? null });
    });
}

const ListStore = createGenericStore<any>(FakeList as unknown as typeof DbService as any);

describe('a list read page by page, by whatever move', () => {
    let list: FakeList;
    let store: InstanceType<typeof ListStore>;
    const ask = (page: number, extra: Record<string, unknown> = {}) =>
        store.getAll({ limitCount: 10, currentPageNumber: page, previousPageNumber: page - 1, orderByField: 'createdAt', orderByDirection: 'desc', whereConditions: [], ...extra });
    const first = () => (store.items()[0] as Row | undefined)?.id;

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
        await Promise.resolve();
        expect(first()).toBe('r11');
        expect(store.currentPageNumber()).toBe(1);
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
    const move = { shape: 'a', current: 0, firstVisible: 'f', lastVisible: 'l', total: 95, limit: 10, ordered: true };

    it('reads the last page from the end only when the query has an order', () => {
        const c = new PageCursors();
        c.landed('a');
        expect(c.plan({ ...move, target: 9 })).toEqual({ page: 9, read: { kind: 'fromEnd', count: 5 } });
        const unordered = new PageCursors();
        unordered.landed('a');
        expect(unordered.plan({ ...move, target: 9, ordered: false })).toEqual({ page: 0, read: { kind: 'first' } });
    });

    it('never uses a cursor of another list', () => {
        const c = new PageCursors();
        c.landed('other');
        expect(c.plan({ ...move, target: 1 })).toEqual({ page: 0, read: { kind: 'first' } });
    });

    it('tells lists apart by filter, order and size, not by page', () => {
        const q = { whereConditions: [{ field: 'status', operator: '==', value: 'a' }], orderByField: 'createdAt', orderByDirection: 'desc', limitCount: 10 };
        expect(pageQueryShape(q)).toBe(pageQueryShape({ ...q }));
        expect(pageQueryShape(q)).not.toBe(pageQueryShape({ ...q, limitCount: 25 }));
        expect(pageQueryShape(q)).not.toBe(pageQueryShape(q, 'blog'));
    });
});
