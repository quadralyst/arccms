/**
 * The developer docs (docs/) as data: load every page, build the search index, and
 * find the pages that describe a set of changed files. Used by `npm run docs:index`,
 * `npm run docs:affected` and the docs checks (scripts/__tests__/docs).
 *
 * The docs are plain HTML files. Two of their assets are plain scripts that set a
 * global (nav.js sets ARC_DOCS_NAV, search-index.js sets ARC_DOCS_INDEX) and docs.js
 * carries the heading id rules, so they are evaluated here with a fake `window`: the
 * checks then see exactly what a browser sees.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DOCS_DIR = resolve(REPO_ROOT, 'docs');

/** Folders of docs/ that are not core pages: shared assets, and the app's own pages. */
const SKIP_DIRS = new Set(['assets', 'custom', 'examples']);

/** Run one of the docs' plain scripts with a fake window and return the window. */
function runScript(file) {
    const win = {};
    // eslint-disable-next-line no-new-func
    new Function('window', readFileSync(file, 'utf8'))(win);
    return win;
}

/** Every core page under docs/, as posix paths relative to docs/, sorted. */
export function listPages(docsDir = DOCS_DIR) {
    const out = [];
    const walk = (dir, prefix) => {
        for (const name of readdirSync(dir).sort()) {
            const full = join(dir, name);
            const rel = prefix ? `${prefix}/${name}` : name;
            if (statSync(full).isDirectory()) {
                if (!prefix && SKIP_DIRS.has(name)) continue;
                walk(full, rel);
            } else if (name.endsWith('.html')) {
                out.push(rel);
            }
        }
    };
    walk(docsDir, '');
    return out;
}

const clean = (text) => text.replace(/\s+/g, ' ').trim();

function readMeta(document, name) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    return meta ? meta.getAttribute('content') : null;
}

/** One page, parsed. */
function parsePage(docsDir, path, tools) {
    const html = readFileSync(join(docsDir, path), 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const main = document.querySelector('main');
    const headEls = main ? [...main.querySelectorAll('h2, h3')] : [];
    const ids = tools.assignIds(headEls.map((h) => ({ id: h.getAttribute('id'), text: clean(h.textContent) })));
    const sourcesRaw = readMeta(document, 'docs:sources');
    return {
        path,
        html,
        document,
        main,
        pageTitle: document.title,
        h1: main ? [...main.querySelectorAll('h1')].map((h) => clean(h.textContent)) : [],
        description: readMeta(document, 'description'),
        sourcesRaw,
        sources: sourcesRaw === null ? null : sourcesRaw.split(',').map((s) => s.trim()).filter(Boolean),
        dataRoot: document.body ? document.body.getAttribute('data-root') : null,
        dataPage: document.body ? document.body.getAttribute('data-page') : null,
        headings: headEls.map((h, i) => ({ level: h.tagName.toLowerCase(), text: clean(h.textContent), id: ids[i] })),
        links: main ? [...main.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: clean(a.textContent) })) : [],
    };
}

/** The whole docs folder: pages, the navigation, the search index file's content. */
export function loadSite(docsDir = DOCS_DIR) {
    const tools = runScript(join(docsDir, 'assets/docs.js')).ARC_DOCS_TOOLS;
    const navFile = join(docsDir, 'assets/nav.js');
    const indexFile = join(docsDir, 'assets/search-index.js');
    const nav = existsSync(navFile) ? runScript(navFile).ARC_DOCS_NAV ?? [] : [];
    const indexText = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : null;
    const pages = listPages(docsDir).map((path) => parsePage(docsDir, path, tools));
    return { docsDir, tools, nav, indexFile, indexText, pages };
}

/** The pages in navigation order (the order the sidebar and the previous and next links use). */
export function navPages(site) {
    return site.nav.flatMap((section) => section.pages.map((p) => ({ ...p, section: section.title })));
}

/** The content of docs/assets/search-index.js for the site's pages. */
export function renderIndex(site) {
    const byPath = new Map(site.pages.map((p) => [p.path, p]));
    const entries = navPages(site)
        .filter((entry) => byPath.has(entry.path))
        .map((entry) => {
            const page = byPath.get(entry.path);
            return {
                p: entry.path,
                t: entry.title,
                s: entry.section,
                d: page.description ?? '',
                h: page.headings.map((h) => [h.id, h.text]),
            };
        });
    const lines = entries.map((e) => `  ${JSON.stringify(e)}`).join(',\n');
    return [
        '// Generated by `npm run docs:index` from the pages in docs/. Do not edit.',
        `window.ARC_DOCS_INDEX = [\n${lines}\n];`,
        '',
    ].join('\n');
}

/**
 * The pages whose `docs:sources` overlap the changed files. A source is a file or a
 * folder (a trailing slash is optional); a changed file overlaps when it is the source
 * or inside it. A changed docs page is reported as itself.
 */
export function affectedPages(site, changed) {
    const files = changed.map((f) => f.replace(/\\/g, '/'));
    const out = [];
    for (const page of site.pages) {
        const hits = new Set();
        for (const source of page.sources ?? []) {
            if (source === 'none') continue;
            const s = source.replace(/\/+$/, '');
            for (const file of files) {
                if (file === s || file.startsWith(`${s}/`)) hits.add(file);
            }
        }
        const own = files.includes(`docs/${page.path}`);
        if (hits.size || own) out.push({ path: page.path, files: [...hits].sort(), edited: own });
    }
    return out;
}
