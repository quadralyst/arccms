/**
 * The public website's files (specs/own-website-spec.md, docs/website/overview.html).
 *
 * An app keeps its website in src/custom/site/; Arc CMS keeps its defaults in
 * public/_site/ and its other served files in public/. This is the one place
 * that decides which file is served where, for the dev server, the build, the
 * tests and the scripts:
 *
 *   src/custom/site/home.html, home.{lang}.html    /_site/home.html, /_site/home.{lang}.html
 *   src/custom/site/header.html, footer.html        /_site/header.html, /_site/footer.html
 *   src/custom/site/sign-in.html                    /_site/sign-in.html (the sign-in page's brand panel)
 *   src/custom/site/templates/{folder}/{file}.html  /_site/templates/{folder}/{file}.html
 *   src/custom/site/pages/{name}.html               /_site/pages/{name}.html
 *   src/custom/site/strings/{lang}.json             /_site/strings/{lang}.json, merged over core's
 *   src/custom/site/site.css                        /assets/css/site.css
 *   src/custom/site/assets/...                      /site/...
 *   src/custom/site/favicon.ico, 403.html, 404.html /favicon.ico, /403.html, /404.html
 *
 * An app file replaces the core file served at the same path; strings files are
 * merged key by key instead. Everything is assembled into one folder
 * (.arc-build/public, gitignored), which Vite serves and builds from, with a
 * manifest of what exists at /_site/site.json.
 */
import { createHash } from 'node:crypto';
import {
    copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Arc CMS's served files, its site defaults among them in `_site/`. */
export const CORE_PUBLIC = 'public';
/** The app's website. */
export const APP_SITE = 'src/custom/site';
/** Where the two are assembled. */
export const SITE_OUT = '.arc-build/public';
/** The manifest's served path. */
export const MANIFEST_PATH = '_site/site.json';

/**
 * Served files that keep their name across builds but must reach browsers when
 * they change (Hosting lets browsers keep CSS for a year): linked with `?v={hash}`.
 */
export const VERSIONED = ['assets/css/main.css', 'assets/css/site.css', 'assets/js/arc-site.js'];

/** The three files a template folder can have. */
export const TEMPLATE_FILES = ['partials', 'list', 'detail'];

const LANG = '[a-z]{2,3}(?:-[a-z0-9]{2,8})?';
const NAME = '[a-z0-9][a-z0-9_-]*';

/** App file (relative to src/custom/site, `/`-separated) to served path, in order. */
const APP_RULES = [
    [new RegExp(`^home(\\.${LANG})?\\.html$`), (p) => `_site/${p}`],
    [/^(header|footer|sign-in)\.html$/, (p) => `_site/${p}`],
    [new RegExp(`^templates/${NAME}/(${TEMPLATE_FILES.join('|')})\\.html$`), (p) => `_site/${p}`],
    [new RegExp(`^pages/${NAME}\\.html$`), (p) => `_site/${p}`],
    [new RegExp(`^strings/${LANG}\\.json$`), (p) => `_site/${p}`],
    [/^site\.css$/, () => 'assets/css/site.css'],
    [/^assets\/.+/, (p) => `site/${p.slice('assets/'.length)}`],
    [/^(favicon\.ico|403\.html|404\.html)$/, (p) => p],
];

/** Files in src/custom/site that are never served and never warned about. */
const QUIET = /(^|\/)(README\.md|\.gitkeep|\.DS_Store)$/;

/** Where an app file is served, or null when it is not a site file. */
export function servedPath(appRelative) {
    const path = appRelative.split(sep).join('/');
    for (const [pattern, to] of APP_RULES) {
        if (pattern.test(path)) return to(path);
    }
    return null;
}

/** Every file under a folder, as `/`-separated paths relative to it. */
function walk(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(path).map((p) => `${entry.name}/${p}`));
        else if (entry.isFile()) out.push(entry.name);
    }
    return out;
}

/**
 * Every served file and where it comes from:
 * Map(servedPath, { from: 'core' | 'app', file }), plus the app files that are
 * not site files (`ignored`), for a warning.
 */
