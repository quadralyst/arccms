// @vitest-environment node
/**
 * The app's own redirects (docs/website/redirects.html): src/custom/site/redirects.json,
 * checked, and put first in the Hosting config the website deploy uploads, whichever
 * config the project uses. The deploy itself is covered in arc-deploy-ci.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    APP_REDIRECTS, globToRegExp, readAppRedirects, redirectProblems, websiteConfigPath, withAppRedirects, writeWebsiteConfig,
} from '../arc-redirects.mjs';
import { normalizeConfig, renderFirebaseConfig } from '../arc-configure.mjs';
import { siteSources } from '../arc-site.mjs';
import { arcSite } from '../vite-arc-site';

const ROOT = resolve(__dirname, '../..');
const committedFirebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const ARC_OWN = committedFirebase.hosting.redirects;
const MOVE = { source: '/services-web-designing.html', destination: '/services/web-designing', type: 301 };
const BLOG = { regex: '^/blog/(?P<slug>[^/]+)\\.html$', destination: '/blog/:slug', type: 302 };

describe('checking the redirects', () => {
    it('takes Firebase Hosting\'s own format: source or regex, a path or URL, 301 or 302 or no type', () => {
        expect(redirectProblems([
            MOVE,
            BLOG,
            { source: '/old/**', destination: 'https://example.com/new', type: 302 },
            { source: '/news/:post*', destination: '/blog/:post' },
            { source: '/p/about.html', destination: '/about' },
            { source: '/:page.html', destination: '/:page' },
        ])).toEqual([]);
        expect(redirectProblems([])).toEqual([]);
    });

    it('names each bad entry by number and what is wrong with it', () => {
        const problems = redirectProblems([
            MOVE,
            { destination: '/new' },
            { source: '/a.html', regex: '^/a$', destination: '/a' },
            { source: '/b.html' },
            { source: '/c.html', destination: 'c-page' },
            { source: '/d.html', destination: '//elsewhere.com/d' },
            { source: '/e.html', destination: 'ftp://example.com/e' },
            { source: '/f.html', destination: '/f', type: 307 },
            { source: '/g.html', destination: '/g', type: '301' },
            { source: '/h.html', destination: '/h', status: 301 },
            { source: 'i.html', destination: '/i' },
            { regex: '^/j(', destination: '/j' },
            { source: '/same', destination: '/same' },
            'not an object',
        ]);
        expect(problems).toEqual([
            'Redirect 2 has no "source" (or "regex"): the old address to redirect.',
            'Redirect 3 ("/a.html") has both "source" and "regex": give one.',
            'Redirect 4 ("/b.html") has no "destination": the new address.',
            'Redirect 5 ("/c.html"): "destination" must be an address on this site starting with "/" or a full http(s) URL, not "c-page".',
            'Redirect 6 ("/d.html"): "destination" must be an address on this site starting with "/" or a full http(s) URL, not "//elsewhere.com/d".',
            'Redirect 7 ("/e.html"): "destination" must be an address on this site starting with "/" or a full http(s) URL, not "ftp://example.com/e".',
            'Redirect 8 ("/f.html"): "type" must be 301 (moved for good) or 302 (moved for now), not 307.',
            'Redirect 9 ("/g.html"): "type" must be 301 (moved for good) or 302 (moved for now), not "301".',
            'Redirect 10 ("/h.html") has an unknown field "status" (allowed: source, regex, destination, type).',
            'Redirect 11 ("i.html"): "source" must start with "/", as in "/i.html".',
            'Redirect 12 (regex "^/j("): "regex" is not a valid regular expression.',
            'Redirect 13 ("/same") redirects to itself, so the browser would loop.',
            'Redirect 14 is not an object with "source", "destination" and "type".',
        ]);
    });

    it('refuses a file that is not a list', () => {
        expect(redirectProblems({ redirects: [MOVE] })[0]).toMatch(/^It must hold a list/);
    });

    it('refuses a repeat, which Hosting would never reach', () => {
        expect(redirectProblems([MOVE, { ...MOVE, destination: '/elsewhere' }, BLOG, BLOG])).toEqual([
            'Redirect 2 ("/services-web-designing.html") repeats redirect 1: only the first would ever be used.',
            'Redirect 4 (regex "^/blog/(?P<slug>[^/]+)\\.html$") repeats redirect 3: only the first would ever be used.',
        ]);
    });

    it('refuses a redirect that would catch an address Arc CMS needs: the admin, its files, its functions', () => {
        const caught = (entry: object) => redirectProblems([{ destination: '/new', ...entry }]);
        expect(caught({ source: '/admin' })[0]).toContain('would also catch /admin, which Arc CMS needs for itself');
        expect(caught({ source: '/admin/**' })[0]).toContain('/admin');
        expect(caught({ source: '/assets/**' })[0]).toContain('/assets/');
        expect(caught({ source: '/_site/:file' })[0]).toContain('/_site/');
        expect(caught({ source: '/site/**' })[0]).toContain('/site/');
        expect(caught({ source: '/_arc/**' })[0]).toContain('/_arc/');
        expect(caught({ source: '/__/**' })[0]).toContain('/__/');
        expect(caught({ source: '/unsubscribe' })[0]).toContain('/unsubscribe');
        expect(caught({ source: '/email-preferences' })[0]).toContain('/email-preferences');
        // Patterns wide enough to reach them.
        expect(caught({ source: '**' })[0]).toContain('/admin');
        expect(caught({ source: '/:page' })[0]).toContain('/admin');
        expect(caught({ source: '/{admin,old}' })[0]).toContain('/admin');
        expect(caught({ regex: '.*' })[0]).toContain('/admin');
        expect(caught({ regex: '^/(?P<area>admin|old)$' })[0]).toContain('/admin');
        // Narrow ones are fine, also next to those addresses.
        expect(caught({ source: '/admin-old.html' })).toEqual([]);
        expect(caught({ source: '/old-site/**' })).toEqual([]);
        expect(caught({ regex: '^/old/(.*)$' })).toEqual([]);
    });

    it('reads globs the way Hosting does, closely enough to tell what they catch', () => {
        expect(globToRegExp('/blog/:post*')!.test('/blog/2020/hello')).toBe(true);
        expect(globToRegExp('/users/:id/profile')!.test('/users/7/profile')).toBe(true);
        expect(globToRegExp('/users/:id/profile')!.test('/users/7/8/profile')).toBe(false);
        expect(globToRegExp('/*.php')!.test('/index.php')).toBe(true);
        expect(globToRegExp('/*.php')!.test('/a/index.php')).toBe(false);
        expect(globToRegExp('/**/*.@(htm|php)')!.test('/a/b/c.htm')).toBe(true);
        expect(globToRegExp('/old.html')!.test('/oldxhtml')).toBe(false);
    });
});

