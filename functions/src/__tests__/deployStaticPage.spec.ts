import { onTestFinished, describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
    mockFetch,
    mockGetPartials,
    mockGetSiteConfig,
    mockGetMiscSettings,
    mockGetUiStrings,
    mockDeployFileToHosting,
} = vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockGetPartials: vi.fn(),
    mockGetSiteConfig: vi.fn(),
    mockGetMiscSettings: vi.fn(),
    mockGetUiStrings: vi.fn(),
    mockDeployFileToHosting: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

// The site's details and standard pages for data-arc-site (SS3, SS6), read in site-info-source.ts.
vi.mock('../shared/site-info-source', () => ({ siteInfoFor: async () => ({ name: 'Kumar Studio', phone: '+91 98765 43210', contactEmail: 'hi@kumar.example', sameAs: [], year: 2026, pages: [] }) }));
vi.mock('../shared/site-settings', () => ({
    getPartials: mockGetPartials,
    getSiteConfig: mockGetSiteConfig,
    getMiscSettings: mockGetMiscSettings,
    getUiStrings: mockGetUiStrings,
    // The search widget is built for the default language (S5).
    getLocalizationSettings: vi.fn().mockResolvedValue({ defaultLanguage: 'en', enabledLanguages: [] }),
    // The site's own details for data-arc-site (SS3).
    getAboutConfig: vi.fn().mockResolvedValue({ name: 'Kumar Studio', phone: '+91 98765 43210', contactEmail: 'hi@kumar.example', sameAs: [] }),
}));

vi.mock('../pages/deployToHosting', () => ({
    deployFileToHosting: mockDeployFileToHosting,
}));

import { generateAndDeployStaticPage, staticPageSlugs } from '../pages/deployStaticPage.js';
import { clearSiteFilesCache } from '../shared/site-files.js';

// ─── Test Data ──────────────────────────────────────────────────────────────

const RAW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Privacy Policy - Test Site</title>
    <meta name="description" content="Privacy Policy for Test Site.">
</head>
<body>
    <arc-header></arc-header>
    <div class="container">
        <h1>Privacy Policy</h1>
        <p>This is the privacy policy content.</p>
    </div>
    <arc-footer></arc-footer>
</body>
</html>`;

const RAW_HTML_WITH_STYLES = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Cookie Policy</title>
    <style>body { font-family: sans-serif; }</style>
</head>
<body>
    <arc-header></arc-header>
    <div class="container"><h1>Cookie Policy</h1></div>
    <arc-footer></arc-footer>
</body>
</html>`;

const MOCK_PARTIALS = {
    headerHtml: '<header class="site-header">Site Header</header>',
    footerHtml: '<footer class="site-footer">Site Footer</footer>',
};

