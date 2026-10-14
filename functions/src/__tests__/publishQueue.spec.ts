import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
    mockCollection,
    mockDoc,
    mockGet,
    mockSet,
    mockUpdate,
    mockDelete,
    mockAdd,
    mockBatchSet,
    mockBatchUpdate,
    mockBatchCommit,
    mockGenerateDetailPage,
    mockGenerateListPage,
    mockRemoveContentPage,
    mockDeployBatchToHosting,
    mockContentTypeGet,
    mockSubCollectionGet,
    mockBatchDelete,
    mockGenerateRobotsTxt,
    mockGenerateLlmsTxt,
    mockEnsureIndexNowKey,
    mockSubmitBatchToIndexNow,
    mockGetDiscoverabilitySettings,
} = vi.hoisted(() => ({
    mockCollection: vi.fn(),
    mockDoc: vi.fn(),
    mockGet: vi.fn(),
    mockSet: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockAdd: vi.fn(),
    mockBatchSet: vi.fn(),
    mockBatchUpdate: vi.fn(),
    mockBatchCommit: vi.fn().mockResolvedValue(undefined),
    mockGenerateDetailPage: vi.fn(),
    mockGenerateListPage: vi.fn(),
    mockGenerateRobotsTxt: vi.fn().mockResolvedValue(undefined),
    mockGenerateLlmsTxt: vi.fn().mockResolvedValue(undefined),
    mockEnsureIndexNowKey: vi.fn().mockResolvedValue('key'),
    mockSubmitBatchToIndexNow: vi.fn().mockResolvedValue({ submitted: 0 }),
    mockGetDiscoverabilitySettings: vi.fn().mockResolvedValue({ indexNow: { enabled: true, key: 'key' }, llmsTxt: true, crawlers: {}, defaultAuthorId: '' }),
    mockRemoveContentPage: vi.fn(),
    mockDeployBatchToHosting: vi.fn(),
    mockContentTypeGet: vi.fn(),
    mockSubCollectionGet: vi.fn(),
    mockBatchDelete: vi.fn(),
}));

vi.mock('../init', () => ({
    db: {
        collection: mockCollection,
        batch: () => ({
            set: mockBatchSet,
            update: mockBatchUpdate,
            delete: mockBatchDelete,
            commit: mockBatchCommit,
        }),
    },
}));

vi.mock('../pages/deployToHosting', async (importOriginal) => {
    // HostingBatch stays real — the queue collects into one; only the
    // network-touching release is mocked.
    const actual = await importOriginal<typeof import('../pages/deployToHosting.js')>();
    return { ...actual, deployBatchToHosting: mockDeployBatchToHosting };
});

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((_path: string, handler: any) => handler),
}));

vi.mock('../pages/deployContentPage', () => ({
    generateAndDeployContentDetailPage: mockGenerateDetailPage,
    removeContentPage: mockRemoveContentPage,
}));

vi.mock('../pages/deployContentListPage', () => ({
    generateAndDeployContentListPage: mockGenerateListPage,
}));

vi.mock('../pages/generateSitemap', () => ({
    // Adds the sitemap to the release, as the real one does.
    generateAndDeploySitemap: vi.fn(async (batch?: { add(path: string, content: string): void }) => {
        batch?.add('/sitemap.xml', '<urlset/>');
    }),
}));

const { mockGenerateHome, mockGenerateStaticPage, mockHomeShowsType } = vi.hoisted(() => ({
    mockGenerateHome: vi.fn(), mockGenerateStaticPage: vi.fn(), mockHomeShowsType: vi.fn(async () => false),
}));
vi.mock('../pages/deployStaticPage', () => ({
    staticPageSlugs: async () => ['privacy-policy', 'terms'],
    generateAndDeployStaticPage: (...args: unknown[]) => mockGenerateStaticPage(...args),
}));
vi.mock('../pages/deployHomePage', () => ({
    // The home page shows no content types unless a test says so.
    homeShowsType: (...args: unknown[]) => mockHomeShowsType(...(args as [])),
    generateAndDeployHomePage: (...args: unknown[]) => mockGenerateHome(...args),
}));

// No template shows entries of another type (data-arc-items-src) unless a test says so.
const { mockTypesShowingItemsOf, mockRebuildPagesShowingItemsOf } = vi.hoisted(() => ({
    mockTypesShowingItemsOf: vi.fn(async (_slug: string): Promise<{ slug: string; templateFolder: string }[]> => []),
    mockRebuildPagesShowingItemsOf: vi.fn(),
}));
vi.mock('../pages/items-from-type-pages', () => ({
    typesShowingItemsOf: (slug: string) => mockTypesShowingItemsOf(slug),
    rebuildPagesShowingItemsOf: (...args: unknown[]) => mockRebuildPagesShowingItemsOf(...args),
}));
const { mockChromeSignature, mockChromeShowsType } = vi.hoisted(() => ({
    mockChromeSignature: vi.fn(async (_slug: string) => ''), mockChromeShowsType: vi.fn(async (_slug: string) => false),
}));
vi.mock('../pages/card-blocks', () => ({
    // The header and footer show no card blocks unless a test says so.
    chromeCardsSignature: (slug: string) => mockChromeSignature(slug),
    chromeShowsType: (slug: string) => mockChromeShowsType(slug),
}));

// Coalesced queue items (coalesced-items.ts, coalescedQueue.spec.ts): asked for,
// claimed and finished through spies; a claim succeeds unless a test says not.
const { mockRequestCoalesced, mockClaimCoalesced, mockFinishCoalesced } = vi.hoisted(() => ({
    mockRequestCoalesced: vi.fn(async (_action: string, _slug?: string) => 'queued'),
    mockClaimCoalesced: vi.fn(async (_id: string): Promise<Record<string, unknown> | null> => ({ state: 'running' })),
    mockFinishCoalesced: vi.fn(async (_id: string, _continuation?: Record<string, unknown>, _outcome?: Record<string, unknown>) => undefined),
}));
vi.mock('../publishQueue/coalesced-items', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../publishQueue/coalesced-items.js')>()),
    requestCoalesced: (action: string, slug?: string) => mockRequestCoalesced(action, slug),
    claimCoalesced: (id: string) => mockClaimCoalesced(id),
    finishCoalesced: (...args: [string, Record<string, unknown>?, Record<string, unknown>?]) => mockFinishCoalesced(...args),
}));
const requested = (action: string) => mockRequestCoalesced.mock.calls.filter(([a]) => a === action);

// The search index rebuild after a whole-site republish.
const { mockRunReindex } = vi.hoisted(() => ({ mockRunReindex: vi.fn(async () => []) }));
vi.mock('../search/reindexSearch', () => ({ runReindex: (...args: unknown[]) => mockRunReindex(...(args as [])) }));