describe('reading src/custom/site/redirects.json', () => {
    let dir: string;
    const write = (text: string) => {
        mkdirSync(join(dir, 'src/custom/site'), { recursive: true });
        writeFileSync(join(dir, APP_REDIRECTS), text);
    };
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'arc-redirects-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('no file means no redirects', () => {
        expect(readAppRedirects(dir)).toEqual([]);
    });

    it('gives the list as written', () => {
        write(JSON.stringify([MOVE, BLOG], null, 2));
        expect(readAppRedirects(dir)).toEqual([MOVE, BLOG]);
    });

    it('stops with a message on JSON that does not parse, as a broken strings file does', () => {
        write('[{ "source": "/old.html", }]');
        expect(() => readAppRedirects(dir)).toThrow(/^src\/custom\/site\/redirects\.json is not valid JSON: /);
    });

    it('stops with every problem listed', () => {
        write(JSON.stringify([MOVE, { source: '/x.html', destination: '/x', type: 308 }, { source: '/admin/**', destination: '/x' }]));
        expect(() => readAppRedirects(dir)).toThrow(
            'src/custom/site/redirects.json has 2 problems (see docs/website/redirects.html):\n'
            + '  Redirect 2 ("/x.html"): "type" must be 301 (moved for good) or 302 (moved for now), not 308.\n'
            + '  Redirect 3 ("/admin/**") would also catch /admin, which Arc CMS needs for itself. Make the pattern narrower.',
        );
    });

    it('a bad file stops npm run build and npm run dev, before a deploy finds it', () => {
        const config = arcSite({ notices: {} as never }).config as (c: { root: string }) => unknown;
        expect(() => config({ root: dir })).not.toThrow();
        write('[{ "source": "/old.html", "destination": "new" }]');
        expect(() => config({ root: dir })).toThrow('Redirect 1 ("/old.html"): "destination" must be');
    });

    it('is not a website file: never served, never warned about', () => {
        write(JSON.stringify([MOVE]));
        const { sources, ignored } = siteSources(dir);
        expect(ignored).toEqual([]);
        expect([...sources.keys()].some((path) => path.includes('redirects'))).toBe(false);
    });
});