export function siteSources(root = process.cwd()) {
    const sources = new Map();
    for (const path of walk(resolve(root, CORE_PUBLIC))) {
        sources.set(path, { from: 'core', file: resolve(root, CORE_PUBLIC, path) });
    }
    const ignored = [];
    for (const path of walk(resolve(root, APP_SITE))) {
        if (QUIET.test(path)) continue;
        const served = servedPath(path);
        if (!served) {
            ignored.push(`${APP_SITE}/${path}`);
            continue;
        }
        sources.set(served, { from: 'app', file: resolve(root, APP_SITE, path), core: sources.get(served)?.file });
    }
    return { sources, ignored };
}

function readJson(file) {
    try {
        const value = JSON.parse(readFileSync(file, 'utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (error) {
        throw new Error(`${file} is not valid JSON: ${error.message}`);
    }
    throw new Error(`${file} must hold one object of "key": "text" pairs.`);
}

const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

/**
 * What the assembled folder holds: Map(servedPath, { file } | { content }),
 * the manifest, and the ignored app files.
 */
export function siteContents(root = process.cwd()) {
    const { sources, ignored } = siteSources(root);
    const contents = new Map();
    for (const [path, source] of sources) {
        // Strings: the app's keys over core's, so core keeps adding keys the app has not touched.
        if (source.from === 'app' && source.core && /^_site\/strings\/[^/]+\.json$/.test(path)) {
            const merged = { ...readJson(source.core), ...readJson(source.file) };
            contents.set(path, { from: 'app', content: `${JSON.stringify(merged, null, 2)}\n` });
        } else {
            if (source.from === 'app' && path.startsWith('_site/strings/')) readJson(source.file);
            contents.set(path, { from: source.from, file: source.file });
        }
    }
    versionCssUrls(contents);
    const manifest = buildManifest(contents);
    contents.set(MANIFEST_PATH, { from: 'core', content: `${JSON.stringify(manifest, null, 2)}\n` });
    return { contents, manifest, ignored };
}

function contentOf(entry) {
    return entry.content !== undefined ? Buffer.from(entry.content) : readFileSync(entry.file);
}

/** `url(...)` in CSS, with or without quotes. */
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * Adds `?v={hash}` to each url() in the app's own stylesheets (site.css and the
 * .css files in src/custom/site/assets/) that points at a file the site serves,
 * absolute (/site/hero.webp) or relative to the stylesheet (hero.webp). Browsers
 * keep images and fonts for a year, so a changed one reaches returning visitors
 * only under a new address. Pages version their own links (shared/site-urls.ts);
 * a stylesheet is a file, so it is done here, when the site is assembled.
 */
function versionCssUrls(contents) {
    for (const [path, entry] of contents) {
        if (entry.from !== 'app' || !path.endsWith('.css')) continue;
        const css = contentOf(entry).toString('utf8');
        const dir = path.slice(0, path.lastIndexOf('/') + 1);
        const rewritten = css.replace(CSS_URL, (match, quote, url) => {
            if (/^(data:|https?:|\/\/|#)/.test(url) || url.includes('?')) return match;
            const [target, fragment] = url.split('#');
            const served = target.startsWith('/') ? target.slice(1) : normalisePath(dir + target);
            const file = contents.get(served);
            if (!file || served.endsWith('.css')) return match;
            return `url(${quote}${target}?v=${hash(contentOf(file))}${fragment !== undefined ? `#${fragment}` : ''}${quote})`;
        });
        if (rewritten !== css) contents.set(path, { ...entry, content: rewritten, file: undefined });
    }
}

/** `a/b/../c.png` as `a/c.png`. */
function normalisePath(path) {
    const out = [];
    for (const part of path.split('/')) {
        if (part === '..') out.pop();
        else if (part && part !== '.') out.push(part);
    }
    return out.join('/');
}

/**
 * What the site has, for the SPA, the publish functions and the admin:
 *
 *   home       languages with a home page file: { default: 'app', hi: 'app' }
 *   templates  each folder's files and where each comes from: { articles: { detail: 'app', list: 'core' } }
 *   pages      static pages: { 'privacy-policy': 'core', terms: 'app' }
 *   strings    languages with a strings file
 *   files      a hash of every /_site file, every /site file (the app's own
 *              assets) and the site stylesheets, to tell whether two copies of the
 *              site are the same, and to version links (shared/site-urls.ts)
 */
export function buildManifest(contents) {
    const manifest = { version: 1, home: {}, templates: {}, pages: {}, strings: [], files: {} };
    for (const [path, entry] of [...contents].sort(([a], [b]) => a.localeCompare(b))) {
        let m;
        if ((m = /^_site\/home(?:\.([^.]+))?\.html$/.exec(path))) manifest.home[m[1] ?? 'default'] = entry.from;
        else if ((m = /^_site\/templates\/([^/]+)\/([^/]+)\.html$/.exec(path)) && TEMPLATE_FILES.includes(m[2])) {
            (manifest.templates[m[1]] ??= {})[m[2]] = entry.from;
        } else if ((m = /^_site\/pages\/([^/]+)\.html$/.exec(path))) manifest.pages[m[1]] = entry.from;
        else if ((m = /^_site\/strings\/([^/]+)\.json$/.exec(path))) manifest.strings.push(m[1]);
        if (path.startsWith('_site/') || path.startsWith('site/') || VERSIONED.includes(path)) manifest.files[path] = hash(contentOf(entry));
    }
    return manifest;
}

/** Writes a file only when it differs; returns whether it wrote. */
function place(target, entry) {
    if (entry.content !== undefined) {
        if (existsSync(target) && readFileSync(target, 'utf8') === entry.content) return false;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.content);
        return true;
    }
    const from = statSync(entry.file);
    if (existsSync(target)) {
        const to = statSync(target);
        // The copy carries the source's time, give or take float rounding.
        if (to.size === from.size && Math.abs(to.mtimeMs - from.mtimeMs) < 2) return false;
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(entry.file, target);
    utimesSync(target, from.atime, from.mtime);
    return true;
}

function removeEmptyDirs(dir, keep) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name), false);
    }
    if (!keep && readdirSync(dir).length === 0) rmdirSync(dir);
}

