/**
 * The order entries are shown in (SS2 in specs/site-sections-spec.md): this
 * file is the source and functions/src/shared/display-order.ts its mirror.
 */
import { describe, it, expect } from 'vitest';
import { entryOrderOf, sortForDisplay, timeOf } from './display-order';
import * as published from '../../../../functions/src/shared/display-order';

const day = (n: number) => ({ seconds: 1767600000 + n * 86400 });

const ENTRIES = [
    { id: 'a', publishedOn: day(1) },
    { id: 'b', publishedOn: day(3), sortOrder: 2 },
    { id: 'c', publishedOn: day(2), sortOrder: 1 },
    { id: 'd', publishedOn: day(5) },
    { id: 'e', publishedOn: day(4), sortOrder: 2 },
];

const ids = (entries: { id: string }[]) => entries.map((e) => e.id);

describe('display order', () => {
    it('is newest first unless the type is in its own order', () => {
        expect(entryOrderOf({ entryOrder: 'manual' })).toBe('manual');
        expect(entryOrderOf({})).toBe('newest');
        expect(entryOrderOf(null)).toBe('newest');
        expect(entryOrderOf({ entryOrder: 'something' })).toBe('newest');
        expect(ids(sortForDisplay(ENTRIES, 'newest'))).toEqual(['d', 'e', 'b', 'c', 'a']);
    });

    it('in its own order: numbered first, ties newest first, then the rest oldest first', () => {
        // c (1), then e and b (both 2, e published later), then a and d unnumbered, oldest first.
        expect(ids(sortForDisplay(ENTRIES, 'manual'))).toEqual(['c', 'e', 'b', 'a', 'd']);
    });

    it('ignores a sortOrder that is not a number', () => {
        const entries = [{ id: 'x', publishedOn: day(1), sortOrder: '1' }, { id: 'y', publishedOn: day(2), sortOrder: 5 }];
        expect(ids(sortForDisplay(entries, 'manual'))).toEqual(['y', 'x']);
    });

    it('sorts by another time when asked, and leaves the input alone', () => {
        const drafts = [{ id: 'p', createdAt: day(2) }, { id: 'q', createdAt: day(1) }];
        expect(ids(sortForDisplay(drafts, 'newest', (d) => d.createdAt))).toEqual(['p', 'q']);
        expect(ids(drafts)).toEqual(['p', 'q']);
    });

    it('reads every kind of time', () => {
        expect(timeOf({ toMillis: () => 5 })).toBe(5);
        expect(timeOf({ seconds: 2 })).toBe(2000);
        expect(timeOf({ _seconds: 3 })).toBe(3000);
        expect(timeOf(new Date(7))).toBe(7);
        expect(timeOf('1970-01-01T00:00:00.009Z')).toBe(9);
        expect(timeOf(undefined)).toBe(0);
        expect(timeOf('not a date')).toBe(0);
    });

    it('matches the copy publishing uses', () => {
        for (const order of ['newest', 'manual'] as const) {
            expect(ids(published.sortForDisplay(ENTRIES, order))).toEqual(ids(sortForDisplay(ENTRIES, order)));
        }
        expect(published.entryOrderOf({ entryOrder: 'manual' })).toBe('manual');
        expect(published.timeOf({ seconds: 2 })).toBe(timeOf({ seconds: 2 }));
    });
});
