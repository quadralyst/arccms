/**
 * The public website's files (scripts/arc-site.mjs, specs/own-website-spec.md):
 * where each app file is served, the app's over core's, strings merged, the
 * manifest, and the assembled folder.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    APP_SITE, CORE_PUBLIC, MANIFEST_PATH, assembleSite, readSiteFile, servedPath, siteContents, siteModule, siteSources,
} from '../arc-site.mjs';

let root: string;

function put(path: string, content: string): void {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

const core = (path: string, content: string) => put(`${CORE_PUBLIC}/${path}`, content);
const app = (path: string, content: string) => put(`${APP_SITE}/${path}`, content);

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arc-site-'));
    core('_site/header.html', '<nav>Core header</nav>');
    core('_site/footer.html', '<footer>Core footer</footer>');
    core('_site/templates/default/detail.html', '<div>default detail</div>');
    core('_site/templates/default/list.html', '<div>default list</div>');
    core('_site/templates/default/partials.html', '<div>default cards</div>');
    core('_site/templates/articles/detail.html', '<div>core articles</div>');
    core('_site/pages/privacy-policy.html', '<html>core policy</html>');
    core('_site/strings/hi.json', JSON.stringify({ read_more: 'लेख पढ़ें', next: 'अगला' }));
    core('assets/css/site.css', '');
    core('favicon.ico', 'core-icon');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('servedPath', () => {
    it.each([
        ['home.html', '_site/home.html'],
        ['home.hi.html', '_site/home.hi.html'],
        ['header.html', '_site/header.html'],
        ['footer.html', '_site/footer.html'],
        ['sign-in.html', '_site/sign-in.html'],
        ['templates/recipes/detail.html', '_site/templates/recipes/detail.html'],
        ['templates/recipes/partials.html', '_site/templates/recipes/partials.html'],
        ['templates/info/detail-contact.html', '_site/templates/info/detail-contact.html'],
        ['templates/info/detail-wide_hero-2.html', '_site/templates/info/detail-wide_hero-2.html'],
        ['pages/terms.html', '_site/pages/terms.html'],
        ['strings/hi.json', '_site/strings/hi.json'],
        ['site.css', 'assets/css/site.css'],
        ['assets/img/hero.webp', 'site/img/hero.webp'],
        ['assets/home.js', 'site/home.js'],
        ['favicon.ico', 'favicon.ico'],
        ['404.html', '404.html'],
    ])('serves %s at /%s', (from, to) => {
        expect(servedPath(from)).toBe(to);
    });

    it.each([
        'templates/recipes/card.html',
        'templates/recipes/detail-.html',
        'templates/recipes/detail-Contact.html',
        'templates/recipes/list-contact.html',
        'templates/recipes/styles.css',
        'templates/detail.html',
        'pages/nested/terms.html',
        'notes.txt',
        'home.Hindi.html',
    ])('does not serve %s', (from) => {
        expect(servedPath(from)).toBeNull();
    });
});

describe('siteSources', () => {
    it('uses core\'s file where the app has none, the app\'s where it has one', () => {
        app('header.html', '<nav>App header</nav>');
        const { sources } = siteSources(root);
        expect(sources.get('_site/header.html')).toMatchObject({ from: 'app' });
        expect(sources.get('_site/footer.html')).toMatchObject({ from: 'core' });
    });

    it('lists app files that are not website files, and stays quiet about a README', () => {
        app('notes.txt', 'x');
        app('README.md', 'x');
        expect(siteSources(root).ignored).toEqual([`${APP_SITE}/notes.txt`]);
    });
});

describe('siteContents', () => {
    it('merges the app\'s strings over core\'s key by key', () => {
        app('strings/hi.json', JSON.stringify({ next: 'आगे', nav_lessons: 'पाठ' }));
        expect(JSON.parse(readSiteFile(root, '_site/strings/hi.json'))).toEqual({
            read_more: 'लेख पढ़ें', next: 'आगे', nav_lessons: 'पाठ',
        });
    });

    it('serves an app strings file for a language core has none for, as it is', () => {
        app('strings/ta.json', JSON.stringify({ read_more: 'படிக்க' }));
        expect(JSON.parse(readSiteFile(root, '_site/strings/ta.json'))).toEqual({ read_more: 'படிக்க' });
    });

    it('stops with the file\'s name on a broken strings file', () => {
        app('strings/hi.json', '{ not json');
        expect(() => siteContents(root)).toThrow(/strings\/hi\.json is not valid JSON/);
    });

    it('lists the app\'s own files with a hash, so pages can version their links', () => {
        app('assets/home.css', 'body{}');
        app('assets/img/hero.webp', 'IMG');
        const { manifest } = siteContents(root);
        expect(manifest.files['site/home.css']).toMatch(/^[0-9a-f]{16}$/);
        expect(manifest.files['site/img/hero.webp']).toMatch(/^[0-9a-f]{16}$/);
    });

    it('versions url() in the app\'s stylesheets, absolute or relative, and its hash follows the image', () => {
        app('assets/img/hero.webp', 'IMG-1');
        app('assets/fonts/a.woff2', 'FONT');
        app('assets/home.css', ".hero{background:url('/site/img/hero.webp')} @font-face{src:url(fonts/a.woff2) format('woff2')} .x{background:url(data:image/png;base64,AA)} .y{background:url(https://cdn.test/a.png)} .z{background:url(/site/none.png)}");
        app('site.css', '.logo{background:url("/site/img/hero.webp#c")}');
        const first = siteContents(root);
        const imgHash = first.manifest.files['site/img/hero.webp'];
        const css = readSiteFile(root, 'site/home.css');
        expect(css).toContain(`url('/site/img/hero.webp?v=${imgHash}')`);
        expect(css).toMatch(/url\(fonts\/a\.woff2\?v=[0-9a-f]{16}\)/);
        expect(css).toContain('url(data:image/png;base64,AA)');
        expect(css).toContain('url(https://cdn.test/a.png)');
        expect(css).toContain('url(/site/none.png)');
        expect(readSiteFile(root, 'assets/css/site.css')).toContain(`url("/site/img/hero.webp?v=${imgHash}#c")`);

        // A changed image changes the stylesheet, so pages link the stylesheet anew too.
        app('assets/img/hero.webp', 'IMG-2');
        const second = siteContents(root);
        expect(second.manifest.files['site/home.css']).not.toBe(first.manifest.files['site/home.css']);
    });

    it('leaves Arc CMS\'s own stylesheets as they are', () => {
        core('assets/css/main.css', '.a{background:url(/site/img/hero.webp)}');
        app('assets/img/hero.webp', 'IMG');
        expect(readSiteFile(root, 'assets/css/main.css')).toBe('.a{background:url(/site/img/hero.webp)}');
    });

    it('describes the site in the manifest', () => {
        app('home.html', '<html>home</html>');
        app('home.hi.html', '<html>घर</html>');
        app('templates/articles/list.html', '<div>app list</div>');
        app('templates/recipes/detail.html', '<div>recipes</div>');
        app('pages/terms.html', '<html>terms</html>');
        const { manifest } = siteContents(root);

        expect(manifest.home).toEqual({ default: 'app', hi: 'app' });
        expect(manifest.templates).toEqual({
            articles: { detail: 'core', list: 'app' },
            default: { detail: 'core', list: 'core', partials: 'core' },
            recipes: { detail: 'app' },
        });
        expect(manifest.layouts).toEqual({});
        expect(manifest.pages).toEqual({ 'privacy-policy': 'core', terms: 'app' });
        expect(manifest.strings).toEqual(['hi']);
        expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['_site/header.html', 'assets/css/site.css']));
        expect(Object.keys(manifest.files)).not.toContain('favicon.ico');
        // Both site stylesheets, for their ?v= links.
        expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['assets/css/site.css']));
    });

    // SS8 (specs/site-sections-spec.md): another detail page an entry can choose.
    it('lists layouts by folder, the app\'s over core\'s, and a folder holding only layouts', () => {
        core('_site/templates/info/detail.html', '<div>info</div>');
        core('_site/templates/info/detail-contact.html', '<div>core contact</div>');
        app('templates/info/detail-contact.html', '<div>app contact</div>');
        app('templates/info/detail-team.html', '<div>team</div>');
        app('templates/landing/detail-wide.html', '<div>wide</div>');
        const { manifest } = siteContents(root);

        expect(manifest.layouts).toEqual({ info: { contact: 'app', team: 'app' }, landing: { wide: 'app' } });
        expect(manifest.templates['info']).toEqual({ detail: 'core' });
        expect(manifest.templates['landing']).toEqual({});
        expect(readSiteFile(root, '_site/templates/info/detail-contact.html')).toBe('<div>app contact</div>');
        expect(manifest.files['_site/templates/info/detail-team.html']).toMatch(/^[0-9a-f]{16}$/);
    });

    it('gives a file a new hash when its content changes, and only then', () => {
        const before = siteContents(root).manifest.files['_site/header.html'];
        expect(siteContents(root).manifest.files['_site/header.html']).toBe(before);
        app('header.html', '<nav>App header</nav>');
        expect(siteContents(root).manifest.files['_site/header.html']).not.toBe(before);
    });
});

describe('assembleSite', () => {
    it('writes core\'s files, the app\'s over them, and the manifest', () => {
        app('favicon.ico', 'app-icon');
        app('assets/home.js', 'console.log(1)');
        const { dir } = assembleSite(root);

        expect(readFileSync(join(dir, 'favicon.ico'), 'utf8')).toBe('app-icon');
        expect(readFileSync(join(dir, '_site/footer.html'), 'utf8')).toBe('<footer>Core footer</footer>');
        expect(readFileSync(join(dir, 'site/home.js'), 'utf8')).toBe('console.log(1)');
        expect(JSON.parse(readFileSync(join(dir, MANIFEST_PATH), 'utf8')).version).toBe(1);
    });

    it('changes nothing on a second run, and only what changed after an edit', () => {
        assembleSite(root);
        expect(assembleSite(root).changed).toEqual([]);

        app('footer.html', '<footer>App footer</footer>');
        expect(assembleSite(root).changed.sort()).toEqual(['_site/footer.html', MANIFEST_PATH]);
    });

    it('removes a file the sources no longer have, and goes back to core\'s when the app\'s is deleted', () => {
        app('pages/terms.html', '<html>terms</html>');
        app('footer.html', '<footer>App footer</footer>');
        const { dir } = assembleSite(root);
        expect(existsSync(join(dir, '_site/pages/terms.html'))).toBe(true);

        rmSync(join(root, APP_SITE, 'pages/terms.html'));
        rmSync(join(root, APP_SITE, 'footer.html'));
        assembleSite(root);
        expect(existsSync(join(dir, '_site/pages/terms.html'))).toBe(false);
        expect(readFileSync(join(dir, '_site/footer.html'), 'utf8')).toBe('<footer>Core footer</footer>');
    });
});

describe('siteModule', () => {
    it('exports the header, the footer and the manifest the app bundles', () => {
        app('header.html', '<nav>{ app } @header</nav>');
        const code = siteModule(root);
        expect(code).toContain('export const header = "<nav>{ app } @header</nav>";');
        expect(code).toContain('export const footer = "<footer>Core footer</footer>";');
        expect(code).toContain('export const signIn = "";');
        expect(code).toMatch(/export const manifest = \{"version":1,/);
    });
});

describe('Arc CMS\'s own site files', () => {
    // Core's defaults, read from public/ directly: an app's src/custom/site/ may replace any of them.
    const repo = join(__dirname, '..', '..');
    const coreFile = (path: string) => readFileSync(join(repo, CORE_PUBLIC, path), 'utf8');

    it('ship a full default template set, a header and a footer', () => {
        for (const file of ['detail', 'list', 'partials']) expect(coreFile(`_site/templates/default/${file}.html`)).not.toBe('');
        expect(coreFile('_site/header.html')).toContain('<arc-search>');
        expect(coreFile('_site/footer.html')).not.toBe('');
    });

    it('ship a placeholder home page that says it runs on Arc CMS, in every language it has strings for, and stays out of search', () => {
        const home = coreFile('_site/home.html');
        expect(home).toContain('<meta name="robots" content="noindex">');
        expect(home).toContain('href="https://arccms.com"');
        expect(home).toContain('href="https://github.com/quadralyst/arccms"');
        const keys = [...home.matchAll(/data-arc-t="([^"]+)"/g)].map((m) => m[1]);
        const hi = JSON.parse(coreFile('_site/strings/hi.json'));
        expect(keys.filter((key) => !(key in hi))).toEqual([]);
    });
});
