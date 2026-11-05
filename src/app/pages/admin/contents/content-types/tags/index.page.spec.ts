import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import TagsComponent from './index.page';

describe('the tags list asks for the page it shows', () => {
    it('passes the page and its size to the store, under the names the store reads', () => {
        const ctx = {
            tagsStore: { getAll: vi.fn(), updateUsedColors: vi.fn() },
            pageSize: signal(25),
            currentPage: signal(2),
            sortField: signal('label'),
            sortDirection: signal('asc'),
            filters: signal({}),
        };
        (TagsComponent.prototype as any).fetchData.call(ctx);
        expect(ctx.tagsStore.getAll).toHaveBeenCalledWith(expect.objectContaining({ limitCount: 25, currentPageNumber: 2, previousPageNumber: 1 }));
    });
});