vi.mock('../pages/generateRssFeed', () => ({
    generateAndDeployRssFeeds: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../pages/generateRobotsTxt', () => ({
    generateAndDeployRobotsTxt: mockGenerateRobotsTxt,
}));
vi.mock('../pages/generateLlmsTxt', () => ({
    generateAndDeployLlmsTxt: mockGenerateLlmsTxt,
}));
vi.mock('../pages/indexNow', () => ({
    ensureIndexNowKey: mockEnsureIndexNowKey,
    submitBatchToIndexNow: mockSubmitBatchToIndexNow,
}));
vi.mock('../shared/discoverability-settings', () => ({
    getDiscoverabilitySettings: mockGetDiscoverabilitySettings,
}));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: vi.fn(),
    Timestamp: {
        now: () => ({ seconds: 1705334400, nanoseconds: 0 }),
    },
    FieldValue: {
        increment: vi.fn((n: number) => ({ _increment: n })),
        delete: vi.fn(() => ({ _delete: true })),
        serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
    },
}));

import { COALESCED_BUILD_MS, QUEUE_TIMEOUT_MS, RELEASE_BY_MS, processPublishQueue } from '../publishQueue/processPublishQueue.js';
import { RELEASE_LOCK_WAIT_MS, RELEASE_TIME_MS } from '../pages/hosting-release-lock.js';
import { MissingTemplateFolderError } from '../shared/site-files.js';

// The mock of onDocumentCreated returns the handler directly,
// so processPublishQueue IS the handler function.
const handler = processPublishQueue as unknown as (event: any) => Promise<void>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildChain(contentTypeData: any = { hasPublicUrl: true }) {
    const subCollectionAdd = mockAdd.mockResolvedValue({ id: 'log1' });
    // `get` supports the translations subcollection (M3); PublishedHistory
    // only ever writes, so the same shape serves both.
    const subCollectionRef = {
        add: subCollectionAdd,
        doc: vi.fn().mockReturnValue({ id: 'auto-id', ref: { id: 'auto-id' } }),
        get: mockSubCollectionGet,
    };

    const docRef = {
        get: mockGet,
        set: mockSet,
        update: mockUpdate,
        delete: mockDelete,
        collection: vi.fn().mockReturnValue(subCollectionRef),
    };

    mockDoc.mockReturnValue(docRef);

    // ContentTypes lookup: .where().limit().get()
    mockContentTypeGet.mockResolvedValue({
        empty: !contentTypeData,
        docs: contentTypeData ? [{ data: () => contentTypeData }] : [],
    });

    mockCollection.mockImplementation((name: string) => {
        if (name === 'ContentTypes') {
            return {
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        get: mockContentTypeGet,
                    }),
                }),
            };
        }
        return { doc: mockDoc };
    });

    return { docRef, subCollectionRef };
}

