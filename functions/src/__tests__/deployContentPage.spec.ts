import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
    mockFetch,
    mockDeployFileToHosting,
    mockRemoveFileFromHosting,
    mockGetPartials,
    mockGetSiteConfig,
    mockGetMiscSettings,
    mockGetLocalizationSettings,
    mockGetUiStrings,
    mockTranslationsGet,
    // Firestore mocks
    mockDocGet,
    mockCollectionDocGet,
    mockContentTypeWhere,
    mockContentTypeLimitGet,
    mockCollection,
    mockTopDoc,
} = vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockDeployFileToHosting: vi.fn(),
    mockRemoveFileFromHosting: vi.fn(),
    mockGetPartials: vi.fn(),
    mockGetSiteConfig: vi.fn(),
    mockGetMiscSettings: vi.fn(),
    mockGetLocalizationSettings: vi.fn(),
    mockGetUiStrings: vi.fn(),
    mockTranslationsGet: vi.fn(),
    // Firestore chain mocks
    mockDocGet: vi.fn(),
    mockCollectionDocGet: vi.fn(),
    mockContentTypeWhere: vi.fn(),
    mockContentTypeLimitGet: vi.fn(),
    mockCollection: vi.fn(),
    mockTopDoc: vi.fn(),
}));

// ─── Global fetch mock ──────────────────────────────────────────────────────
vi.stubGlobal('fetch', mockFetch);

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock('../init', () => ({
    db: {
        collection: mockCollection,
        doc: mockTopDoc,
    },
}));

vi.mock('../pages/deployToHosting', () => ({
    deployFileToHosting: mockDeployFileToHosting,
    removeFileFromHosting: mockRemoveFileFromHosting,
}));

vi.mock('../shared/site-settings', () => ({
    getPartials: mockGetPartials,
    getSiteConfig: mockGetSiteConfig,
    getMiscSettings: mockGetMiscSettings,
    getLocalizationSettings: mockGetLocalizationSettings,
    getUiStrings: mockGetUiStrings,
}));

// Let template-hydration and html-document run unmocked (real logic)

import {
    generateAndDeployContentDetailPage,
    removeContentPage,
} from '../pages/deployContentPage.js';

// ─── Test Data ──────────────────────────────────────────────────────────────

const MOCK_CONTENT = {
    title: 'Test Article',
    content: '<p>This is the article body with enough words for reading time.</p>',
    urlSlug: 'test-article',
    type: 'articles',
    coverImage: 'https://example.com/image.jpg',
    tags: ['javascript', 'testing'],
    tagsWithColors: [
        { name: 'javascript', color: '#f7df1e' },
        { name: 'testing', color: '#4caf50' },
    ],
    seoTitle: 'Test Article - SEO Title',
    metaDescription: 'A test article for unit testing',
    canonicalUrl: '',
    publishedOn: { seconds: 1705334400, nanoseconds: 0 }, // Jan 15, 2024
    publishedStatus: true,
    summary: 'A brief summary of the test article',
    customFields: { author: 'John Doe' },
};

const MOCK_CONTENT_TYPE = {
    name: 'Articles',
    slug: 'articles',
    templateFolder: 'articles',
    fields: [],
};

const MOCK_PARTIALS = {
    headerHtml: '<header>Site Header</header>',
    footerHtml: '<footer>Site Footer</footer>',
};

const MOCK_SITE_CONFIG = {
    siteName: 'Test Site',
    baseUrl: 'https://example.com',
    cssUrls: ['/assets/css/main.css'],
};