describe('putting them in the Hosting config', () => {
    it('goes first, ahead of Arc CMS\'s own redirects, in the order written', () => {
        const out = withAppRedirects(committedFirebase, [MOVE, BLOG]);
        expect(out.hosting.redirects).toEqual([MOVE, BLOG, ...ARC_OWN]);
        // Everything else is as it was, and the committed config is not touched.
        expect({ ...out, hosting: { ...out.hosting, redirects: ARC_OWN } }).toEqual(committedFirebase);
        expect(committedFirebase.hosting.redirects).toEqual(ARC_OWN);
    });

    it('merges into a project\'s generated config, keeping its site and its functions region', () => {
        const generated = renderFirebaseConfig(committedFirebase, normalizeConfig({ hostingSite: 'acme-site', functionsRegion: 'asia-south1' }));
        const out = withAppRedirects(generated, [MOVE]);
        expect(out.hosting.site).toBe('acme-site');
        expect(out.hosting.redirects).toEqual([MOVE, ...ARC_OWN]);
        expect(out.hosting.rewrites).toEqual(generated.hosting.rewrites);
    });

    it('merges into every Hosting block of a config with several, and leaves a config without Hosting alone', () => {
        const several = { hosting: [{ site: 'a', redirects: [{ source: '/x', destination: '/y' }] }, { site: 'b' }] };
        expect(withAppRedirects(several, [MOVE]).hosting).toEqual([
            { site: 'a', redirects: [MOVE, { source: '/x', destination: '/y' }] },
            { site: 'b', redirects: [MOVE] },
        ]);
        const off = renderFirebaseConfig(committedFirebase, normalizeConfig({ hostingSite: 'none' }));
        expect(withAppRedirects(off, [MOVE])).toBe(off);
        expect(withAppRedirects(committedFirebase, [])).toBe(committedFirebase);
    });

    describe('the file the website deploy uploads', () => {
        let dir: string;
        beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'arc-website-config-')); });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        it('is written next to firebase.json, under a name no project id can take', () => {
            const path = writeWebsiteConfig('acme-dev', committedFirebase, [MOVE], dir);
            expect(path).toBe(websiteConfigPath('acme-dev', dir));
            expect(path).toBe(join(dir, 'firebase.acme-dev.website.json'));
            expect(JSON.parse(readFileSync(path!, 'utf8')).hosting.redirects).toEqual([MOVE, ...ARC_OWN]);
        });

        it('is not written when the app has no redirects', () => {
            expect(writeWebsiteConfig('acme-dev', committedFirebase, [], dir)).toBeNull();
            expect(existsSync(websiteConfigPath('acme-dev', dir))).toBe(false);
        });
    });
});