/** A queue item's trigger event; `id` is the queue document's id (a coalesced item has a fixed one). */
function createEvent(action: string, contentTypeSlug: string, docId: string, id = 'q1') {
    const deleteRef = vi.fn().mockResolvedValue(undefined);
    return {
        params: { queueId: id },
        data: {
            data: () => ({
                action,
                contentTypeSlug,
                docId,
                timestamp: { seconds: 1705334400, nanoseconds: 0 },
            }),
            ref: { id, delete: deleteRef },
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('processPublishQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildChain();
        mockSubCollectionGet.mockResolvedValue({ docs: [], empty: true });
        // A release goes out unless a test says not.
        mockDeployBatchToHosting.mockResolvedValue(true);
        mockBatchDelete.mockReturnValue(undefined);
        mockSet.mockResolvedValue(undefined);
        mockUpdate.mockResolvedValue(undefined);
        mockDelete.mockResolvedValue(undefined);
        mockGenerateDetailPage.mockResolvedValue(undefined);
        mockGenerateListPage.mockResolvedValue(undefined);
        mockRemoveContentPage.mockResolvedValue(undefined);
    });

    describe('source code structure', () => {
        it('should use v2 onDocumentCreated API', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../publishQueue/processPublishQueue.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
            expect(fileContent).toContain('onDocumentCreated');
        });

        it('should watch _publish_queue collection (not wildcard)', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../publishQueue/processPublishQueue.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("'_publish_queue/{queueId}'");
            expect(fileContent).not.toContain("'{collectionId}/{docId}'");
        });

        it('should handle all five actions: publish, unpublish, update, delete, redeploy', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../publishQueue/processPublishQueue.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("case 'publish':");
            expect(fileContent).toContain("case 'unpublish':");
            expect(fileContent).toContain("case 'update':");
            expect(fileContent).toContain("case 'delete':");
            expect(fileContent).toContain("case 'redeploy':");
        });

        it('should import static HTML deployment functions', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../publishQueue/processPublishQueue.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('generateAndDeployContentDetailPage');
            expect(fileContent).toContain('generateAndDeployContentListPage');
            expect(fileContent).toContain('removeContentPage');
        });

        it('should always clean up the queue document', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../publishQueue/processPublishQueue.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('queueDocRef.delete()');
        });
    });

    describe('publish action — static HTML deployment', () => {
        it('should generate detail page after publishing', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    title: 'Test',
                    content: '<p>body</p>',
                    urlSlug: 'test',
                }),
            });

            const event = createEvent('publish', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
        });

        it('should generate list page after publishing', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    title: 'Test',
                    content: '<p>body</p>',
                    urlSlug: 'test',
                }),
            });

            const event = createEvent('publish', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should not block Firestore sync when deployment fails', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    title: 'Test',
                    content: '<p>body</p>',
                    urlSlug: 'test',
                }),
            });
            mockGenerateDetailPage.mockRejectedValue(new Error('Deploy failed'));

            const event = createEvent('publish', 'articles', 'doc1');
            // Should NOT throw — deployment failure is caught
            await handler(event);

            // Firestore batch write should have happened before deployment
            expect(mockBatchCommit).toHaveBeenCalled();
            // Queue doc should still be cleaned up
            expect(event.data.ref.delete).toHaveBeenCalled();
        });

        it('copies the Next and Previous links to the published copy and its version', async () => {
            const nextContent = { id: 'n1', title: 'Part three', summary: '', slug: 'part-three' };
            const previousContent = { id: 'p1', title: 'Part one', summary: '', slug: 'part-one' };
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Part two', content: '<p>body</p>', urlSlug: 'part-two', nextContent, previousContent }),
            });

            await handler(createEvent('publish', 'articles', 'doc1'));

            // The published document, then the PublishedHistory entry a restore reads.
            const written = mockBatchSet.mock.calls.map(([, data]) => data);
            expect(written[0]).toEqual(expect.objectContaining({ id: 'doc1', nextContent, previousContent }));
            expect(written[1]).toEqual(expect.objectContaining({ nextContent, previousContent }));
        });
    });

    describe('a page that cannot be built', () => {
        beforeEach(() => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Test', content: '<p>body</p>', urlSlug: 'test' }),
            });
        });

        it('releases the rest without stamping the item deployed, and records why on it', async () => {
            mockGenerateDetailPage.mockRejectedValue(new MissingTemplateFolderError('recipes', true));

            await handler(createEvent('publish', 'articles', 'doc1'));

            // The sitemap still goes out, but the release names no item to stamp.
            expect(mockDeployBatchToHosting).toHaveBeenCalledWith(expect.anything(), expect.anything(), '', '', expect.anything());
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                deployStatus: 'failed',
                deployErrorCode: 'TEMPLATE_FOLDER_MISSING',
                deployError: "Template folder 'recipes' is not on the live site. Deploy the website, then publish again.",
            }));
        });

        it('records any other build failure too, rather than reporting it deployed', async () => {
            mockGenerateDetailPage.mockRejectedValue(Object.assign(new Error('Content type configuration not found'), { code: 'CONTENT_TYPE_NOT_FOUND' }));

            await handler(createEvent('publish', 'articles', 'doc1'));

            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                deployStatus: 'failed',
                deployErrorCode: 'CONTENT_TYPE_NOT_FOUND',
                deployError: 'Content type configuration not found',
            }));
        });

        it('stamps the item as before when its page was built', async () => {
            mockGenerateDetailPage.mockImplementation(async (_slug: string, _id: string, batch: any) => {
                batch.add('/articles/test.html', '<html></html>');
            });

            await handler(createEvent('publish', 'articles', 'doc1'));

            expect(mockDeployBatchToHosting).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'arc_articles', 'doc1', expect.anything());
            expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ deployStatus: 'failed' }));
        });
    });

    describe('home action: the home page alone, after a setting it shows changed', () => {
        it('republishes the home page in one release and removes the queue item', async () => {
            mockGenerateHome.mockImplementation(async (batch: any) => { batch.add('/index.html', '<html></html>'); });
            const event = createEvent('home', '', '');
            await handler(event);
            expect(mockGenerateHome).toHaveBeenCalledTimes(1);
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(event.data.ref.delete).toHaveBeenCalled();
        });

        it('removes the queue item even when the home page cannot be built', async () => {
            mockGenerateHome.mockRejectedValue(new Error('no home page'));
            const event = createEvent('home', '', '');
            await handler(event);
            expect(mockDeployBatchToHosting).not.toHaveBeenCalled();
            expect(event.data.ref.delete).toHaveBeenCalled();
        });
    });

    // SS2 (specs/site-sections-spec.md): entries put in a new order.
    // SS6: every page's footer lists the standard pages.
    describe('standard pages in the footer', () => {
        const queueAdd = vi.fn();
        function wire(type: Record<string, unknown>) {
            buildChain(type);
            const base = mockCollection.getMockImplementation()!;
            mockCollection.mockImplementation((name: string) => (name === '_publish_queue' ? { add: queueAdd } : base(name)));
            queueAdd.mockResolvedValue(undefined);
        }
        const published = (title: string) => ({ exists: true, data: () => ({ title, urlSlug: 'about', content: '<p>x</p>' }) });
        const redeployQueued = () => requested('redeploy-all').length > 0;

        beforeEach(() => queueAdd.mockReset());

        it('republishes the whole site when a standard page goes live', async () => {
            wire({ hasPublicUrl: true, standard: 'pages' });
            mockGet.mockResolvedValueOnce({ exists: false, data: () => undefined }).mockResolvedValue(published('About'));
            await handler(createEvent('publish', 'info', 'about'));
            expect(redeployQueued()).toBe(true);
        });

        it('republishes it when a standard page\'s title changes', async () => {
            wire({ hasPublicUrl: true, standard: 'pages' });
            mockGet.mockResolvedValueOnce(published('About')).mockResolvedValue(published('About us'));
            await handler(createEvent('update', 'info', 'about'));
            expect(redeployQueued()).toBe(true);
        });

        it('leaves the rest of the site alone for an edit the footer does not show', async () => {
            wire({ hasPublicUrl: true, standard: 'pages' });
            mockGet.mockResolvedValue(published('About'));
            await handler(createEvent('update', 'info', 'about'));
            expect(redeployQueued()).toBe(false);
        });

        it('never for other content types', async () => {
            wire({ hasPublicUrl: true });
            mockGet.mockResolvedValueOnce({ exists: false, data: () => undefined }).mockResolvedValue(published('Post'));
            await handler(createEvent('publish', 'articles', 'p1'));
            expect(redeployQueued()).toBe(false);
        });
    });

    // Detail pages that show entries of another type (data-arc-items-src).
    describe('pages showing entries of the changed type', () => {
        const queued = () => requested('items-from').map(([, slug]) => slug);
        const live = { exists: true, data: () => ({ title: 'Drive', urlSlug: 'drive', content: '<p>x</p>' }) };
        const ITEM_ID = 'items-from--events';

        beforeEach(() => {
            mockTypesShowingItemsOf.mockResolvedValue([{ slug: 'services', templateFolder: 'services' }]);
            mockRebuildPagesShowingItemsOf.mockResolvedValue({ pages: 0, dropped: 0 });
        });
        afterEach(() => {
            mockTypesShowingItemsOf.mockResolvedValue([]);
            mockRebuildPagesShowingItemsOf.mockReset();
            mockChromeSignature.mockReset().mockResolvedValue('');
        });

        it.each(['publish', 'update', 'unpublish', 'delete'])('asks for a rebuild of them after %s, in the type\'s one queue item', async (action) => {
            mockGet.mockResolvedValue(live);
            await handler(createEvent(action, 'events', 'a1'));
            expect(mockTypesShowingItemsOf).toHaveBeenCalledWith('events');
            expect(queued()).toEqual(['events']);
            // Not in this item's release.
            expect(mockRebuildPagesShowingItemsOf).not.toHaveBeenCalled();
        });

        it('asks for none when no template shows the type', async () => {
            mockGet.mockResolvedValue(live);
            mockTypesShowingItemsOf.mockResolvedValueOnce([]);
            await handler(createEvent('publish', 'articles', 'p1'));
            expect(queued()).toEqual([]);
        });

        it('asks for none when the same change republishes the whole site, which rebuilds them anyway', async () => {
            mockGet.mockResolvedValue(live);
            mockChromeSignature.mockResolvedValueOnce('en:<li>Old</li>').mockResolvedValue('en:<li>Drive</li>');
            await handler(createEvent('publish', 'events', 'a1'));
            expect(requested('redeploy-all')).toHaveLength(1);
            expect(queued()).toEqual([]);
        });

        it('a bulk publish of 20 entries asks 20 times for the one coalescing item, and never adds an item of its own', async () => {
            mockGet.mockResolvedValue(live);
            const queueAdd = vi.fn();
            const base = mockCollection.getMockImplementation()!;
            mockCollection.mockImplementation((name: string) => (name === '_publish_queue' ? { add: queueAdd } : base(name)));
            await Promise.all(Array.from({ length: 20 }, (_, i) => handler(createEvent('publish', 'events', `a${i}`))));
            expect(queued()).toHaveLength(20);
            expect(queueAdd).not.toHaveBeenCalled();
        });

        it('asks for none for a redeploy, which changes no entry', async () => {
            mockGet.mockResolvedValue(live);
            await handler(createEvent('redeploy', 'events', 'a1'));
            expect(queued()).toEqual([]);
        });

        it('asks for one when the type\'s entries are put in a new order', async () => {
            const base = mockCollection.getMockImplementation()!;
            mockCollection.mockImplementation((name: string) => (name.startsWith('arc_')
                ? { get: async () => ({ docs: [] }), doc: mockDoc }
                : base(name)));
            await handler(createEvent('order', 'events', ''));
            expect(queued()).toEqual(['events']);
        });

        it('claims the item, rebuilds them in one release that stamps no entry, then finishes the item', async () => {
            const order: string[] = [];
            mockClaimCoalesced.mockImplementationOnce(async () => { order.push('claim'); return { state: 'running' }; });
            mockRebuildPagesShowingItemsOf.mockImplementation(async (_slug: string, batch: { add(p: string, c: string): void }) => {
                order.push('rebuild');
                batch.add('/services/door.html', '<html></html>');
                return { pages: 1, dropped: 0 };
            });
            mockDeployBatchToHosting.mockImplementation(async () => { order.push('release'); return true; });
            mockFinishCoalesced.mockImplementationOnce(async () => { order.push('finish'); });
            const event = createEvent('items-from', 'events', '', ITEM_ID);
            await handler(event);

            expect(mockClaimCoalesced).toHaveBeenCalledWith(ITEM_ID);
            expect(mockRebuildPagesShowingItemsOf).toHaveBeenCalledWith('events', expect.anything(), expect.objectContaining({ after: undefined, deadline: expect.any(Number) }));
            expect(order).toEqual(['claim', 'rebuild', 'release', 'finish']);
            expect(mockFinishCoalesced).toHaveBeenCalledWith(ITEM_ID, undefined);
            expect(mockDeployBatchToHosting.mock.calls[0][2]).toBe('');
            expect(mockDeployBatchToHosting.mock.calls[0][3]).toBe('');
            // The coalesced item is finished, not deleted, and rebuilding the pages changes no entry.
            expect(event.data.ref.delete).not.toHaveBeenCalled();
            expect(queued()).toEqual([]);
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
        });

        it('goes on from where a continuation says, and queues the rest when it runs out of time', async () => {
            mockClaimCoalesced.mockResolvedValueOnce({ state: 'running', after: { type: 'services', id: 'p4' } });
            mockRebuildPagesShowingItemsOf.mockResolvedValue({ pages: 3, dropped: 0, next: { type: 'guides', id: 'g2' } });
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            expect(mockRebuildPagesShowingItemsOf.mock.calls[0][2]).toMatchObject({ after: { type: 'services', id: 'p4' } });
            expect(mockFinishCoalesced).toHaveBeenCalledWith(ITEM_ID, { after: { type: 'guides', id: 'g2' } });
        });

        it('finishes the item as failed when the rebuild fails, so it runs again', async () => {
            mockRebuildPagesShowingItemsOf.mockRejectedValue(new Error('boom'));
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            expect(mockFinishCoalesced).toHaveBeenCalledWith(ITEM_ID, undefined, { failed: true, error: 'boom' });
        });

        it('finishes it as failed when its release does not go out (HOSTING_RELEASE_BUSY), to run the same part again', async () => {
            vi.stubEnv('ARC_HOSTING_SITE', 'my-site');
            mockClaimCoalesced.mockResolvedValueOnce({ state: 'running', after: { type: 'services', id: 'p4' } });
            mockRebuildPagesShowingItemsOf.mockImplementation(async (_slug: string, batch: { add(p: string, c: string): void }) => {
                batch.add('/services/door.html', 'x');
                return { pages: 1, dropped: 0, next: { type: 'services', id: 'p9' } };
            });
            mockDeployBatchToHosting.mockImplementation(async (_s, _b, _c, _d, options: { onFailure?: (f: { code: string; message: string }) => void }) => {
                options.onFailure?.({ code: 'HOSTING_RELEASE_BUSY', message: 'Another release was still running' });
                return false;
            });
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            vi.unstubAllEnvs();

            // From where the failed part started, not where it stopped: its pages never went out.
            expect(mockFinishCoalesced).toHaveBeenCalledWith(ITEM_ID, { after: { type: 'services', id: 'p4' } }, {
                failed: true, error: 'HOSTING_RELEASE_BUSY: Another release was still running',
            });
        });

        it('is no failure when Hosting is off for the install: there is nothing to run again for', async () => {
            vi.stubEnv('ARC_HOSTING_SITE', 'none');
            mockRebuildPagesShowingItemsOf.mockImplementation(async (_slug: string, batch: { add(p: string, c: string): void }) => {
                batch.add('/services/door.html', 'x');
                return { pages: 1, dropped: 0 };
            });
            mockDeployBatchToHosting.mockResolvedValue(false);
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            vi.unstubAllEnvs();
            expect(mockFinishCoalesced).toHaveBeenCalledWith(ITEM_ID, undefined);
        });

        it('builds for its share of the function\'s time and releases before the run\'s time is up', async () => {
            mockRebuildPagesShowingItemsOf.mockImplementation(async (_slug: string, batch: { add(p: string, c: string): void }) => {
                batch.add('/services/door.html', 'x');
                return { pages: 1, dropped: 0 };
            });
            const before = Date.now();
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            const buildDeadline = mockRebuildPagesShowingItemsOf.mock.calls[0][2].deadline;
            const releaseDeadline = mockDeployBatchToHosting.mock.calls[0][4].deadline;
            expect(buildDeadline - before).toBeGreaterThanOrEqual(COALESCED_BUILD_MS);
            expect(buildDeadline - Date.now()).toBeLessThanOrEqual(COALESCED_BUILD_MS);
            expect(releaseDeadline - buildDeadline).toBe(RELEASE_BY_MS - COALESCED_BUILD_MS);
        });

        it('runs nothing when another delivery of the trigger is running it', async () => {
            mockClaimCoalesced.mockResolvedValueOnce(null);
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            expect(mockRebuildPagesShowingItemsOf).not.toHaveBeenCalled();
            expect(mockFinishCoalesced).not.toHaveBeenCalled();
        });

        it('releases nothing when no page shows the type any more', async () => {
            await handler(createEvent('items-from', 'events', '', ITEM_ID));
            expect(mockDeployBatchToHosting).not.toHaveBeenCalled();
        });
    });

    // A card block in the header or footer (pages/card-blocks.ts) is on every page.
    describe('card blocks in the header and footer', () => {
        const queueAdd = vi.fn();
        function wire() {
            buildChain({ hasPublicUrl: false });
            const base = mockCollection.getMockImplementation()!;
            mockCollection.mockImplementation((name: string) => (name === '_publish_queue' ? { add: queueAdd } : base(name)));
            queueAdd.mockResolvedValue(undefined);
            mockGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Summer Camp', urlSlug: 'summer-camp' }) });
        }
        const redeploys = () => requested('redeploy-all').length;

        beforeEach(() => queueAdd.mockReset());
        // Back to showing nothing, for the tests after these.
        afterEach(() => {
            mockChromeSignature.mockReset().mockResolvedValue('');
            mockChromeShowsType.mockReset().mockResolvedValue(false);
        });

        it('republishes the whole site, once and in its own queue item, when what a block shows changes', async () => {
            wire();
            mockChromeSignature.mockResolvedValueOnce('en:<li>Old</li>').mockResolvedValue('en:<li>Summer Camp</li>');
            await handler(createEvent('publish', 'programs', 'summer-camp'));
            expect(mockChromeSignature).toHaveBeenCalledWith('programs');
            expect(redeploys()).toBe(1);
        });

        it('leaves the rest of the site alone for a change the blocks do not show', async () => {
            wire();
            mockChromeSignature.mockResolvedValue('en:<li>Summer Camp</li>');
            await handler(createEvent('update', 'programs', 'summer-camp'));
            expect(redeploys()).toBe(0);
        });

        it('never for a type no header or footer block shows', async () => {
            wire();
            mockChromeSignature.mockResolvedValue('');
            await handler(createEvent('unpublish', 'programs', 'summer-camp'));
            expect(redeploys()).toBe(0);
        });

        it('republishes it when the type\'s entries are put in a new order', async () => {
            wire();
            mockChromeShowsType.mockResolvedValue(true);
            mockCollection.mockImplementation((name: string) => {
                if (name === '_publish_queue') return { add: queueAdd };
                if (name === 'ContentTypes') return { where: () => ({ limit: () => ({ get: async () => ({ empty: false, docs: [{ data: () => ({ slug: 'programs', hasPublicUrl: false }) }] }) }) }) };
                return { get: async () => ({ docs: [] }), doc: mockDoc };
            });
            await handler(createEvent('order', 'programs', ''));
            expect(mockChromeShowsType).toHaveBeenCalledWith('programs');
            expect(redeploys()).toBe(1);
        });
    });

    describe('order action: a content type\'s entries in a new order', () => {
        const ref = (id: string) => ({ id });
        function wireOrder(type: Record<string, unknown> | null) {
            const drafts = [
                { id: 'a', data: () => ({ sortOrder: 1 }) },
                { id: 'b', data: () => ({ sortOrder: 2 }) },
                { id: 'c', data: () => ({}) },
            ];
            const published = [
                { id: 'a', ref: ref('a'), data: () => ({ sortOrder: 2 }) },   // moved
                { id: 'b', ref: ref('b'), data: () => ({ sortOrder: 2 }) },   // unchanged
                { id: 'c', ref: ref('c'), data: () => ({ sortOrder: 3 }) },   // its number removed
            ];
            mockCollection.mockImplementation((name: string) => {
                if (name === 'ContentTypes') {
                    return { where: () => ({ limit: () => ({ get: async () => ({ empty: !type, docs: type ? [{ data: () => type }] : [] }) }) }) };
                }
                if (name === 'arc_services_drafts') return { get: async () => ({ docs: drafts }) };
                if (name === 'arc_services') return { get: async () => ({ docs: published }) };
                return { doc: mockDoc };
            });
            mockGenerateListPage.mockImplementation(async (_slug: string, batch: { add(p: string, c: string): void }) => batch.add('/services/index.html', 'list'));
        }

        it('copies only the changed numbers to the published entries, then rebuilds the list page in one release', async () => {
            wireOrder({ slug: 'services', entryOrder: 'manual' });
            const event = createEvent('order', 'services', '');
            await handler(event);

            expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
            expect(mockBatchUpdate).toHaveBeenCalledWith(ref('a'), { sortOrder: 1 });
            const [cRef, cFields] = mockBatchUpdate.mock.calls.find(([r]) => r.id === 'c')!;
            expect(cRef).toEqual(ref('c'));
            expect(cFields.sortOrder).toEqual({ _delete: true }); // FieldValue.delete()
            expect(mockGenerateListPage).toHaveBeenCalledWith('services', expect.anything());
            expect(mockGenerateHome).not.toHaveBeenCalled();
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
            expect(mockDeployBatchToHosting.mock.calls[0][2]).toBe(''); // stamps no entry
            expect(event.data.ref.delete).toHaveBeenCalled();
        });

        it('rebuilds the home page, not a list page, for a type without public pages that the home page shows', async () => {
            wireOrder({ slug: 'services', entryOrder: 'manual', hasPublicUrl: false });
            mockHomeShowsType.mockResolvedValueOnce(true);
            mockGenerateHome.mockImplementation(async (batch: { add(p: string, c: string): void }) => batch.add('/index.html', 'home'));
            await handler(createEvent('order', 'services', ''));

            expect(mockGenerateListPage).not.toHaveBeenCalled();
            expect(mockGenerateHome).toHaveBeenCalledTimes(1);
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
        });

        it('needs a content type, but no document', async () => {
            wireOrder({ slug: 'services' });
            const event = createEvent('order', '', '');
            await handler(event);
            expect(mockBatchUpdate).not.toHaveBeenCalled();
            expect(event.data.ref.delete).toHaveBeenCalled();
        });
    });

    describe('redeploy-all action — repairing the whole site in one release', () => {
        beforeEach(() => {
            mockCollection.mockImplementation((name: string) => {
                if (name === 'ContentTypes') {
                    return {
                        where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockContentTypeGet }) }),
                        get: vi.fn().mockResolvedValue({
                            docs: [
                                { data: () => ({ slug: 'articles', hasPublicUrl: true }) },
                                { data: () => ({ slug: 'notes', hasPublicUrl: false }) },
                            ],
                        }),
                    };
                }
                return {
                    doc: mockDoc,
                    get: vi.fn().mockResolvedValue({
                        empty: false,
                        docs: [{ id: 'doc1' }, { id: 'doc2' }],
                    }),
                };
            });
        });

        it('should rebuild every published page of every public content type', async () => {
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything(), expect.anything());
            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc2', expect.anything(), expect.anything());
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
            // One read cache for the whole site: another type's entries are read once, not once per page.
            expect(mockGenerateDetailPage.mock.calls[0][3]).toBeInstanceOf(Map);
            expect(mockGenerateDetailPage.mock.calls[1][3]).toBe(mockGenerateDetailPage.mock.calls[0][3]);
        });

        it('should skip content types without a public URL', async () => {
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));

            expect(mockGenerateDetailPage.mock.calls.map(([slug]) => slug)).not.toContain('notes');
        });

        it('rebuilds the static pages too, in the same release', async () => {
            mockGenerateStaticPage.mockImplementation(async (slug: string, batch: any) => {
                batch.add(`/pages/${slug}/index.html`, '<html></html>');
            });
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));
            expect(mockGenerateStaticPage).toHaveBeenCalledWith('privacy-policy', expect.anything());
            expect(mockGenerateStaticPage).toHaveBeenCalledWith('terms', expect.anything());
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
            const paths = mockDeployBatchToHosting.mock.calls[0][1].files.map((f: { path: string }) => f.path);
            expect(paths).toEqual(expect.arrayContaining(['/pages/privacy-policy/index.html', '/pages/terms/index.html']));
        });

        it('should release everything as a single Hosting version', async () => {
            mockGenerateDetailPage.mockImplementation(async (slug: string, id: string, batch: any) => {
                batch.add(`/${slug}/${id}.html`, '<html></html>');
            });

            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));

            // Two releases would rebuild the second from a file list that does
            // not yet contain the first, dropping it — the race this exists to
            // avoid.
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
        });

        it('claims the one whole-site item and finishes it after the release and the reindex', async () => {
            const event = createEvent('redeploy-all', '', '', 'redeploy-all');
            await handler(event);
            expect(mockClaimCoalesced).toHaveBeenCalledWith('redeploy-all');
            expect(mockFinishCoalesced).toHaveBeenCalledWith('redeploy-all', undefined);
            expect(event.data.ref.delete).not.toHaveBeenCalled();
        });

        it('finishes it as failed when the rebuild fails too, so it runs again rather than blocking the next one', async () => {
            mockGenerateHome.mockRejectedValueOnce(new Error('no home'));
            mockGenerateStaticPage.mockRejectedValue(new Error('no page'));
            mockDeployBatchToHosting.mockRejectedValue(new Error('release failed'));
            mockGenerateDetailPage.mockImplementation(async (slug: string, id: string, batch: any) => batch.add(`/${slug}/${id}.html`, 'x'));
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));
            expect(mockFinishCoalesced).toHaveBeenCalledWith('redeploy-all', undefined, { failed: true, error: 'release failed' });
            expect(mockRunReindex).not.toHaveBeenCalled();
            mockGenerateStaticPage.mockReset();
        });

        it('finishes it as failed when its release does not go out, so the republish is not dropped', async () => {
            vi.stubEnv('ARC_HOSTING_SITE', 'my-site');
            mockGenerateDetailPage.mockImplementation(async (slug: string, id: string, batch: any) => batch.add(`/${slug}/${id}.html`, 'x'));
            mockDeployBatchToHosting.mockImplementation(async (_s, _b, _c, _d, options: { onFailure?: (f: { code: string; message: string }) => void }) => {
                options.onFailure?.({ code: 'HOSTING_RELEASE_BUSY', message: 'busy' });
                return false;
            });
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));
            vi.unstubAllEnvs();
            expect(mockFinishCoalesced).toHaveBeenCalledWith('redeploy-all', undefined, { failed: true, error: 'HOSTING_RELEASE_BUSY: busy' });
            expect(mockSubmitBatchToIndexNow).not.toHaveBeenCalled();
        });

        it('still releases the pages when the sitemap cannot be built', async () => {
            const sitemap = (await import('../pages/generateSitemap.js')).generateAndDeploySitemap as unknown as ReturnType<typeof vi.fn>;
            sitemap.mockRejectedValueOnce(new Error('no sitemap'));
            mockGenerateDetailPage.mockImplementation(async (slug: string, id: string, batch: any) => batch.add(`/${slug}/${id}.html`, 'x'));
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));
            expect(sitemap).toHaveBeenCalled();
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
            expect(mockDeployBatchToHosting.mock.calls[0][1].paths).toContain('/articles/doc1.html');
            expect(mockFinishCoalesced).toHaveBeenCalledWith('redeploy-all', undefined);
        });

        describe('a site with more pages than fit in one run', () => {
            let clock = 0;
            beforeEach(() => {
                clock = Date.now();
                vi.spyOn(Date, 'now').mockImplementation(() => clock);
                // Each page takes the whole build budget: the run stops after the first.
                mockGenerateDetailPage.mockImplementation(async (slug: string, id: string, batch: any) => {
                    batch.add(`/${slug}/${id}.html`, 'x');
                    clock += COALESCED_BUILD_MS;
                });
                mockGenerateStaticPage.mockImplementation(async (slug: string, batch: any) => batch.add(`/pages/${slug}/index.html`, 'x'));
            });
            afterEach(() => {
                vi.mocked(Date.now).mockRestore();
                mockGenerateStaticPage.mockReset();
            });

            it('releases what it built and queues the rest, from where it stopped', async () => {
                await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));

                expect(mockGenerateDetailPage.mock.calls.map(([, id]) => id)).toEqual(['doc1']);
                expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
                expect(mockDeployBatchToHosting.mock.calls[0][1].paths).toEqual(['/articles/doc1.html']);
                // The home page, static pages and the reindex wait for the last part.
                expect(mockGenerateHome).not.toHaveBeenCalled();
                expect(mockGenerateStaticPage).not.toHaveBeenCalled();
                expect(mockRunReindex).not.toHaveBeenCalled();
                expect(mockFinishCoalesced).toHaveBeenCalledWith('redeploy-all', { after: { type: 'articles', id: 'doc1' } });
            });

            it('goes on from a continuation, then rebuilds the rest of the site with the last part', async () => {
                mockClaimCoalesced.mockResolvedValueOnce({ state: 'running', after: { type: 'articles', id: 'doc1' } });
                await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));

                expect(mockGenerateDetailPage.mock.calls.map(([, id]) => id)).toEqual(['doc2']);
                expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
                expect(mockGenerateHome).toHaveBeenCalledTimes(1);
                expect(mockGenerateStaticPage).toHaveBeenCalledTimes(2);
                expect(mockRunReindex).toHaveBeenCalledTimes(1);
                expect(mockFinishCoalesced).toHaveBeenCalledWith('redeploy-all', undefined);
            });
        });

        it('rebuilds nothing when another delivery of the trigger is running it', async () => {
            mockClaimCoalesced.mockResolvedValueOnce(null);
            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockFinishCoalesced).not.toHaveBeenCalled();
        });

        it('turns one added any other way (the admin\'s Republish button) into a request for the one item', async () => {
            const event = createEvent('redeploy-all', '', '', 'abc123');
            await handler(event);
            expect(requested('redeploy-all')).toHaveLength(1);
            expect(event.data.ref.delete).toHaveBeenCalled();
            expect(mockClaimCoalesced).not.toHaveBeenCalled();
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
        });

        it('should keep going when one page cannot be rebuilt', async () => {
            mockGenerateDetailPage.mockImplementation(async (_slug: string, id: string) => {
                if (id === 'doc1') throw new Error('template missing');
            });

            await handler(createEvent('redeploy-all', '', '', 'redeploy-all'));

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc2', expect.anything(), expect.anything());
        });
    });

    describe('the Hosting release target', () => {
        it('should release to the project site, not to the Firestore collection', async () => {
            process.env.GCLOUD_PROJECT = 'my-site';
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Test', content: '<p>body</p>', urlSlug: 'test' }),
            });
            // An empty batch is never released, so the page generator has to
            // put something in it for there to be a release to inspect.
            mockGenerateDetailPage.mockImplementation(async (_slug: string, _id: string, batch: any) => {
                batch.add('/articles/test.html', '<html></html>');
            });

            await handler(createEvent('publish', 'articles', 'doc1'));

            // Passing 'arc_articles' here aims the deploy at a site that does
            // not exist, and nothing reaches the live site.
            expect(mockDeployBatchToHosting).toHaveBeenCalledWith(
                'my-site', expect.anything(), 'arc_articles', 'doc1', expect.anything(),
            );
        });

        it('waits for the release lock once more rather than failing the publish, within the run\'s time', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Test', urlSlug: 'test' }) });
            mockGenerateDetailPage.mockImplementation(async (_slug: string, _id: string, batch: any) => batch.add('/articles/test.html', 'x'));
            const before = Date.now();
            await handler(createEvent('publish', 'articles', 'doc1'));

            const options = mockDeployBatchToHosting.mock.calls[0][4];
            expect(options.busyRetries).toBe(1);
            expect(options.deadline).toBeGreaterThanOrEqual(before + RELEASE_BY_MS);
            expect(options.deadline).toBeLessThanOrEqual(Date.now() + RELEASE_BY_MS);
        });
    });

    describe('IndexNow only after a real release (CO5)', () => {
        const publishOne = async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Test', content: '<p>body</p>', urlSlug: 'test' }),
            });
            mockGenerateDetailPage.mockImplementation(async (_slug: string, _id: string, batch: any) => {
                batch.add('/articles/test.html', '<html></html>');
            });
            await handler(createEvent('publish', 'articles', 'doc1'));
        };

        it('pings search engines when the release went out', async () => {
            mockDeployBatchToHosting.mockResolvedValue(true);
            await publishOne();
            expect(mockSubmitBatchToIndexNow).toHaveBeenCalled();
        });

        it('does not ping for pages that never went live (release failed, or hosting is off)', async () => {
            mockDeployBatchToHosting.mockResolvedValue(false);
            await publishOne();
            expect(mockSubmitBatchToIndexNow).not.toHaveBeenCalled();
        });
    });

    describe('redeploy action — restoring pages a hosting deploy dropped', () => {
        it('should regenerate the detail and list pages', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Live', content: '<p>body</p>', urlSlug: 'test' }),
            });

            await handler(createEvent('redeploy', 'articles', 'doc1'));

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should not touch the draft or the published document', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Live', content: '<p>body</p>', urlSlug: 'test' }),
            });

            await handler(createEvent('redeploy', 'articles', 'doc1'));

            // The whole point: a draft may hold unreviewed edits, so restoring
            // the site must not publish them.
            expect(mockSet).not.toHaveBeenCalled();
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(mockBatchCommit).not.toHaveBeenCalled();
        });

        it('should do nothing when the document was never published', async () => {
            mockGet.mockResolvedValue({ exists: false });

            const event = createEvent('redeploy', 'articles', 'ghost');
            await handler(event);

            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(event.data.ref.delete).toHaveBeenCalled();
        });

        it('should skip deployment for content types without a public URL', async () => {
            buildChain({ hasPublicUrl: false });
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Live', urlSlug: 'test' }),
            });

            await handler(createEvent('redeploy', 'internal-notes', 'doc1'));

            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
        });
    });

    describe('update action — static HTML deployment', () => {
        it('should generate detail page after update', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    title: 'Updated',
                    content: '<p>updated body</p>',
                    urlSlug: 'test',
                }),
            });

            const event = createEvent('update', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
        });

        it('should generate list page after update', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    title: 'Updated',
                    content: '<p>updated body</p>',
                    urlSlug: 'test',
                }),
            });

            const event = createEvent('update', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should not block Firestore sync when deployment fails on update', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    title: 'Updated',
                    content: '<p>updated body</p>',
                    urlSlug: 'test',
                }),
            });
            mockGenerateListPage.mockRejectedValue(new Error('Deploy failed'));

            const event = createEvent('update', 'articles', 'doc1');
            await handler(event);

            // Queue doc should still be cleaned up
            expect(event.data.ref.delete).toHaveBeenCalled();
        });
    });

    describe('hasPublicUrl filtering (ContentType-level)', () => {
        it('should skip all static HTML when ContentType.hasPublicUrl is false on publish', async () => {
            buildChain({ hasPublicUrl: false });
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Item', content: '<p>body</p>', urlSlug: 'item' }),
            });

            const event = createEvent('publish', 'people', 'doc1');
            await handler(event);

            // Firestore batch write should still happen
            expect(mockBatchCommit).toHaveBeenCalled();
            // But NO static HTML deployment
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
        });

        it('should skip all static HTML when ContentType.hasPublicUrl is false on update', async () => {
            buildChain({ hasPublicUrl: false });
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Item', content: '<p>body</p>', urlSlug: 'item' }),
            });

            const event = createEvent('update', 'people', 'doc1');
            await handler(event);

            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
        });

        // SS1 (specs/site-sections-spec.md): the home page can show cards of a
        // type without public pages, so publishing one republishes it.
        it('republishes the home page for a type without public pages when the home page shows it', async () => {
            buildChain({ hasPublicUrl: false });
            mockGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Design', urlSlug: 'design' }) });
            mockHomeShowsType.mockResolvedValueOnce(true);

            await handler(createEvent('publish', 'services', 'doc1'));

            expect(mockGenerateHome).toHaveBeenCalledTimes(1);
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
        });

        it('leaves the home page alone for a type it does not show', async () => {
            buildChain({ hasPublicUrl: false });
            mockGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Design', urlSlug: 'design' }) });

            await handler(createEvent('publish', 'services', 'doc1'));

            expect(mockGenerateHome).not.toHaveBeenCalled();
        });

        it('should deploy static HTML when ContentType.hasPublicUrl is undefined (backward compat)', async () => {
            buildChain({ name: 'Articles' }); // no hasPublicUrl field
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Item', content: '<p>body</p>', urlSlug: 'item' }),
            });

            const event = createEvent('publish', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should deploy static HTML when ContentType.hasPublicUrl is true', async () => {
            buildChain({ hasPublicUrl: true });
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ title: 'Item', content: '<p>body</p>', urlSlug: 'item' }),
            });

            const event = createEvent('publish', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });
    });

    describe('unpublish action — static HTML removal', () => {
        it('should remove content page on unpublish', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ urlSlug: 'my-article' }),
            });

            const event = createEvent('unpublish', 'articles', 'doc1');
            await handler(event);

            expect(mockRemoveContentPage).toHaveBeenCalledWith('articles', 'my-article', expect.anything());
        });

        it('should regenerate list page on unpublish', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ urlSlug: 'my-article' }),
            });

            const event = createEvent('unpublish', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should skip page removal when urlSlug is missing', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({}),
            });

            const event = createEvent('unpublish', 'articles', 'doc1');
            await handler(event);

            expect(mockRemoveContentPage).not.toHaveBeenCalled();
            // But list should still regenerate
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });
    });

    describe('delete action — static HTML removal', () => {
        it('should remove content page on delete', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ urlSlug: 'my-article' }),
            });

            const event = createEvent('delete', 'articles', 'doc1');
            await handler(event);

            expect(mockRemoveContentPage).toHaveBeenCalledWith('articles', 'my-article', expect.anything());
        });

        it('should regenerate list page on delete', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ urlSlug: 'my-article' }),
            });

            const event = createEvent('delete', 'articles', 'doc1');
            await handler(event);

            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should not block on removal failure during delete', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ urlSlug: 'my-article' }),
            });
            mockRemoveContentPage.mockRejectedValue(new Error('Remove failed'));

            const event = createEvent('delete', 'articles', 'doc1');
            await handler(event);

            // Queue doc should still be cleaned up
            expect(event.data.ref.delete).toHaveBeenCalled();
        });
    });
});

