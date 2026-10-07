/**
 * The docs guardrails. Each check takes the loaded site (scripts/docs-lib.mjs) and
 * returns a list of problems; an empty list means it passes. They run as specs in
 * scripts/__tests__/docs (`npm run check:docs`, and with the whole suite), so a page
 * that drifts from the code, or a rule broken, fails the build.
 *
 * The rules themselves are written down in specs/developer-docs-strategy.md, and
 * shown to authors on docs/contributing/writing-docs.html.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { REPO_ROOT } from './docs-lib.mjs';
import { CUSTOM_STARTERS } from './custom-starters.mjs';

const TITLE_SUFFIX = ' | Arc CMS docs';

/** Navigation and pages agree: nothing unlisted, nothing listed that is missing. */
export function checkNav(site) {
    const problems = [];
    const files = new Map(site.pages.map((p) => [p.path, p]));
    const seen = new Set();
    if (!files.has('index.html')) problems.push('docs/index.html (the home page) is missing');
    for (const section of site.nav) {
        if (!section.pages.length) problems.push(`nav.js: the section "${section.title}" has no pages`);
        for (const entry of section.pages) {
            if (seen.has(entry.path)) problems.push(`nav.js lists ${entry.path} twice`);
            seen.add(entry.path);
            const page = files.get(entry.path);
            if (!page) {
                problems.push(`nav.js lists ${entry.path}, but that page does not exist`);
                continue;
            }
            if (page.h1[0] !== entry.title) {
                problems.push(`nav.js calls ${entry.path} "${entry.title}", but its heading is "${page.h1[0] ?? ''}"`);
            }
        }
    }
    for (const page of site.pages) {
        if (page.path !== 'index.html' && !seen.has(page.path)) problems.push(`${page.path} is not in docs/assets/nav.js`);
    }
    return problems;
}

/** Every page has the parts the furniture and the checks rely on. */
export function checkShape(site) {
    const problems = [];
    for (const page of site.pages) {
        const at = (msg) => problems.push(`${page.path}: ${msg}`);
        const depth = page.path.split('/').length - 1;
        const root = '../'.repeat(depth);
        const isHome = page.path === 'index.html';
        const doc = page.document;
        if (!/^\s*<!doctype html>/i.test(page.html)) at('does not start with <!doctype html>');
        if (doc.documentElement.getAttribute('lang') !== 'en') at('<html> needs lang="en"');
        if (!doc.querySelector('meta[charset]')) at('needs <meta charset>');
        if (!doc.querySelector('meta[name="viewport"]')) at('needs the viewport meta');
        if (isHome) {
            if (page.pageTitle !== 'Arc CMS docs') at('the <title> must be "Arc CMS docs"');
        } else if (!page.pageTitle.endsWith(TITLE_SUFFIX) || page.pageTitle === TITLE_SUFFIX.trim()) {
            at(`the <title> must be a name followed by "${TITLE_SUFFIX}"`);
        }
        if (!page.description || !page.description.trim()) at('needs <meta name="description"> with one sentence');
        else if (page.description.length > 220) at('the description is longer than 220 characters');
        if (!isHome) {
            if (page.sources === null) at('needs <meta name="docs:sources"> (the files it describes, or "none")');
            else if (!page.sources.length) at('docs:sources is empty (list the files it describes, or write "none")');
        }
        if (doc.querySelectorAll('main').length !== 1) at('needs exactly one <main>');
        if (page.h1.length !== 1) at(`needs exactly one <h1> in <main> (has ${page.h1.length})`);
        if (page.dataRoot !== root) at(`<body data-root> must be "${root}"`);
        if (page.dataPage !== page.path) at(`<body data-page> must be "${page.path}"`);
        const css = doc.querySelector('link[rel="stylesheet"]');
        if (!css || css.getAttribute('href') !== `${root}assets/docs.css`) at(`needs <link rel="stylesheet" href="${root}assets/docs.css">`);
        const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
        const want = ['nav.js', 'search-index.js', 'docs.js'].map((f) => `${root}assets/${f}`);
        if (scripts.join('|') !== want.join('|')) at(`the scripts must be, in order: ${want.join(', ')}`);
    }
    return problems;
}