const MOCK_TEMPLATE_HTML = `<article>
    <h1 data-arc-bind="title">Title</h1>
    <time data-arc-bind="publishedOn">Date</time>
    <span data-arc-bind="readTime">0</span> min read
    <img data-arc-bind="coverImage" alt="" style="max-width:100%">
    <div [innerHTML]="content">Content</div>
    <div class="tags-container" data-arc-loop="tags">
        <span data-arc-bind="name" data-arc-style-background="color">Tag</span>
    </div>
    <a data-arc-bind="share.facebook">Share</a>
</article>`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function restoreMockImplementations() {
    // Site settings
    mockGetPartials.mockResolvedValue(MOCK_PARTIALS);
    mockGetSiteConfig.mockResolvedValue(MOCK_SITE_CONFIG);
    mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });
    // Single-language site by default, so the pre-M3 expectations hold.
    mockGetLocalizationSettings.mockResolvedValue({
        defaultLanguage: 'en',
        enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }],
    });
    mockTranslationsGet.mockResolvedValue({ docs: [] });
    // No translated chrome by default — the authored English stands.
    mockGetUiStrings.mockResolvedValue({});

    // Deploy functions
    mockDeployFileToHosting.mockResolvedValue(undefined);
    mockRemoveFileFromHosting.mockResolvedValue(undefined);

    // Firestore: db.collection('arc_articles').doc('doc123').get()
    mockCollectionDocGet.mockResolvedValue({
        exists: true,
        id: 'doc123',
        data: () => ({ ...MOCK_CONTENT }),
    });

    // Firestore: db.collection('ContentTypes').where().limit().get()
    mockContentTypeLimitGet.mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ ...MOCK_CONTENT_TYPE }) }],
    });

    // Wire up collection chain based on collection name
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
        // Default: published content collection (arc_*)
        return {
            doc: vi.fn().mockReturnValue({
                get: mockCollectionDocGet,
                collection: vi.fn().mockReturnValue({ get: mockTranslationsGet }),
            }),
        };
    });

    // Firestore: db.doc('templates/articles:detail').get() — Tier 1 template
    mockDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ html: MOCK_TEMPLATE_HTML }),
    });
    mockTopDoc.mockReturnValue({
        get: mockDocGet,
    });

    // Global fetch — Tier 2 template (not needed by default, Tier 1 succeeds)
    mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(MOCK_TEMPLATE_HTML),
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('deployContentPage', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        restoreMockImplementations();
        process.env.GCLOUD_PROJECT = 'test-project';
    });

    // --- Firestore reads ---

    describe('Firestore reads', () => {
        it('should read content from the correct published collection', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            // First call to mockCollection should be for the published collection
            expect(mockCollection).toHaveBeenCalledWith('arc_articles');
        });

        it('should read ContentType from ContentTypes where slug matches', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(mockCollection).toHaveBeenCalledWith('ContentTypes');
            expect(mockContentTypeWhere).toHaveBeenCalledWith('slug', '==', 'articles');
        });
    });

    // --- Template 3-tier fallback ---

    describe('Template 3-tier fallback', () => {
        it('Tier 1: should load template from Firestore html field', async () => {
            const customTemplate = '<div data-arc-bind="title">Custom</div>';
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ html: customTemplate }),
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            // Verify template doc was read
            expect(mockTopDoc).toHaveBeenCalledWith('templates/articles:detail');
            // Verify the deployed HTML contains hydrated content from the custom template
            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Test Article');
        });

        it('Tier 1 fallback: should use originalHtml when html field is missing', async () => {
            const originalTemplate = '<div data-arc-bind="title">Original</div>';
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ originalHtml: originalTemplate }),
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Test Article');
        });

        it('Tier 2: should fetch from hosting when Firestore doc missing', async () => {
            // Tier 1 fails (doc doesn't exist)
            mockDocGet.mockResolvedValue({
                exists: false,
                data: () => null,
            });

            // Tier 2 succeeds
            const hostingTemplate = '<h2 data-arc-bind="title">Hosting</h2>';
            mockFetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(hostingTemplate),
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-project.web.app/templates/articles/detail.html',
            );
            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Test Article');
        });

        it('Tier 3: should use built-in fallback when Tier 1+2 fail', async () => {
            // Tier 1 fails
            mockDocGet.mockRejectedValue(new Error('Firestore error'));

            // Tier 2 fails
            mockFetch.mockRejectedValue(new Error('Network error'));

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            // Fallback template has data-arc-bind="title" which gets hydrated
            expect(deployedHtml).toContain('Test Article');
        });

        it('should load the shared default template when templateFolder is "default"', async () => {
            // "default" names a real template folder — public/templates/default —
            // rather than meaning "no template". It used to short-circuit to the
            // bare built-in skeleton, which is why a deployed page looked
            // nothing like the same content previewed locally.
            mockContentTypeLimitGet.mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ ...MOCK_CONTENT_TYPE, templateFolder: 'default' }) }],
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(mockTopDoc).toHaveBeenCalledWith('templates/default:detail');
            expect(mockDeployFileToHosting).toHaveBeenCalled();
        });

        it('should fall back to the default folder when templateFolder is empty', async () => {
            mockContentTypeLimitGet.mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ ...MOCK_CONTENT_TYPE, templateFolder: '' }) }],
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(mockTopDoc).toHaveBeenCalledWith('templates/default:detail');
            expect(mockDeployFileToHosting).toHaveBeenCalled();
        });
    });

    // --- Template data and hydration ---

    describe('Template data and hydration', () => {
        it('should include share URLs with proper URL encoding', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            // The template has <a data-arc-bind="share.facebook"> which gets hydrated
            expect(deployedHtml).toContain('facebook.com/sharer/sharer.php');
        });

        it('should include readTime calculated from content', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            // readTime is injected into <span data-arc-bind="readTime"> → <span>N</span> min read
            expect(deployedHtml).toMatch(/<span>\d+<\/span> min read/);
        });

        it('should include formatted date from Firestore Timestamp', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            // Jan 15, 2024 — the Firestore timestamp we set (seconds: 1705334400)
            expect(deployedHtml).toContain('January 15, 2024');
        });

        it('should process tags loop via tagsWithColors', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('javascript');
            expect(deployedHtml).toContain('testing');
        });
    });

    // --- HTML assembly and deployment ---

    describe('HTML assembly and deployment', () => {
        it('should deploy to correct file path /{slug}/{urlSlug}.html', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(mockDeployFileToHosting).toHaveBeenCalledWith(
                'test-project',
                '/articles/test-article.html',
                expect.any(String),
                'arc_articles',
                'doc123',
            );
        });

        it('should pass correct collectionName and docId to deployFileToHosting', async () => {
            await generateAndDeployContentDetailPage('blog-posts', 'abc456');

            // Need to set up mocks for the blog-posts content
            // Already handled by generic mockCollection implementation
            expect(mockDeployFileToHosting.mock.calls[0][3]).toBe('arc_blog-posts');
            expect(mockDeployFileToHosting.mock.calls[0][4]).toBe('abc456');
        });

        it('should pass siteId from GCLOUD_PROJECT', async () => {
            process.env.GCLOUD_PROJECT = 'my-custom-project';

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(mockDeployFileToHosting.mock.calls[0][0]).toBe('my-custom-project');
        });

        it('should build HTML containing SEO meta tags', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('<title>Test Article - SEO Title</title>');
            expect(deployedHtml).toContain('A test article for unit testing');
            expect(deployedHtml).toContain('arc-served-by');
            expect(deployedHtml).toContain('firebase-hosting');
        });
    });

    // --- Error handling ---

    describe('Error handling', () => {
        it('should throw CONTENT_NOT_FOUND when content doc missing', async () => {
            mockCollectionDocGet.mockResolvedValue({
                exists: false,
                id: 'doc123',
                data: () => null,
            });

            await expect(
                generateAndDeployContentDetailPage('articles', 'doc123'),
            ).rejects.toThrow('Published content not found');

            try {
                await generateAndDeployContentDetailPage('articles', 'doc123');
            } catch (err: any) {
                expect(err.code).toBe('CONTENT_NOT_FOUND');
            }
        });

        it('should throw CONTENT_TYPE_NOT_FOUND when ContentType query empty', async () => {
            mockContentTypeLimitGet.mockResolvedValue({
                empty: true,
                docs: [],
            });

            await expect(
                generateAndDeployContentDetailPage('articles', 'doc123'),
            ).rejects.toThrow('Content type configuration not found');

            try {
                await generateAndDeployContentDetailPage('articles', 'doc123');
            } catch (err: any) {
                expect(err.code).toBe('CONTENT_TYPE_NOT_FOUND');
            }
        });
    });

    // --- Edge cases ---

    describe('Edge cases', () => {
        it('should handle content with no tags (empty arrays)', async () => {
            mockCollectionDocGet.mockResolvedValue({
                exists: true,
                id: 'doc123',
                data: () => ({
                    ...MOCK_CONTENT,
                    tags: [],
                    tagsWithColors: undefined,
                }),
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            // Should still deploy successfully even with no tags
            expect(mockDeployFileToHosting).toHaveBeenCalled();
            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Test Article');
        });
    });

    // --- Powered-by footer ---

    describe('Powered-by footer', () => {
        it('should include "Powered by Arc CMS" when showPoweredBy is true', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });
    // Single-language site by default, so the pre-M3 expectations hold.
    mockGetLocalizationSettings.mockResolvedValue({
        defaultLanguage: 'en',
        enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }],
    });
    mockTranslationsGet.mockResolvedValue({ docs: [] });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Powered by');
            expect(deployedHtml).toContain('arccms.com');
        });

        it('should NOT include "Powered by Arc CMS" when showPoweredBy is false', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: false });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).not.toContain('Powered by');
            expect(deployedHtml).not.toContain('arccms.com');
        });
    });

    // --- removeContentPage ---

    describe('removeContentPage', () => {
        it('should call removeFileFromHosting with correct path', async () => {
            await removeContentPage('articles', 'test-article');

            expect(mockRemoveFileFromHosting).toHaveBeenCalledWith(
                'test-project',
                '/articles/test-article.html',
            );
        });

        it('should pass GCLOUD_PROJECT as siteId', async () => {
            process.env.GCLOUD_PROJECT = 'custom-project';

            await removeContentPage('articles', 'test-article');

            expect(mockRemoveFileFromHosting.mock.calls[0][0]).toBe('custom-project');
        });
    });
    // ── Multilingual publishing (M3) ────────────────────────────────────────

    describe('language variants', () => {
        const EN_HI = {
            defaultLanguage: 'en',
            enabledLanguages: [
                { code: 'en', label: 'English', nativeLabel: 'English' },
                { code: 'hi', label: 'Hindi', nativeLabel: 'Hindi' },
            ],
        };

        function withHindiTranslation(translation: Record<string, unknown> = {}) {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            mockTranslationsGet.mockResolvedValue({
                docs: [{ id: 'hi', data: () => ({ lang: 'hi', title: 'Hindi title', ...translation }) }],
            });
        }

        function deployedPaths(): string[] {
            return mockDeployFileToHosting.mock.calls.map(call => call[1]);
        }

        function htmlFor(path: string): string {
            const call = mockDeployFileToHosting.mock.calls.find(c => c[1] === path);
            return call ? call[2] : '';
        }

        it('should deploy only the default language when nothing is translated', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            mockTranslationsGet.mockResolvedValue({ docs: [] });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(deployedPaths()).toEqual(['/articles/test-article.html']);
        });

        it('should deploy one page per translated language', async () => {
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(deployedPaths()).toEqual([
                '/articles/test-article.html',
                '/hi/articles/test-article.html',
            ]);
        });

        it('should keep the default language URL unprefixed', async () => {
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(deployedPaths()).toContain('/articles/test-article.html');
            expect(deployedPaths()).not.toContain('/en/articles/test-article.html');
        });

        it('should render translated fields in the translated page', async () => {
            withHindiTranslation({ content: '<p>Hindi body</p>' });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const hindi = htmlFor('/hi/articles/test-article.html');
            expect(hindi).toContain('Hindi title');
            expect(hindi).toContain('Hindi body');
        });

        it('should fall back to default-language content for untranslated fields', async () => {
            withHindiTranslation(); // only `title` translated

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const hindi = htmlFor('/hi/articles/test-article.html');
            expect(hindi).toContain('This is the article body');
        });

        it('should set html lang per variant', async () => {
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/articles/test-article.html')).toContain('<html lang="en">');
            expect(htmlFor('/hi/articles/test-article.html')).toContain('<html lang="hi">');
        });

        it('should emit reciprocal hreflang alternates on every variant', async () => {
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            for (const path of ['/articles/test-article.html', '/hi/articles/test-article.html']) {
                const html = htmlFor(path);
                expect(html).toContain('hreflang="en" href="https://example.com/articles/test-article"');
                expect(html).toContain('hreflang="hi" href="https://example.com/hi/articles/test-article"');
                // x-default points at the site default language.
                expect(html).toContain('hreflang="x-default" href="https://example.com/articles/test-article"');
            }
        });

        it('should not emit hreflang on a single-language site', async () => {
            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/articles/test-article.html')).not.toContain('hreflang');
        });

        it('should give each variant a self-referential canonical', async () => {
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/hi/articles/test-article.html'))
                .toContain('<link rel="canonical" href="https://example.com/hi/articles/test-article">');
        });

        it('should mark right-to-left languages', async () => {
            mockGetLocalizationSettings.mockResolvedValue({
                defaultLanguage: 'en',
                enabledLanguages: [
                    { code: 'en', label: 'English', nativeLabel: 'English' },
                    { code: 'ar', label: 'Arabic', nativeLabel: 'Arabic', rtl: true },
                ],
            });
            mockTranslationsGet.mockResolvedValue({
                docs: [{ id: 'ar', data: () => ({ lang: 'ar', title: 'Arabic title' }) }],
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/ar/articles/test-article.html')).toContain('<html lang="ar" dir="rtl">');
        });

        it('should still deploy the default page when translations cannot be read', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            mockTranslationsGet.mockRejectedValue(new Error('permission denied'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(deployedPaths()).toEqual(['/articles/test-article.html']);
            consoleSpy.mockRestore();
        });

        it('should remove every enabled language variant on unpublish', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);

            await removeContentPage('articles', 'test-article');

            const removed = mockRemoveFileFromHosting.mock.calls.map(call => call[1]);
            expect(removed).toEqual([
                '/articles/test-article.html',
                '/hi/articles/test-article.html',
            ]);
        });
        it('should let a translated field win over a shadowing custom field', async () => {
            // Content types commonly define a custom field whose key shadows a
            // built-in (`title`). The custom field is spread last, so without
            // care an untranslated one silently overrides the translated title.
            mockCollectionDocGet.mockResolvedValue({
                exists: true,
                id: 'doc123',
                data: () => ({ ...MOCK_CONTENT, customFields: { title: 'English custom title' } }),
            });
            withHindiTranslation({ title: 'Hindi title' });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const hindi = htmlFor('/hi/articles/test-article.html');
            expect(hindi).toContain('Hindi title');
            expect(hindi).not.toContain('English custom title');
        });

        it('should leave the shadowing custom field in place when untranslated', async () => {
            mockCollectionDocGet.mockResolvedValue({
                exists: true,
                id: 'doc123',
                data: () => ({ ...MOCK_CONTENT, customFields: { title: 'English custom title' } }),
            });
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            mockTranslationsGet.mockResolvedValue({
                docs: [{ id: 'hi', data: () => ({ lang: 'hi', content: '<p>Hindi body</p>' }) }],
            });

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/hi/articles/test-article.html')).toContain('English custom title');
        });

        it('should not reuse an author canonical on translated variants', async () => {
            // A shared canonical would contradict hreflang and deindex the
            // translations.
            mockCollectionDocGet.mockResolvedValue({
                exists: true,
                id: 'doc123',
                data: () => ({ ...MOCK_CONTENT, canonicalUrl: 'https://elsewhere.com/original' }),
            });
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/articles/test-article.html'))
                .toContain('<link rel="canonical" href="https://elsewhere.com/original">');
            expect(htmlFor('/hi/articles/test-article.html'))
                .toContain('<link rel="canonical" href="https://example.com/hi/articles/test-article">');
        });
        it('should link the switcher relatively but hreflang absolutely', async () => {
            // hreflang must be absolute for search engines; the switcher must
            // not be, or clicking a language on a preview channel or the
            // .web.app domain throws the visitor onto the configured baseUrl.
            mockGetPartials.mockResolvedValue({
                headerHtml: '<header><arc-language-switcher></arc-language-switcher></header>',
                footerHtml: '<footer></footer>',
            });
            // The switcher lives inside the header partial, so the template
            // must actually place the header.
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ html: `<arc-header></arc-header>${MOCK_TEMPLATE_HTML}` }),
            });
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const html = htmlFor('/articles/test-article.html');
            expect(html).toContain('<a href="/hi/articles/test-article" hreflang="hi"');
            expect(html).toContain(
                '<link rel="alternate" hreflang="hi" href="https://example.com/hi/articles/test-article">',
            );
        });
        it('should translate static template chrome on the translated page only', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ html: '<article><span data-arc-t="read_more">Read Article</span></article>' }),
            });
            mockGetUiStrings.mockImplementation(async (lang: string) =>
                lang === 'hi' ? { read_more: 'लेख पढ़ें' } : {});
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/hi/articles/test-article.html')).toContain('लेख पढ़ें');
            // The default language keeps the authored English and is never asked
            // for a strings file.
            expect(htmlFor('/articles/test-article.html')).toContain('Read Article');
            expect(mockGetUiStrings).not.toHaveBeenCalledWith('en');
        });

        it('should keep English chrome when a key is untranslated', async () => {
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ html: '<article><span data-arc-t="read_more">Read Article</span></article>' }),
            });
            mockGetUiStrings.mockResolvedValue({ other_key: 'x' });
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            expect(htmlFor('/hi/articles/test-article.html')).toContain('Read Article');
        });

        it('should resolve interpolation carried by a translated string', async () => {
            // Strings are applied before hydration, so "back_to" can hold its own
            // {{ contentType }} and still end up with the real value.
            mockDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ html: '<article><span data-arc-t="back_to">Back to {{ contentType }}</span></article>' }),
            });
            mockGetUiStrings.mockImplementation(async (lang: string) =>
                lang === 'hi' ? { back_to: 'वापस {{ contentType }} पर' } : {});
            withHindiTranslation();

            await generateAndDeployContentDetailPage('articles', 'doc123');

            const hindi = htmlFor('/hi/articles/test-article.html');
            expect(hindi).toContain('वापस Articles पर');
            expect(hindi).not.toContain('{{');
        });
    });
});
