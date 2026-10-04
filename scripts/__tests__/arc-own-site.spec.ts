/**
 * `npm run arc:own-site` (scripts/arc-own-site.mjs, specs/own-website-spec.md section 9):
 * an app's website moved out of Arc CMS's public/ into src/custom/site/.
 *
 * The end-to-end tests build two real git repositories: an "Arc CMS" with a commit
 * in the old layout and one in the new, and an app that edited the old one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    convertAngular, headOf, headOfComponent, main, ownStrings, placeFor, planMigration, rewriteUrls, wrapDocument, writeMigration,
} from '../arc-own-site.mjs';

describe('arc:own-site pieces', () => {
    it('knows where each old file goes', () => {
        expect(placeFor('public/index.html', false)).toMatchObject({ kind: 'home', to: 'src/custom/site/home.html', lang: '' });
        expect(placeFor('public/i18n/hi/index.html', false)).toMatchObject({ kind: 'home', to: 'src/custom/site/home.hi.html', lang: 'hi' });
        expect(placeFor('public/i18n/hi/strings.json', false)).toMatchObject({ kind: 'strings', to: 'src/custom/site/strings/hi.json' });
        expect(placeFor('public/_partials/_header.html', false)).toMatchObject({ kind: 'copy', to: 'src/custom/site/header.html' });
        expect(placeFor('public/templates/events/detail.html', true)).toMatchObject({ kind: 'copy', to: 'src/custom/site/templates/events/detail.html' });
        expect(placeFor('public/pages/terms.html', true)).toMatchObject({ kind: 'copy', to: 'src/custom/site/pages/terms.html' });
        expect(placeFor('public/_site/templates/articles/detail.html', false)).toMatchObject({ kind: 'copy', to: 'src/custom/site/templates/articles/detail.html' });
        expect(placeFor('public/assets/css/main.css', false)).toMatchObject({ kind: 'main-css' });
        expect(placeFor('public/assets/images/logo.png', true)).toMatchObject({ kind: 'asset', to: 'src/custom/site/assets/images/logo.png', url: '/site/images/logo.png', from: '/assets/images/logo.png' });
        expect(placeFor('public/robots-extra.txt', true)).toMatchObject({ kind: 'asset', url: '/site/robots-extra.txt' });
        expect(placeFor('public/assets/js/arc-search.js', false)).toMatchObject({ kind: 'report' });
        expect(placeFor('public/templates/templates.json', false)).toMatchObject({ kind: 'ignore' });
    });

    it('turns the old Angular home page into plain HTML, and lists what it cannot', () => {
        const { html, leftovers } = convertAngular([
            '<arc-content-partials [contentType]="\'articles\'" [count]="3" [sectionTitle]="\'News\'"></arc-content-partials>',
            '<img ngSrc="assets/images/a.png" width="10" height="10">',
            '<a href="assets/doc.pdf">Doc</a> <a href="#waitlist">Join</a>',
            '<p>{{ greeting }}</p>',
            '<button (click)="go()">Go</button>',
        ].join('\n'));
        expect(html).toContain('<arc-content-partials content-type="articles" count="3" section-title="News">');
        expect(html).toContain('<img src="/assets/images/a.png"');
        expect(html).toContain('href="/assets/doc.pdf"');
        expect(html).toContain('href="#waitlist"');
        expect(leftovers.map((l) => l.line)).toEqual([4, 5]);
    });

    it('wraps a fragment into a whole document with the old title', () => {
        const doc = wrapDocument('<h1>Hi</h1>', { lang: 'hi', title: 'A & B', description: 'Desc', stylesheets: ['/site/home.css'] });
        expect(doc).toMatch(/^<!doctype html>\n<html lang="hi">/);
        expect(doc).toContain('<title>A &amp; B</title>');
        expect(doc).toContain('<meta name="description" content="Desc">');
        expect(doc).toContain('<link rel="stylesheet" href="/site/home.css">');
        expect(doc).toContain('<body>\n<h1>Hi</h1>\n</body>');
    });

    it('reads the old titles from the app shell and from a language\'s home component', () => {
        expect(headOf('<title>My Site</title><meta name="description" content="What we do">')).toEqual({ title: 'My Site', description: 'What we do' });
        expect(headOfComponent("pageTitle = 'मेरी साइट';\n pageDescription =\n  'हम क्या करते हैं';")).toEqual({ title: 'मेरी साइट', description: 'हम क्या करते हैं' });
    });

    it('keeps only the app\'s own strings', () => {
        expect(ownStrings({ a: 'same', b: 'changed', c: 'new' }, { a: 'same', b: 'core' })).toEqual({ b: 'changed', c: 'new' });
    });

    it('points links at moved files', () => {
        const moves = [{ from: '/assets/images/logo.png', url: '/site/images/logo.png' }];
        expect(rewriteUrls('<img src="/assets/images/logo.png"> url(assets/images/logo.png)', moves))
            .toBe('<img src="/site/images/logo.png"> url(/site/images/logo.png)');
    });
});

// ─── End to end ─────────────────────────────────────────────────────────────

const OLD_HOME = `<div class="arc-cms-template">
    <arc-header></arc-header>
    <section class="hero"><h1>Deepakam</h1><img ngSrc="assets/images/logo.png" width="10" height="10"></section>
    <arc-content-partials [contentType]="'articles'"></arc-content-partials>
    <arc-footer></arc-footer>
</div>
`;

let dir: string;
let arc: string;
let app: string;

function sh(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function put(root: string, files: Record<string, string | null>): void {
    for (const [path, content] of Object.entries(files)) {
        const file = join(root, path);
        if (content === null) rmSync(file, { force: true });
        else {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, content);
        }
    }
}

const read = (path: string) => readFileSync(join(app, path), 'utf8');

function setUpRepositories(): void {
    dir = mkdtempSync(join(tmpdir(), 'arc-own-site-'));
    arc = join(dir, 'arccms');
    app = join(dir, 'app');
    mkdirSync(arc);
    sh(arc, 'init', '-q', '-b', 'dev');
    // Arc CMS in the old layout.
    put(arc, {
        'index.html': '<html><head><title>Arc CMS</title></head><body><arc-root></arc-root></body></html>',
        'public/index.html': '<div><arc-header></arc-header><h1>Arc CMS</h1></div>\n',
        'public/_partials/_header.html': '<nav>Arc CMS</nav>\n',
        'public/_partials/_footer.html': '<footer>Arc CMS</footer>\n',
        'public/templates/articles/detail.html': '<article>core detail</article>\n',
        'public/i18n/hi/strings.json': '{\n  "read_more": "और पढ़ें"\n}\n',
        'public/assets/css/main.css': '.hero { color: red; }\n',
        'public/assets/js/arc-search.js': 'search();\n',
        'src/app/pages/index.page.ts': 'export default {};\n',
    });
    sh(arc, 'add', '-A');
    sh(arc, 'commit', '-q', '-m', 'old layout');

    sh(dir, 'clone', '-q', arc, 'app');
    sh(app, 'remote', 'rename', 'origin', 'upstream');
    // The app edits core files the old way.
    put(app, {
        'index.html': '<html><head><title>Deepakam</title><meta name="description" content="Sanskrit for kids"></head><body><arc-root></arc-root></body></html>',
        'public/index.html': OLD_HOME,
        'public/_partials/_header.html': '<nav>Deepakam</nav>\n',
        'public/templates/events/detail.html': '<article>event</article>\n',
        'public/i18n/hi/strings.json': '{\n  "read_more": "और पढ़ें",\n  "join": "जुड़ें"\n}\n',
        'public/assets/images/logo.png': 'PNG',
        'public/assets/js/arc-search.js': 'search(); // tweaked\n',
    });
    sh(app, 'add', '-A');
    sh(app, 'commit', '-q', '-m', 'our site');

    // Arc CMS moves to the new layout.
    put(arc, {
        'public/index.html': null,
        'public/_partials/_header.html': null,
        'public/_partials/_footer.html': null,
        'public/templates/articles/detail.html': null,
        'public/i18n/hi/strings.json': null,
        'public/_site/home.html': '<!doctype html><html><head><title>Coming soon</title></head><body>placeholder</body></html>\n',
        'public/_site/header.html': '<nav>Arc CMS</nav>\n',
        'public/_site/footer.html': '<footer>Arc CMS</footer>\n',
        'public/_site/templates/articles/detail.html': '<article>core detail v2</article>\n',
        'public/_site/strings/hi.json': '{\n  "read_more": "और पढ़ें",\n  "legal_terms": "शर्तें"\n}\n',
        'public/assets/css/main.css': 'body { margin: 0; }\n',
    });
    sh(arc, 'add', '-A');
    sh(arc, 'commit', '-q', '-m', 'new layout');
    sh(app, 'fetch', '-q', 'upstream');
}

function mergeUpstream(): void {
    try {
        sh(app, 'merge', '-q', '--no-edit', 'upstream/dev');
    } catch {
        // Conflicts in public/: arc:own-site settles them.
    }
}

describe('arc:own-site end to end', () => {
    beforeEach(setUpRepositories);
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('asks for the merge first while the copy is still on the old Arc CMS', () => {
        const out: string[] = [];
        expect(main([], (l: string) => out.push(l), app)).toBe(1);
        expect(out.join('\n')).toContain('git merge upstream/dev');
    });

    it('plans without changing anything, in the middle of the merge', () => {
        mergeUpstream();
        const before = sh(app, 'status', '--porcelain');
        const out: string[] = [];
        expect(main([], (l: string) => out.push(l), app)).toBe(0);
        const text = out.join('\n');
        expect(text).toContain('src/custom/site/home.html');
        expect(text).toContain('Nothing was changed');
        expect(sh(app, 'status', '--porcelain')).toBe(before);
        expect(existsSync(join(app, 'src/custom/site'))).toBe(false);
    });

    it('moves the site into src/custom/site/ and puts Arc CMS\'s files back', () => {
        mergeUpstream();
        const plan = planMigration({ cwd: app });
        writeMigration(plan, app);

        // The home page: a whole document, plain HTML, the old title, the old styles.
        const home = read('src/custom/site/home.html');
        expect(home).toMatch(/^<!doctype html>\n<html lang="en">/);
        expect(home).toContain('<title>Deepakam</title>');
        expect(home).toContain('content="Sanskrit for kids"');
        expect(home).toContain('<arc-content-partials content-type="articles">');
        expect(home).toContain('src="/site/images/logo.png"');
        expect(home).toContain('href="/site/home.css"');
        expect(read('src/custom/site/assets/home.css')).toBe('.hero { color: red; }\n');

        expect(read('src/custom/site/header.html')).toBe('<nav>Deepakam</nav>\n');
        expect(read('src/custom/site/templates/events/detail.html')).toBe('<article>event</article>\n');
        expect(JSON.parse(read('src/custom/site/strings/hi.json'))).toEqual({ join: 'जुड़ें' });
        expect(read('src/custom/site/assets/images/logo.png')).toBe('PNG');
        // Files the app never changed stay Arc CMS's.
        expect(existsSync(join(app, 'src/custom/site/footer.html'))).toBe(false);
        expect(existsSync(join(app, 'src/custom/site/templates/articles/detail.html'))).toBe(false);

        // public/ is Arc CMS's again, conflicts settled.
        expect(existsSync(join(app, 'public/index.html'))).toBe(false);
        expect(existsSync(join(app, 'public/_partials/_header.html'))).toBe(false);
        expect(existsSync(join(app, 'public/assets/images/logo.png'))).toBe(false);
        expect(read('public/_site/templates/articles/detail.html')).toBe('<article>core detail v2</article>\n');
        expect(read('public/assets/js/arc-search.js')).toBe('search();\n');
        expect(sh(app, 'diff', '--name-only', '--diff-filter=U')).toBe('');
        expect(sh(app, 'diff', 'upstream/dev', '--stat', '--', 'public')).toBe('');

        // The core edit with no place to go is reported.
        expect(plan.report.map((r: { path: string }) => r.path)).toContain('public/assets/js/arc-search.js');
    });

    it('works after the merge too, from the app\'s last commit in the old layout', () => {
        mergeUpstream();
        // Settle the merge the quick way: take Arc CMS's side everywhere.
        sh(app, 'checkout', 'upstream/dev', '--', '.');
        for (const path of sh(app, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean)) sh(app, 'rm', '-q', '-f', path);
        sh(app, 'add', '-A');
        sh(app, 'commit', '-q', '--no-edit', '-m', 'merge');

        const plan = planMigration({ cwd: app });
        expect(plan.moves.map((m: { to: string }) => m.to)).toContain('src/custom/site/home.html');
        writeMigration(plan, app);
        expect(read('src/custom/site/header.html')).toBe('<nav>Deepakam</nav>\n');
        expect(main([], () => {}, app)).toBe(0);
    });

    it('has nothing to do for an app that never edited the site', () => {
        sh(app, 'reset', '-q', '--hard', 'HEAD~1');
        sh(app, 'merge', '-q', '--no-edit', 'upstream/dev');
        const out: string[] = [];
        expect(main([], (l: string) => out.push(l), app)).toBe(0);
        expect(out.join('\n')).toContain('nothing to move');
    });
});
