import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    generateAndDeploySitemap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../pages/generateRssFeed', () => ({
    generateAndDeployRssFeeds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: vi.fn(),
    Timestamp: {
        now: () => ({ seconds: 1705334400, nanoseconds: 0 }),
    },
    FieldValue: {
        increment: vi.fn((n: number) => ({ _increment: n })),
        serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
    },
}));

import { processPublishQueue } from '../publishQueue/processPublishQueue.js';

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

function createEvent(action: string, contentTypeSlug: string, docId: string) {
    const deleteRef = vi.fn().mockResolvedValue(undefined);
    return {
        data: {
            data: () => ({
                action,
                contentTypeSlug,
                docId,
                timestamp: { seconds: 1705334400, nanoseconds: 0 },
            }),
            ref: { delete: deleteRef },
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('processPublishQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildChain();
        mockSubCollectionGet.mockResolvedValue({ docs: [], empty: true });
        mockDeployBatchToHosting.mockResolvedValue(undefined);
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
            await handler(createEvent('redeploy-all', '', ''));

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc1', expect.anything());
            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc2', expect.anything());
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles', expect.anything());
        });

        it('should skip content types without a public URL', async () => {
            await handler(createEvent('redeploy-all', '', ''));

            expect(mockGenerateDetailPage).not.toHaveBeenCalledWith('notes', expect.anything(), expect.anything());
        });

        it('should release everything as a single Hosting version', async () => {
            mockGenerateDetailPage.mockImplementation(async (slug: string, id: string, batch: any) => {
                batch.add(`/${slug}/${id}.html`, '<html></html>');
            });

            await handler(createEvent('redeploy-all', '', ''));

            // Two releases would rebuild the second from a file list that does
            // not yet contain the first, dropping it — the race this exists to
            // avoid.
            expect(mockDeployBatchToHosting).toHaveBeenCalledTimes(1);
        });

        it('should keep going when one page cannot be rebuilt', async () => {
            mockGenerateDetailPage.mockImplementation(async (_slug: string, id: string) => {
                if (id === 'doc1') throw new Error('template missing');
            });

            await handler(createEvent('redeploy-all', '', ''));

            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'doc2', expect.anything());
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
                'my-site', expect.anything(), 'arc_articles', 'doc1',
            );
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
