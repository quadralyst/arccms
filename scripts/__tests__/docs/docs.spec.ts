import { describe, it, expect, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import * as lib from '../../docs-lib.mjs';
// @ts-expect-error: plain ESM script without type declarations
import * as checks from '../../docs-checks.mjs';

/**
 * The docs guardrails (specs/developer-docs-strategy.md, section 7). The first block runs
 * every check on the real docs/. The second proves each check fails on the drift it exists
 * for, using small throwaway docs folders, so a check that stops working is noticed.
 */

const { REPO_ROOT, DOCS_DIR, loadSite, renderIndex, affectedPages } = lib;

describe('the docs', () => {
    const site = loadSite(DOCS_DIR);

    it('has pages', () => {
        expect(site.pages.length).toBeGreaterThan(2);
    });
    it('lists every page in the navigation, and only pages that exist', () => {
        expect(checks.checkNav(site)).toEqual([]);
    });
    it('gives every page the parts the furniture and the checks rely on', () => {
        expect(checks.checkShape(site)).toEqual([]);
    });
    it('has no broken link, image or heading anchor', () => {
        expect(checks.checkLinks(site)).toEqual([]);
    });
    it('names only files that exist', () => {
        expect(checks.checkSources(site, REPO_ROOT)).toEqual([]);
    });
    it('follows the writing rules', () => {
        expect(checks.checkWriting(site)).toEqual([]);
    });
    it('shows only npm scripts that exist', () => {
        expect(checks.checkCommands(site, REPO_ROOT)).toEqual([]);
    });
    it('has a page for every switchable feature, each with the standard sections', () => {
        expect(checks.checkFeatures(site)).toEqual([]);
    });
    it('lists exactly what the code has on the reference pages (scripts, features, functions, tags, config, collections)', () => {
        expect(checks.checkLookups(site, REPO_ROOT)).toEqual([]);
    });
    it('has a search index that matches the pages', () => {
        expect(checks.checkIndexFresh(site, renderIndex)).toEqual([]);
    });
    it('is not named by any file that does not exist, and breaks no markdown link', () => {
        expect(checks.checkReferences(REPO_ROOT)).toEqual([]);
    });
});

// ---------- fixtures: small docs folders, built on disk ----------

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

interface PageSpec {
    title?: string;
    body?: string;
    sources?: string | null;
    description?: string | null;
    root?: string;
    dataPage?: string;
    scripts?: string[];
}

function pageHtml(path: string, spec: PageSpec = {}): string {
    const depth = path.split('/').length - 1;
    const root = spec.root ?? '../'.repeat(depth);
    const title = spec.title ?? 'A page';
    const desc = spec.description === undefined ? 'What this page does.' : spec.description;
    const sources = spec.sources === undefined ? 'none' : spec.sources;
    const scripts = spec.scripts ?? ['nav.js', 'search-index.js', 'docs.js'];
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Arc CMS docs</title>
  ${desc === null ? '' : `<meta name="description" content="${desc}">`}
  ${sources === null ? '' : `<meta name="docs:sources" content="${sources}">`}
  <link rel="stylesheet" href="${root}assets/docs.css">
</head>
<body data-root="${root}" data-page="${spec.dataPage ?? path}">
  <main>
    <h1>${title}</h1>
    ${spec.body ?? '<p>Text.</p>'}
  </main>
  ${scripts.map((s) => `<script src="${root}assets/${s}"></script>`).join('\n  ')}
</body>
</html>
`;
}

function homeHtml(): string {
    return pageHtml('index.html', { title: 'Home' }).replace('<title>Home | Arc CMS docs</title>', '<title>Arc CMS docs</title>');
}

/** A throwaway docs folder: the real docs.js, a generated nav.js, and the given pages. */
function fixture(pages: Record<string, PageSpec>, nav?: { title: string; pages: { path: string; title: string }[] }[], extraFiles: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'arc-docs-'));
    made.push(dir);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    copyFileSync(join(DOCS_DIR, 'assets/docs.js'), join(dir, 'assets/docs.js'));
    writeFileSync(join(dir, 'assets/docs.css'), '/* css */\n');
    writeFileSync(join(dir, 'index.html'), homeHtml());
    const navData = nav ?? [{
        title: 'Section',
        pages: Object.entries(pages).map(([path, spec]) => ({ path, title: spec.title ?? 'A page' })),
    }];
    writeFileSync(join(dir, 'assets/nav.js'), `window.ARC_DOCS_NAV = ${JSON.stringify(navData)};\n`);
    for (const [path, spec] of Object.entries(pages)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), pageHtml(path, spec));
    }
    for (const [path, content] of Object.entries(extraFiles)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    const site = loadSite(dir);
    writeFileSync(join(dir, 'assets/search-index.js'), renderIndex(site));
    return loadSite(dir);
}

const good = { 'a/one.html': { title: 'One' }, 'a/two.html': { title: 'Two', body: '<p>See <a href="one.html">one</a>.</p>' } };

describe('the checks catch drift', () => {
    it('pass on a good folder', () => {
        const site = fixture(good);
        expect(checks.checkNav(site)).toEqual([]);
        expect(checks.checkShape(site)).toEqual([]);
        expect(checks.checkLinks(site)).toEqual([]);
        expect(checks.checkSources(site, REPO_ROOT)).toEqual([]);
        expect(checks.checkWriting(site)).toEqual([]);
        expect(checks.checkIndexFresh(site, renderIndex)).toEqual([]);
    });

    describe('navigation', () => {
        it('fails on a page that is not listed', () => {
            const site = fixture(good, [{ title: 'Section', pages: [{ path: 'a/one.html', title: 'One' }] }]);
            expect(checks.checkNav(site)).toEqual(['a/two.html is not in docs/assets/nav.js']);
        });
        it('fails on a listed page that does not exist', () => {
            const site = fixture(good, [{ title: 'Section', pages: [
                { path: 'a/one.html', title: 'One' }, { path: 'a/two.html', title: 'Two' }, { path: 'a/ghost.html', title: 'Ghost' },
            ] }]);
            expect(checks.checkNav(site)[0]).toContain('a/ghost.html, but that page does not exist');
        });
        it('fails on a title that differs from the heading', () => {
            const site = fixture(good, [{ title: 'Section', pages: [{ path: 'a/one.html', title: 'Uno' }, { path: 'a/two.html', title: 'Two' }] }]);
            expect(checks.checkNav(site)[0]).toContain('calls a/one.html "Uno", but its heading is "One"');
        });
        it('fails on an empty section and on a page listed twice', () => {
            const site = fixture(good, [
                { title: 'Empty', pages: [] },
                { title: 'Section', pages: [{ path: 'a/one.html', title: 'One' }, { path: 'a/one.html', title: 'One' }, { path: 'a/two.html', title: 'Two' }] },
            ]);
            const problems = checks.checkNav(site).join('\n');
            expect(problems).toContain('the section "Empty" has no pages');
            expect(problems).toContain('lists a/one.html twice');
        });
    });

    describe('page shape', () => {
        it.each([
            ['no description', { description: null }, 'needs <meta name="description"'],
            ['no sources', { sources: null }, 'needs <meta name="docs:sources"'],
            ['empty sources', { sources: '' }, 'docs:sources is empty'],
            ['wrong data-root', { root: '../../' }, '<body data-root> must be "../"'],
            ['wrong data-page', { dataPage: 'a/other.html' }, '<body data-page> must be "a/one.html"'],
            ['scripts out of order', { scripts: ['docs.js', 'nav.js', 'search-index.js'] }, 'the scripts must be, in order'],
        ])('fails on %s', (_name, spec, message) => {
            const site = fixture({ 'a/one.html': { title: 'One', ...(spec as PageSpec) } });
            expect(checks.checkShape(site).join('\n')).toContain(message);
        });
    });

    describe('links', () => {
        it('fails on a link to a page that does not exist', () => {
            const site = fixture({ 'a/one.html': { title: 'One', body: '<a href="missing.html">x</a>' } });
            expect(checks.checkLinks(site)).toEqual(['a/one.html: the link "missing.html" does not lead to a page']);
        });
        it('fails on a heading that does not exist, and accepts one that does (by its generated id)', () => {
            const site = fixture({
                'a/one.html': { title: 'One', body: '<h2>Set it up</h2><a href="#set-it-up">ok</a><a href="two.html#the-end">ok</a><a href="two.html#nope">bad</a>' },
                'a/two.html': { title: 'Two', body: '<h2 id="the-end">The end</h2>' },
            });
            expect(checks.checkLinks(site)).toEqual(['a/one.html: the link "two.html#nope" points at a heading that does not exist']);
        });
        it('gives repeated headings distinct ids, the same way the browser does', () => {
            const site = fixture({ 'a/one.html': { title: 'One', body: '<h2>Steps</h2><h2>Steps</h2><a href="#steps-2">second</a>' } });
            expect(checks.checkLinks(site)).toEqual([]);
        });
        it('ignores external links and fails on a missing image', () => {
            const site = fixture({ 'a/one.html': { title: 'One', body: '<a href="https://example.com/x">x</a><img src="../img/none.png" alt="">' } });
            expect(checks.checkLinks(site)).toEqual(['a/one.html: the image "../img/none.png" does not exist']);
        });
    });

    describe('sources and paths', () => {
        it('fails on a docs:sources path that does not exist', () => {
            const site = fixture({ 'a/one.html': { title: 'One', sources: 'package.json, src/nothing/here.ts' } });
            expect(checks.checkSources(site, REPO_ROOT)).toEqual(['a/one.html: docs:sources names src/nothing/here.ts, which does not exist']);
        });
        it('fails on an app-only file written as plain code, and accepts it marked new', () => {
            const bad = fixture({ 'a/one.html': { title: 'One', body: '<p>Edit <code>firestore.app.rules</code>.</p>' } });
            expect(checks.checkSources(bad, REPO_ROOT)).toEqual([
                'a/one.html: <code>firestore.app.rules</code> names a path that does not exist (mark a file the reader creates with class="new")',
            ]);
            const good = fixture({ 'a/one.html': { title: 'One', body: '<p>Create <code class="new">firestore.app.rules</code>.</p>' } });
            expect(checks.checkSources(good, REPO_ROOT)).toEqual([]);
        });
        it('fails on a path in <code> that does not exist, but not on one marked new, in a block, or with a placeholder', () => {
            const site = fixture({
                'a/one.html': {
                    title: 'One',
                    body: '<p><code>src/custom/features.ts</code> <code>src/gone/file.ts</code> <code class="new">src/custom/pages/deals.page.ts</code> <code>src/custom/i18n/{lang}.json</code> <code>package.json</code> <code>nofile.json</code></p><pre><code>src/never/there.ts</code></pre>',
                },
            });
            expect(checks.checkSources(site, REPO_ROOT)).toEqual([
                'a/one.html: <code>src/gone/file.ts</code> names a path that does not exist (mark a file the reader creates with class="new")',
            ]);
        });
    });

    describe('feature pages', () => {
        const sections = checks.FEATURE_SECTIONS as string[];
        const featurePage = (order: string[]) => ({ title: 'Search', body: order.map((s) => `<h2>${s}</h2><p>x</p>`).join('') });
        it('fails on a feature with no page', () => {
            const site = fixture({ 'a/one.html': { title: 'One' } });
            expect(checks.checkFeatures(site, ['search'])).toEqual(['the feature "search" has no page features/search.html']);
        });
        it('passes on a page with every section in order', () => {
            const site = fixture({ 'features/search.html': featurePage(sections) });
            expect(checks.checkFeatures(site, ['search'])).toEqual([]);
        });
        it('fails on a missing section and on one out of order', () => {
            const missing = fixture({ 'features/search.html': featurePage(sections.filter((s) => s !== 'Use it')) });
            expect(checks.checkFeatures(missing, ['search'])).toEqual(['features/search.html: needs the section "Use it"']);
            const swapped = [...sections];
            [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
            const out = fixture({ 'features/search.html': featurePage(swapped) });
            expect(checks.checkFeatures(out, ['search']).join('\n')).toContain('(in the standard order)');
        });
        it('reads the real feature ids from the registry the build uses', () => {
            expect(checks.featureIds()).toEqual(expect.arrayContaining(['content', 'search', 'pwa']));
        });
    });

    describe('writing rules', () => {
        it.each([
            ['an em dash', 'Fast — and simple', 'em or en dash'],
            ['an en dash', '2020–2021', 'em or en dash'],
            ['a dash entity', 'Fast &mdash; simple', 'em or en dash'],
            ['a phase code', 'Built in phase S3', 'phase or task code'],
            ['a task code', 'See CO6.9 for more', 'phase or task code'],
            ['a branch name', 'Merged from feat/search into dev', 'branch name'],
            ['a project id', 'Deploy to xlm-project-864ff', 'Firebase project id'],
            ['a link into the working papers', 'Read specs/search-spec.md', 'reference to specs/'],
            ['a leftover to-do', 'TODO write this', 'TODO, TBD or placeholder'],
        ])('fails on %s', (_name, text, message) => {
            const site = fixture({ 'a/one.html': { title: 'One', body: `<p>${text}</p>` } });
            const problems = checks.checkWriting(site);
            expect(problems).toHaveLength(1);
            expect(problems[0]).toContain(message);
        });
        it('accepts ordinary hyphens and words like "specs" without a folder', () => {
            const site = fixture({ 'a/one.html': { title: 'One', body: '<p>A built-in, well-known feature; the specs are separate.</p>' } });
            expect(checks.checkWriting(site)).toEqual([]);
        });
    });

    describe('search index', () => {
        it('fails when a page changes and the index is not rewritten', () => {
            const site = fixture(good);
            writeFileSync(join(site.docsDir, 'a/one.html'), pageHtml('a/one.html', { title: 'One', body: '<h2>New heading</h2>' }));
            const changed = loadSite(site.docsDir);
            expect(checks.checkIndexFresh(changed, renderIndex)).toEqual(['docs/assets/search-index.js is out of date (run npm run docs:index)']);
        });
        it('fails when the file is missing', () => {
            const site = fixture(good);
            rmSync(join(site.docsDir, 'assets/search-index.js'));
            expect(checks.checkIndexFresh(loadSite(site.docsDir), renderIndex)[0]).toContain('is missing');
        });
        it('lists pages in navigation order with their headings', () => {
            const site = fixture({ 'a/one.html': { title: 'One', body: '<h2>First part</h2><h3>Detail</h3>' }, 'a/two.html': { title: 'Two' } });
            const text = renderIndex(site) as string;
            expect(text.indexOf('"p":"a/one.html"')).toBeLessThan(text.indexOf('"p":"a/two.html"'));
            expect(text).toContain('["first-part","First part"],["detail","Detail"]');
        });
    });

    describe('references to docs and specs pages', () => {
        const repo = (files: Record<string, string>) => {
            const dir = mkdtempSync(join(tmpdir(), 'arc-repo-'));
            made.push(dir);
            for (const [path, content] of Object.entries(files)) {
                mkdirSync(dirname(join(dir, path)), { recursive: true });
                writeFileSync(join(dir, path), content);
            }
            return { dir, files: Object.keys(files) };
        };
        it('fails on a comment that names a page that is gone', () => {
            const { dir, files } = repo({ 'src/a.ts': '// See specs/gone-spec.md for why.\n', 'specs/here.md': '# Here\n' });
            expect(checks.checkReferences(dir, files)).toEqual(['src/a.ts:1: names specs/gone-spec.md, which does not exist']);
        });
        it('accepts pages that exist, and skips docs/custom', () => {
            const { dir, files } = repo({ 'src/a.ts': '// See specs/here.md and docs/custom/notes.md and docs/index.html.\n', 'specs/here.md': '# Here\n', 'docs/index.html': '<p></p>' });
            expect(checks.checkReferences(dir, files)).toEqual([]);
        });
        it('fails on a markdown link in specs/ or the root to a file that is not there', () => {
            const { dir, files } = repo({ 'specs/a.md': 'See [b](b.md) and [c](c.md#top) and [web](https://x.y/z.md).\n', 'specs/b.md': '# B\n', 'README.md': '[guide](specs/none.md)\n' });
            const problems = checks.checkReferences(dir, files);
            expect(problems).toHaveLength(3);
            expect(problems).toEqual(expect.arrayContaining([
                'README.md:1: links to specs/none.md, which does not exist',
                'specs/a.md:1: links to c.md, which does not exist',
            ]));
        });
    });

    describe('docs:affected', () => {
        it('lists the pages whose sources contain a changed file, by file or by folder', () => {
            const site = fixture({
                'a/one.html': { title: 'One', sources: 'functions/src/search, package.json' },
                'a/two.html': { title: 'Two', sources: 'src/custom/features.ts' },
                'a/three.html': { title: 'Three', sources: 'none' },
            });
            const hits = affectedPages(site, ['functions/src/search/tokenizer.ts', 'functions/src/searchable/x.ts', 'src/custom/features.ts']);
            expect(hits.map((h: { path: string }) => h.path)).toEqual(['a/one.html', 'a/two.html']);
            expect(hits[0].files).toEqual(['functions/src/search/tokenizer.ts']);
        });
        it('marks a page that was edited itself', () => {
            const site = fixture({ 'a/one.html': { title: 'One', sources: 'package.json' } });
            const hits = affectedPages(site, ['docs/a/one.html']);
            expect(hits).toEqual([{ path: 'a/one.html', files: [], edited: true }]);
        });
        it('reports nothing when no source is touched', () => {
            const site = fixture({ 'a/one.html': { title: 'One', sources: 'package.json' } });
            expect(affectedPages(site, ['src/app/app.ts'])).toEqual([]);
        });
    });

    describe('lookups (reference pages against the code)', () => {
        const fakeRepo = () => {
            const dir = mkdtempSync(join(tmpdir(), 'arc-lookup-'));
            made.push(dir);
            const put = (path: string, content: string) => {
                mkdirSync(dirname(join(dir, path)), { recursive: true });
                writeFileSync(join(dir, path), content);
            };
            put('package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'vite build', 'check:docs': 'x' } }));
            put('arccms.config.example.json', JSON.stringify({ profile: 'standalone', projects: { p: { databaseId: 'arccms' } } }));
            put('src/custom/features.ts', 'export const CUSTOM_FEATURES = {};\n');
            put('functions/src/custom/search-sources.ts', 'export const SEARCH_COLLECTIONS: string[] = [];\n');
            put('src/app/core/features/feature-registry.ts', "export const FEATURE_IDS = ['content', 'search'] as const;\n");
            put('functions/src/a.ts', "export const doThing = onCall(async () => {});\nexport const onMade = onDocumentCreated('x', () => {});\nexport const helper = makeHelper();\nexport const typed = onCall<{ id: string }>(async () => {});\n");
            put('functions/src/__tests__/a.spec.ts', "export const notCounted = onCall(() => {});\n");
            put('src/shared/constants/email-tags.ts', "export const EMAIL_TAG = {\n  NAME: '##NAME##',\n  EMAIL: '##EMAIL##',\n} as const;\n// ##EXAMPLE##\n");
            put('firestore.rules', "service cloud.firestore {\n  match /databases/{database}/documents {\n    match /Contacts/{id} {\n    }\n    match /Lists/{id} {\n    }\n  }\n}\n");
            return dir;
        };
        const table = (names: string[]) => `<table><thead><tr><th>Name</th></tr></thead><tbody>${names.map((n) => `<tr><td><code>${n}</code></td></tr>`).join('')}</tbody></table>`;
        const lookupSite = (overrides: Record<string, string[]> = {}) => {
            const pages: Record<string, PageSpec> = {
                'reference/npm-scripts.html': { title: 'npm scripts', body: table(overrides.scripts ?? ['npm run dev', 'npm run build', 'npm run check:docs']) },
                'reference/feature-ids.html': { title: 'Feature ids', body: table(overrides.features ?? ['content', 'search']) },
                'reference/cloud-functions.html': { title: 'Cloud Functions', body: table(overrides.functions ?? ['doThing', 'onMade', 'typed']) },
                'reference/email-tags.html': { title: 'Email merge tags', body: table(overrides.tags ?? ['##NAME##', '##EMAIL##']) },
                'reference/config-keys.html': { title: 'Configuration keys', body: table(overrides.config ?? ['profile', 'projects', 'databaseId', 'CUSTOM_FEATURES', 'SEARCH_COLLECTIONS']) },
                'reference/data-model.html': { title: 'Data model', body: table(overrides.collections ?? ['Contacts', 'Lists']) },
            };
            return fixture(pages);
        };

        it('reads the names from the code', () => {
            const repo = fakeRepo();
            expect([...checks.packageScripts(repo)]).toEqual(['dev', 'build', 'check:docs']);
            expect([...checks.functionNames(repo)]).toEqual(['doThing', 'onMade', 'typed']);
            expect([...checks.emailTags(repo)]).toEqual(['##NAME##', '##EMAIL##']);
            expect([...checks.ruleCollections(repo)]).toEqual(['Contacts', 'Lists']);
            expect([...checks.customExports(repo)].sort()).toEqual(['CUSTOM_FEATURES', 'SEARCH_COLLECTIONS']);
            expect([...checks.configKeys(repo)]).toEqual(['profile', 'projects', 'databaseId']);
        });
        it('passes when every reference page lists what the code has', () => {
            expect(checks.checkLookups(lookupSite(), fakeRepo())).toEqual([]);
        });
        it('fails on a script, function, tag, feature or collection the page does not list', () => {
            const problems = checks.checkLookups(lookupSite({
                scripts: ['npm run dev'], functions: ['doThing'], tags: ['##NAME##'], features: ['content'], collections: ['Contacts'], config: ['profile', 'projects', 'databaseId', 'CUSTOM_FEATURES'],
            }), fakeRepo()).join('\n');
            expect(problems).toContain('does not list build');
            expect(problems).toContain('does not list check:docs');
            expect(problems).toContain('does not list onMade');
            expect(problems).toContain('does not list ##EMAIL##');
            expect(problems).toContain('does not list search');
            expect(problems).toContain('does not list Lists');
            expect(problems).toContain('does not list SEARCH_COLLECTIONS');
        });
        it('fails on a documented name the code no longer has (where the list must be exact)', () => {
            const problems = checks.checkLookups(lookupSite({
                scripts: ['npm run dev', 'npm run build', 'npm run check:docs', 'npm run gone'], functions: ['doThing', 'onMade', 'typed', 'removed'], tags: ['##NAME##', '##EMAIL##', '##OLD##'], features: ['content', 'search', 'ghost'],
                config: ['profile', 'projects', 'databaseId', 'CUSTOM_FEATURES', 'SEARCH_COLLECTIONS', 'CUSTOM_MISSING'],
            }), fakeRepo()).join('\n');
            expect(problems).toContain('lists gone, which is not in the code');
            expect(problems).toContain('lists removed, which is not in the code');
            expect(problems).toContain('lists ##OLD##, which is not in the code');
            expect(problems).toContain('lists ghost, which is not in the code');
            expect(problems).toContain('lists CUSTOM_MISSING, which no custom starter file exports');
        });
        it('fails when a reference page is missing', () => {
            const site = fixture({ 'a/one.html': { title: 'One' } });
            expect(checks.checkLookups(site, fakeRepo()).filter((p: string) => p.endsWith('is missing (it lists the scripts in package.json)'))).toHaveLength(1);
        });
        it('fails on an npm run command that is not a script, in any page, and accepts arguments after it', () => {
            const site = fixture({ 'a/one.html': { title: 'One', body: '<p><code>npm run dev</code> <code>npm run nothing</code></p><pre><code>npm run build -- --flag\nnpm run also-missing</code></pre>' } });
            expect(checks.checkCommands(site, fakeRepo())).toEqual([
                'a/one.html: shows "npm run nothing", but package.json has no such script',
                'a/one.html: shows "npm run also-missing", but package.json has no such script',
            ]);
        });
    });

    describe('docs:lint', () => {
        it('reports the page-level problems of the named pages only, and does not need the page listed in the navigation', () => {
            const site = fixture(
                { 'a/one.html': { title: 'One', body: '<p>Fast \u2014 bad</p>' }, 'a/two.html': { title: 'Two', body: '<p>Also \u2014 bad</p>' }, 'a/new.html': { title: 'New', sources: 'src/nothing.ts' } },
                [{ title: 'Section', pages: [{ path: 'a/one.html', title: 'One' }, { path: 'a/two.html', title: 'Two' }] }],
            );
            const problems = checks.lintPages(site, ['a/one.html', 'a/new.html'], REPO_ROOT);
            expect(problems).toHaveLength(2);
            expect(problems.join('\n')).toContain('a/one.html:');
            expect(problems.join('\n')).toContain('a/new.html: docs:sources names src/nothing.ts');
            expect(problems.join('\n')).not.toContain('a/two.html');
            expect(problems.join('\n')).not.toContain('is not in docs/assets/nav.js');
        });
        it('checks the sections of a feature page', () => {
            const site = fixture({ 'features/x.html': { title: 'X', body: '<h2>What it is</h2>' } });
            expect(checks.lintPages(site, ['features/x.html'], REPO_ROOT).join('\n')).toContain('needs the section "Turn it on or off"');
        });
    });

    describe('heading ids (shared with the browser)', () => {
        it('slugs text, keeps explicit ids, and numbers duplicates', () => {
            const { assignIds, slug } = loadSite(DOCS_DIR).tools;
            expect(slug('Turn it on or off')).toBe('turn-it-on-or-off');
            expect(slug('Q&A: what?')).toBe('q-and-a-what');
            expect(slug('???')).toBe('section');
            expect(assignIds([{ text: 'Steps' }, { text: 'Steps' }, { id: 'steps-3', text: 'x' }, { text: 'Steps' }])).toEqual(['steps', 'steps-2', 'steps-3', 'steps-4']);
        });
    });
});
