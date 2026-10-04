/**
 * The home page, published like content (pages/deployHomePage.ts,
 * specs/own-website-spec.md W4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSiteFile, mockGetSiteManifest, mockLoadSiteTemplate, mockDeployBatch, mockGetUiStrings, mockLocalization, mockCollection } = vi.hoisted(() => ({
    mockGetSiteFile: vi.fn(),
    mockGetSiteManifest: vi.fn(),
    mockLoadSiteTemplate: vi.fn(),
    mockDeployBatch: vi.fn(),
    mockGetUiStrings: vi.fn(),
    mockLocalization: vi.fn(),
    mockCollection: vi.fn(),
}));

vi.mock('../init', () => ({ db: { collection: (...args: unknown[]) => mockCollection(...args) } }));
vi.mock('../shared/site-files', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../shared/site-files.js')>()),
    getSiteFile: (...a: unknown[]) => mockGetSiteFile(...a),
    getSiteManifest: (...a: unknown[]) => mockGetSiteManifest(...a),
    loadSiteTemplate: (...a: unknown[]) => mockLoadSiteTemplate(...a),
    pageStylesheets: async (urls: string[]) => [...urls, '/assets/css/site.css?v=s1'],
}));
vi.mock('../shared/site-settings', () => ({
    getPartials: async () => ({ headerHtml: '<nav class="site-nav"><a href="/articles">Articles</a><arc-search></arc-search></nav>', footerHtml: '<footer>Footer</footer>' }),
    getSiteConfig: async () => ({ siteName: 'Deepakam', baseUrl: 'https://deepakam.example', cssUrls: ['/assets/css/main.css'] }),
    getMiscSettings: async () => ({ showPoweredBy: false }),
    getLocalizationSettings: (...a: unknown[]) => mockLocalization(...a),
    getAboutConfig: async () => ({ name: 'Deepakam', description: 'Sanskrit for kids.', logoUrl: 'https://deepakam.example/logo.png', finalUrl: '', address: '', sameAs: [], contactEmail: '', organizationType: 'Organization' }),
    getUiStrings: (...a: unknown[]) => mockGetUiStrings(...a),
}));
vi.mock('../pages/deployToHosting', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../pages/deployToHosting.js')>()),
    deployBatchToHosting: (...a: unknown[]) => mockDeployBatch(...a),
}));

import {
    addLegalNotices, generateAndDeployHomePage, homeContentTypes, homeFilePath, homeShowsType, homeUrl, setupState,
} from '../pages/deployHomePage.js';
import { loadHtml } from '../shared/lazy-cheerio.js';

const HOME = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title data-arc-t="home_title">Learn Sanskrit</title>
<link rel="stylesheet" href="/site/home.css">
</head><body>
<arc-header></arc-header>
<h1 data-arc-t="home_heading">Hello</h1>
<a class="more" href="/articles">More</a><a class="terms" href="/p/terms">Terms</a>
<arc-content-partials content-type="articles" count="2" section-title="From the blog"></arc-content-partials>
<form data-waitlist-form data-waitlist-id="waitlist-form"><input name="email"><button type="submit">Join</button></form>
<arc-footer></arc-footer>
<script src="/site/home.js"></script>
</body></html>`;

const MANIFEST = { version: 1, home: { default: 'app' }, templates: {}, pages: { terms: 'app', 'privacy-policy': 'core' }, strings: ['hi'], files: { 'assets/js/arc-site.js': 'j1' } };

let onboarding: Record<string, unknown> | null;
let emailLookupEmpty: boolean;

function wireDb(): void {
    mockCollection.mockImplementation((name: string) => {
        if (name === 'Settings') {
            return { doc: () => ({ get: async () => ({ exists: !!onboarding, data: () => onboarding }) }) };
        }
        if (name === 'email_lookup') {
            return { limit: () => ({ get: async () => ({ empty: emailLookupEmpty }) }) };
        }
        if (name === 'ContentTypes') {
            return { where: () => ({ limit: () => ({ get: async () => ({ empty: false, docs: [{ data: () => ({ slug: 'articles', name: 'Articles', templateFolder: '' }) }] }) }) }) };
        }
        return {
            orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [
                { id: 'a1', data: () => ({ title: 'First post', urlSlug: 'first-post', publishedOn: { seconds: 1705334400 } }) },
            ] }) }) }),
            doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ title: 'पहला लेख' }) }) }) }) }),
        };
    });
}

/** The files the deploy released, by path. */
function released(): Record<string, string> {
    const batch = mockDeployBatch.mock.calls[0][1] as { files: { path: string; content: string }[] };
    return Object.fromEntries(batch.files.map((f) => [f.path, f.content]));
}

