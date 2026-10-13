/**
 * Deleting a content type deletes its entries, but only when no other type uses
 * the same slug: the entries belong to the slug (arc_{slug}, arc_{slug}_drafts,
 * Tags_{slug}), and two types sharing one must not lose each other's entries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    // ContentTypes still in the database after the delete, as { id, slug }.
    types: [] as { id: string; slug: string }[],
    // Documents per collection name.
    docs: {} as Record<string, string[]>,
    deleted: [] as string[],
    removeCollectionEntries: vi.fn(async () => undefined),
}));

function docRef(path: string) {
    return {
        path,
        collection: (sub: string) => ({ get: async () => ({ docs: [] as unknown[] }) , path: `${path}/${sub}` }),
    };
}

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => ({
            where: (_field: string, _op: string, value: string) => ({
                get: async () => ({ docs: m.types.filter((t) => t.slug === value).map((t) => ({ id: t.id })) }),
            }),
            get: async () => {
                const ids = m.docs[name] ?? [];
                return { empty: ids.length === 0, docs: ids.map((id) => ({ id, ref: docRef(`${name}/${id}`) })) };
            },
        }),
        batch: () => ({
            delete: (ref: { path: string }) => m.deleted.push(ref.path),
            commit: async () => undefined,
        }),
    },
}));
vi.mock('../arc-config.js', () => ({ arcDocument: (path: string) => path }));
vi.mock('../feature-flags.js', () => ({ isFeatureOn: () => true }));
vi.mock('../search/writer.js', () => ({ removeCollectionEntries: m.removeCollectionEntries }));
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: (_opts: unknown, handler: unknown) => handler,
}));

import { onContentTypeDeleted } from '../content-types/onContentTypeDelete.js';

const handler = onContentTypeDeleted as unknown as (e: unknown) => Promise<void>;
const deleteEvent = (id: string, slug: string) => ({ params: { contentTypeId: id }, data: { data: () => ({ slug }) } });

describe('onContentTypeDeleted', () => {
    beforeEach(() => {
        m.types = [];
        m.deleted = [];
        m.docs = {
            arc_articles: ['a1'],
            arc_articles_drafts: ['a1', 'a2'],
            Tags_articles: ['t1'],
        };
        m.removeCollectionEntries.mockClear();
    });

    it('deletes the entries, drafts, tags and search entries of the only type with the slug', async () => {
        await handler(deleteEvent('ct-1', 'articles'));
        expect(m.deleted.sort()).toEqual([
            'Tags_articles/t1',
            'arc_articles/a1',
            'arc_articles_drafts/a1',
            'arc_articles_drafts/a2',
        ]);
        expect(m.removeCollectionEntries).toHaveBeenCalledWith('arc_articles');
        expect(m.removeCollectionEntries).toHaveBeenCalledWith('arc_articles_drafts');
    });

    it('keeps everything when another type still uses the slug', async () => {
        m.types = [{ id: 'ct-2', slug: 'articles' }];
        await handler(deleteEvent('ct-1', 'articles'));
        expect(m.deleted).toEqual([]);
        expect(m.removeCollectionEntries).not.toHaveBeenCalled();
    });

    it('is not fooled by the deleted type itself still being listed', async () => {
        m.types = [{ id: 'ct-1', slug: 'articles' }];
        await handler(deleteEvent('ct-1', 'articles'));
        expect(m.deleted).toHaveLength(4);
    });

    it('deletes when the other type has a different slug', async () => {
        m.types = [{ id: 'ct-2', slug: 'news' }];
        await handler(deleteEvent('ct-1', 'articles'));
        expect(m.deleted).toHaveLength(4);
    });

    it('does nothing for a type without a slug', async () => {
        await handler({ params: { contentTypeId: 'ct-1' }, data: { data: () => ({}) } });
        expect(m.deleted).toEqual([]);
    });
});
