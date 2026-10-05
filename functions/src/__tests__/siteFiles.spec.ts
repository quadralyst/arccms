/**
 * Publishing reads the live site's /_site/ files (shared/site-files.ts,
 * specs/own-website-spec.md, W3): templates chosen the way the app chooses them,
 * a missing folder refused, the default built into the functions as the last
 * resort, and nothing from Firestore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
    MissingTemplateFolderError, clearSiteFilesCache, getSiteFile, getSiteManifest, loadDetailTemplate, loadSiteTemplate, pageStylesheets,
    siteStylesheets, versionedUrl,
} from '../shared/site-files.js';
import { DEFAULT_TEMPLATES } from '../site-defaults.gen.js';
// @ts-expect-error: plain ESM script without type declarations
import { readSiteFile } from '../../../scripts/arc-site.mjs';

const ORIGIN = 'https://test-project.web.app';
const SHELL = '<!doctype html><html><head></head><body><arc-root><arc-not-found>404</arc-not-found></arc-root></body></html>';

const MANIFEST = {
    version: 1,
    home: {},
    templates: {
        default: { partials: 'core', list: 'core', detail: 'core' },
        articles: { partials: 'core', list: 'core', detail: 'core' },
        recipes: { detail: 'app' },
    },
    pages: { 'privacy-policy': 'core' },
    strings: ['hi'],
    files: { 'assets/css/site.css': 'abc123' },
};

/** The live site: these paths answer with their text, everything else with the app shell. */
function liveSite(files: Record<string, string>) {
    mockFetch.mockImplementation(async (url: string) => {
        const path = url.replace(ORIGIN, '');
        return { ok: true, status: 200, text: async () => (path in files ? files[path] : SHELL) };
    });
}

/** How often the live site was asked for `path`. */
const reads = (path: string) => mockFetch.mock.calls.filter(([url]) => url === `${ORIGIN}${path}`).length;

let clock = 0;
/** Moves the clock the caches read forward. */
function later(ms: number) {
    clock += ms;
}

