/**
 * Search indexes only what is named (docs/feature-flags-spec.md, section 6):
 * content through the draft queue and the publish pipeline, and each collection
 * the app lists through its own trigger. Nothing watches every write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: vi.fn((path: string, handler: unknown) => Object.assign(handler as object, { path })),
}));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class HttpsError extends Error {},
}));

const indexDocument = vi.fn().mockResolvedValue(1);
vi.mock('../search/writer.js', () => ({ indexDocument: (...args: unknown[]) => indexDocument(...args) }));
vi.mock('../search/context.js', () => ({
    buildSearchContext: vi.fn(async (collection: string, docId: string) => ({
        collection, docId, localization: { defaultLanguage: 'en', enabledLanguages: [] }, contentTypes: new Map(),
    })),
    loadContentTypes: vi.fn(async () => new Map([
        ['articles', { id: 'a', slug: 'articles', name: 'Articles', hasPublicUrl: true, fields: [{ key: 'city', type: 'text' }], searchFields: ['city'] }],
        ['notes', { id: 'n', slug: 'notes', name: 'Notes', hasPublicUrl: false, fields: [] }],
    ])),
    clearSearchContextCache: vi.fn(),
}));

// The app named Lessons and added the ready-made products source in code.
vi.mock('../custom/search-sources.js', async () => {
    const { productsSource } = await import('../search/sources/products.js');
    return { SEARCH_COLLECTIONS: ['Lessons'], CUSTOM_SEARCH_SOURCES: [productsSource] };
});

const { setups, draftGet, queueDelete } = vi.hoisted(() => ({
    setups: { value: {} as Record<string, unknown> },
    draftGet: vi.fn(),
    queueDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../init.js', () => ({
    db: {
        collection: vi.fn((name: string) => ({
            doc: vi.fn(() => ({
                get: name === 'Settings'
                    ? vi.fn(async () => ({ data: () => ({ collections: setups.value }) }))
                    : draftGet,
            })),
        })),
    },
    owner: {},
}));

import { findSources, refreshSearchSources, searchSetupProblems, triggeredCollections } from '../search/registry.js';
import { syncDocument } from '../search/sync.js';
import { searchSync } from '../search/collectionTriggers.js';
import { onSearchQueued } from '../search/searchQueue.js';
import { buildCollectionSource, fillLink, validSetup } from '../search/collections.js';
import { canSetUp, collectionState, indexedFields, textFields } from '../search/adminCollections.js';
import { productsSource } from '../search/sources/products.js';

const LESSONS = { label: 'Lessons', fields: [{ path: 'title', weight: 'high' }, { path: 'summary', weight: 'normal' }], title: 'title', snippet: 'summary', link: '/admin/lessons/{id}', scope: 'admin' };

beforeEach(async () => {
    indexDocument.mockClear();
    draftGet.mockReset();
    queueDelete.mockClear();
    setups.value = {};
    await refreshSearchSources(true);
});

describe('what is searchable', () => {
    it('content, the code sources, and set-up collections; never logs', async () => {
        expect(findSources('arc_articles_drafts').map(s => s.id)).toEqual(['content-drafts']);
        expect(findSources('arc_articles').map(s => s.id)).toEqual(['content']);
        expect(findSources('Products').map(s => s.id)).toEqual(['products']);
        expect(findSources('EmailLogs')).toEqual([]);

        expect(findSources('Lessons')).toEqual([]);
        setups.value = { Lessons: LESSONS };
        await refreshSearchSources(true);
        expect(findSources('Lessons').map(s => s.id)).toEqual(['collection-Lessons']);
    });

    it('gives a trigger only to the named collections and the code sources', () => {
        expect(triggeredCollections()).toEqual(['Lessons', 'Products']);
        expect(Object.keys(searchSync)).toEqual(['Lessons', 'Products']);
        expect(JSON.stringify((searchSync['Lessons'] as unknown as { path: unknown }).path)).toContain('Lessons/{docId}');
    });
});

describe('searchSetupProblems', () => {
    it('refuses logs, queues and the index', () => {
        expect(searchSetupProblems(['EmailLogs'], [])[0]).toContain('EmailLogs can never be searchable');
        expect(searchSetupProblems(['_search_queue'], [])[0]).toContain('internal to Arc CMS');
        expect(searchSetupProblems(['form_otps', 'Settings'], []).join()).toContain('one-time codes');
        expect(searchSetupProblems([], [{ ...productsSource, collection: 'SearchIndex' }])[0]).toContain('the search index itself');
    });

    it('refuses names that are not plain, pattern sources with a trigger, and trigger clashes', () => {
        expect(searchSetupProblems(['a/b'], [])[0]).toContain('not a plain collection name');
        expect(searchSetupProblems([], [{ ...productsSource, collection: /^x/ }])[0]).toContain('watches a pattern');
        expect(searchSetupProblems([], [{ ...productsSource, collection: /^x/, trigger: false }])).toEqual([]);
        expect(searchSetupProblems(['a-b', 'a_b'], []).join()).toContain('would share the trigger');
    });

    it('accepts ordinary collections', () => {
        expect(searchSetupProblems(['Lessons', 'Products'], [])).toEqual([]);
    });
});

describe('syncDocument', () => {
    it('indexes a set-up collection with its setup, and removes on delete', async () => {
        setups.value = { Lessons: LESSONS };
        await refreshSearchSources(true);
        await syncDocument('Lessons', 'l1', { title: 'Fractions' });
        expect(indexDocument.mock.calls[0][0]).toMatchObject({ id: 'collection-Lessons', scope: 'admin', label: 'Lessons' });

        await syncDocument('Lessons', 'l1', null);
        expect(indexDocument.mock.calls[1][1]).toBeNull();
    });

    it('does nothing for a collection nobody set up', async () => {
        await syncDocument('Lessons', 'l1', { title: 'x' });
        expect(indexDocument).not.toHaveBeenCalled();
    });

    it('survives a failing source', async () => {
        indexDocument.mockRejectedValueOnce(new Error('boom'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(syncDocument('arc_articles_drafts', 'a1', { title: 'x' })).resolves.toBeUndefined();
        spy.mockRestore();
    });
});

describe('draft queue', () => {
    const handler = onSearchQueued as unknown as (e: unknown) => Promise<void>;
    const entry = (data: unknown) => ({ params: { id: 'q' }, data: { after: { exists: true, data: () => data, ref: { delete: queueDelete } } } });

    it('indexes the draft as it is now, then empties the entry', async () => {
        const draft = { title: 'Hello' };
        draftGet.mockResolvedValue({ exists: true, data: () => draft });
        await handler(entry({ collection: 'arc_articles_drafts', docId: 'a1' }));
        expect(indexDocument.mock.calls[0][0]).toMatchObject({ id: 'content-drafts' });
        expect(indexDocument.mock.calls[0][1]).toBe(draft);
        expect(queueDelete).toHaveBeenCalled();
    });

    it('removes a deleted draft', async () => {
        draftGet.mockResolvedValue({ exists: false });
        await handler(entry({ collection: 'arc_articles_drafts', docId: 'a1' }));
        expect(indexDocument.mock.calls[0][1]).toBeNull();
    });

    it('ignores an entry that names no draft, and its own delete', async () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await handler(entry({ collection: 'users', docId: 'u1' }));
        expect(indexDocument).not.toHaveBeenCalled();
        expect(queueDelete).toHaveBeenCalled();
        spy.mockRestore();

        await handler({ params: { id: 'q' }, data: { after: { exists: false } } });
        expect(indexDocument).not.toHaveBeenCalled();
    });
});

describe('collection setups', () => {
    it('needs fields, a title and a scope', () => {
        expect(validSetup(LESSONS)).toMatchObject({ title: 'title', scope: 'admin' });
        expect(validSetup({ ...LESSONS, fields: [] })).toBeNull();
        expect(validSetup({ ...LESSONS, title: '' })).toBeNull();
        expect(validSetup({ ...LESSONS, scope: 'everyone' })).toBeNull();
    });

    it('weighs high fields 3 with type-ahead, and fills the link', () => {
        const source = buildCollectionSource('Lessons', validSetup(LESSONS)!);
        expect(source.fields).toEqual([{ path: 'title', weight: 3, prefix: true }, { path: 'summary', weight: 1, prefix: false }]);
        expect(fillLink('/lessons/{id}/{slug}', { slug: 'a b' }, 'x/1')).toBe('/lessons/x%2F1/a%20b');
    });

    it('shows no link when the setup has none', () => {
        const source = buildCollectionSource('Lessons', validSetup({ ...LESSONS, link: '' })!);
        const display = source.display({ title: 'T' }, { collection: 'Lessons', docId: '1' } as never, 'en');
        expect(display.link).toBe('');
    });
});

describe('Search settings', () => {
    it('offers text fields, one level into maps, most common first', () => {
        const fields = textFields([
            { title: 'A', tags: ['x', 'y'], count: 3, when: new Date(), address: { city: 'Pune', pin: 411 } },
            { title: 'B', summary: 'S' },
        ]);
        expect(fields.map(f => f.path)).toEqual(['title', 'address.city', 'summary', 'tags']);
        expect(fields[0]).toMatchObject({ count: 2, example: 'A' });
    });

    it('tells each collection apart', () => {
        const s = { Lessons: validSetup(LESSONS)! };
        expect(collectionState('EmailLogs', s)).toMatchObject({ state: 'refused' });
        expect(collectionState('arc_blog_drafts', s)).toMatchObject({ state: 'content', sourceId: 'content-drafts' });
        expect(collectionState('Products', s)).toMatchObject({ state: 'code', sourceId: 'products' });
        expect(collectionState('Lessons', s)).toMatchObject({ state: 'searchable', sourceId: 'collection-Lessons' });
        expect(collectionState('Lessons', {})).toMatchObject({ state: 'needs_setup' });
        expect(collectionState('users', s)).toMatchObject({ state: 'not_listed' });
        // Set up before a developer named it: kept, but nothing indexes it yet.
        expect(collectionState('users', { users: validSetup(LESSONS)! })).toMatchObject({ state: 'waiting', sourceId: 'collection-users' });
    });

    it('lets an admin set up any collection but refused ones, content and code sources', () => {
        expect(['searchable', 'needs_setup', 'waiting', 'not_listed'].every((s) => canSetUp(s as never))).toBe(true);
        expect(['refused', 'content', 'code'].some((s) => canSetUp(s as never))).toBe(false);
    });

    it('lists what each source tokenizes: content per type, code sources, and setups', async () => {
        const fields = await indexedFields({ Lessons: validSetup(LESSONS)! });
        expect(fields['content'].byType).toEqual([{ type: 'Articles', fields: [
            { path: 'title', high: true }, { path: 'summary', high: expect.any(Boolean) },
            { path: 'authorName', high: expect.any(Boolean) }, { path: 'customFields.city', high: expect.any(Boolean) },
        ] }]);
        expect(fields['content-drafts'].byType?.map((t) => t.type)).toEqual(['Articles', 'Notes']);
        expect(fields['products'].fields?.map((f) => f.path)).toEqual(['name', 'description', 'features']);
        expect(fields['collection-Lessons'].fields).toEqual([{ path: 'title', high: true }, { path: 'summary', high: false }]);
    });
});
