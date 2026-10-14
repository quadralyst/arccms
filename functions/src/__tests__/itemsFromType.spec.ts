/**
 * Entries of another type in a detail template when publishing
 * (data-arc-items-src): reading the rows (pages/published-entries.ts) and
 * finding the pages to rebuild when that type's entries change
 * (pages/items-from-type-pages.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollection, mockGenerateDetailPage, mockLoadSiteTemplate, mockLoadDetailTemplate, mockGetSiteFile, mockGetSiteManifest, mockHostingSite } = vi.hoisted(() => ({
    mockCollection: vi.fn(),
    mockGenerateDetailPage: vi.fn(),
    mockLoadSiteTemplate: vi.fn(),
    mockLoadDetailTemplate: vi.fn(),
    mockGetSiteFile: vi.fn(),
    mockGetSiteManifest: vi.fn(),
    mockHostingSite: vi.fn(() => 'test-site'),
}));

vi.mock('../init', () => ({ db: { collection: (...args: unknown[]) => mockCollection(...args) } }));
vi.mock('../arc-config', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../arc-config.js')>()),
    arcHostingSite: () => mockHostingSite(),
}));
vi.mock('../shared/site-files', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../shared/site-files.js')>()),
    loadSiteTemplate: (...args: unknown[]) => mockLoadSiteTemplate(...args),
    loadDetailTemplate: (...args: unknown[]) => mockLoadDetailTemplate(...args),
    getSiteFile: (...args: unknown[]) => mockGetSiteFile(...args),
    getSiteManifest: (...args: unknown[]) => mockGetSiteManifest(...args),
}));
vi.mock('../pages/deployContentPage', () => ({ generateAndDeployContentDetailPage: (...args: unknown[]) => mockGenerateDetailPage(...args) }));

import { readItemsFromType } from '../pages/published-entries.js';
import { rebuildPagesShowingItemsOf, typesShowingItemsOf } from '../pages/items-from-type-pages.js';
import { HostingBatch } from '../pages/deployToHosting.js';
import { MissingTemplateFolderError } from '../shared/site-files.js';

const day = (n: number) => ({ seconds: 1767600000 + n * 86400 });
const snapOf = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

/** An in-memory Firestore: content types, published entries and their translations. */
function wireDb(types: Record<string, any>[], entries: Record<string, Record<string, any>[]>, translations: Record<string, Record<string, any>> = {}) {
    const reads = { typeQueries: 0, limits: [] as number[], fullReads: 0 };
    mockCollection.mockImplementation((name: string) => {
        if (name === 'ContentTypes') {
            return {
                get: async () => ({ docs: types.map((t) => snapOf(t['slug'], t)) }),
                where: (_f: string, _op: string, slug: string) => ({
                    limit: () => ({
                        get: async () => {
                            reads.typeQueries++;
                            const found = types.filter((t) => t['slug'] === slug);
                            return { empty: !found.length, docs: found.map((t) => snapOf(slug, t)) };
                        },
                    }),
                }),
            };
        }
        const slug = name.replace(/^arc_/, '');
        const all = (entries[slug] || []).map((e) => snapOf(e['id'], e));
        return {
            get: async () => { reads.fullReads++; return { docs: all }; },
            orderBy: () => ({
                limit: (n: number) => ({
                    get: async () => {
                        reads.limits.push(n);
                        const sorted = [...(entries[slug] || [])].sort((a, b) => b['publishedOn'].seconds - a['publishedOn'].seconds);
                        return { docs: sorted.slice(0, n).map((e) => snapOf(e['id'], e)) };
                    },
                }),
            }),
            doc: (id: string) => ({
                collection: () => ({
                    doc: (lang: string) => ({
                        get: async () => {
                            const tr = translations[`${slug}/${id}/${lang}`];
                            return { exists: !!tr, data: () => tr };
                        },
                    }),
                }),
            }),
        };
    });
    return reads;
}