const SKIPPED_HREF = /^(https?:|mailto:|tel:|javascript:|data:)/i;

const idsOf = (page) => new Set([
    ...page.headings.map((h) => h.id),
    ...[...page.document.querySelectorAll('[id]')].map((n) => n.getAttribute('id')),
]);

/** Internal links land on a page, and #anchors land on a heading of it. */
export function checkLinks(site) {
    const problems = [];
    const pages = new Map(site.pages.map((p) => [p.path, p]));
    for (const page of site.pages) {
        for (const { href } of page.links) {
            if (!href || SKIPPED_HREF.test(href)) continue;
            const [target, anchor] = href.split('#');
            let targetPage;
            if (target === '') {
                targetPage = page;
            } else {
                const resolved = posix.normalize(posix.join(posix.dirname(page.path), target));
                targetPage = pages.get(resolved);
                if (!targetPage) {
                    const asset = join(site.docsDir, resolved);
                    if (!resolved.startsWith('..') && existsSync(asset) && statSync(asset).isFile()) continue;
                    problems.push(`${page.path}: the link "${href}" does not lead to a page`);
                    continue;
                }
            }
            if (anchor && !idsOf(targetPage).has(anchor)) {
                problems.push(`${page.path}: the link "${href}" points at a heading that does not exist`);
            }
        }
        for (const img of page.document.querySelectorAll('main img[src]')) {
            const src = img.getAttribute('src');
            if (SKIPPED_HREF.test(src)) continue;
            const resolved = posix.normalize(posix.join(posix.dirname(page.path), src));
            if (!existsSync(join(site.docsDir, resolved))) problems.push(`${page.path}: the image "${src}" does not exist`);
        }
    }
    return problems;
}

const PATH_IN_CODE = /^(?:src|functions|scripts|public|tests|docs|custom)\/[A-Za-z0-9_.\-/[\]()@]+$/;
const ROOT_FILE_IN_CODE = /^[A-Za-z0-9_.-]+\.(?:json|md|rules|mjs|cjs|ts|js|html|css|txt|sh|yml|yaml)$/;
const PLACEHOLDER = /[{}*<>]|\.\.\.|YOUR/;
/** Files an app creates in its own copy; Arc CMS does not ship them, so a page writes them as new. */
const APP_ONLY_FILES = new Set(['firestore.app.rules', 'storage.app.rules', 'firestore.app.indexes.json']);

/**
 * Every file a page says it describes (docs:sources) exists, and so does every repo
 * path it writes in <code>. A path the reader is told to create is written
 * <code class="new">, and one only older versions have (to move away from) is
 * written <code class="old">; neither is checked.
 */
export function checkSources(site, repoRoot = REPO_ROOT) {
    const problems = [];
    const rootFiles = new Set(readdirSync(repoRoot).filter((f) => statSync(join(repoRoot, f)).isFile()));
    for (const page of site.pages) {
        for (const source of page.sources ?? []) {
            if (source === 'none') continue;
            if (!existsSync(join(repoRoot, source))) problems.push(`${page.path}: docs:sources names ${source}, which does not exist`);
        }
        if (!page.main) continue;
        for (const code of page.main.querySelectorAll('code')) {
            if (code.classList.contains('new') || code.closest('.new') || code.classList.contains('old')) continue;
            if (code.parentElement && code.parentElement.tagName === 'PRE') continue;
            const text = code.textContent.trim().replace(/:\d+(-\d+)?$/, '');
            if (PLACEHOLDER.test(text)) continue;
            const isPath = PATH_IN_CODE.test(text);
            const isRootFile = !isPath && ROOT_FILE_IN_CODE.test(text) && (rootFiles.has(text) || APP_ONLY_FILES.has(text));
            if (!isPath && !isRootFile) continue;
            if (text.startsWith('docs/custom')) continue;
            if (!existsSync(join(repoRoot, text))) {
                problems.push(`${page.path}: <code>${text}</code> names a path that does not exist (mark a file the reader creates with class="new")`);
            }
        }
    }
    return problems;
}

/** The section titles every feature page has, in this order. */
export const FEATURE_SECTIONS = [
    'What it is',
    'Turn it on or off',
    'Set it up',
    'Use it',
    'Extend it',
    'What it stores',
    'Who can do what',
    'Troubleshooting',
];

