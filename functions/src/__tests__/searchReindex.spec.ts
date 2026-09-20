/**
 * The reindex tool: admin only, walks every collection of a source, writes
 * every entry and deletes the orphans.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) { super(message); this.code = code; }
    }
    return { onCall: vi.fn((...args: unknown[]) => (args.length === 2 ? args[1] : args[0])), HttpsError };
});

const batch = { set: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
const state = {
    collections: {} as Record<string, { id: string; data: Record<string, unknown> }[]>,
    indexDocs: [] as { id: string; source: string; collection: string }[],
    settingsWrites: [] as unknown[],
};

vi.mock('../init.js', () => ({
    db: {
        listCollections: async () => Object.keys(state.collections).map(id => ({ id })),
        batch: () => batch,
        collection: (name: string) => {
            if (name === 'Settings') {
                return { doc: () => ({ set: async (data: unknown) => { state.settingsWrites.push(data); } }) };
            }
            if (name === 'ContentTypes') {
                return { get: async () => ({ docs: [
                    { id: 'ct1', data: () => ({ slug: 'articles', name: 'Articles', fields: [], hasPublicUrl: true }) },
                ] }) };
            }
            if (name === 'SearchIndex') {
                const filters: [string, unknown][] = [];
                const q = {
                    where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return q; },
                    get: async () => ({
                        docs: state.indexDocs
                            .filter(d => filters.every(([f, v]) => (d as unknown as Record<string, unknown>)[f] === v))
                            .map(d => ({ id: d.id, ref: `ref:${d.id}` })),
                    }),
                    doc: (id: string) => ({ id }),
                };
                return q;
            }
            const docs = state.collections[name] ?? [];
            const q = {
                orderBy: () => q,
                limit: () => q,
                startAfter: () => q,
                get: async () => ({
                    empty: docs.length === 0,
                    size: docs.length,
                    docs: docs.map(d => ({ id: d.id, data: () => d.data, ref: {} })),
                }),
                doc: () => ({ collection: () => ({ get: async () => ({ docs: [] }) }) }),
            };
            return q;
        },
    },
    owner: { getUser: vi.fn().mockResolvedValue({ customClaims: {} }) },
}));

vi.mock('../shared/site-settings.js', () => ({
    getLocalizationSettings: async () => ({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }] }),
}));

import { reindexSearch, reindexSource, runReindex, collectionsFor } from '../search/reindexSearch.js';
import { contentSource } from '../search/sources/content.js';
import { contentDraftsSource } from '../search/sources/content-drafts.js';

type Handler = (request: { data: unknown; auth?: { uid: string; token: Record<string, unknown> } }) => Promise<unknown>;
const handler = reindexSearch as unknown as Handler;

beforeEach(() => {
    batch.set.mockClear();
    batch.delete.mockClear();
    batch.commit.mockClear();
    state.collections = {
        arc_articles: [{ id: 'p1', data: { title: 'Published One', urlSlug: 'one', publishedOn: { seconds: 5 } } }],
        arc_articles_drafts: [
            { id: 'p1', data: { title: 'Published One', urlSlug: 'one', publishedStatus: true } },
            { id: 'd2', data: { title: 'Draft Two', urlSlug: 'two' } },
        ],
        EmailLogs: [{ id: 'e', data: {} }],
    };
    state.indexDocs = [
        { id: 'content-drafts:arc_articles_drafts:gone:en', source: 'content-drafts', collection: 'arc_articles_drafts' },
    ];
    state.settingsWrites = [];
});

describe('collectionsFor', () => {
    it('lists the collections a pattern source spans', async () => {
        expect(await collectionsFor(contentDraftsSource)).toEqual(['arc_articles_drafts']);
        expect(await collectionsFor(contentSource)).toEqual(['arc_articles']);
    });
});

describe('reindexSource', () => {
    it('writes every entry and removes orphans', async () => {
        const result = await reindexSource(contentDraftsSource);
        expect(result).toMatchObject({ source: 'content-drafts', documents: 2, entries: 2, removed: 1 });
        expect(batch.set).toHaveBeenCalledTimes(2);
        expect(batch.set.mock.calls.map(call => call[0].id).sort()).toEqual([
            'content-drafts:arc_articles_drafts:d2:en',
            'content-drafts:arc_articles_drafts:p1:en',
        ]);
        expect(batch.delete).toHaveBeenCalledWith('ref:content-drafts:arc_articles_drafts:gone:en');
    });

    it('builds published entries with public links and badges', async () => {
        await reindexSource(contentSource);
        const entry = batch.set.mock.calls[0][1];
        expect(entry).toMatchObject({
            source: 'content', scope: 'public', lang: 'en', title: 'Published One',
            link: '/articles/one', badge: 'Articles',
        });
        expect(entry.tokens).toContain('publ');
    });
});

describe('runReindex', () => {
    it('records per-source status in Settings/search_status', async () => {
        const results = await runReindex();
        expect(results.map(r => r.source)).toEqual(['content', 'content-drafts', 'products']);
        const write = state.settingsWrites[0] as Record<string, unknown>;
        expect(write['sources.content']).toMatchObject({ documents: 1, entries: 1 });
        expect(write['sources.content-drafts']).toMatchObject({ documents: 2, entries: 2 });
    });

    it('rejects an unknown source', async () => {
        await expect(runReindex({ source: 'nope' })).rejects.toMatchObject({ code: 'not-found' });
    });
});

describe('reindexSearch callable', () => {
    it('requires an authenticated admin', async () => {
        await expect(handler({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(handler({ data: {}, auth: { uid: 'u', token: {} } })).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('validates its arguments and runs for an admin', async () => {
        const admin = { uid: 'u', token: { role: 'admin' } };
        await expect(handler({ data: { source: 5 }, auth: admin })).rejects.toMatchObject({ code: 'invalid-argument' });
        const response = await handler({ data: { source: 'content' }, auth: admin }) as { results: { source: string }[] };
        expect(response.results.map(r => r.source)).toEqual(['content']);
    });
});