const EVENTS = [
    { id: 'e1', title: 'Fair', urlSlug: 'fair', publishedOn: day(1), customFields: { 'events-venue': 'Hall' } },
    { id: 'e2', title: 'Walk', urlSlug: 'walk', publishedOn: day(3) },
    { id: 'e3', title: 'Talk', urlSlug: 'talk', publishedOn: day(2) },
    { id: 'e4', title: 'Gone', urlSlug: 'gone', publishedOn: day(0), publishedStatus: false },
];
const PAGE = { lang: 'en', defaultLang: 'en', type: 'entry-points', id: 'p1' };

describe('readItemsFromType', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reads each loop\'s type newest first, as cards, up to its limit, skipping unpublished copies', async () => {
        const reads = wireDb([{ slug: 'events', name: 'Events' }], { events: EVENTS });
        const rows = await readItemsFromType([
            { name: 'arc-items-from-0', type: 'events', limit: 2 },
            { name: 'arc-items-from-1', type: 'events', limit: 6 },
        ], PAGE);
        expect(rows['arc-items-from-0'].map((r) => r['title'])).toEqual(['Walk', 'Talk']);
        expect(rows['arc-items-from-1'].map((r) => r['title'])).toEqual(['Walk', 'Talk', 'Fair']);
        expect(reads.limits).toEqual([2, 6]);
        const fair = rows['arc-items-from-1'][2];
        expect(fair['url']).toBe('/events/fair');
        expect(fair['events-venue']).toBe('Hall');
        expect(fair['contentType']).toBe('Events');
    });

    it('never shows the page\'s own entry, still filling the limit', async () => {
        wireDb([{ slug: 'events', name: 'Events' }], { events: EVENTS });
        const rows = await readItemsFromType([{ name: 'arc-items-from-0', type: 'events', limit: 2 }], { ...PAGE, type: 'events', id: 'e2' });
        expect(rows['arc-items-from-0'].map((r) => r['id'])).toEqual(['e3', 'e1']);
    });

    it('keeps a type in its own order', async () => {
        const reads = wireDb([{ slug: 'events', name: 'Events', entryOrder: 'manual' }], {
            events: [{ ...EVENTS[0], sortOrder: 1 }, { ...EVENTS[1], sortOrder: 2 }, EVENTS[2]],
        });
        const rows = await readItemsFromType([{ name: 'arc-items-from-0', type: 'events', limit: 6 }], PAGE);
        expect(rows['arc-items-from-0'].map((r) => r['id'])).toEqual(['e1', 'e2', 'e3']);
        expect(reads.fullReads).toBe(1);
    });

    it('shows each entry\'s translation and links inside the page\'s language', async () => {
        wireDb(
            [{ slug: 'events', name: 'Events', nameTranslations: { hi: { name: 'कार्यक्रम' } } }],
            { events: EVENTS.slice(0, 2) },
            { 'events/e1/hi': { title: 'मेला' } },
        );
        const rows = await readItemsFromType([{ name: 'arc-items-from-0', type: 'events', limit: 6 }], { ...PAGE, lang: 'hi' });
        expect(rows['arc-items-from-0'].map((r) => [r['title'], r['url']])).toEqual([['Walk', '/hi/events/walk'], ['मेला', '/hi/events/fair']]);
        expect(rows['arc-items-from-0'][0]['contentType']).toBe('कार्यक्रम');
    });

    it('gives cards without links for a type without public pages, and no rows for a type that does not exist', async () => {
        wireDb([{ slug: 'events', name: 'Events', hasPublicUrl: false }], { events: EVENTS.slice(0, 1) });
        const rows = await readItemsFromType([
            { name: 'arc-items-from-0', type: 'events', limit: 6 },
            { name: 'arc-items-from-1', type: 'nothing', limit: 6 },
        ], PAGE);
        expect(rows['arc-items-from-0'][0]['url']).toBe('');
        expect(rows['arc-items-from-1']).toEqual([]);
    });

    it('reads a type once for every language of a page sharing the cache', async () => {
        const reads = wireDb([{ slug: 'events', name: 'Events' }], { events: EVENTS });
        const cache = new Map();
        const loops = [{ name: 'arc-items-from-0', type: 'events', limit: 3 }];
        await readItemsFromType(loops, PAGE, cache);
        await readItemsFromType(loops, { ...PAGE, lang: 'hi' }, cache);
        expect(reads.typeQueries).toBe(1);
        expect(reads.limits).toEqual([3]);
    });

    it('reads nothing for a template without such loops', async () => {
        expect(await readItemsFromType([], PAGE)).toEqual({});
        expect(mockCollection).not.toHaveBeenCalled();
    });
});

