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
        expect(manifest.pages).toEqual({ 'privacy-policy': 'core', terms: 'app' });
        expect(manifest.strings).toEqual(['hi']);
        expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['_site/header.html', 'assets/css/site.css']));
        expect(Object.keys(manifest.files)).not.toContain('favicon.ico');
        // Both site stylesheets, for their ?v= links.
        expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['assets/css/site.css']));
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
    it('ship a full default template set, a header, a footer and no app files', () => {
        const repo = join(__dirname, '..', '..');
        const { manifest } = siteContents(repo);
        expect(manifest.templates.default).toEqual({ detail: 'core', list: 'core', partials: 'core' });
        expect(readSiteFile(repo, '_site/header.html')).toContain('<arc-search>');
        expect(readSiteFile(repo, '_site/footer.html')).not.toBe('');
    });

    it('ship a placeholder home page that says it runs on Arc CMS, in every language it has strings for, and stays out of search', () => {
        const repo = join(__dirname, '..', '..');
        const home = readSiteFile(repo, '_site/home.html');
        expect(home).toContain('<meta name="robots" content="noindex">');
        expect(home).toContain('href="https://arccms.com"');
        expect(home).toContain('href="https://github.com/quadralyst/arccms"');
        const keys = [...home.matchAll(/data-arc-t="([^"]+)"/g)].map((m) => m[1]);
        const hi = JSON.parse(readSiteFile(repo, '_site/strings/hi.json'));
        expect(keys.filter((key) => !(key in hi))).toEqual([]);
    });
});
