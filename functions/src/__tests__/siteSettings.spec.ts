import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-document mocks for cleaner testing
const mockPartialsGet = vi.fn();
const mockAboutGet = vi.fn();
const mockSiteGet = vi.fn();
const mockLocalizationGet = vi.fn();

vi.mock('../init', () => ({
    db: {
        doc: vi.fn((path: string) => {
            if (path === 'Settings/partials') return { get: mockPartialsGet };
            if (path === 'Settings/about') return { get: mockAboutGet };
            if (path === 'Settings/site') return { get: mockSiteGet };
            if (path === 'Settings/localization') return { get: mockLocalizationGet };
            return { get: vi.fn() };
        }),
    },
}));

// Mock global fetch for hosting fallback tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
    getPartials,
    getSiteConfig,
    getAboutConfig,
    clearSettingsCache,
    getLocalizationSettings,
    getExtraLanguages,
    languagePathPrefix,
    normalizeLocalization,
} from '../shared/site-settings.js';
import { db } from '../init.js';

describe('site-settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearSettingsCache();
        process.env.GCLOUD_PROJECT = 'test-project';
    });

    // ─── getPartials ───────────────────────────────────────────────────────

    describe('getPartials', () => {
        it('should return headerHtml and footerHtml from Firestore', async () => {
            mockPartialsGet.mockResolvedValueOnce({
                data: () => ({
                    headerHtml: '<header>Test</header>',
                    footerHtml: '<footer>Test</footer>',
                }),
            });

            const result = await getPartials();

            expect(db.doc).toHaveBeenCalledWith('Settings/partials');
            expect(result).toEqual({
                headerHtml: '<header>Test</header>',
                footerHtml: '<footer>Test</footer>',
            });
            // Should NOT fetch from hosting when Firestore has values
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should fall back to hosting when Firestore document is empty', async () => {
            mockPartialsGet.mockResolvedValueOnce({
                data: () => undefined,
            });
            mockFetch
                .mockResolvedValueOnce({ ok: true, text: async () => '<nav>Header from hosting</nav>' })
                .mockResolvedValueOnce({ ok: true, text: async () => '<footer>Footer from hosting</footer>' });

            const result = await getPartials();

            expect(mockFetch).toHaveBeenCalledWith('https://test-project.web.app/_partials/_header.html');
            expect(mockFetch).toHaveBeenCalledWith('https://test-project.web.app/_partials/_footer.html');
            expect(result).toEqual({
                headerHtml: '<nav>Header from hosting</nav>',
                footerHtml: '<footer>Footer from hosting</footer>',
            });
        });

        it('should return empty strings when both Firestore and hosting fail', async () => {
            mockPartialsGet.mockResolvedValueOnce({
                data: () => undefined,
            });
            mockFetch.mockResolvedValue({ ok: false });

            const result = await getPartials();

            expect(result).toEqual({
                headerHtml: '',
                footerHtml: '',
            });
        });

        it('should only fetch missing partial from hosting (partial fallback)', async () => {
            mockPartialsGet.mockResolvedValueOnce({
                data: () => ({ headerHtml: '<header>From Firestore</header>' }),
            });
            mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '<footer>From hosting</footer>' });

            const result = await getPartials();

            expect(result.headerHtml).toBe('<header>From Firestore</header>');
            expect(result.footerHtml).toBe('<footer>From hosting</footer>');
            // Should only fetch footer, not header
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith('https://test-project.web.app/_partials/_footer.html');
        });

        it('should handle hosting fetch errors gracefully', async () => {
            mockPartialsGet.mockResolvedValueOnce({
                data: () => undefined,
            });
            mockFetch.mockRejectedValue(new Error('Network error'));

            const result = await getPartials();

            expect(result).toEqual({
                headerHtml: '',
                footerHtml: '',
            });
        });

        it('should cache results and not re-query within 5 minutes', async () => {
            mockPartialsGet.mockResolvedValueOnce({
                data: () => ({
                    headerHtml: '<header>Cached</header>',
                    footerHtml: '<footer>Cached</footer>',
                }),
            });

            const first = await getPartials();
            const second = await getPartials();

            expect(first).toEqual(second);
            expect(mockPartialsGet).toHaveBeenCalledTimes(1);
        });

        it('should re-query after clearSettingsCache', async () => {
            mockPartialsGet
                .mockResolvedValueOnce({
                    data: () => ({ headerHtml: 'v1', footerHtml: 'v1' }),
                })
                .mockResolvedValueOnce({
                    data: () => ({ headerHtml: 'v2', footerHtml: 'v2' }),
                });

            await getPartials();
            clearSettingsCache();
            const result = await getPartials();

            expect(mockPartialsGet).toHaveBeenCalledTimes(2);
            expect(result.headerHtml).toBe('v2');
        });
    });

    // ─── getAboutConfig ────────────────────────────────────────────────────

    describe('getAboutConfig', () => {
        it('should return name, finalUrl, address from Settings/about', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({
                    name: 'My Site',
                    finalUrl: 'https://mysite.com',
                    address: '123 Main St, City',
                }),
            });

            const result = await getAboutConfig();

            expect(db.doc).toHaveBeenCalledWith('Settings/about');
            expect(result).toEqual({
                name: 'My Site',
                finalUrl: 'https://mysite.com',
                address: '123 Main St, City',
            });
        });

        it('should return empty strings when document does not exist', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => undefined,
            });

            const result = await getAboutConfig();

            expect(result).toEqual({
                name: '',
                finalUrl: '',
                address: '',
            });
        });

        it('should cache results and not re-query within TTL', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({
                    name: 'Cached',
                    finalUrl: 'https://cached.com',
                    address: 'Cached Address',
                }),
            });

            await getAboutConfig();
            await getAboutConfig();

            expect(mockAboutGet).toHaveBeenCalledTimes(1);
        });

        it('should re-query after clearSettingsCache', async () => {
            mockAboutGet
                .mockResolvedValueOnce({
                    data: () => ({ name: 'v1', finalUrl: 'https://v1.com', address: 'v1 addr' }),
                })
                .mockResolvedValueOnce({
                    data: () => ({ name: 'v2', finalUrl: 'https://v2.com', address: 'v2 addr' }),
                });

            await getAboutConfig();
            clearSettingsCache();
            const result = await getAboutConfig();

            expect(mockAboutGet).toHaveBeenCalledTimes(2);
            expect(result.name).toBe('v2');
        });
    });

    // ─── getSiteConfig ─────────────────────────────────────────────────────

    describe('getSiteConfig', () => {
        it('should prefer Settings/about values over Settings/site', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({
                    name: 'About Name',
                    finalUrl: 'https://about-url.com',
                    address: 'About Addr',
                }),
            });
            mockSiteGet.mockResolvedValueOnce({
                data: () => ({
                    siteName: 'Site Name',
                    baseUrl: 'https://site-url.com',
                    cssUrls: ['/custom.css'],
                }),
            });

            const result = await getSiteConfig();

            expect(result.siteName).toBe('About Name');
            expect(result.baseUrl).toBe('https://about-url.com');
            expect(result.cssUrls).toEqual(['/custom.css']);
        });

        it('should fall back to Settings/site when Settings/about is empty', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => undefined,
            });
            mockSiteGet.mockResolvedValueOnce({
                data: () => ({
                    siteName: 'Site Name',
                    baseUrl: 'https://site-url.com',
                    cssUrls: ['/site.css'],
                }),
            });

            const result = await getSiteConfig();

            expect(result.siteName).toBe('Site Name');
            expect(result.baseUrl).toBe('https://site-url.com');
            expect(result.cssUrls).toEqual(['/site.css']);
        });

        it('should default baseUrl to project URL when both About and Site are empty', async () => {
            mockAboutGet.mockResolvedValueOnce({ data: () => undefined });
            mockSiteGet.mockResolvedValueOnce({ data: () => undefined });

            const result = await getSiteConfig();

            expect(result.baseUrl).toBe('https://test-project.web.app');
        });

        it('should default cssUrls to Bootstrap, Font Awesome, and main.css when not set', async () => {
            mockAboutGet.mockResolvedValueOnce({ data: () => undefined });
            mockSiteGet.mockResolvedValueOnce({
                data: () => ({
                    siteName: 'My Site',
                    baseUrl: 'https://mysite.web.app',
                }),
            });

            const result = await getSiteConfig();

            expect(result.cssUrls).toEqual([
                'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css',
                'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
                '/assets/css/main.css',
            ]);
        });

        it('should return empty siteName when both About and Site are missing', async () => {
            mockAboutGet.mockResolvedValueOnce({ data: () => undefined });
            mockSiteGet.mockResolvedValueOnce({ data: () => undefined });

            const result = await getSiteConfig();

            expect(result.siteName).toBe('');
        });

        it('should cache results and not re-query within TTL', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({ name: 'Cached', finalUrl: 'https://cached.com', address: '' }),
            });
            mockSiteGet.mockResolvedValueOnce({
                data: () => ({ siteName: '', baseUrl: '', cssUrls: ['/cached.css'] }),
            });

            await getSiteConfig();
            await getSiteConfig();

            // About and Site should each be called once (getSiteConfig + getAboutConfig caches)
            expect(mockAboutGet).toHaveBeenCalledTimes(1);
            expect(mockSiteGet).toHaveBeenCalledTimes(1);
        });

        it('should re-query after clearSettingsCache', async () => {
            mockAboutGet
                .mockResolvedValueOnce({
                    data: () => ({ name: 'v1', finalUrl: '', address: '' }),
                })
                .mockResolvedValueOnce({
                    data: () => ({ name: 'v2', finalUrl: '', address: '' }),
                });
            mockSiteGet
                .mockResolvedValue({ data: () => undefined });

            await getSiteConfig();
            clearSettingsCache();
            const result = await getSiteConfig();

            expect(mockAboutGet).toHaveBeenCalledTimes(2);
            expect(result.siteName).toBe('v2');
        });

        it('should use About.name for siteName even when Site.siteName is also set', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({ name: 'About Name', finalUrl: '', address: '' }),
            });
            mockSiteGet.mockResolvedValueOnce({
                data: () => ({ siteName: 'Site Name', baseUrl: '', cssUrls: [] }),
            });

            const result = await getSiteConfig();

            expect(result.siteName).toBe('About Name');
        });

        it('should use About.finalUrl for baseUrl even when Site.baseUrl is also set', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({ name: '', finalUrl: 'https://about.com', address: '' }),
            });
            mockSiteGet.mockResolvedValueOnce({
                data: () => ({ siteName: '', baseUrl: 'https://site.com', cssUrls: [] }),
            });

            const result = await getSiteConfig();

            expect(result.baseUrl).toBe('https://about.com');
        });
    });

    // ─── localization (M1) ─────────────────────────────────────────────────

    describe('normalizeLocalization', () => {
        const ENGLISH = { code: 'en', label: 'English', nativeLabel: 'English' };
        const HINDI = { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' };

        it('should default to a single English site for empty input', () => {
            for (const input of [null, undefined, {}]) {
                expect(normalizeLocalization(input)).toEqual({
                    defaultLanguage: 'en',
                    enabledLanguages: [ENGLISH],
                });
            }
        });

        it('should always list the default language first', () => {
            const result = normalizeLocalization({
                defaultLanguage: 'hi',
                enabledLanguages: [ENGLISH, HINDI],
            });
            expect(result.enabledLanguages.map((l) => l.code)).toEqual(['hi', 'en']);
        });

        it('should add a default language missing from the list', () => {
            const result = normalizeLocalization({
                defaultLanguage: 'fr',
                enabledLanguages: [HINDI],
            });
            expect(result.defaultLanguage).toBe('fr');
            expect(result.enabledLanguages.map((l) => l.code)).toEqual(['fr', 'hi']);
        });

        it('should drop duplicates and code-less entries, and lower-case codes', () => {
            const result = normalizeLocalization({
                defaultLanguage: ' EN ',
                enabledLanguages: [{ code: ' EN ', label: 'English', nativeLabel: 'English' }, ENGLISH, HINDI, { code: '' }],
            });
            expect(result.defaultLanguage).toBe('en');
            expect(result.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
        });

        it('should tolerate a non-array enabledLanguages', () => {
            const result = normalizeLocalization({ defaultLanguage: 'en', enabledLanguages: 'nope' });
            expect(result.enabledLanguages.map((l) => l.code)).toEqual(['en']);
        });
    });

    describe('getLocalizationSettings', () => {
        it('should read and normalize the settings document', async () => {
            mockLocalizationGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    defaultLanguage: 'en',
                    enabledLanguages: [
                        { code: 'en', label: 'English', nativeLabel: 'English' },
                        { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
                    ],
                }),
            });

            const result = await getLocalizationSettings();

            expect(result.defaultLanguage).toBe('en');
            expect(result.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
        });

        it('should fall back to a single-language site when the doc is missing', async () => {
            mockLocalizationGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

            const result = await getLocalizationSettings();

            expect(result).toEqual({
                defaultLanguage: 'en',
                enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }],
            });
        });

        it('should fall back to a single-language site when the read throws', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockLocalizationGet.mockRejectedValueOnce(new Error('unavailable'));

            const result = await getLocalizationSettings();

            expect(result.enabledLanguages.map((l) => l.code)).toEqual(['en']);
            consoleSpy.mockRestore();
        });

        it('should cache within the TTL and re-read after clearSettingsCache', async () => {
            mockLocalizationGet.mockResolvedValue({
                exists: true,
                data: () => ({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }] }),
            });

            await getLocalizationSettings();
            await getLocalizationSettings();
            expect(mockLocalizationGet).toHaveBeenCalledTimes(1);

            clearSettingsCache();
            await getLocalizationSettings();
            expect(mockLocalizationGet).toHaveBeenCalledTimes(2);
        });
    });

    describe('localization helpers', () => {
        const settings = {
            defaultLanguage: 'en',
            enabledLanguages: [
                { code: 'en', label: 'English', nativeLabel: 'English' },
                { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
            ],
        };

        it('getExtraLanguages should exclude the default', () => {
            expect(getExtraLanguages(settings).map((l) => l.code)).toEqual(['hi']);
        });

        it('languagePathPrefix should leave the default language at the root', () => {
            expect(languagePathPrefix(settings, 'en')).toBe('');
            expect(languagePathPrefix(settings, 'hi')).toBe('/hi');
        });
    });
});
