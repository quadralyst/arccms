/**
 * Page text's draft and published copy (pages/page-text-store.ts,
 * specs/visual-editing-spec.md VE-D39 and VE-D57).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { docs, batchSets, mockCommit, updates } = vi.hoisted(() => ({
    updates: [] as Array<[string, Record<string, unknown>]>,
    docs: new Map<string, Record<string, unknown> | Error>(),
    batchSets: [] as Array<[string, Record<string, unknown>]>,
    mockCommit: vi.fn(async () => undefined),
}));

function docRef(path: string): any {
    return {
        path,
        update: async (data: Record<string, unknown>) => { updates.push([path, data]); },
        get: async () => {
            const data = docs.get(path);
            if (data instanceof Error) throw data;
            return { exists: !!data, data: () => data };
        },
        collection: (name: string) => ({ doc: (id = 'auto') => docRef(`${path}/${name}/${id}`) }),
    };
}

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
        // Everything in one transaction, which commits once.
        runTransaction: async (fn: any) => {
            await fn({
                get: (ref: any) => ref.get(),
                set: (ref: { path: string }, data: Record<string, unknown>) => batchSets.push([ref.path, data]),
                update: (ref: { path: string }, data: Record<string, unknown>) => updates.push([ref.path, data]),
            });
            await mockCommit();
        },
    },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TIME', delete: () => 'DELETED' } }));

import { loadPublishedPageText, markPageTextUnreleased, pageOfPageTextId, pageTextValuesOf, publishPageTextDraft } from '../pages/page-text-store.js';

describe('page text store', () => {
    beforeEach(() => {
        docs.clear();
        batchSets.length = 0;
        updates.length = 0;
        vi.clearAllMocks();
    });

    it('keeps one History entry per queue item, and a copy that did not go live says no draft', async () => {
        docs.set('SitePageTextDrafts/home', { text: {}, updatedAt: 'T1' });
        await publishPageTextDraft('home', 'queue-1');
        expect(batchSets[1][0]).toBe('SitePageText/home/History/queue-1');
        await markPageTextUnreleased('p-about');
        expect(updates).toEqual([['SitePageText/p-about', { draftUpdatedAt: null }]]);
    });

    it('publishes the draft\'s values, whole, with its history copy', async () => {
        docs.set('SitePageTextDrafts/home', {
            text: { en: { hero: { value: 'Hi' } } }, urls: { photo: { value: '/a.jpg' } }, seo: {}, shareImage: { value: '/s.jpg' },
            updatedAt: 'T1', updatedBy: 'editor-uid', stray: 'never published',
        });
        await publishPageTextDraft('home');

        expect(batchSets.map(([path]) => path)).toEqual(['SitePageText/home', 'SitePageText/home/History/auto']);
        expect(batchSets[0][1]).toEqual({
            text: { en: { hero: { value: 'Hi' } } }, urls: { photo: { value: '/a.jpg' } }, seo: {}, shareImage: { value: '/s.jpg' },
            publishedAt: 'SERVER_TIME', draftUpdatedAt: 'T1',
        });
        expect(batchSets[1][1]).toMatchObject({ publishedBy: 'editor-uid', draftUpdatedAt: 'T1' });
        expect(mockCommit).toHaveBeenCalledTimes(1);
    });

    it('puts no account id or saved-against text in the copy anyone reads, and keeps them in History', async () => {
        const hero = { value: 'Hi', by: 'editor-uid', at: 'T0', fileText: 'Hello', sourceText: 'Hey' };
        docs.set('SitePageTextDrafts/home', {
            text: { hi: { hero } }, urls: { photo: { value: '/a.jpg', by: 'editor-uid' } },
            seo: { en: { title: { value: 'T', by: 'editor-uid' } } }, shareImage: { value: '/s.jpg', by: 'editor-uid' },
            updatedAt: 'T1', updatedBy: 'editor-uid',
        });
        await publishPageTextDraft('home');
        expect(JSON.stringify(batchSets[0][1])).not.toMatch(/editor-uid|fileText|sourceText|"by"|"at"/);
        expect(batchSets[0][1]).toMatchObject({ text: { hi: { hero: { value: 'Hi' } } }, seo: { en: { title: { value: 'T' } } } });
        expect((batchSets[1][1] as any).text.hi.hero).toEqual(hero);
    });

    it('never copies who holds the page (VE-D78), to the copy or its History', async () => {
        docs.set('SitePageTextDrafts/home', {
            text: { en: {} }, updatedAt: 'T1', updatedBy: 'editor-uid', editing: { by: 'priya-uid', name: 'Priya' },
        });
        await publishPageTextDraft('home');
        expect(JSON.stringify(batchSets)).not.toMatch(/priya|Priya|editing/);
    });

    it('lets go of the page in the same write, its updatedAt untouched, and writes nothing to a draft nobody holds', async () => {
        docs.set('SitePageTextDrafts/home', { text: {}, updatedAt: 'T1', editing: { by: 'priya-uid' } });
        await publishPageTextDraft('home');
        expect(updates).toEqual([['SitePageTextDrafts/home', { editing: 'DELETED' }]]);
        expect(mockCommit).toHaveBeenCalledTimes(1);
        updates.length = 0;
        docs.set('SitePageTextDrafts/home', { text: {}, updatedAt: 'T1' });
        await publishPageTextDraft('home');
        await publishPageTextDraft('p-no-draft');
        expect(updates).toEqual([]);
    });

    it('copies what is stored when the write lands, not what was read before someone saved', async () => {
        // The transaction runs again on a draft that changed under it, and reads it anew.
        docs.set('SitePageTextDrafts/home', { text: { en: { hero: { value: 'Old' } } }, updatedAt: 'T1' });
        const { db } = await import('../init.js') as any;
        const run = db.runTransaction;
        vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any) => {
            await fn({ get: (ref: any) => ref.get(), set: () => undefined, update: () => undefined });
            docs.set('SitePageTextDrafts/home', { text: { en: { hero: { value: 'New' } } }, updatedAt: 'T2', editing: { by: 'priya-uid' } });
            return run(fn);
        });
        await publishPageTextDraft('home');
        expect(batchSets[0][1]).toMatchObject({ text: { en: { hero: { value: 'New' } } }, draftUpdatedAt: 'T2' });
        expect(updates).toEqual([['SitePageTextDrafts/home', { editing: 'DELETED' }]]);
        vi.restoreAllMocks();
    });

    it('publishes no values when there is no draft, which brings the page back to its file', async () => {
        await publishPageTextDraft('p-about-us');
        expect(batchSets[0]).toEqual(['SitePageText/p-about-us', { publishedAt: 'SERVER_TIME', draftUpdatedAt: null }]);
    });

    it('reads the published values, and fails when they cannot be read, so no page goes out without them', async () => {
        docs.set('SitePageText/home', { text: { en: {} }, publishedAt: 'T' });
        expect(await loadPublishedPageText('home')).toEqual({ text: { en: {} } });
        expect(await loadPublishedPageText('p-x')).toBeNull();
        docs.set('SitePageText/p-y', new Error('offline'));
        await expect(loadPublishedPageText('p-y')).rejects.toThrow('offline');
    });

    it('keeps only the value fields, and only maps', () => {
        expect(pageTextValuesOf({ text: 'x', urls: [], seo: { en: {} }, other: 1 })).toEqual({ seo: { en: {} } });
        expect(pageTextValuesOf(undefined)).toEqual({});
    });

    it('tells the home page, a static page and a list page apart, and refuses anything else', () => {
        expect(pageOfPageTextId('home')).toEqual({ kind: 'home' });
        expect(pageOfPageTextId('p-about-us')).toEqual({ kind: 'static', name: 'about-us' });
        expect(pageOfPageTextId('list-articles')).toEqual({ kind: 'list', slug: 'articles' });
        expect(pageOfPageTextId('list-my_type-2')).toEqual({ kind: 'list', slug: 'my_type-2' });
        // A static page called list, and one called list-x, stay static pages.
        expect(pageOfPageTextId('p-list')).toEqual({ kind: 'static', name: 'list' });
        expect(pageOfPageTextId('p-list-x')).toEqual({ kind: 'static', name: 'list-x' });
        expect(pageOfPageTextId('list-')).toBeNull();
        expect(pageOfPageTextId('list-a/b')).toBeNull();
        expect(pageOfPageTextId('p-../x')).toBeNull();
        expect(pageOfPageTextId('about')).toBeNull();
    });
});
