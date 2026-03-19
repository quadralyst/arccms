import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
    mockCollectionGet,
    mockGenerateDetailPage,
    mockGenerateListPage,
    mockGenerateStaticPage,
    mockClearSettingsCache,
    mockGetPartials,
    mockGetSiteConfig,
    mockGenerateRobotsTxt,
    mockGenerateSitemap,
    mockGenerateRssFeeds,
} = vi.hoisted(() => ({
    mockCollectionGet: vi.fn(),
    mockGenerateDetailPage: vi.fn(),
    mockGenerateListPage: vi.fn(),
    mockGenerateStaticPage: vi.fn(),
    mockClearSettingsCache: vi.fn(),
    mockGetPartials: vi.fn(),
    mockGetSiteConfig: vi.fn(),
    mockGenerateRobotsTxt: vi.fn(),
    mockGenerateSitemap: vi.fn(),
    mockGenerateRssFeeds: vi.fn(),
}));

vi.mock('../init', () => ({
    db: {
        collection: vi.fn().mockReturnValue({
            get: mockCollectionGet,
            orderBy: vi.fn().mockReturnValue({ get: mockCollectionGet }),
        }),
    },
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((_opts: any, handler: any) => handler),
}));

vi.mock('../shared/site-settings', () => ({
    clearSettingsCache: mockClearSettingsCache,
    getPartials: mockGetPartials,
    getSiteConfig: mockGetSiteConfig,
}));

vi.mock('../pages/deployContentPage', () => ({
    generateAndDeployContentDetailPage: mockGenerateDetailPage,
}));

vi.mock('../pages/deployContentListPage', () => ({
    generateAndDeployContentListPage: mockGenerateListPage,
}));

vi.mock('../pages/deployStaticPage', () => ({
    generateAndDeployStaticPage: mockGenerateStaticPage,
}));

vi.mock('../pages/generateRobotsTxt', () => ({
    generateAndDeployRobotsTxt: mockGenerateRobotsTxt,
}));

vi.mock('../pages/generateSitemap', () => ({
    generateAndDeploySitemap: mockGenerateSitemap,
}));

vi.mock('../pages/generateRssFeed', () => ({
    generateAndDeployRssFeeds: mockGenerateRssFeeds,
}));

import { seedStaticPages, runSeed } from '../pages/seedStaticPages.js';

// The mock of onCall returns the handler directly
const handler = seedStaticPages as unknown as (request: any) => Promise<any>;

// ─── Test Data ──────────────────────────────────────────────────────────────

const MOCK_CONTENT_TYPES = [
    { id: 'ct1', slug: 'articles', name: 'Articles', templateFolder: 'articles' },
    { id: 'ct2', slug: 'manuals', name: 'Manuals', templateFolder: 'manuals' },
];

const MOCK_ARTICLES = [
    { id: 'a1', urlSlug: 'first-article', title: 'First Article' },
    { id: 'a2', urlSlug: 'second-article', title: 'Second Article' },
];