const MOCK_SITE_CONFIG = {
    siteName: 'Test Site',
    baseUrl: 'https://example.com',
    cssUrls: ['/assets/css/main.css', '/assets/css/theme.css'],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('deployStaticPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearSiteFilesCache();
        process.env.GCLOUD_PROJECT = 'test-project';

        mockGetPartials.mockResolvedValue(MOCK_PARTIALS);
        mockGetSiteConfig.mockResolvedValue(MOCK_SITE_CONFIG);
        mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });
        mockGetUiStrings.mockResolvedValue({});
        mockDeployFileToHosting.mockResolvedValue(undefined);

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(RAW_HTML),
        });
    });

    // specs/form-gamification-spec.md G-D4: static pages are in the default language,
    // so its strings file words them, the signup panels included.
    describe('the default language\'s strings file', () => {
        const PAGE = '<html><head></head><body><arc-header></arc-header><h1 data-arc-t="page_heading">Hello</h1>'
            + '<form data-waitlist-form><input name="email"><button type="submit">Join</button></form><arc-footer></arc-footer></body></html>';

        it('applies it to the page and gives the signup panels their keys', async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(PAGE) });
            mockGetUiStrings.mockResolvedValue({ page_heading: 'Welcome aboard', signup_on_list: 'Thanks, you are in!' });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2] as string;
            expect(mockGetUiStrings).toHaveBeenCalledWith('en');
            expect(deployedHtml).toContain('Welcome aboard');
            expect(deployedHtml).toContain('data-strings=');
            expect(deployedHtml).toContain('Thanks, you are in!');
        });

        it('keeps the authored text when the site has none', async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(PAGE) });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2] as string;
            expect(deployedHtml).toContain('>Hello<');
            expect(deployedHtml).not.toContain('data-strings=');
        });
    });

    describe('happy path', () => {
        it('should fetch the page from the live site at /_site/pages/{slug}.html', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-project.web.app/_site/pages/privacy-policy.html',
            );
        });

        it('should replace <arc-header> with actual header HTML', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Site Header');
            expect(deployedHtml).not.toContain('<arc-header>');
        });

        it('should replace <arc-footer> with actual footer HTML', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Site Footer');
            expect(deployedHtml).not.toContain('<arc-footer>');
        });

        it('fills the site\'s details in the page and its footer (SS3)', async () => {
            mockGetPartials.mockResolvedValue({
                ...MOCK_PARTIALS,
                footerHtml: '<footer>Site Footer <a data-arc-site="phone">phone</a><span data-arc-site="address">no address</span></footer>',
            });
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('<a href="tel:+919876543210">+91 98765 43210</a>');
            expect(deployedHtml).not.toContain('no address');
            expect(deployedHtml).not.toContain('data-arc-site');
        });

        it('adds arc-site.js, so a contact or signup form works here (SS5)', async () => {
            await generateAndDeployStaticPage('privacy-policy');
            expect(mockDeployFileToHosting.mock.calls[0][2]).toContain('/assets/js/arc-site.js');
        });

        it('should inject site CSS link tags into <head>', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('<link rel="stylesheet" href="/assets/css/main.css">');
            expect(deployedHtml).toContain('<link rel="stylesheet" href="/assets/css/theme.css">');
        });

        it('links Arc CMS\'s stylesheets before the page\'s own <style> and <link>, so the page\'s rules win', async () => {
            const page = `<!DOCTYPE html><html lang="en"><head>
    <title>Launch</title>
    <meta charset="UTF-8">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="/site/pages/launch.css">
    <style>.hero { min-height: 80vh; }</style>
</head><body><arc-header></arc-header><section class="hero">Hi</section><arc-footer></arc-footer></body></html>`;
            mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(page) });

            await generateAndDeployStaticPage('launch');

            const deployedHtml: string = mockDeployFileToHosting.mock.calls[0][2];
            const at = (needle: string) => {
                const i = deployedHtml.indexOf(needle);
                expect(i, needle).toBeGreaterThan(-1);
                return i;
            };
            const lastSiteSheet = at('href="/assets/css/site.css"');
            expect(at('href="/assets/css/main.css"')).toBeLessThan(at('href="/assets/css/theme.css"'));
            expect(at('href="/assets/css/theme.css"')).toBeLessThan(lastSiteSheet);
            expect(lastSiteSheet).toBeLessThan(at('href="/site/pages/launch.css"'));
            expect(lastSiteSheet).toBeLessThan(at('<style>.hero'));
            // The charset stays the first thing in <head>.
            expect(at('<meta charset="UTF-8">')).toBeLessThan(at('href="/assets/css/main.css"'));
            expect(deployedHtml.match(/<meta charset/g)).toHaveLength(1);
        });

        it('should add arc-served-by meta tag', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('arc-served-by');
            expect(deployedHtml).toContain('firebase-hosting');
        });

        it('should add arc-deployed-at meta tag', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('arc-deployed-at');
        });

        it('should deploy to /pages/{slug}/index.html', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            expect(mockDeployFileToHosting).toHaveBeenCalledWith(
                'test-project',
                '/pages/privacy-policy/index.html',
                expect.any(String),
                'static_pages',
                'privacy-policy',
            );
        });

        it('should preserve the original page content', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Privacy Policy');
            expect(deployedHtml).toContain('This is the privacy policy content.');
        });

        it('should preserve original title and meta tags', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('<title>Privacy Policy - Test Site</title>');
            expect(deployedHtml).toContain('Privacy Policy for Test Site.');
        });

        it('should work with pages that have inline styles', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(RAW_HTML_WITH_STYLES),
            });

            await generateAndDeployStaticPage('cookie-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('font-family: sans-serif');
            expect(deployedHtml).toContain('Cookie Policy');
            expect(deployedHtml).toContain('Site Header');
        });
    });

    describe('error handling', () => {
        it('should throw when fetch returns non-OK response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve('Not Found'),
            });

            await expect(
                generateAndDeployStaticPage('nonexistent'),
            ).rejects.toThrow('The live site has no page nonexistent (/_site/pages/nonexistent.html). Deploy the website first.');
        });

        it('should throw when the live site answers with the app shell (no such page)', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve('<!doctype html><html><body><arc-root></arc-root></body></html>'),
            });

            await expect(generateAndDeployStaticPage('terms')).rejects.toThrow('The live site has no page terms');
        });

        it('should throw when fetch itself fails (network error)', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            await expect(
                generateAndDeployStaticPage('privacy-policy'),
            ).rejects.toThrow('The live site has no page privacy-policy');
        });
    });

    describe('edge cases', () => {
        it('should handle empty CSS URLs array', async () => {
            mockGetSiteConfig.mockResolvedValue({
                ...MOCK_SITE_CONFIG,
                cssUrls: [],
            });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            // Only the site's own stylesheet, which every page links.
            expect(deployedHtml.match(/rel="stylesheet"/g)).toHaveLength(1);
            expect(deployedHtml).toContain('href="/assets/css/site.css"');
            // Should still replace arc components
            expect(deployedHtml).toContain('Site Header');
        });

        it('should handle empty partials gracefully', async () => {
            mockGetPartials.mockResolvedValue({
                headerHtml: '',
                footerHtml: '',
            });

            await generateAndDeployStaticPage('privacy-policy');

            // Should still deploy (no crash)
            expect(mockDeployFileToHosting).toHaveBeenCalled();
            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Privacy Policy');
        });

        it('builds the search box for the project, not the hosting site, when the two differ', async () => {
            process.env.GCLOUD_PROJECT = 'acme';
            process.env.ARC_HOSTING_SITE = 'acme-arccms';
            onTestFinished(() => { delete process.env.ARC_HOSTING_SITE; });
            mockFetch.mockResolvedValue({ ok: true, text: async () => '<html><body><arc-search></arc-search>Policy</body></html>' });
            await generateAndDeployStaticPage('privacy-policy');
            const html: string = mockDeployFileToHosting.mock.calls[0][2];
            // The callable lives at https://{region}-{project}.cloudfunctions.net (search/widget.ts).
            expect(html).toMatch(/https:\/\/[a-z0-9-]+-acme\.cloudfunctions\.net\//);
            expect(html).not.toContain('-acme-arccms.cloudfunctions.net');
        });

        it('joins a site-wide release instead of releasing alone when given a batch', async () => {
            const added: string[] = [];
            await generateAndDeployStaticPage('privacy-policy', { add: (path: string) => added.push(path) } as never);
            expect(added).toEqual(['/pages/privacy-policy/index.html']);
            expect(mockDeployFileToHosting).not.toHaveBeenCalled();
        });

        it('should use GCLOUD_PROJECT as siteId', async () => {
            process.env.GCLOUD_PROJECT = 'my-custom-project';

            await generateAndDeployStaticPage('privacy-policy');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://my-custom-project.web.app/_site/pages/privacy-policy.html',
            );
            expect(mockDeployFileToHosting).toHaveBeenCalledWith(
                'my-custom-project',
                expect.any(String),
                expect.any(String),
                expect.any(String),
                expect.any(String),
            );
        });
    });

    describe('Powered-by footer', () => {
        it('should include "Built with Arc CMS" when showPoweredBy is true', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Built with <a href="https://arccms.com"');
            expect(deployedHtml).toContain('arccms.com');
        });

        it('should NOT include "Built with Arc CMS" when showPoweredBy is false', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: false });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).not.toContain('arc-powered-by');
            expect(deployedHtml).not.toContain('arccms.com');
        });
    });

    describe('staticPageSlugs', () => {
        it('lists every page in the live site\'s manifest, the app\'s own included', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(JSON.stringify({
                    version: 1, home: {}, templates: {}, strings: [], files: {},
                    pages: { terms: 'app', 'privacy-policy': 'app', 'cookie-policy': 'core' },
                })),
            });

            expect(await staticPageSlugs()).toEqual(['cookie-policy', 'privacy-policy', 'terms']);
            expect(mockFetch).toHaveBeenCalledWith('https://test-project.web.app/_site/site.json');
        });

        it('falls back to the two pages Arc CMS has always shipped when the live site has no manifest', async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') });

            expect(await staticPageSlugs()).toEqual(['privacy-policy', 'cookie-policy']);
        });
    });
});
