import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
    mockFetch,
    mockDeployFileToHosting,
    mockGetPartials,
    mockGetSiteConfig,
    mockGetMiscSettings,
    mockDocGet,
    mockContentTypeWhere,
    mockContentTypeLimitGet,
    mockContentsOrderBy,
    mockContentsGet,
    mockCollection,
    mockTopDoc,
} = vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockDeployFileToHosting: vi.fn(),
    mockGetPartials: vi.fn(),
    mockGetSiteConfig: vi.fn(),
    mockGetMiscSettings: vi.fn(),
    mockDocGet: vi.fn(),
    mockContentTypeWhere: vi.fn(),
    mockContentTypeLimitGet: vi.fn(),
    mockContentsOrderBy: vi.fn(),
    mockContentsGet: vi.fn(),
    mockCollection: vi.fn(),
    mockTopDoc: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('../init', () => ({
    db: {
        collection: mockCollection,
        doc: mockTopDoc,
    },
}));

vi.mock('../pages/deployToHosting', () => ({
    deployFileToHosting: mockDeployFileToHosting,
}));

vi.mock('../shared/site-settings', () => ({
    getPartials: mockGetPartials,
    getSiteConfig: mockGetSiteConfig,
    getMiscSettings: mockGetMiscSettings,
}));

import { generateAndDeployContentListPage } from '../pages/deployContentListPage.js';

// ─── Test Data ──────────────────────────────────────────────────────────────

const MOCK_CONTENT_TYPE = {
    name: 'Articles',
    slug: 'articles',
    description: 'Latest news and updates',
    templateFolder: 'articles',
    fields: [],
};

const MOCK_CONTENTS = [
    {
        id: 'doc1',
        title: 'First Article',
        content: '<p>First article body content.</p>',
        urlSlug: 'first-article',
        coverImage: 'https://example.com/img1.jpg',
        tags: ['javascript'],
        tagsWithColors: [{ name: 'javascript', color: '#f7df1e' }],
        publishedOn: { seconds: 1705334400, nanoseconds: 0 },
        metaDescription: 'First article description',
        publishedStatus: true,
    },
    {
        id: 'doc2',
        title: 'Second Article',
        content: '<p>Second article body content.</p>',
        urlSlug: 'second-article',
        coverImage: '',
        tags: ['testing'],
        publishedOn: { seconds: 1705248000, nanoseconds: 0 },
        metaDescription: 'Second article description',
        publishedStatus: true,
    },
];

const MOCK_PARTIALS = {
    headerHtml: '<header>Site Header</header>',
    footerHtml: '<footer>Site Footer</footer>',
};

const MOCK_SITE_CONFIG = {
    siteName: 'Test Site',
    baseUrl: 'https://example.com',
    cssUrls: ['/assets/css/main.css'],
};

