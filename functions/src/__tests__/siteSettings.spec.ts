import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-document mocks for cleaner testing
const mockAboutGet = vi.fn();
const mockSiteGet = vi.fn();
const mockLocalizationGet = vi.fn();
const mockMiscGet = vi.fn();

vi.mock('../init', () => ({
    db: {
        doc: vi.fn((path: string) => {
            if (path === 'Settings/about') return { get: mockAboutGet };
            if (path === 'Settings/site') return { get: mockSiteGet };
            if (path === 'Settings/localization') return { get: mockLocalizationGet };
            if (path === 'Settings/misc') return { get: mockMiscGet };
            return { get: vi.fn() };
        }),
    },
}));

// The live site's files (/_site/), fetched over HTTP
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
    getPartials,
    getSiteConfig,
    getAboutConfig,
    getMiscSettings,
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
        const respond = (byPath: Record<string, string>) => mockFetch.mockImplementation(async (url: string) => {
            const path = url.replace('https://test-project.web.app', '');
            return path in byPath
                ? { ok: true, text: async () => byPath[path] }
                : { ok: true, text: async () => '<!doctype html><html><body><arc-root></arc-root></body></html>' };
        });

        it('reads the header and footer from the live site\'s /_site/', async () => {
            respond({ '/_site/header.html': ' <nav>Header</nav>\n', '/_site/footer.html': '<footer>Footer</footer>' });

            expect(await getPartials()).toEqual({ headerHtml: '<nav>Header</nav>', footerHtml: '<footer>Footer</footer>' });
            expect(mockFetch).toHaveBeenCalledWith('https://test-project.web.app/_site/header.html');
            expect(mockFetch).toHaveBeenCalledWith('https://test-project.web.app/_site/footer.html');
        });

        it('never reads Settings/partials', async () => {
            respond({ '/_site/header.html': '<nav/>', '/_site/footer.html': '<footer/>' });
            await getPartials();
            expect(db.doc).not.toHaveBeenCalledWith('Settings/partials');
        });

        it('returns empty strings when the live site has no such files (the app shell answers)', async () => {
            respond({});
            expect(await getPartials()).toEqual({ headerHtml: '', footerHtml: '' });
        });

        it('returns empty strings when the fetch fails or hosting is off', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));
            expect(await getPartials()).toEqual({ headerHtml: '', footerHtml: '' });

            clearSettingsCache();
            process.env.ARC_HOSTING_SITE = 'none';
            try {
                expect(await getPartials()).toEqual({ headerHtml: '', footerHtml: '' });
            } finally {
                delete process.env.ARC_HOSTING_SITE;
            }
        });

        it('reads the files once, and again after clearSettingsCache', async () => {
            respond({ '/_site/header.html': '<nav/>', '/_site/footer.html': '<footer/>' });
            const fileReads = () => mockFetch.mock.calls.filter(([url]) => !String(url).endsWith('/site.json')).length;
            await getPartials();
            await getPartials();
            expect(fileReads()).toBe(2);

            clearSettingsCache();
            await getPartials();
            expect(fileReads()).toBe(4);
        });
    });

    // ─── getMiscSettings ───────────────────────────────────────────────────

    describe('getMiscSettings', () => {
        it('reads the image maximum, with 1200 when it is not set', async () => {
            mockMiscGet.mockResolvedValueOnce({ data: () => ({ showPoweredBy: false, mediaMaxSize: 2000 }) });
            expect(await getMiscSettings()).toEqual({ showPoweredBy: false, mediaMaxSize: 2000 });

            clearSettingsCache();
            mockMiscGet.mockResolvedValueOnce({ data: () => undefined });
            expect(await getMiscSettings()).toEqual({ showPoweredBy: true, mediaMaxSize: 1200 });
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
                logoUrl: '',
                description: '',
                sameAs: [],
                contactEmail: '',
                phone: '',
                organizationType: 'Organization',
            });
        });

        it('reads the public phone (SS3)', async () => {
            mockAboutGet.mockResolvedValueOnce({ data: () => ({ name: 'My Site', phone: '+91 98765 43210' }) });
            expect((await getAboutConfig()).phone).toBe('+91 98765 43210');
        });

        it('should return empty identity when document does not exist', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => undefined,
            });

            const result = await getAboutConfig();

            expect(result).toEqual({
                name: '',
                finalUrl: '',
                address: '',
                logoUrl: '',
                description: '',
                sameAs: [],
                contactEmail: '',
                phone: '',
                organizationType: 'Organization',
            });
        });

        it('should read the identity fields and drop non-string sameAs entries', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({
                    name: 'Jane',
                    finalUrl: 'https://jane.dev',
                    logoUrl: 'https://jane.dev/me.png',
                    description: 'Writes about CMSes.',
                    sameAs: ['https://x.com/jane', 42, null],
                    contactEmail: 'jane@jane.dev',
                    organizationType: 'Person',
                }),
            });

            const result = await getAboutConfig();

            expect(result.logoUrl).toBe('https://jane.dev/me.png');
            expect(result.description).toBe('Writes about CMSes.');
            expect(result.sameAs).toEqual(['https://x.com/jane']);
            expect(result.contactEmail).toBe('jane@jane.dev');
            expect(result.organizationType).toBe('Person');
        });

        it('should coerce an unknown organizationType to Organization', async () => {
            mockAboutGet.mockResolvedValueOnce({
                data: () => ({ name: 'X', organizationType: 'Corporation' }),
            });
            const result = await getAboutConfig();
            expect(result.organizationType).toBe('Organization');
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