/** The switchable feature ids, read from the registry the build uses. */
export function featureIds(repoRoot = REPO_ROOT) {
    const text = readFileSync(join(repoRoot, 'src/app/core/features/feature-registry.ts'), 'utf8');
    const block = /FEATURE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(text);
    if (!block) throw new Error('docs checks: could not read FEATURE_IDS from feature-registry.ts');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Each switchable feature has features/<id>.html; each feature page has the standard sections. */
export function checkFeatures(site, ids = featureIds()) {
    const problems = [];
    const pages = new Map(site.pages.map((p) => [p.path, p]));
    for (const id of ids) {
        if (!pages.has(`features/${id}.html`)) problems.push(`the feature "${id}" has no page features/${id}.html`);
    }
    for (const page of site.pages) {
        if (!page.path.startsWith('features/') || page.path === 'features/overview.html') continue;
        const h2 = page.headings.filter((h) => h.level === 'h2').map((h) => h.text);
        let at = 0;
        for (const wanted of FEATURE_SECTIONS) {
            const found = h2.indexOf(wanted, at);
            if (found < 0) {
                problems.push(`${page.path}: needs the section "${wanted}"${h2.includes(wanted) ? ' (in the standard order)' : ''}`);
            } else {
                at = found + 1;
            }
        }
    }
    return problems;
}

const RULES = [
    { name: 'an em or en dash (use a comma, colon, full stop or "such as")', test: /[–—]|&mdash;|&ndash;|&#8211;|&#8212;|&#x201[34];/i },
    { name: 'a phase or task code such as S3, CO6 or D2 (docs describe what is, not how it was built)', test: /\b(?:CO|[SDFMCU])\d{1,2}(?:\.\d+)?\b/ },
    { name: 'a branch name (feat/, fix/, chore/)', test: /\b(?:feat|fix|chore|refactor)\/[a-z0-9][\w./-]*/ },
    { name: 'a Firebase project id from our own projects', test: /xlm-project-864ff/i },
    { name: 'a reference to specs/ (the docs never link into the working papers)', test: /\bspecs\//i },
    { name: 'a TODO, TBD or placeholder text', test: /\b(?:TODO|TBD|FIXME|lorem ipsum)\b/i },
];

/** No dash, internal term or placeholder in any page or asset. */
export function checkWriting(site) {
    const problems = [];
    const targets = site.pages.map((p) => ({ name: p.path, text: p.html }));
    for (const file of ['nav.js', 'docs.js', 'docs.css']) {
        const full = join(site.docsDir, 'assets', file);
        if (existsSync(full)) targets.push({ name: `assets/${file}`, text: readFileSync(full, 'utf8') });
    }
    for (const { name, text } of targets) {
        for (const rule of RULES) {
            const match = rule.test.exec(text);
            if (!match) continue;
            const line = text.slice(0, match.index).split('\n').length;
            problems.push(`${name}:${line}: contains ${rule.name}: "${match[0]}"`);
        }
    }
    return problems;
}

/** docs/assets/search-index.js is what `npm run docs:index` would write. */
export function checkIndexFresh(site, render) {
    if (site.indexText === null) return ['docs/assets/search-index.js is missing (run npm run docs:index)'];
    return site.indexText === render(site) ? [] : ['docs/assets/search-index.js is out of date (run npm run docs:index)'];
}

const TEXT_EXTENSIONS = /\.(?:ts|js|mjs|cjs|json|md|html|css|txt|sh|rules|yml|yaml)$/;
const SKIP_FILES = /(?:^|\/)package-lock\.json$/;

/** The files of the repo that are tracked or new (not ignored), as paths relative to the root. */
export function repoFiles(repoRoot = REPO_ROOT) {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString();
    return out.split('\0').filter(Boolean).filter((f) => existsSync(join(repoRoot, f)));
}

const DOC_PATH = /(?<![\w./-])((?:docs|specs)\/[A-Za-z0-9_.\-/[\]()]+?\.(?:md|html))(?![\w-])/g;
const MD_LINK = /\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g;

/**
 * No file names a docs/ or specs/ page that does not exist, and no markdown link in the
 * root or specs/ files leads to a file that is not there. Deleting or renaming a page
 * must repoint everything that mentioned it.
 */
export function checkReferences(repoRoot = REPO_ROOT, files = repoFiles(repoRoot)) {
    const problems = [];
    for (const file of files) {
        if (!TEXT_EXTENSIONS.test(file) || SKIP_FILES.test(file)) continue;
        if (file.startsWith('docs/custom/') || file.startsWith('node_modules/') || file.startsWith('scripts/__tests__/docs/')) continue;
        const text = readFileSync(join(repoRoot, file), 'utf8');
        for (const match of text.matchAll(DOC_PATH)) {
            const path = match[1];
            if (path.startsWith('docs/custom/')) continue;
            if (!existsSync(join(repoRoot, path))) {
                const line = text.slice(0, match.index).split('\n').length;
                problems.push(`${file}:${line}: names ${path}, which does not exist`);
            }
        }
        if (file.endsWith('.md') && (file.startsWith('specs/') || !file.includes('/'))) {
            for (const match of text.matchAll(MD_LINK)) {
                const target = match[1];
                if (/^(https?:|mailto:|\/|#)/i.test(target) || /[*<>{}\u2026]/.test(target)) continue;
                const resolved = resolve(repoRoot, dirname(file), target);
                if (!existsSync(resolved)) {
                    const line = text.slice(0, match.index).split('\n').length;
                    problems.push(`${file}:${line}: links to ${target}, which does not exist`);
                }
            }
        }
    }
    return problems;
}

/**
 * The page-level checks for some pages only (shape, links, paths, writing rules and, for
 * a feature page, its sections). For someone writing a page: navigation and the search
 * index are not part of it, so it works before the page is listed.
 */
export function lintPages(site, paths, repoRoot = REPO_ROOT) {
    const wanted = new Set(paths);
    const all = [
        ...checkShape(site),
        ...checkLinks(site),
        ...checkSources(site, repoRoot),
        ...checkWriting(site),
        ...checkFeatures(site, []),
        ...checkCommands(site, repoRoot),
        ...checkLookups(site, repoRoot),
    ];
    return all.filter((problem) => [...wanted].some((path) => problem.startsWith(`${path}:`)));
}

/* ---------- lookups: the reference pages agree with the code, both ways ---------- */

/** The `<code>` texts in the first cell of each table row of a page (the "names" column). */
export function firstColumnCodes(page) {
    if (!page.main) return new Set();
    return new Set([...page.main.querySelectorAll('table tr > td:first-child code')].map((c) => c.textContent.trim()));
}

const readJson = (repoRoot, path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

/** The scripts of package.json. */
export function packageScripts(repoRoot = REPO_ROOT) {
    return new Set(Object.keys(readJson(repoRoot, 'package.json').scripts ?? {}));
}

/** The keys of the install config example: the top level, and what each project holds. */
export function configKeys(repoRoot = REPO_ROOT) {
    const config = readJson(repoRoot, 'arccms.config.example.json');
    const keys = new Set(Object.keys(config));
    for (const project of Object.values(config.projects ?? {})) Object.keys(project).forEach((k) => keys.add(k));
    return keys;
}

/**
 * The exports of the starter files Arc CMS ships in the custom space
 * (scripts/custom-starters.mjs). Read from that list, not from the files: in an app the
 * files hold its own code too, and reference/config-keys.html is not the app's to edit.
 */
export function customExports(starters = CUSTOM_STARTERS) {
    return new Set(starters.flatMap((s) => Object.keys(s.exports)));
}

function walkTs(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'node_modules' || name === 'custom') continue;
            walkTs(full, out);
        } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.gen.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** The Cloud Functions Arc CMS exports (`export const name = onCall(...)` and its kin). */
export function functionNames(repoRoot = REPO_ROOT) {
    const names = new Set();
    for (const file of walkTs(join(repoRoot, 'functions/src'))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/^export const ([A-Za-z0-9_]+)\s*=\s*(?:on|before)[A-Z]\w*\s*(?:<[^()]{0,300}>)?\s*\(/gm)) names.add(match[1]);
        // First generation functions, built from `import * as functionsV1 from 'firebase-functions/v1'`.
        for (const match of text.matchAll(/^export const ([A-Za-z0-9_]+)\s*=\s*functionsV1\b/gm)) names.add(match[1]);
    }
    return names;
}

/** The merge tags of the central registry. */
export function emailTags(repoRoot = REPO_ROOT) {
    const text = readFileSync(join(repoRoot, 'src/shared/constants/email-tags.ts'), 'utf8');
    const block = /export const EMAIL_TAG\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(text);
    if (!block) throw new Error('docs checks: could not read EMAIL_TAG from email-tags.ts');
    return new Set([...block[1].matchAll(/'(##[A-Z0-9_]+##)'/g)].map((m) => m[1]));
}

/** The Firestore collections that firestore.rules names at the top level. */
export function ruleCollections(repoRoot = REPO_ROOT) {
    const text = readFileSync(join(repoRoot, 'firestore.rules'), 'utf8');
    const names = new Set();
    for (const match of text.matchAll(/^ {4}match \/([A-Za-z_][A-Za-z0-9_]*)\/\{/gm)) names.add(match[1]);
    return names;
}

const NPM_RUN = /\bnpm run ([A-Za-z0-9:_.-]+)/g;

/** Every `npm run x` any page shows is a script that exists. */
export function checkCommands(site, repoRoot = REPO_ROOT) {
    const problems = [];
    const scripts = packageScripts(repoRoot);
    for (const page of site.pages) {
        if (!page.main) continue;
        const seen = new Set();
        for (const code of page.main.querySelectorAll('code')) {
            for (const match of code.textContent.matchAll(NPM_RUN)) {
                const script = match[1];
                if (scripts.has(script) || seen.has(script)) continue;
                seen.add(script);
                problems.push(`${page.path}: shows "npm run ${script}", but package.json has no such script`);
            }
        }
    }
    return problems;
}

/** What a documented name is compared as: a script may be written `npm run x`. */
const asScript = (name) => name.replace(/^npm (?:run )?/, '');

/**
 * Compare the names in a reference page's first column with the names in the code.
 * Every name in the code must be on the page; with `exact`, every name on the page must
 * be in the code too.
 */
function compareNames(site, path, wanted, { exact, normalize = (n) => n, label }) {
    const page = site.pages.find((p) => p.path === path);
    if (!page) return [`${path} is missing (it lists ${label})`];
    const documented = new Set([...firstColumnCodes(page)].map(normalize));
    const problems = [];
    for (const name of [...wanted].sort()) {
        if (!documented.has(name)) problems.push(`${path}: does not list ${name} (${label})`);
    }
    if (exact) {
        for (const name of [...documented].sort()) {
            if (!wanted.has(name)) problems.push(`${path}: lists ${name}, which is not in the code (${label})`);
        }
    }
    return problems;
}

/** The reference pages list exactly what the code has. */
export function checkLookups(site, repoRoot = REPO_ROOT, starters = CUSTOM_STARTERS) {
    const problems = [
        ...compareNames(site, 'reference/npm-scripts.html', packageScripts(repoRoot), { exact: true, normalize: asScript, label: 'the scripts in package.json' }),
        ...compareNames(site, 'reference/feature-ids.html', new Set(featureIds(repoRoot)), { exact: true, label: 'FEATURE_IDS' }),
        ...compareNames(site, 'reference/cloud-functions.html', functionNames(repoRoot), { exact: true, label: 'the exported functions' }),
        ...compareNames(site, 'reference/email-tags.html', emailTags(repoRoot), { exact: true, label: 'EMAIL_TAG' }),
        ...compareNames(site, 'reference/config-keys.html', new Set([...configKeys(repoRoot), ...customExports(starters)]), { exact: false, label: 'the install config and the custom starter files' }),
        ...compareNames(site, 'reference/data-model.html', ruleCollections(repoRoot), { exact: false, label: 'the collections in firestore.rules' }),
    ];
    const config = site.pages.find((p) => p.path === 'reference/config-keys.html');
    if (config) {
        const known = customExports(starters);
        for (const name of firstColumnCodes(config)) {
            if (/^CUSTOM_[A-Z0-9_]+$/.test(name) && !known.has(name)) problems.push(`reference/config-keys.html: lists ${name}, which no custom starter file exports`);
        }
    }
    return problems;
}
