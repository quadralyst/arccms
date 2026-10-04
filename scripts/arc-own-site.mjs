#!/usr/bin/env node
/**
 * `npm run arc:own-site`: move an app's website out of Arc CMS's files and into
 * its own, src/custom/site/ (specs/own-website-spec.md section 9,
 * docs/website/move-your-site.html).
 *
 * Before Arc CMS gave an app its own website folder, an app changed the site by
 * editing core files in public/: the home page (public/index.html and
 * public/i18n/{lang}/index.html, Angular templates), the header and footer
 * (public/_partials/), templates, static pages, main.css, the favicon. This
 * finds those edits and the files the app added, by comparing the app's last
 * commit in that layout with the Arc CMS version it was based on, and:
 *
 *   - writes each to its place in src/custom/site/ (the home page turned into a
 *     whole HTML document, a strings file reduced to the app's own keys, files
 *     the app added moved to src/custom/site/assets/ with links to them updated),
 *   - puts every file in public/ back as Arc CMS has it (the upstream branch).
 *
 * It reads the app's files from git, so it works in the middle of merging the
 * newer Arc CMS (conflicts in public/ included) and after it. A file the merge already moved to public/_site/ with the app's edit in it
 * is taken from the working copy, where it also has Arc CMS's newer changes.
 *
 * Without --write it prints the plan and changes nothing.
 *
 *   npm run arc:own-site                      the plan
 *   npm run arc:own-site -- --write           do it
 *   npm run arc:own-site -- --from <commit>   the app's commit in the old layout
 *                                             (default: the newest one on this branch)
 *   npm run arc:own-site -- --against upstream/dev
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARC_CMS_REPO, followedUpstream, isArcCmsRepository } from './check-core.mjs';
import { APP_SITE, servedPath } from './arc-site.mjs';

/** A file only the old layout has: a commit with it is in the old layout. */
export const OLD_LAYOUT_MARKER = 'public/_partials/_header.html';

const LANG = '[a-z]{2,3}(?:-[a-z0-9]{2,8})?';

// ─── Where each old file goes ──────────────────────────────────────────────

/**
 * What to do with a file under public/ that the app changed or added:
 *   { kind: 'home', to, lang }      the old home page, converted
 *   { kind: 'strings', to }         a strings file, reduced to the app's keys
 *   { kind: 'copy', to }            a site file, as it is
 *   { kind: 'main-css' }            the app's main.css: becomes site.css
 *   { kind: 'asset', to, url, from } a file the app added, served at a new address
 *   { kind: 'ignore', why }         nothing to move
 *   { kind: 'report', why }         an edit to a core file with no place in the site folder
 * `added` says whether Arc CMS has the file at all.
 */
export function placeFor(path, added) {
    const site = (p) => `${APP_SITE}/${p}`;
    let m;
    if (path === 'public/index.html') return { kind: 'home', to: site('home.html'), lang: '' };
    if ((m = new RegExp(`^public/i18n/(${LANG})/index\\.html$`).exec(path))) return { kind: 'home', to: site(`home.${m[1]}.html`), lang: m[1] };
    if ((m = new RegExp(`^public/i18n/(${LANG})/strings\\.json$`).exec(path))) return { kind: 'strings', to: site(`strings/${m[1]}.json`) };
    if (path === 'public/i18n/README.md' || path === 'public/.gitkeep') return { kind: 'ignore', why: 'not needed any more' };
    if (path === 'public/templates/templates.json') return { kind: 'ignore', why: 'template folders are found by name now' };
    if ((m = /^public\/_partials\/_(header|footer)\.html$/.exec(path))) return { kind: 'copy', to: site(`${m[1]}.html`) };
    if ((m = /^public\/(pages\/[^/]+\.html)$/.exec(path))) return { kind: 'copy', to: site(m[1]) };
    if ((m = /^public\/(templates\/[^/]+\/(?:partials|list|detail)\.html)$/.exec(path))) return { kind: 'copy', to: site(m[1]) };
    if (path === 'public/assets/css/main.css') return { kind: 'main-css' };
    if ((m = /^public\/(favicon\.ico|403\.html|404\.html)$/.exec(path))) return { kind: 'copy', to: site(m[1]) };
    // The new layout, where a merge carried the app's edit: the same name in the site folder.
    if ((m = /^public\/_site\/(.+)$/.exec(path))) {
        const rest = m[1];
        if (servedPath(rest) === `_site/${rest}`) {
            return /^strings\//.test(rest) ? { kind: 'strings', to: site(rest) } : { kind: 'copy', to: site(rest) };
        }
        if (rest === 'site.json') return { kind: 'ignore', why: 'written by the build' };
    }
    if (added) {
        // A file the app added (an image, a script): it moves, and so does its address.
        const rest = path.slice('public/'.length);
        const inAssets = rest.startsWith('assets/') ? rest.slice('assets/'.length) : rest;
        return { kind: 'asset', to: site(`assets/${inAssets}`), url: `/site/${inAssets}`, from: `/${rest}` };
    }
    return { kind: 'report', why: 'an Arc CMS file the app edited; the site folder cannot replace it' };
}