const MOCK_LIST_TEMPLATE = `<div class="arc-cms-template">
    <arc-header></arc-header>
    <h1 data-arc-bind="contentType">Title</h1>
    <p data-arc-bind="contentTypeDescription">Description</p>
    <div data-arc-loop="items" data-limit="12">
        <a href="{{ url }}">
            <h2>{{ title }}</h2>
            <time>{{ publishedOn }}</time>
            <p>{{ excerpt }}</p>
        </a>
    </div>
    <arc-footer></arc-footer>
</div>`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function restoreMockImplementations() {
    mockGetPartials.mockResolvedValue(MOCK_PARTIALS);
    mockGetSiteConfig.mockResolvedValue(MOCK_SITE_CONFIG);
    mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });
    mockDeployFileToHosting.mockResolvedValue(undefined);

    // ContentTypes query chain
    mockContentTypeLimitGet.mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ ...MOCK_CONTENT_TYPE }) }],
    });

    // Published contents query chain
    mockContentsGet.mockResolvedValue({
        docs: MOCK_CONTENTS.map(c => ({
            id: c.id,
            data: () => ({ ...c }),
        })),
    });

    mockContentsOrderBy.mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockContentsGet }) });

    mockCollection.mockImplementation((name: string) => {
        if (name === 'ContentTypes') {
            return {
                where: mockContentTypeWhere.mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        get: mockContentTypeLimitGet,
                    }),
                }),
            };
        }
        // Published content collection (arc_*)
        return {
            orderBy: mockContentsOrderBy,
        };
    });

    // Template doc (Tier 1)
    mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ html: MOCK_LIST_TEMPLATE }),
    });
    mockTopDoc.mockReturnValue({ get: mockDocGet });

    // Tier 2 fetch
    mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(MOCK_LIST_TEMPLATE),
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('deployContentListPage', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        restoreMockImplementations();
        process.env.GCLOUD_PROJECT = 'test-project';
    });

    describe('source code structure', () => {
        it('should limit published content query to 100 items', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../pages/deployContentListPage.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('.limit(100)');
        });
    });

    describe('Firestore reads', () => {
        it('should read ContentType from ContentTypes where slug matches', async () => {
            await generateAndDeployContentListPage('articles');

            expect(mockCollection).toHaveBeenCalledWith('ContentTypes');
            expect(mockContentTypeWhere).toHaveBeenCalledWith('slug', '==', 'articles');
        });

        it('should read all published content ordered by publishedOn desc', async () => {
            await generateAndDeployContentListPage('articles');

            expect(mockCollection).toHaveBeenCalledWith('arc_articles');
            expect(mockContentsOrderBy).toHaveBeenCalledWith('publishedOn', 'desc');
        });
    });

    describe('Template 3-tier fallback', () => {
        it('Tier 1: should load from Firestore html field', async () => {
            await generateAndDeployContentListPage('articles');

            expect(mockTopDoc).toHaveBeenCalledWith('templates/articles:list');
        });

        it('Tier 1 fallback: should use originalHtml when html missing', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ originalHtml: MOCK_LIST_TEMPLATE }),
            });

            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Articles');
        });

        it('Tier 2: should fetch from hosting when Firestore doc missing', async () => {
            mockDocGet.mockResolvedValue({ exists: false, data: () => null });

            await generateAndDeployContentListPage('articles');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-project.web.app/templates/articles/list.html',
            );
        });

        it('Tier 3: should use fallback when Tier 1+2 fail', async () => {
            mockDocGet.mockRejectedValue(new Error('Firestore error'));
            mockFetch.mockRejectedValue(new Error('Network error'));

            await generateAndDeployContentListPage('articles');

            expect(mockDeployFileToHosting).toHaveBeenCalled();
            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('First Article');
        });

        it('should skip Tier 1+2 when templateFolder is "default"', async () => {
            mockContentTypeLimitGet.mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ ...MOCK_CONTENT_TYPE, templateFolder: 'default' }) }],
            });

            await generateAndDeployContentListPage('articles');

            expect(mockTopDoc).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockDeployFileToHosting).toHaveBeenCalled();
        });
    });

    describe('Content hydration', () => {
        it('should hydrate content type name into template', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Articles');
        });

        it('should hydrate content type description', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Latest news and updates');
        });

        it('should include all content items in the loop', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('First Article');
            expect(deployedHtml).toContain('Second Article');
        });

        it('should generate correct URLs for content items', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('/articles/first-article');
            expect(deployedHtml).toContain('/articles/second-article');
        });

        it('should format dates in short format', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            // Short format: "Jan 15, 2024" (not "January 15, 2024")
            expect(deployedHtml).toContain('Jan 15, 2024');
        });

        it('should include excerpt from metaDescription', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('First article description');
        });
    });

    describe('Deployment', () => {
        it('should deploy to /{slug}/index.html', async () => {
            await generateAndDeployContentListPage('articles');

            expect(mockDeployFileToHosting).toHaveBeenCalledWith(
                'test-project',
                '/articles/index.html',
                expect.any(String),
                'arc_articles',
                'doc1',
            );
        });

        it('should build HTML with SEO meta tags', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('<title>Articles</title>');
            expect(deployedHtml).toContain('Latest news and updates');
            expect(deployedHtml).toContain('arc-served-by');
            expect(deployedHtml).toContain('og:type');
        });

        it('should use canonical URL based on content type slug', async () => {
            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('https://example.com/articles');
        });
    });

    describe('Powered-by footer', () => {
        it('should include "Powered by Arc CMS" when showPoweredBy is true', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });

            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Powered by');
            expect(deployedHtml).toContain('arccms.com');
        });

        it('should NOT include "Powered by Arc CMS" when showPoweredBy is false', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: false });

            await generateAndDeployContentListPage('articles');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).not.toContain('Powered by');
            expect(deployedHtml).not.toContain('arccms.com');
        });
    });

    describe('Error handling', () => {
        it('should throw CONTENT_TYPE_NOT_FOUND when ContentType missing', async () => {
            mockContentTypeLimitGet.mockResolvedValue({ empty: true, docs: [] });

            await expect(
                generateAndDeployContentListPage('articles'),
            ).rejects.toThrow('Content type configuration not found');
        });

        it('should handle empty content list gracefully', async () => {
            mockContentsGet.mockResolvedValue({ docs: [] });

            await generateAndDeployContentListPage('articles');

            // Should still deploy (empty list page)
            expect(mockDeployFileToHosting).toHaveBeenCalled();
            // Deploy doc ID should be placeholder since no content docs
            expect(mockDeployFileToHosting.mock.calls[0][4]).toBe('_list_index');
        });
    });
});