describe('deployHomePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GCLOUD_PROJECT = 'test-project';
        delete process.env.ARC_HOSTING_SITE;
        mockGetSiteManifest.mockResolvedValue(MANIFEST);
        mockGetSiteFile.mockImplementation(async (path: string) => (path === 'home.html' ? HOME : null));
        mockLoadSiteTemplate.mockResolvedValue('<section data-arc-if="hasItems"><h2>{{ sectionTitle }}</h2><a class="all" href="{{ listUrl }}">All</a><div data-arc-loop="items"><a class="card" href="{{ url }}">{{ title }}</a></div></section>');
        mockGetUiStrings.mockResolvedValue({ home_heading: 'नमस्ते', home_title: 'संस्कृत सीखें', legal_terms: 'शर्तें' });
        mockLocalization.mockResolvedValue({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' }] });
        mockDeployBatch.mockResolvedValue(true);
        onboarding = { completed: true };
        emailLookupEmpty = false;
        wireDb();
    });

    describe('addresses', () => {
        it('writes the default language at the root and the others under their code', () => {
            expect(homeFilePath('en', 'en')).toBe('/index.html');
            expect(homeFilePath('hi', 'en')).toBe('/hi/index.html');
            expect(homeUrl('https://x.example/', 'en', 'en')).toBe('https://x.example/');
            expect(homeUrl('https://x.example', 'hi', 'en')).toBe('https://x.example/hi');
        });

        it('knows which content types a home page shows', () => {
            expect(homeContentTypes(HOME)).toEqual(['articles']);
            expect(homeContentTypes('<arc-content-partials content-type="a"></arc-content-partials><arc-content-partials content-type=\'b\'>')).toEqual(['a', 'b']);
        });

        it('says when a content type\'s change has to republish the home page', async () => {
            expect(await homeShowsType('articles')).toBe(true);
            expect(await homeShowsType('events')).toBe(false);
        });
    });

    describe('the published page', () => {
        it('writes every enabled language in one release', async () => {
            await generateAndDeployHomePage();
            expect(Object.keys(released()).sort()).toEqual(['/hi/index.html', '/index.html']);
        });

        it('keeps the page\'s own head and adds every SEO tag it does not set', async () => {
            await generateAndDeployHomePage();
            const $ = loadHtml(released()['/index.html'], { xmlMode: false });
            expect($('title').text()).toBe('Learn Sanskrit');
            expect($('meta[name="description"]').attr('content')).toBe('Sanskrit for kids.');
            expect($('link[rel="canonical"]').attr('href')).toBe('https://deepakam.example/');
            expect($('meta[property="og:url"]').attr('content')).toBe('https://deepakam.example/');
            expect($('meta[property="og:image"]').attr('content')).toBe('https://deepakam.example/logo.png');
            expect($('link[hreflang="hi"]').attr('href')).toBe('https://deepakam.example/hi');
            expect($('link[hreflang="x-default"]').attr('href')).toBe('https://deepakam.example/');
            expect($('script[type="application/ld+json"]').length).toBeGreaterThan(0);
            expect($('meta[name="robots"]').attr('content')).toBe('index, follow');
            expect($('html').attr('lang')).toBe('en');
        });

        it('links Arc CMS\'s stylesheets before the page\'s own, so the page\'s win', async () => {
            await generateAndDeployHomePage();
            const links = loadHtml(released()['/index.html'], { xmlMode: false })('link[rel="stylesheet"]').toArray().map((l) => l.attribs['href']);
            expect(links.indexOf('/assets/css/main.css')).toBeLessThan(links.indexOf('/site/home.css'));
            expect(links.indexOf('/assets/css/site.css?v=s1')).toBeLessThan(links.indexOf('/site/home.css'));
        });

        it('fills the header, footer and cards, adds the terms notice and the live-parts script', async () => {
            await generateAndDeployHomePage();
            const html = released()['/index.html'];
            const $ = loadHtml(html, { xmlMode: false });
            expect($('nav.site-nav').length).toBe(1);
            expect($('footer').text()).toBe('Footer');
            expect(html).not.toContain('<arc-');
            expect($('h2').text()).toBe('From the blog');
            expect($('a.card').attr('href')).toBe('/articles/first-post');
            expect($('a.all').attr('href')).toBe('/articles');
            expect($('form [data-legal-notice]').text()).toContain('Terms of Service');
            expect($('form [data-legal-notice] a[href="/p/terms"]').length).toBe(1);
            expect($('form [data-legal-notice] a[href="/p/privacy-policy"]').length).toBe(0); // Arc CMS's sample is never linked
            const site = $('script[src="/assets/js/arc-site.js?v=j1"]');
            expect(site.length).toBe(1);
            expect(site.attr('data-functions')).toBe('https://us-central1-test-project.cloudfunctions.net');
            expect(site.attr('data-group')).toBe('arccms');
            expect(site.attr('data-project')).toBe('test-project');
            expect(site.attr('data-database')).toBe('(default)');
            expect($('script[src="/site/home.js"]').length).toBe(1);
            expect(site.attr('data-setup')).toBeUndefined(); // set up: no check, no read
        });

        it('asks the page to check the setup wizard while it is still to do', async () => {
            onboarding = null;
            emailLookupEmpty = true;
            expect(await setupState()).toBe('first-run');
            await generateAndDeployHomePage();
            const $ = loadHtml(released()['/index.html'], { xmlMode: false });
            expect($('script[src^="/assets/js/arc-site.js"]').attr('data-setup')).toBe('first-run');

            onboarding = { completed: false, startedBy: 'u1' };
            expect(await setupState()).toBe('in-progress');
            onboarding = null;
            emailLookupEmpty = false; // an install from before the flag, already set up
            expect(await setupState()).toBe('');
        });

        it('publishes home.html in another language through its strings, links in that language', async () => {
            await generateAndDeployHomePage();
            const $ = loadHtml(released()['/hi/index.html'], { xmlMode: false });
            expect($('html').attr('lang')).toBe('hi');
            expect($('h1').text()).toBe('नमस्ते');
            expect($('title').text()).toBe('संस्कृत सीखें');
            expect($('a.more').attr('href')).toBe('/hi/articles');
            expect($('a.terms').attr('href')).toBe('/p/terms');
            expect($('nav.site-nav a').attr('href')).toBe('/hi/articles');
            expect($('a.card').attr('href')).toBe('/hi/articles/first-post');
            expect($('a.card').text()).toBe('पहला लेख');
            expect($('link[rel="canonical"]').attr('href')).toBe('https://deepakam.example/hi');
            expect($('form [data-legal-notice]').text()).toContain('शर्तें');
        });

        it('uses the language\'s own file when the site has one', async () => {
            mockGetSiteManifest.mockResolvedValue({ ...MANIFEST, home: { default: 'app', hi: 'app' } });
            mockGetSiteFile.mockImplementation(async (path: string) =>
                path === 'home.hi.html' ? HOME.replace('<h1 data-arc-t="home_heading">Hello</h1>', '<h1>हिंदी पेज</h1>') : path === 'home.html' ? HOME : null);
            await generateAndDeployHomePage();
            expect(loadHtml(released()['/hi/index.html'], { xmlMode: false })('h1').text()).toBe('हिंदी पेज');
        });

        it('keeps a placeholder\'s noindex', async () => {
            mockGetSiteFile.mockImplementation(async (path: string) => (path === 'home.html'
                ? '<!doctype html><html><head><title>Coming soon</title><meta name="robots" content="noindex"></head><body><h1>Not set up</h1></body></html>' : null));
            await generateAndDeployHomePage();
            expect(loadHtml(released()['/index.html'], { xmlMode: false })('meta[name="robots"]').attr('content')).toBe('noindex');
        });

        it('stops, deploying nothing, when the live site has no home page file', async () => {
            mockGetSiteFile.mockResolvedValue(null);
            await expect(generateAndDeployHomePage()).rejects.toThrow('The live site has no home page (/_site/home.html). Deploy the website first.');
            expect(mockDeployBatch).not.toHaveBeenCalled();
        });

        it('does nothing when hosting is off', async () => {
            process.env.ARC_HOSTING_SITE = 'none';
            await generateAndDeployHomePage();
            expect(mockDeployBatch).not.toHaveBeenCalled();
            expect(mockGetSiteFile).not.toHaveBeenCalled();
        });
    });

    describe('addLegalNotices', () => {
        it('leaves a form that already has its own notice', () => {
            const $ = loadHtml('<form data-waitlist-form><p data-legal-notice>Mine</p><button>Go</button></form>', { xmlMode: false });
            addLegalNotices($, {}, null);
            expect($('[data-legal-notice]').length).toBe(1);
            expect($('[data-legal-notice]').text()).toBe('Mine');
        });

        it('puts the notice above the submit button, in plain text without the app\'s pages', () => {
            const $ = loadHtml('<form data-waitlist-form><input><button type="submit">Go</button></form>', { xmlMode: false });
            addLegalNotices($, {}, null);
            expect($('form').children().eq(1).is('[data-legal-notice]')).toBe(true);
            expect($('[data-legal-notice] a').length).toBe(0);
        });
    });
});
