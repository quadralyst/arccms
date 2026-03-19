import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
    mockFetch,
    mockGetPartials,
    mockGetSiteConfig,
    mockGetMiscSettings,
    mockDeployFileToHosting,
} = vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockGetPartials: vi.fn(),
    mockGetSiteConfig: vi.fn(),
    mockGetMiscSettings: vi.fn(),
    mockDeployFileToHosting: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('../shared/site-settings', () => ({
    getPartials: mockGetPartials,
    getSiteConfig: mockGetSiteConfig,
    getMiscSettings: mockGetMiscSettings,
}));

vi.mock('../pages/deployToHosting', () => ({
    deployFileToHosting: mockDeployFileToHosting,
}));

import { generateAndDeployStaticPage } from '../pages/deployStaticPage.js';

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
        process.env.GCLOUD_PROJECT = 'test-project';

        mockGetPartials.mockResolvedValue(MOCK_PARTIALS);
        mockGetSiteConfig.mockResolvedValue(MOCK_SITE_CONFIG);
        mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });
        mockDeployFileToHosting.mockResolvedValue(undefined);

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(RAW_HTML),
        });
    });

    describe('happy path', () => {
        it('should fetch raw HTML from hosting at /pages/{slug}.html', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-project.web.app/pages/privacy-policy.html',
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

        it('should inject site CSS link tags into <head>', async () => {
            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('<link rel="stylesheet" href="/assets/css/main.css">');
            expect(deployedHtml).toContain('<link rel="stylesheet" href="/assets/css/theme.css">');
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
            ).rejects.toThrow('Failed to fetch static page source');
        });

        it('should include HTTP status code in error message', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 403,
                text: () => Promise.resolve('Forbidden'),
            });

            await expect(
                generateAndDeployStaticPage('forbidden'),
            ).rejects.toThrow('HTTP 403');
        });

        it('should throw when fetch itself fails (network error)', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            await expect(
                generateAndDeployStaticPage('privacy-policy'),
            ).rejects.toThrow('Network error');
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
            expect(deployedHtml).not.toContain('stylesheet');
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

        it('should use GCLOUD_PROJECT as siteId', async () => {
            process.env.GCLOUD_PROJECT = 'my-custom-project';

            await generateAndDeployStaticPage('privacy-policy');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://my-custom-project.web.app/pages/privacy-policy.html',
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
        it('should include "Powered by Arc CMS" when showPoweredBy is true', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: true });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).toContain('Powered by');
            expect(deployedHtml).toContain('arccms.com');
        });

        it('should NOT include "Powered by Arc CMS" when showPoweredBy is false', async () => {
            mockGetMiscSettings.mockResolvedValue({ showPoweredBy: false });

            await generateAndDeployStaticPage('privacy-policy');

            const deployedHtml = mockDeployFileToHosting.mock.calls[0][2];
            expect(deployedHtml).not.toContain('Powered by');
            expect(deployedHtml).not.toContain('arccms.com');
        });
    });
});