const MOCK_MANUALS = [
    { id: 'm1', urlSlug: 'install-guide', title: 'Install Guide' },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('seedStaticPages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateDetailPage.mockResolvedValue(undefined);
        mockGenerateListPage.mockResolvedValue(undefined);
        mockGenerateStaticPage.mockResolvedValue(undefined);
        mockGenerateRobotsTxt.mockResolvedValue(undefined);
        mockGenerateSitemap.mockResolvedValue(undefined);
        mockGenerateRssFeeds.mockResolvedValue(undefined);
        // Default: valid settings so existing tests pass validation
        mockGetPartials.mockResolvedValue({ headerHtml: '<header>Site</header>', footerHtml: '<footer/>' });
        mockGetSiteConfig.mockResolvedValue({ siteName: 'Test', baseUrl: 'https://example.web.app', cssUrls: [] });
    });

    describe('registration', () => {
        it('should register as an onCall function with 540s timeout and 512MiB memory', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../pages/seedStaticPages.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('timeoutSeconds: 540');
            expect(fileContent).toContain("memory: '512MiB'");
            expect(fileContent).toContain('onCall');
        });

        it('should export runSeed for direct CLI usage', () => {
            expect(typeof runSeed).toBe('function');
        });
    });

    describe('happy path', () => {
        beforeEach(() => {
            // First call: ContentTypes, then subsequent calls: content collections
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: MOCK_CONTENT_TYPES.map(ct => ({
                        id: ct.id,
                        data: () => ct,
                    })),
                })
                .mockResolvedValueOnce({
                    docs: MOCK_ARTICLES.map(a => ({
                        id: a.id,
                        data: () => a,
                    })),
                })
                .mockResolvedValueOnce({
                    docs: MOCK_MANUALS.map(m => ({
                        id: m.id,
                        data: () => m,
                    })),
                });
        });

        it('should clear settings cache before seeding', async () => {
            await handler({});
            expect(mockClearSettingsCache).toHaveBeenCalled();
        });

        it('should deploy detail pages for all published content', async () => {
            await handler({});

            // 2 articles + 1 manual = 3 detail pages
            expect(mockGenerateDetailPage).toHaveBeenCalledTimes(3);
            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'a1');
            expect(mockGenerateDetailPage).toHaveBeenCalledWith('articles', 'a2');
            expect(mockGenerateDetailPage).toHaveBeenCalledWith('manuals', 'm1');
        });

        it('should deploy list pages for each content type', async () => {
            await handler({});

            expect(mockGenerateListPage).toHaveBeenCalledTimes(2);
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles');
            expect(mockGenerateListPage).toHaveBeenCalledWith('manuals');
        });

        it('should deploy static pages (privacy-policy, cookie-policy)', async () => {
            await handler({});

            expect(mockGenerateStaticPage).toHaveBeenCalledTimes(2);
            expect(mockGenerateStaticPage).toHaveBeenCalledWith('privacy-policy');
            expect(mockGenerateStaticPage).toHaveBeenCalledWith('cookie-policy');
        });

        it('should return correct deployed count including static pages and SEO files', async () => {
            const result = await handler({});

            // 3 detail pages + 2 list pages + 2 static pages + 3 SEO files = 10
            expect(result.deployed).toBe(10);
            expect(result.errors).toBe(0);
            expect(result.success).toBe(true);
        });

        it('should return summary details', async () => {
            const result = await handler({});

            expect(result.details).toEqual(expect.arrayContaining([
                expect.stringContaining('Found 2 content type(s)'),
                expect.stringContaining('Static pages: 2 page(s)'),
            ]));
        });
    });

    describe('empty states', () => {
        it('should still deploy static pages and SEO files when no ContentTypes exist', async () => {
            mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });

            const result = await handler({});

            // 0 content pages + 2 static pages + 3 SEO files = 5
            expect(result.deployed).toBe(5);
            expect(result.errors).toBe(0);
            expect(result.success).toBe(true);
            expect(mockGenerateStaticPage).toHaveBeenCalledTimes(2);
            expect(result.details).toEqual(expect.arrayContaining([
                expect.stringContaining('No ContentTypes found'),
            ]));
        });

        it('should handle content type with no published content', async () => {
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'ct1', data: () => MOCK_CONTENT_TYPES[0] }],
                })
                .mockResolvedValueOnce({ docs: [] });

            const result = await handler({});

            // 0 detail pages + 1 list page + 2 static pages + 3 SEO files = 6
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles');
            expect(result.deployed).toBe(6);
        });

        it('should skip content types without a slug but still deploy static pages', async () => {
            mockCollectionGet.mockResolvedValueOnce({
                empty: false,
                docs: [{ id: 'ct_bad', data: () => ({ id: 'ct_bad', name: 'No Slug' }) }],
            });

            const result = await handler({});

            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
            expect(mockGenerateStaticPage).toHaveBeenCalledTimes(2);
            expect(result.deployed).toBe(5); // 2 static pages + 3 SEO files
            expect(result.details).toEqual(expect.arrayContaining([
                expect.stringContaining('no slug'),
            ]));
        });
    });

    describe('error handling', () => {
        it('should continue deploying when a detail page fails', async () => {
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'ct1', data: () => MOCK_CONTENT_TYPES[0] }],
                })
                .mockResolvedValueOnce({
                    docs: MOCK_ARTICLES.map(a => ({
                        id: a.id,
                        data: () => a,
                    })),
                });

            // First article fails, second succeeds
            mockGenerateDetailPage
                .mockRejectedValueOnce(new Error('Template not found'))
                .mockResolvedValueOnce(undefined);

            const result = await handler({});

            // Should still call for second article + list page + 2 static pages + 3 SEO files
            expect(mockGenerateDetailPage).toHaveBeenCalledTimes(2);
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles');
            expect(result.deployed).toBe(7); // second article + list + 2 static + 3 SEO
            expect(result.errors).toBe(1);
            expect(result.success).toBe(false);
            expect(result.errorDetails).toEqual(expect.arrayContaining([
                expect.stringContaining('Template not found'),
            ]));
        });

        it('should continue when a list page fails', async () => {
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: MOCK_CONTENT_TYPES.map(ct => ({
                        id: ct.id,
                        data: () => ct,
                    })),
                })
                .mockResolvedValueOnce({
                    docs: MOCK_ARTICLES.map(a => ({
                        id: a.id,
                        data: () => a,
                    })),
                })
                .mockResolvedValueOnce({
                    docs: MOCK_MANUALS.map(m => ({
                        id: m.id,
                        data: () => m,
                    })),
                });

            // First list page fails, second succeeds
            mockGenerateListPage
                .mockRejectedValueOnce(new Error('List deploy error'))
                .mockResolvedValueOnce(undefined);

            const result = await handler({});

            // All detail pages + second list page + 2 static pages + 3 SEO files
            expect(result.deployed).toBe(9); // 3 detail + 1 list + 2 static + 3 SEO
            expect(result.errors).toBe(1);
            expect(result.success).toBe(false);
        });

        it('should continue when a static page fails', async () => {
            mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });

            // First static page fails, second succeeds
            mockGenerateStaticPage
                .mockRejectedValueOnce(new Error('Fetch failed for privacy-policy'))
                .mockResolvedValueOnce(undefined);

            const result = await handler({});

            expect(result.deployed).toBe(4); // cookie-policy + 3 SEO files
            expect(result.errors).toBe(1);
            expect(result.success).toBe(false);
            expect(result.errorDetails).toEqual(expect.arrayContaining([
                expect.stringContaining('privacy-policy'),
            ]));
        });

        it('should include copy-friendly error details', async () => {
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'ct1', data: () => MOCK_CONTENT_TYPES[0] }],
                })
                .mockResolvedValueOnce({
                    docs: [{ id: 'a1', data: () => MOCK_ARTICLES[0] }],
                });

            mockGenerateDetailPage.mockRejectedValue(
                new Error('Hosting API error 403: Permission denied'),
            );

            const result = await handler({});

            expect(result.errorDetails[0]).toContain('arc_articles/a1');
            expect(result.errorDetails[0]).toContain('Hosting API error 403');
        });
    });

    describe('hasPublicUrl filtering (ContentType-level)', () => {
        it('should skip entire ContentType when hasPublicUrl is false', async () => {
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [
                        { id: 'ct1', data: () => ({ ...MOCK_CONTENT_TYPES[0], hasPublicUrl: false }) },
                        { id: 'ct2', data: () => MOCK_CONTENT_TYPES[1] },
                    ],
                })
                // Only manuals content fetched (articles skipped entirely)
                .mockResolvedValueOnce({
                    docs: MOCK_MANUALS.map(m => ({ id: m.id, data: () => m })),
                });

            const result = await handler({});

            // Articles skipped: no detail or list pages
            expect(mockGenerateDetailPage).not.toHaveBeenCalledWith('articles', expect.anything());
            expect(mockGenerateListPage).not.toHaveBeenCalledWith('articles');
            // Manuals deployed normally
            expect(mockGenerateDetailPage).toHaveBeenCalledWith('manuals', 'm1');
            expect(mockGenerateListPage).toHaveBeenCalledWith('manuals');
            // 1 manual detail + 1 manual list + 2 static + 3 SEO = 7
            expect(result.deployed).toBe(7);
            expect(result.details).toEqual(expect.arrayContaining([
                expect.stringContaining('no public URL'),
            ]));
        });

        it('should deploy all when hasPublicUrl is undefined (backward compat)', async () => {
            mockCollectionGet
                .mockResolvedValueOnce({
                    empty: false,
                    docs: [{ id: 'ct1', data: () => MOCK_CONTENT_TYPES[0] }],
                })
                .mockResolvedValueOnce({
                    docs: MOCK_ARTICLES.map(a => ({ id: a.id, data: () => a })),
                });

            const result = await handler({});

            expect(mockGenerateDetailPage).toHaveBeenCalledTimes(2);
            expect(mockGenerateListPage).toHaveBeenCalledWith('articles');
            // 2 detail + 1 list + 2 static + 3 SEO = 8
            expect(result.deployed).toBe(8);
        });

        it('should still deploy static pages when all ContentTypes have hasPublicUrl=false', async () => {
            mockCollectionGet.mockResolvedValueOnce({
                empty: false,
                docs: [
                    { id: 'ct1', data: () => ({ ...MOCK_CONTENT_TYPES[0], hasPublicUrl: false }) },
                ],
            });

            const result = await handler({});

            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
            expect(mockGenerateStaticPage).toHaveBeenCalledTimes(2);
            // 2 static pages + 3 SEO files = 5
            expect(result.deployed).toBe(5);
        });
    });

    describe('settings validation', () => {
        it('should abort when baseUrl is empty', async () => {
            mockGetSiteConfig.mockResolvedValue({ siteName: 'Test', baseUrl: '', cssUrls: [] });

            const result = await handler({});

            expect(result.success).toBe(false);
            expect(result.deployed).toBe(0);
            expect(result.details).toEqual(expect.arrayContaining([
                expect.stringContaining('baseUrl is empty'),
            ]));
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
            expect(mockGenerateStaticPage).not.toHaveBeenCalled();
            expect(mockCollectionGet).not.toHaveBeenCalled();
        });

        it('should abort when headerHtml is empty', async () => {
            mockGetPartials.mockResolvedValue({ headerHtml: '', footerHtml: '<footer/>' });

            const result = await handler({});

            expect(result.success).toBe(false);
            expect(result.deployed).toBe(0);
            expect(result.details).toEqual(expect.arrayContaining([
                expect.stringContaining('headerHtml is empty'),
            ]));
            expect(mockGenerateDetailPage).not.toHaveBeenCalled();
            expect(mockGenerateListPage).not.toHaveBeenCalled();
            expect(mockGenerateStaticPage).not.toHaveBeenCalled();
            expect(mockCollectionGet).not.toHaveBeenCalled();
        });

        it('should proceed when both baseUrl and headerHtml are present', async () => {
            mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });

            const result = await handler({});

            // Passes validation, deploys static pages + SEO files
            expect(result.success).toBe(true);
            expect(result.deployed).toBe(5); // 2 static + 3 SEO
            expect(mockGenerateStaticPage).toHaveBeenCalledTimes(2);
        });

        it('should include helpful guidance in the baseUrl error message', async () => {
            mockGetSiteConfig.mockResolvedValue({ siteName: '', baseUrl: '', cssUrls: [] });

            const result = await handler({});

            expect(result.details[0]).toContain('Settings/about');
            expect(result.details[0]).toContain('Settings/site');
        });

        it('should include helpful guidance in the headerHtml error message', async () => {
            mockGetPartials.mockResolvedValue({ headerHtml: '', footerHtml: '' });

            const result = await handler({});

            expect(result.details[0]).toContain('Settings/partials');
        });
    });
});