// ─── Turning the old home page into a page ────────────────────────────────

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Angular template syntax the conversion cannot turn into plain HTML. */
const LEFTOVER = /\{\{|\s\([a-zA-Z.]+\)=|\s\*ng[A-Z]|@(if|for|switch|defer)\s*[({]|\s\[[a-zA-Z.]+\]=|<ng-(container|template|content)/;

/**
 * The old home page's Angular template as plain HTML: literal inputs become
 * attributes (`[contentType]="'articles'"` is `content-type="articles"`), `ngSrc`
 * is `src`, and `assets/...` is `/assets/...` (the page is also served at /hi/).
 * Returns the HTML and the lines still holding Angular syntax, to fix by hand.
 */
export function convertAngular(html) {
    const out = html
        .replace(/\[([a-zA-Z]+)\]="'([^'"]*)'"/g, (_, name, value) => `${kebab(name)}="${value}"`)
        .replace(/\[([a-zA-Z]+)\]="(\d+(?:\.\d+)?|true|false)"/g, (_, name, value) => `${kebab(name)}="${value}"`)
        .replace(/\bngSrc=/g, 'src=')
        .replace(/\b(src|href)="assets\//g, '$1="/assets/');
    const leftovers = out.split('\n')
        .map((text, i) => ({ line: i + 1, text: text.trim() }))
        .filter(({ text }) => LEFTOVER.test(` ${text}`));
    return { html: out, leftovers };
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** The `<title>` and description of an HTML document (the old app shell, index.html). */
export function headOf(html) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html ?? '')?.[1]?.trim() ?? '';
    const description = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html ?? '')?.[1]?.trim() ?? '';
    return { title, description };
}

/** The title and description a language's old home component set (home.{lang}.component.ts). */
export function headOfComponent(ts) {
    const pick = (name) => new RegExp(`${name}\\s*=\\s*\\n?\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(ts ?? '')?.[2] ?? '';
    return { title: pick('pageTitle'), description: pick('pageDescription') };
}

/** A body fragment as a whole HTML document. */
export function wrapDocument(body, { lang = 'en', title = '', description = '', stylesheets = [] } = {}) {
    const head = [
        '    <meta charset="utf-8">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1">',
        `    <title>${escapeHtml(title)}</title>`,
        ...(description ? [`    <meta name="description" content="${escapeHtml(description)}">`] : []),
        ...stylesheets.map((href) => `    <link rel="stylesheet" href="${escapeHtml(href)}">`),
    ];
    return `<!doctype html>\n<html lang="${lang}">\n<head>\n${head.join('\n')}\n</head>\n<body>\n${body.trim()}\n</body>\n</html>\n`;
}

/** The app's own keys: added, or worded differently from Arc CMS's file. */
export function ownStrings(app, core) {
    return Object.fromEntries(Object.entries(app ?? {}).filter(([key, value]) => core?.[key] !== value));
}

/** Points links to moved files at their new addresses. */
export function rewriteUrls(text, moves) {
    let out = text;
    for (const { from, url } of moves) {
        const bare = from.slice(1);
        out = out.split(`"${from}"`).join(`"${url}"`).split(`'${from}'`).join(`'${url}'`).split(`(${from})`).join(`(${url})`)
            .split(`"${bare}"`).join(`"${url}"`).split(`(${bare})`).join(`(${url})`);
    }
    return out;
}

// ─── Git ───────────────────────────────────────────────────────────────────

function git(args, cwd, encoding = 'utf8') {
    const out = execFileSync('git', args, { cwd, encoding: encoding === 'buffer' ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
    return encoding === 'buffer' ? out : out.trim();
}

function tryGit(args, cwd, encoding) {
    try {
        return git(args, cwd, encoding);
    } catch {
        return null;
    }
}

const short = (ref) => (/^[0-9a-f]{40}$/.test(ref ?? '') ? ref.slice(0, 8) : ref);

const lines = (text) => (text ? text.split('\n').filter(Boolean) : []);

/** Files under a folder at a commit. */
const filesAt = (ref, folder, cwd) => lines(tryGit(['ls-tree', '-r', '--name-only', ref, '--', folder], cwd));

/** A file's bytes at a commit, or null. */
const readAt = (ref, path, cwd) => tryGit(['show', `${ref}:${path}`], cwd, 'buffer');

const hasFile = (ref, path, cwd) => tryGit(['cat-file', '-e', `${ref}:${path}`], cwd) !== null;

/**
 * The app's newest commit in the old layout: HEAD while a merge is under way
 * (or before it), else the first commit back along this branch that has the
 * old header file. Null when there is none.
 */
export function oldLayoutCommit(cwd) {
    if (hasFile('HEAD', OLD_LAYOUT_MARKER, cwd)) return 'HEAD';
    for (const commit of lines(tryGit(['rev-list', '--first-parent', '--max-count=500', 'HEAD'], cwd))) {
        if (hasFile(commit, OLD_LAYOUT_MARKER, cwd)) return commit;
    }
    return null;
}

/** Files in the working copy under a folder: tracked (conflicted ones once) and new. */
function workingFiles(folder, cwd) {
    const tracked = lines(tryGit(['ls-files', '--', folder], cwd));
    const untracked = lines(tryGit(['ls-files', '--others', '--exclude-standard', '--', folder], cwd));
    return [...new Set([...tracked, ...untracked])].filter((p) => existsSync(join(cwd, p)));
}

// ─── The plan ──────────────────────────────────────────────────────────────

const same = (a, b) => !!a && !!b && Buffer.compare(a, b) === 0;
const json = (buffer) => {
    try {
        return JSON.parse(buffer.toString('utf8'));
    } catch {
        return null;
    }
};

/**
 * The Arc CMS version the working copy is on: the one being merged during a
 * merge, else the newest upstream commit already merged.
 */
export function currentArcCms(upstream, cwd) {
    return tryGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], cwd) ?? tryGit(['merge-base', 'HEAD', upstream], cwd);
}

/**
 * What to move, restore and report. Reads only; `writeMigration` carries it out.
 * { from, base, target, moves: [{ path, source, to, kind, content, note }], restore, remove, report, leftovers }
 */
export function planMigration({ cwd = process.cwd(), from, against } = {}) {
    const upstream = against ?? followedUpstream(cwd);
    if (!upstream) return { error: 'no-upstream' };
    const target = currentArcCms(upstream, cwd);
    if (!target) return { error: 'no-base', upstream, app: 'HEAD' };
    if (!hasFile(target, 'public/_site/header.html', cwd)) return { error: 'not-merged', upstream };
    const app = from ?? oldLayoutCommit(cwd);
    const base = app ? tryGit(['merge-base', app, target], cwd) : null;
    if (app && !base) return { error: 'no-base', upstream, app };

    const targetFiles = new Set(filesAt(target, 'public', cwd));
    const candidates = new Map(); // target path (or 'main-css') -> { path, source, place, data }
    const reported = new Map();
    const addCandidate = (path, source, data, place) => {
        if (place.kind === 'ignore') return;
        if (place.kind === 'report') {
            reported.set(path, place.why);
            return;
        }
        const key = place.to ?? place.kind;
        // The working copy wins: a merged file has the app's edit and Arc CMS's newer ones.
        if (candidates.has(key) && source !== 'working copy') return;
        candidates.set(key, { path, source, place, data });
    };

    // 1. The app's edits and additions in the old layout, from its commit.
    if (app && base) {
        const baseFiles = new Set(filesAt(base, 'public', cwd));
        for (const path of filesAt(app, 'public', cwd)) {
            const data = readAt(app, path, cwd);
            const core = baseFiles.has(path) ? readAt(base, path, cwd) : null;
            if (same(data, core)) continue;
            addCandidate(path, app === 'HEAD' ? 'HEAD' : short(app), data, placeFor(path, !core));
        }
    }

    // 2. The working copy against the Arc CMS it is on: edits a merge carried into
    //    public/_site/, files added since that commit, and what to put back.
    const restore = [];
    const remove = [];
    const oldLayoutPaths = app ? new Set(filesAt(app, 'public', cwd)) : new Set();
    for (const path of workingFiles('public', cwd)) {
        const data = readFileSync(join(cwd, path));
        const core = targetFiles.has(path) ? readAt(target, path, cwd) : null;
        if (same(data, core)) continue;
        if (core) restore.push(path);
        else remove.push(path);
        // Old-layout files (left by the merge) were read from the commit; a conflict has markers.
        if (oldLayoutPaths.has(path) || data.includes('<<<<<<<')) continue;
        addCandidate(path, 'working copy', data, placeFor(path, !core));
    }
    for (const path of targetFiles) {
        if (!existsSync(join(cwd, path)) && !restore.includes(path)) restore.push(path);
    }
    const report = [...reported].map(([path, why]) => ({ path, why }));

    // Contents: converted, reduced, with links to moved files updated.
    const assetMoves = [...candidates.values()].filter((c) => c.place.kind === 'asset').map((c) => c.place);
    const mainCss = candidates.get('main-css');
    const homes = [...candidates.values()].filter((c) => c.place.kind === 'home');
    const moves = [];
    const leftovers = [];
    const shell = headOf(app ? readAt(app, 'index.html', cwd)?.toString('utf8') : '');
    for (const candidate of candidates.values()) {
        const { place, data } = candidate;
        let content = data;
        let note = '';
        if (place.kind === 'home') {
            const { html, leftovers: left } = convertAngular(rewriteUrls(data.toString('utf8'), assetMoves));
            const component = place.lang ? readAt(app ?? 'HEAD', `src/app/pages/home-i18n/home.${place.lang}.component.ts`, cwd) : null;
            const head = component ? headOfComponent(component.toString('utf8')) : shell;
            const isDocument = /<html[\s>]/i.test(html);
            content = Buffer.from(isDocument ? html : wrapDocument(html, {
                lang: place.lang || 'en',
                title: head.title || shell.title,
                description: head.description || shell.description,
                stylesheets: mainCss ? [] : ['/site/home.css'],
            }));
            for (const l of left) leftovers.push({ file: place.to, ...l });
            note = left.length ? `converted from Angular; ${left.length} line(s) to check` : 'converted from Angular';
        } else if (place.kind === 'strings') {
            const core = candidate.source === 'working copy' || !base
                ? readAt(target, candidate.path, cwd)
                : readAt(base, candidate.path, cwd);
            const own = ownStrings(json(data), core ? json(core) : {});
            content = Buffer.from(`${JSON.stringify(own, null, 2)}\n`);
            note = `${Object.keys(own).length} key(s) of the app's own`;
        } else if (place.kind === 'main-css') {
            place.to = `${APP_SITE}/site.css`;
            content = Buffer.from(rewriteUrls(data.toString('utf8'), assetMoves));
            note = 'the whole file, loaded after Arc CMS\'s main.css';
        } else if (place.kind === 'copy' && /\.html$/.test(place.to)) {
            content = Buffer.from(rewriteUrls(data.toString('utf8'), assetMoves));
        } else if (place.kind === 'asset') {
            note = `now at ${place.url}`;
        }
        moves.push({ path: candidate.path, source: candidate.source, to: place.to, kind: place.kind, content, note });
    }
    // The old home page was styled by the old main.css, which Arc CMS no longer ships.
    if (homes.length && !mainCss && base) {
        const oldCss = readAt(base, 'public/assets/css/main.css', cwd);
        if (oldCss) moves.push({ path: 'public/assets/css/main.css', source: short(base), to: `${APP_SITE}/assets/home.css`, kind: 'copy', content: oldCss, note: 'the old main.css the home page was styled with, at /site/home.css' });
    }
    moves.sort((a, b) => a.to.localeCompare(b.to));

    // Old pieces of the home page outside public/, for the person to delete.
    for (const path of workingFiles('src/app/pages/home-i18n', cwd)) {
        report.push({ path, why: 'the old home page for one language: delete it, and its route in src/app/app.routes.ts' });
    }

    return { from: app, base, target, upstream, moves, restore: restore.sort(), remove: remove.sort(), report, leftovers };
}

// ─── Doing it ──────────────────────────────────────────────────────────────

/** Writes the moved files and puts public/ back as Arc CMS has it. Returns what it skipped. */
export function writeMigration(plan, cwd = process.cwd()) {
    const skipped = [];
    for (const move of plan.moves) {
        const target = join(cwd, move.to);
        if (existsSync(target)) {
            if (!same(readFileSync(target), move.content)) skipped.push(move.to);
            continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, move.content);
    }
    if (plan.restore.length) git(['checkout', plan.target, '--', ...plan.restore], cwd);
    for (const path of plan.remove) {
        if (tryGit(['rm', '-q', '-f', '--', path], cwd) === null) rmSync(join(cwd, path), { force: true });
    }
    return { skipped };
}

// ─── The command ───────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2), log = console.log, cwd = process.cwd()) {
    const arg = (name) => {
        const i = argv.indexOf(name);
        return i === -1 ? undefined : argv[i + 1];
    };
    const write = argv.includes('--write');

    if (isArcCmsRepository(cwd)) {
        log('This is Arc CMS itself: its website files are core\'s own, so there is nothing to move.');
        return 0;
    }
    const plan = planMigration({ cwd, from: arg('--from'), against: arg('--against') });
    if (plan.error === 'no-upstream') {
        log('No upstream/main or upstream/dev to compare with. Add Arc CMS as the upstream remote once:');
        log(`  git remote add upstream ${ARC_CMS_REPO}`);
        log('  git fetch upstream');
        return 1;
    }
    if (plan.error === 'not-merged') {
        log(`This copy is still on an Arc CMS without a website folder of the app's own. Merge the newer one first:`);
        log(`  git merge ${plan.upstream}`);
        log('Conflicts in public/ are fine: run this again while they are open, and it settles them.');
        return 1;
    }
    if (plan.error === 'no-base') {
        log(`${plan.app} shares no history with ${plan.upstream}, so there is nothing to compare it with.`);
        return 1;
    }

    const nothing = !plan.moves.length && !plan.restore.length && !plan.remove.length && !plan.report.length;
    if (nothing) {
        log(`public/ is as Arc CMS has it (${short(plan.target)}), and there is nothing to move into ${APP_SITE}/.`);
        return 0;
    }
    if (plan.from) log(`Your site in the old layout: ${short(plan.from)}, based on Arc CMS ${short(plan.base)}. Arc CMS now: ${short(plan.target)} (${plan.upstream}).`);
    else log(`No commit of yours has the old layout (${OLD_LAYOUT_MARKER}); comparing the working copy with Arc CMS ${short(plan.target)}.`);

    if (plan.moves.length) {
        log(`\nInto ${APP_SITE}/:`);
        const width = Math.min(48, Math.max(...plan.moves.map((m) => m.path.length)));
        for (const m of plan.moves) log(`  ${m.path.padEnd(width)}  ->  ${m.to}${m.note ? `  (${m.note})` : ''}`);
    }
    if (plan.restore.length || plan.remove.length) {
        log(`\nBack to Arc CMS's own in public/: ${plan.restore.length} file(s) restored, ${plan.remove.length} removed.`);
    }
    if (plan.report.length || plan.leftovers.length) {
        log('\nCheck by hand:');
        for (const r of plan.report) log(`  ${r.path}: ${r.why}`);
        for (const l of plan.leftovers) log(`  ${l.file}:${l.line}  ${l.text.slice(0, 100)}`);
    }

    if (!write) {
        log('\nNothing was changed. Run it again with --write to do this:');
        log('  npm run arc:own-site -- --write');
        return 0;
    }
    const { skipped } = writeMigration(plan, cwd);
    for (const path of skipped) log(`  Not overwritten (it exists and differs): ${path}`);
    log(`\nDone. Next:
  1. Open the site with npm run dev and compare it with the live one; fix what "Check by hand" lists.
  2. npm run check:core, then commit.
  3. Old template overrides in the database are no longer read: Content, Templates shows the files now.
  4. Deploy the functions and the website together, then republish every page:
       npm run deploy
       npm run seed:prod`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main();
}