describe('the queue run\'s time budget', () => {
    it('fits building, the longest wait for the release lock, the release and what follows in the function\'s timeout', () => {
        const longestWait = Math.min(RELEASE_LOCK_WAIT_MS, RELEASE_BY_MS - COALESCED_BUILD_MS - RELEASE_TIME_MS);
        expect(longestWait).toBeGreaterThan(60_000);
        expect(COALESCED_BUILD_MS + longestWait + RELEASE_TIME_MS).toBeLessThanOrEqual(RELEASE_BY_MS);
        expect(RELEASE_BY_MS).toBeLessThan(QUEUE_TIMEOUT_MS);
    });
});

describe('collectionHelpers', () => {
    it('should extract content type slug from draft collection name', async () => {
        const { extractContentTypeSlug } = await import('../draftContent/collectionHelpers.js');

        expect(extractContentTypeSlug('arc_articles_drafts')).toBe('articles');
        expect(extractContentTypeSlug('arc_journals_drafts')).toBe('journals');
        expect(extractContentTypeSlug('arc_user_manuals_drafts')).toBe('user_manuals');
    });

    it('should return null for non-draft collections', async () => {
        const { extractContentTypeSlug } = await import('../draftContent/collectionHelpers.js');

        expect(extractContentTypeSlug('DraftContents')).toBeNull();
        expect(extractContentTypeSlug('Contents')).toBeNull();
        expect(extractContentTypeSlug('users')).toBeNull();
        expect(extractContentTypeSlug('arc_articles')).toBeNull();
        expect(extractContentTypeSlug('_publish_queue')).toBeNull();
    });

    it('should generate correct published collection name', async () => {
        const { getPublishedCollectionName } = await import('../draftContent/collectionHelpers.js');

        expect(getPublishedCollectionName('articles')).toBe('arc_articles');
        expect(getPublishedCollectionName('journals')).toBe('arc_journals');
    });

    it('should generate correct draft collection name', async () => {
        const { getDraftCollectionName } = await import('../draftContent/collectionHelpers.js');

        expect(getDraftCollectionName('articles')).toBe('arc_articles_drafts');
        expect(getDraftCollectionName('journals')).toBe('arc_journals_drafts');
    });
});

