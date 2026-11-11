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
            loadFailed: signal(false),
        };
        (TagsComponent.prototype as any).fetchData.call(ctx);
        expect(ctx.tagsStore.getAll).toHaveBeenCalledWith(expect.objectContaining({ limitCount: 25, currentPageNumber: 2, previousPageNumber: 1 }));
    });
});

// RF4 4.11: the question says how many entries use the tag; a failure says so.
describe('deleting a tag', () => {
    const ctx = (count: Promise<number>, deleted: unknown = { subscribe: (o: any) => o.next() }) => ({
        _contentTypeSlug: signal('blog'),
        draftContentsStore: { countWithTag: vi.fn(() => count) },
        transloco: { translate: vi.fn((key: string, params?: any) => `${key}|${JSON.stringify(params ?? {})}`) },
        dialog: { open: vi.fn(() => ({ afterClosed: () => ({ subscribe: (fn: any) => fn(true) }) })) },
        tagsStore: { delete: vi.fn(() => deleted) },
        notify: { error: vi.fn() },
        fetchData: vi.fn(),
    });
    const remove = (c: any) => (TagsComponent.prototype as any).deleteItem.call(c, { id: 't1', label: 'News <b>' });

    it('counts the entries of the type that use it, and escapes the label', async () => {
        const c = ctx(Promise.resolve(3));
        await remove(c);
        expect(c.draftContentsStore.countWithTag).toHaveBeenCalledWith('blog', 'News <b>');
        const message = (c.dialog.open.mock.calls[0] as any)[1].data.dialogMessage as string;
        expect(message).toContain('admin.contents.tags.delete_confirm_many');
        expect(message).toContain('"count":3');
        expect(message).toContain('News &lt;b&gt;');
        expect(c.tagsStore.delete).toHaveBeenCalledWith('t1');
    });

    it('says when none or one entry uses it, and still asks when the count fails', async () => {
        for (const [count, key] of [[0, 'none'], [1, 'one']] as const) {
            const c = ctx(Promise.resolve(count));
            await remove(c);
            expect((c.dialog.open.mock.calls[0] as any)[1].data.dialogMessage).toContain(`delete_confirm_${key}`);
        }
        const failed = ctx(Promise.reject(new Error('offline')));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await remove(failed);
        expect((failed.dialog.open.mock.calls[0] as any)[1].data.dialogMessage).toContain('delete_confirm_unknown');
    });

    it('shows the admin a message when the delete fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const c = ctx(Promise.resolve(0), { subscribe: (o: any) => o.error(new Error('denied')) });
        await remove(c);
        expect(c.notify.error).toHaveBeenCalledWith('admin.contents.tags.delete_failed');
        expect(c.fetchData).not.toHaveBeenCalled();
    });

    // RF4 review L10: counted in the tag's own content type, or not at all.
    it('counts in the tag\'s own type, and says it cannot tell without one', async () => {
        const c = ctx(Promise.resolve(2));
        await (TagsComponent.prototype as any).deleteItem.call(c, { id: 't1', label: 'News', contentTypeSlug: 'events' });
        expect(c.draftContentsStore.countWithTag).toHaveBeenCalledWith('events', 'News');

        const none = { ...ctx(Promise.resolve(2)), _contentTypeSlug: signal('') };
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await (TagsComponent.prototype as any).deleteItem.call(none, { id: 't2', label: 'News' });
        expect(none.draftContentsStore.countWithTag).not.toHaveBeenCalled();
        expect((none.dialog.open.mock.calls[0] as any)[1].data.dialogMessage).toContain('delete_confirm_unknown');
    });
});