/**
 * Assembles the served folder (SITE_OUT under root, or `outDir`): copies what
 * changed, writes the merged strings and the manifest, removes what is gone.
 * Returns { dir, manifest, ignored, changed } (changed: served paths written or removed).
 */
export function assembleSite(root = process.cwd(), outDir = resolve(root, SITE_OUT)) {
    const { contents, manifest, ignored } = siteContents(root);
    const changed = [];
    for (const [path, entry] of contents) {
        if (place(join(outDir, path), entry)) changed.push(path);
    }
    for (const path of walk(outDir)) {
        if (!contents.has(path)) {
            unlinkSync(join(outDir, path));
            changed.push(path);
        }
    }
    if (existsSync(outDir)) removeEmptyDirs(outDir, true);
    return { dir: outDir, manifest, ignored, changed };
}

/** The served file's text, or '' when the site has no such file. */
export function readSiteFile(root, path) {
    const entry = siteContents(root).contents.get(path);
    return entry ? contentOf(entry).toString('utf8') : '';
}

/**
 * The `virtual:arc-site` module the browser app imports: the header, footer and
 * sign-in panel HTML, bundled so they are on screen with the first paint, and
 * the manifest.
 */
export function siteModule(root = process.cwd()) {
    const { contents, manifest } = siteContents(root);
    const text = (path) => (contents.has(path) ? contentOf(contents.get(path)).toString('utf8') : '');
    return [
        `export const header = ${JSON.stringify(text('_site/header.html'))};`,
        `export const footer = ${JSON.stringify(text('_site/footer.html'))};`,
        `export const signIn = ${JSON.stringify(text('_site/sign-in.html'))};`,
        `export const manifest = ${JSON.stringify(manifest)};`,
        '',
    ].join('\n');
}

/** Whether a path is one of the site's sources (a change there re-assembles). */
export function isSiteSource(root, file) {
    const rel = relative(root, file).split(sep).join('/');
    return rel.startsWith(`${CORE_PUBLIC}/`) || rel.startsWith(`${APP_SITE}/`);
}