describe('processPublishQueue — batched writes', () => {
    it('should use batched writes for publish and update actions', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const fileContent = fs.readFileSync(
            path.resolve(__dirname, '../publishQueue/processPublishQueue.ts'),
            'utf-8'
        );

        // Both publish and update should use batch
        expect(fileContent).toContain('db.batch()');
        expect(fileContent).toMatch(/publishBatch\.set\(/);
        expect(fileContent).toMatch(/publishBatch\.commit\(\)/);
        expect(fileContent).toMatch(/updateBatch\.set\(/);
        expect(fileContent).toMatch(/updateBatch\.commit\(\)/);
    });
    // ── Translation syncing (M3) ────────────────────────────────────────────

    describe('translation syncing', () => {
        /** First get() is the draft's translations, second the published copy. */
        function withTranslations(draftLangs: string[], publishedLangs: string[] = draftLangs) {
            mockSubCollectionGet
                .mockResolvedValueOnce({
                    docs: draftLangs.map(lang => ({ id: lang, data: () => ({ lang, title: `${lang} title` }) })),
                    empty: draftLangs.length === 0,
                })
                .mockResolvedValueOnce({
                    docs: publishedLangs.map(lang => ({ id: lang, ref: { id: lang }, data: () => ({ lang }) })),
                    empty: publishedLangs.length === 0,
                });
        }

        it('should copy draft translations to the published document on publish', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ urlSlug: 'a', title: 'A' }) });
            withTranslations(['hi']);

            await handler(createEvent('publish', 'articles', 'doc1'));

            // The published doc itself, its history entry, and the hi variant.
            const written = mockBatchSet.mock.calls.map(call => call[1]);
            expect(written).toContainEqual(expect.objectContaining({ lang: 'hi', title: 'hi title' }));
        });

        it('should delete published languages the draft no longer has', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ urlSlug: 'a', title: 'A' }) });
            withTranslations([], ['hi']); // translation cleared in the editor

            await handler(createEvent('publish', 'articles', 'doc1'));

            expect(mockBatchDelete).toHaveBeenCalled();
        });

        it('should still publish when the translation sync fails', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ urlSlug: 'a', title: 'A' }) });
            mockSubCollectionGet.mockRejectedValue(new Error('denied'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await handler(createEvent('publish', 'articles', 'doc1'));

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
            consoleSpy.mockRestore();
        });

        it('should remove translations when unpublishing', async () => {
            mockGet.mockResolvedValue({ exists: true, data: () => ({ urlSlug: 'a' }) });
            mockSubCollectionGet.mockResolvedValue({
                docs: [{ id: 'hi', ref: { id: 'hi' } }],
                empty: false,
            });

            await handler(createEvent('unpublish', 'articles', 'doc1'));

            expect(mockBatchDelete).toHaveBeenCalled();
        });
    });
});
