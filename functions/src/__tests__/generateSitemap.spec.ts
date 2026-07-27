/**
 * Tests for sitemap generation (functions/src/pages/generateSitemap.ts).
 *
 * Focus is the multilingual output added in M3: a sitemap is never rendered
 * for a human, so a malformed one fails silently — the namespace, the
 * per-language entries and the reciprocal alternates are pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockDeploySeoFileToHosting,
    mockGetSiteConfig,
    mockGetLocalizationSettings,
    mockCollection,
} = vi.hoisted(() => ({
    mockDeploySeoFileToHosting: vi.fn(),
    mockGetSiteConfig: vi.fn(),
    mockGetLocalizationSettings: vi.fn(),
    mockCollection: vi.fn(),
}));

vi.mock('../init', () => ({ db: { collection: mockCollection } }));
vi.mock('../pages/deploySeoFile', () => ({ deploySeoFileToHosting: mockDeploySeoFileToHosting }));
vi.mock('../shared/site-settings', () => ({
    getSiteConfig: mockGetSiteConfig,
    getLocalizationSettings: mockGetLocalizationSettings,
}));

import { generateAndDeploySitemap } from '../pages/generateSitemap.js';

const SINGLE_LANGUAGE = {
    defaultLanguage: 'en',
    enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }],
};

const EN_HI = {
    defaultLanguage: 'en',
    enabledLanguages: [
        { code: 'en', label: 'English', nativeLabel: 'English' },
        { code: 'hi', label: 'Hindi', nativeLabel: 'Hindi' },
    ],
};

/** Wires ContentTypes + one published article with the given translations. */
function wireFirestore(translatedLangs: string[]): void {
    mockCollection.mockImplementation((name: string) => {
        if (name === 'ContentTypes') {
            return {
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ id: 'ct1', data: () => ({ slug: 'articles', name: 'Articles', hasPublicUrl: true }) }],
                }),
            };
        }
        return {
            orderBy: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    docs: [{
                        id: 'doc1',
                        data: () => ({ urlSlug: 'first-article', publishedOn: { seconds: 1705334400 } }),
                        ref: {
                            collection: vi.fn().mockReturnValue({
                                get: vi.fn().mockResolvedValue({
                                    docs: translatedLangs.map(lang => ({ id: lang })),
                                }),
                            }),
                        },
                    }],
                }),
            }),
        };
    });
}

function generatedXml(): string {
    return mockDeploySeoFileToHosting.mock.calls[0][1];
}

describe('generateAndDeploySitemap', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockDeploySeoFileToHosting.mockResolvedValue(undefined);
        mockGetSiteConfig.mockResolvedValue({
            siteName: 'Test Site',
            baseUrl: 'https://example.com',
            cssUrls: [],
        });
        mockGetLocalizationSettings.mockResolvedValue(SINGLE_LANGUAGE);
        wireFirestore([]);
    });

    it('should deploy to /sitemap.xml', async () => {
        await generateAndDeploySitemap();
        expect(mockDeploySeoFileToHosting).toHaveBeenCalledWith('/sitemap.xml', expect.any(String), undefined);
    });

    it('should declare the xhtml namespace the alternates need', async () => {
        await generateAndDeploySitemap();
        expect(generatedXml()).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    });

    describe('single-language site', () => {
        it('should list each page once, unprefixed', async () => {
            await generateAndDeploySitemap();
            const xml = generatedXml();

            expect(xml).toContain('<loc>https://example.com/articles</loc>');
            expect(xml).toContain('<loc>https://example.com/articles/first-article</loc>');
            expect(xml).not.toContain('/en/articles');
        });

        it('should not emit alternates', async () => {
            await generateAndDeploySitemap();
            expect(generatedXml()).not.toContain('xhtml:link');
        });
    });

    describe('multilingual site', () => {
        it('should list the list page in every enabled language', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            await generateAndDeploySitemap();
            const xml = generatedXml();

            expect(xml).toContain('<loc>https://example.com/articles</loc>');
            expect(xml).toContain('<loc>https://example.com/hi/articles</loc>');
        });

        it('should list a detail page only in languages it is translated into', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            wireFirestore([]); // no translations
            await generateAndDeploySitemap();
            const xml = generatedXml();

            expect(xml).toContain('<loc>https://example.com/articles/first-article</loc>');
            expect(xml).not.toContain('<loc>https://example.com/hi/articles/first-article</loc>');
        });

        it('should list a translated detail page in both languages', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            wireFirestore(['hi']);
            await generateAndDeploySitemap();
            const xml = generatedXml();

            expect(xml).toContain('<loc>https://example.com/articles/first-article</loc>');
            expect(xml).toContain('<loc>https://example.com/hi/articles/first-article</loc>');
        });

        it('should give every variant the full reciprocal alternate set', async () => {
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            wireFirestore(['hi']);
            await generateAndDeploySitemap();
            const xml = generatedXml();

            // Two entries for the article, each carrying both alternates.
            const enAlternates = xml.match(
                /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/example\.com\/articles\/first-article"\/>/g,
            );
            const hiAlternates = xml.match(
                /<xhtml:link rel="alternate" hreflang="hi" href="https:\/\/example\.com\/hi\/articles\/first-article"\/>/g,
            );
            expect(enAlternates).toHaveLength(2);
            expect(hiAlternates).toHaveLength(2);
        });

        it('should survive a translations read failure', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockGetLocalizationSettings.mockResolvedValue(EN_HI);
            mockCollection.mockImplementation((name: string) => {
                if (name === 'ContentTypes') {
                    return {
                        get: vi.fn().mockResolvedValue({
                            empty: false,
                            docs: [{ id: 'ct1', data: () => ({ slug: 'articles', name: 'Articles', hasPublicUrl: true }) }],
                        }),
                    };
                }
                return {
                    orderBy: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            docs: [{
                                id: 'doc1',
                                data: () => ({ urlSlug: 'first-article', publishedOn: { seconds: 1705334400 } }),
                                ref: {
                                    collection: vi.fn().mockReturnValue({
                                        get: vi.fn().mockRejectedValue(new Error('denied')),
                                    }),
                                },
                            }],
                        }),
                    }),
                };
            });

            await generateAndDeploySitemap();

            // Degrades to the default language rather than losing the sitemap.
            expect(generatedXml()).toContain('<loc>https://example.com/articles/first-article</loc>');
            consoleSpy.mockRestore();
        });
    });
});