describe('pages showing entries of a type', () => {
    const SHOWS = '<ul data-arc-loop="items" data-arc-items-src="events"><li>{{ title }}</li></ul>';
    const PLAIN = '<article>{{ title }}</article>';

    beforeEach(() => {
        vi.clearAllMocks();
        mockHostingSite.mockReturnValue('test-site');
        mockGetSiteManifest.mockResolvedValue({ layouts: { guides: { gallery: 'app' } } });
        mockGetSiteFile.mockImplementation(async (path: string) => (path === 'templates/guides/detail-gallery.html' ? SHOWS : null));
        mockLoadSiteTemplate.mockImplementation(async (folder: string) => {
            if (folder === 'entry-points') return SHOWS;
            if (folder === 'missing') throw new MissingTemplateFolderError('missing', true);
            return PLAIN;
        });
        mockLoadDetailTemplate.mockImplementation(async (folder: string, layout: string) =>
            folder === 'entry-points' || (folder === 'guides' && layout === 'gallery') ? SHOWS : PLAIN);
        mockGenerateDetailPage.mockResolvedValue(undefined);
        wireDb([
            { slug: 'entry-points', templateFolder: 'entry-points' },
            { slug: 'guides', templateFolder: 'guides' },
            { slug: 'articles', templateFolder: 'articles' },
            { slug: 'services', templateFolder: 'entry-points', hasPublicUrl: false },
            { slug: 'broken', templateFolder: 'missing' },
        ], {
            'entry-points': [{ id: 'p1' }, { id: 'p2' }],
            guides: [{ id: 'g1', layout: 'gallery' }, { id: 'g2' }, { id: 'g3', layout: ' gallery ' }],
            articles: [{ id: 'a1' }],
        });
    });

    it('finds the types with public pages whose detail.html or a layout names the type', async () => {
        expect((await typesShowingItemsOf('events')).map((t) => t.slug)).toEqual(['entry-points', 'guides']);
        expect(await typesShowingItemsOf('news')).toEqual([]);
    });

    it('finds none with hosting off', async () => {
        mockHostingSite.mockReturnValue('');
        expect(await typesShowingItemsOf('events')).toEqual([]);
        expect(mockCollection).not.toHaveBeenCalled();
    });

    it('rebuilds only the entries whose own template shows the type, into one batch', async () => {
        const batch = new HostingBatch();
        expect(await rebuildPagesShowingItemsOf('events', batch)).toBe(4);
        expect(mockGenerateDetailPage.mock.calls.map(([type, id]) => `${type}/${id}`)).toEqual(['entry-points/p1', 'entry-points/p2', 'guides/g1', 'guides/g3']);
        for (const call of mockGenerateDetailPage.mock.calls) expect(call[2]).toBe(batch);
        // One template check per layout, not per entry.
        expect(mockLoadDetailTemplate.mock.calls.filter(([folder]) => folder === 'guides')).toHaveLength(2);
    });

    it('carries on past a page that cannot be built', async () => {
        mockGenerateDetailPage.mockRejectedValueOnce(new Error('boom'));
        expect(await rebuildPagesShowingItemsOf('events', new HostingBatch())).toBe(3);
    });
});
