/**
 * A type's published entries in its display order (pages/published-entries.ts,
 * specs/site-sections-spec.md SS2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollection } = vi.hoisted(() => ({ mockCollection: vi.fn() }));
vi.mock('../init', () => ({ db: { collection: (...args: unknown[]) => mockCollection(...args) } }));

import { readPublishedInDisplayOrder } from '../pages/published-entries.js';

const day = (n: number) => ({ seconds: 1767600000 + n * 86400 });
const doc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

describe('readPublishedInDisplayOrder', () => {
    const orderBy = vi.fn();
    const limit = vi.fn();
    const getAll = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        limit.mockReturnValue({ get: async () => ({ docs: [doc('n1', { title: 'Newest', publishedOn: day(9) })] }) });
        orderBy.mockReturnValue({ limit });
        getAll.mockResolvedValue({ docs: [
            doc('a', { title: 'A', publishedOn: day(1) }),
            doc('b', { title: 'B', publishedOn: day(2), sortOrder: 2 }),
            doc('c', { title: 'C', publishedOn: day(3), sortOrder: 1 }),
        ] });
        mockCollection.mockReturnValue({ orderBy, get: getAll });
    });

    it('reads newest first with one limited query by default', async () => {
        const entries = await readPublishedInDisplayOrder('articles', { slug: 'articles' }, 100);
        expect(mockCollection).toHaveBeenCalledWith('arc_articles');
        expect(orderBy).toHaveBeenCalledWith('publishedOn', 'desc');
        expect(limit).toHaveBeenCalledWith(100);
        expect(getAll).not.toHaveBeenCalled();
        expect(entries).toEqual([{ id: 'n1', title: 'Newest', publishedOn: day(9) }]);
    });

    it('reads every entry and sorts them for a type in its own order, then cuts to the limit', async () => {
        const entries = await readPublishedInDisplayOrder('services', { entryOrder: 'manual' }, 2);
        expect(orderBy).not.toHaveBeenCalled();
        expect(entries.map((e) => e['id'])).toEqual(['c', 'b']);
        expect((await readPublishedInDisplayOrder('services', { entryOrder: 'manual' }, 10)).map((e) => e['id'])).toEqual(['c', 'b', 'a']);
    });
});