describe('site-files', () => {
    beforeEach(() => {
        clock = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        vi.clearAllMocks();
        clearSiteFilesCache();
        process.env.GCLOUD_PROJECT = 'test-project';
        delete process.env.ARC_HOSTING_SITE;
    });

    afterEach(() => {
        delete process.env.ARC_HOSTING_SITE;
    });

    describe('getSiteFile', () => {
        it('reads /_site/{path} from the live site', async () => {
            liveSite({ '/_site/header.html': '<nav/>' });
            expect(await getSiteFile('header.html')).toBe('<nav/>');
            expect(mockFetch).toHaveBeenCalledWith(`${ORIGIN}/_site/header.html`);
        });

        it('refuses the app shell that answers a path the site does not have', async () => {
            liveSite({});
            expect(await getSiteFile('pages/terms.html')).toBeNull();
        });

        it('gives null on a failed request, and asks nothing when hosting is off', async () => {
            mockFetch.mockRejectedValue(new Error('offline'));
            expect(await getSiteFile('header.html')).toBeNull();

            clearSiteFilesCache();
            mockFetch.mockClear();
            process.env.ARC_HOSTING_SITE = 'none';
            expect(await getSiteFile('header.html')).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('caches each file until the cache is cleared', async () => {
            liveSite({ '/_site/footer.html': '<footer/>' });
            await getSiteFile('footer.html');
            await getSiteFile('footer.html');
            expect(reads('/_site/footer.html')).toBe(1);
            clearSiteFilesCache();
            await getSiteFile('footer.html');
            expect(reads('/_site/footer.html')).toBe(2);
        });

        // B6: "deploy the website, then publish again" must see the deploy at once.
        it('keeps a listed file until a deploy changes its hash', async () => {
            const site: Record<string, string> = {
                '/_site/site.json': JSON.stringify({ ...MANIFEST, files: { '_site/header.html': 'h1' } }),
                '/_site/header.html': '<nav>old</nav>',
            };
            liveSite(site);
            expect(await getSiteFile('header.html')).toBe('<nav>old</nav>');
            later(60_000);
            expect(await getSiteFile('header.html')).toBe('<nav>old</nav>');
            expect(reads('/_site/header.html')).toBe(1);

            site['/_site/site.json'] = JSON.stringify({ ...MANIFEST, files: { '_site/header.html': 'h2' } });
            site['/_site/header.html'] = '<nav>new</nav>';
            later(11_000);
            expect(await getSiteFile('header.html')).toBe('<nav>new</nav>');
        });

        it('forgets a missing file as soon as the manifest is read again', async () => {
            const site: Record<string, string> = { '/_site/site.json': JSON.stringify(MANIFEST) };
            liveSite(site);
            expect(await getSiteFile('pages/terms.html')).toBeNull();

            site['/_site/site.json'] = JSON.stringify({ ...MANIFEST, files: { '_site/pages/terms.html': 't1' } });
            site['/_site/pages/terms.html'] = '<p>terms</p>';
            later(11_000);
            expect(await getSiteFile('pages/terms.html')).toBe('<p>terms</p>');
        });
    });

    describe('getSiteManifest', () => {
        it('reads /_site/site.json', async () => {
            liveSite({ '/_site/site.json': JSON.stringify(MANIFEST) });
            expect((await getSiteManifest())?.templates.recipes).toEqual({ detail: 'app' });
        });

        it('is null on a live site deployed before /_site/ existed', async () => {
            liveSite({});
            expect(await getSiteManifest()).toBeNull();
        });
    });

    describe('loadSiteTemplate', () => {
        beforeEach(() => liveSite({
            '/_site/site.json': JSON.stringify(MANIFEST),
            '/_site/templates/default/detail.html': '<div>live default detail</div>',
            '/_site/templates/default/list.html': '<div>live default list</div>',
            '/_site/templates/articles/detail.html': '<div>articles detail</div>',
            '/_site/templates/recipes/detail.html': '<div>recipes detail</div>',
        }));

        it('reads the type\'s own folder', async () => {
            expect(await loadSiteTemplate('articles', 'detail')).toBe('<div>articles detail</div>');
            expect(await loadSiteTemplate('recipes', 'detail')).toBe('<div>recipes detail</div>');
        });

        it('uses the default\'s file for one the folder lacks, as the app does', async () => {
            expect(await loadSiteTemplate('recipes', 'list')).toBe('<div>live default list</div>');
        });

        it('reads the live default for a type without a folder', async () => {
            expect(await loadSiteTemplate('', 'detail')).toBe('<div>live default detail</div>');
            expect(await loadSiteTemplate('default', 'detail')).toBe('<div>live default detail</div>');
            expect(await loadSiteTemplate(undefined, 'list')).toBe('<div>live default list</div>');
        });

        it('refuses a folder the live site does not have, saying what to do', async () => {
            await expect(loadSiteTemplate('events', 'detail')).rejects.toThrow(MissingTemplateFolderError);
            await expect(loadSiteTemplate('events', 'detail')).rejects.toThrow(
                "Template folder 'events' is not on the live site. Deploy the website, then publish again.");
        });

        it('reads the manifest again before refusing, so a folder deployed a moment ago is found', async () => {
            const site: Record<string, string> = {
                '/_site/site.json': JSON.stringify(MANIFEST),
                '/_site/templates/events/detail.html': '<div>events detail</div>',
            };
            liveSite(site);
            await loadSiteTemplate('default', 'detail'); // the manifest is now cached
            site['/_site/site.json'] = JSON.stringify({ ...MANIFEST, templates: { ...MANIFEST.templates, events: { detail: 'app' } } });
            expect(await loadSiteTemplate('events', 'detail')).toBe('<div>events detail</div>');
        });

        it('refuses a listed folder whose file is not a template (a whole document or the app shell)', async () => {
            liveSite({
                '/_site/site.json': JSON.stringify(MANIFEST),
                '/_site/templates/articles/detail.html': '<!doctype html><html><body>whole page</body></html>',
            });
            await expect(loadSiteTemplate('articles', 'detail')).rejects.toThrow(MissingTemplateFolderError);
        });

        it('uses the built-in default when the live site has no files yet, and refuses a named folder then', async () => {
            liveSite({});
            expect(await loadSiteTemplate('default', 'detail')).toBe(DEFAULT_TEMPLATES.detail);
            await expect(loadSiteTemplate('articles', 'detail')).rejects.toThrow('The live site has no template files yet');
        });

        it('uses the built-in default when the live default cannot be read', async () => {
            liveSite({ '/_site/site.json': JSON.stringify(MANIFEST) });
            expect(await loadSiteTemplate('default', 'partials')).toBe(DEFAULT_TEMPLATES.partials);
        });

        it('builds with the default when hosting is off, since nothing is deployed', async () => {
            process.env.ARC_HOSTING_SITE = 'none';
            expect(await loadSiteTemplate('events', 'detail')).toBe(DEFAULT_TEMPLATES.detail);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    // SS8 (specs/site-sections-spec.md): an entry's own detail layout.
    describe('loadDetailTemplate', () => {
        const WITH_LAYOUTS = { ...MANIFEST, layouts: { articles: { wide: 'app' } } };
        let site: Record<string, string>;
        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            site = {
                '/_site/site.json': JSON.stringify(WITH_LAYOUTS),
                '/_site/templates/default/detail.html': '<div>live default detail</div>',
                '/_site/templates/articles/detail.html': '<div>articles detail</div>',
                '/_site/templates/articles/detail-wide.html': '<div>articles wide</div>',
            };
            liveSite(site);
        });

        it('reads the layout the entry chose', async () => {
            expect(await loadDetailTemplate('articles', 'wide')).toBe('<div>articles wide</div>');
        });

        it('reads the folder\'s detail.html without a layout', async () => {
            expect(await loadDetailTemplate('articles', '')).toBe('<div>articles detail</div>');
            expect(await loadDetailTemplate('articles', undefined)).toBe('<div>articles detail</div>');
            expect(reads('/_site/templates/articles/detail-wide.html')).toBe(0);
        });

        it('falls back to detail.html for a layout the live site does not have, after reading the manifest again', async () => {
            expect(await loadDetailTemplate('articles', 'narrow')).toBe('<div>articles detail</div>');
            expect(reads('/_site/site.json')).toBe(2);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Layout 'narrow'"));
        });

        it('falls back on a live site built before layouts', async () => {
            site['/_site/site.json'] = JSON.stringify(MANIFEST);
            expect(await loadDetailTemplate('articles', 'wide')).toBe('<div>articles detail</div>');
        });

        it('falls back when the layout file is not a template', async () => {
            site['/_site/templates/articles/detail-wide.html'] = '<!doctype html><html><body>page</body></html>';
            expect(await loadDetailTemplate('articles', 'wide')).toBe('<div>articles detail</div>');
        });

        it('finds a layout deployed a moment ago', async () => {
            site['/_site/site.json'] = JSON.stringify(MANIFEST);
            await loadDetailTemplate('articles', ''); // the old manifest is now cached
            site['/_site/site.json'] = JSON.stringify(WITH_LAYOUTS);
            expect(await loadDetailTemplate('articles', 'wide')).toBe('<div>articles wide</div>');
        });

        it('still refuses a folder the live site does not have', async () => {
            await expect(loadDetailTemplate('events', 'wide')).rejects.toThrow(MissingTemplateFolderError);
        });

        it('uses the built-in default when hosting is off', async () => {
            process.env.ARC_HOSTING_SITE = 'none';
            expect(await loadDetailTemplate('articles', 'wide')).toBe(DEFAULT_TEMPLATES.detail);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('siteStylesheets', () => {
        const manifest: Parameters<typeof siteStylesheets>[1] = { version: 1, home: {}, templates: {}, pages: {}, strings: [], files: { 'assets/css/main.css': 'm1', 'assets/css/site.css': 's1' } };

        it('versions main.css and adds the site\'s site.css after the install\'s list', () => {
            expect(siteStylesheets(['https://cdn.example/bootstrap.css', '/assets/css/main.css'], manifest)).toEqual([
                'https://cdn.example/bootstrap.css', '/assets/css/main.css?v=m1', '/assets/css/site.css?v=s1',
            ]);
        });

        it('keeps a site.css the install already lists, where it is, with the current version', () => {
            expect(siteStylesheets(['/assets/css/site.css?v=old', '/x.css'], manifest)).toEqual(['/assets/css/site.css?v=s1', '/x.css']);
        });

        it('links the bare files when the live site has no manifest', () => {
            expect(siteStylesheets(['/assets/css/main.css'], null)).toEqual(['/assets/css/main.css', '/assets/css/site.css']);
        });

        it('reads the live manifest for publishing', async () => {
            liveSite({ '/_site/site.json': JSON.stringify(MANIFEST) });
            expect(await pageStylesheets(['/assets/css/main.css'])).toEqual(['/assets/css/main.css', '/assets/css/site.css?v=abc123']);
        });
    });

    describe('versionedUrl', () => {
        it('adds the build hash, or leaves the address bare without one', () => {
            expect(versionedUrl('/assets/css/site.css', MANIFEST as never)).toBe('/assets/css/site.css?v=abc123');
            expect(versionedUrl('/assets/css/main.css', MANIFEST as never)).toBe('/assets/css/main.css');
            expect(versionedUrl('/assets/css/site.css', null)).toBe('/assets/css/site.css');
        });
    });

    describe('the default templates built into the functions', () => {
        it('are the site\'s default folder as it serves it, all three files', () => {
            const root = resolve(__dirname, '../../..');
            for (const file of ['detail', 'list', 'partials'] as const) {
                expect(DEFAULT_TEMPLATES[file]).toBe(readSiteFile(root, `_site/templates/default/${file}.html`));
            }
        });
    });
});
