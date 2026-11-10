#!/usr/bin/env node
/**
 * Combine Arc CMS's security rules and indexes with an app's own (docs/app/rules-and-indexes.html).
 *
 * An app built on Arc CMS shares its database and bucket, and Firebase takes one
 * rules file per database and per bucket. So the app keeps its rules in files of
 * its own, and this writes the combined files Firebase deploys:
 *
 *   firestore.rules  + firestore.app.rules          -> .arc-build/firestore.rules
 *   storage.rules    + storage.app.rules            -> .arc-build/storage.rules
 *   firestore.indexes.json + firestore.app.indexes.json -> .arc-build/firestore.indexes.json
 *
 * The app files are optional. App rules go where the core file has the line
 * `// @arc-app-rules`, inside the same scope, so they can call the core helpers
 * (isSignedIn, isAdmin, isEditor, ownsUserRecord, signedInByApp). firebase.json runs this as the
 * Firestore and Storage `predeploy`, so every deploy builds first; `npm run
 * rules:build` runs it by hand, and `npm run test:rules` tests the result.
 *
 *   node scripts/arc-rules-build.mjs
 *   node scripts/arc-rules-build.mjs --split-indexes <live.json>
 *     Writes firestore.indexes.json from an export of the live indexes, minus the
 *     app's own, so `npm run export-indexes` never copies app indexes into the core file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_DIR = '.arc-build';
export const MARKER = '// @arc-app-rules';

export const RULES_FILES = [
    { core: 'firestore.rules', app: 'firestore.app.rules', out: `${BUILD_DIR}/firestore.rules` },
    { core: 'storage.rules', app: 'storage.app.rules', out: `${BUILD_DIR}/storage.rules` },
];
export const INDEX_FILES = { core: 'firestore.indexes.json', app: 'firestore.app.indexes.json', out: `${BUILD_DIR}/firestore.indexes.json` };

/**
 * Core collections an app may still add its own rules on, because the docs say how
 * (docs/app/merchant-payments.html): a read for whoever owns a merchant account.
 */
export const APP_EXTENDABLE_COLLECTIONS = ['MerchantAccounts', 'MerchantPayments'];

/**
 * Storage folders core serves through its catch-all rule, so they never appear by
 * name in storage.rules: the media library's images.
 */
const CORE_STORAGE_FOLDERS = ['mediaImages'];

/** The text with comments and quoted strings blanked out, keeping every line where it was. */
function blankCommentsAndStrings(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (c === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
            out += i < text.length ? '\n' : '';
        } else if (c === '/' && next === '*') {
            out += '  ';
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
            out += '  ';
            i++;
        } else if (c === "'" || c === '"') {
            out += ' ';
            i++;
            while (i < text.length && text[i] !== c && text[i] !== '\n') { out += ' '; if (text[i] === '\\') { out += ' '; i++; } i++; }
            out += ' ';
        } else {
            out += c;
        }
    }
    return out;
}

/** Line number (1-based) of a position in a text. */
function lineAt(text, at) {
    return text.slice(0, at).split('\n').length;
}

/**
 * The match blocks of a rules text, with their full path from the text's own top
 * (nested paths joined) and whether the block itself grants anything (`allow`).
 * Throws on unbalanced braces, naming the line.
 */
export function parseRules(text, fileName = 'rules') {
    const clean = blankCommentsAndStrings(text);
    const stack = [];
    const blocks = [];
    let i = 0;
    while (i < clean.length) {
        const c = clean[i];
        const match = /^match\s+\//.exec(clean.slice(i, i + 64));
        if (match && (i === 0 || !/[\w.]/.test(clean[i - 1]))) {
            let j = i + match[0].length - 1;
            let path = '';
            while (j < clean.length) {
                const ch = clean[j];
                if (ch === '{' && path.endsWith('/')) {
                    const close = clean.indexOf('}', j);
                    if (close === -1) break;
                    path += clean.slice(j, close + 1);
                    j = close + 1;
                } else if (/\s|\{/.test(ch)) {
                    break;
                } else {
                    path += ch;
                    j++;
                }
            }
            while (j < clean.length && /\s/.test(clean[j])) j++;
            if (clean[j] !== '{') throw new Error(`${fileName} line ${lineAt(text, i)}: "match ${path}" has no "{" after it.`);
            const parent = [...stack].reverse().find((frame) => frame);
            const segments = [...(parent ? parent.segments : []), ...path.split('/').filter(Boolean)];
            const block = { path: segments.join('/'), segments, line: lineAt(text, i), grants: false };
            blocks.push(block);
            stack.push(block);
            i = j + 1;
            continue;
        }
        if (c === '{') {
            stack.push(null);
        } else if (c === '}') {
            if (!stack.length) throw new Error(`${fileName} line ${lineAt(text, i)}: a "}" closes nothing. Check the braces above it.`);
            stack.pop();
        } else if (/^allow\b/.test(clean.slice(i, i + 6)) && (i === 0 || !/[\w.]/.test(clean[i - 1]))) {
            const frame = stack[stack.length - 1];
            if (frame) frame.grants = true;
        }
        i++;
    }
    if (stack.length) {
        const open = [...stack].reverse().find((frame) => frame);
        throw new Error(`${fileName}: a "{" is never closed${open ? ` (inside "match /${open.path}" at line ${open.line})` : ''}. Add the missing "}".`);
    }
    return blocks;
}

const isWildcard = (segment) => /^\{.*\}$/.test(segment);
const isRecursive = (segment) => /^\{[^}]*=\*\*\}$/.test(segment);

/** Paths below the scope app rules go into: `databases/{database}/documents` or `b/{bucket}/o`. */
function scopePaths(core, storage) {
    const head = storage ? 'b' : 'databases';
    return parseRules(core, storage ? 'storage.rules' : 'firestore.rules')
        .filter((block) => block.segments[0] === head && block.segments.length > 3)
        .map((block) => ({ ...block, segments: block.segments.slice(3) }));
}

/** A Storage path under an upload folder (`{prefix}/users/...`) without the folder. */
function withoutUploadFolder(segments) {
    return segments.length > 1 && isWildcard(segments[0]) && !isRecursive(segments[0]) && !isWildcard(segments[1])
        ? segments.slice(1)
        : segments;
}

/**
 * What the core rules file says app rules must leave alone: the collections (or
 * Storage folders) it names, the prefixes its catch-all serves (`arc_`, `Tags_`),
 * and the folders it uses under a member's `users/{id}`. `anyNames` is every name
 * core uses at any depth (its subcollections too), which a collection-group rule
 * (`/{path=**}/name/{id}`) must not use.
 */
export function coreNames(core) {
    const storage = /service\s+firebase\.storage/.test(core);
    const names = new Set(storage ? CORE_STORAGE_FOLDERS : []);
    const anyNames = new Set(names);
    const userFolders = new Set();
    for (const block of scopePaths(core, storage)) {
        const segments = storage ? withoutUploadFolder(block.segments) : block.segments;
        if (!isWildcard(segments[0])) names.add(segments[0]);
        for (const segment of segments) if (!isWildcard(segment)) anyNames.add(segment);
        if (segments[0] === 'users' && segments.length > 2 && !isWildcard(segments[2])) userFolders.add(segments[2]);
    }
    const prefixes = [];
    for (const m of core.matchAll(/collection\.matches\('([A-Za-z0-9_-]+)\.\*'\)/g)) prefixes.push(m[1]);
    return { storage, names, anyNames, prefixes: [...new Set(prefixes)], userFolders };
}

/**
 * Refuse app rules that reach into core's paths (docs/app/rules-and-indexes.html):
 * a match at the top of the app file that is recursive, that matches every
 * collection, or that names a core collection or folder. Allowed: the app's own
 * collections and folders, its own subcollections or folders under
 * `users/{userDocId}/...` that core does not use, and APP_EXTENDABLE_COLLECTIONS.
 * In Firestore, a collection-group rule (`/{path=**}/progress/{id}`) is allowed
 * too, when the name after the recursive part is one core uses nowhere.
 * Only blocks that grant something (`allow`) are checked, by their full path.
 */
export function checkAppRules(core, app, appFileName = 'app rules') {
    if (!app || !app.trim()) return;
    const { storage, names, anyNames, prefixes, userFolders } = coreNames(core);
    const what = storage ? 'folder' : 'collection';
    const isCoreName = (name) => names.has(name) || anyNames.has(name) || userFolders.has(name)
        || prefixes.some((prefix) => name.startsWith(prefix));
    for (const block of parseRules(app, appFileName)) {
        if (!block.grants) continue;
        const at = `${appFileName} line ${block.line} (match /${block.path})`;
        const segments = storage ? withoutUploadFolder(block.segments) : block.segments;
        const [first, next] = segments;
        if (isRecursive(first)) {
            if (!storage && next && !isWildcard(next) && !isCoreName(next)) continue;
            if (!storage && next && !isWildcard(next)) {
                throw new Error(`${at} matches "${next}" at any depth, and core uses that name. Choose a name core does not use, such as /{path=**}/lessonProgress/{id}.`);
            }
            throw new Error(`${at} matches every path in the ${storage ? 'bucket' : 'database'}, core's too. Match your own ${what} by name, such as /lessons/{id}${storage ? '' : ', or a collection group, such as /{path=**}/progress/{id}'}.`);
        }
        if (isWildcard(first)) {
            throw new Error(`${at} matches every ${what}, core's too. Match your own ${what} by name, such as /lessons/{id}.`);
        }
        if (!storage && APP_EXTENDABLE_COLLECTIONS.includes(first)) continue;
        if (first === 'users') {
            const folder = segments[2];
            if (segments.length < 3) {
                throw new Error(`${at} grants on a member's record${storage ? ' folder' : ''}, which is core's. Put your data under it instead, such as /users/{userDocId}/lessons/{id}.`);
            }
            if (isWildcard(folder)) {
                throw new Error(`${at} matches every ${what} under a member's record, core's too. Name your own, such as /users/{userDocId}/lessons/{id}.`);
            }
            if (userFolders.has(folder)) {
                throw new Error(`${at} uses "${folder}" under a member's record, which core uses. Choose another name.`);
            }
            continue;
        }
        if (names.has(first) || prefixes.some((prefix) => first.startsWith(prefix))) {
            throw new Error(`${at} matches the core ${what} "${first}". Rules on core paths belong in Arc CMS, not in an app: use a ${what} of your own.`);
        }
    }
}

/**
 * The core rules with the app rules in place of the marker line, indented like
 * the marker. With no app rules the marker line stays as it is. Refuses app rules
 * that reach into core's paths or whose braces do not balance (checkAppRules).
 */
export function injectAppRules(core, app, appFileName = 'app rules') {
    const lines = core.split('\n');
    const at = lines.findIndex((line) => line.trim() === MARKER);
    if (at === -1) throw new Error(`The core rules have no "${MARKER}" line, so ${appFileName} has nowhere to go.`);
    if (!app || !app.trim()) return core;
    checkAppRules(core, app, appFileName);
    const indent = lines[at].slice(0, lines[at].indexOf(MARKER));
    const body = app.replace(/\s+$/, '').split('\n').map((line) => (line.trim() ? indent + line : ''));
    return [
        ...lines.slice(0, at),
        `${indent}// ---- ${appFileName} (added by scripts/arc-rules-build.mjs; edit that file, not this one) ----`,
        ...body,
        `${indent}// ---- end of ${appFileName} ----`,
        ...lines.slice(at + 1),
    ].join('\n');
}

/** A stable key for one composite index. */
function indexKey(index) {
    return JSON.stringify(index);
}

function overrideKey(override) {
    return `${override.collectionGroup}/${override.fieldPath}`;
}

/** Core indexes plus the app's, without duplicates. Refuses a field override both define differently. */
export function mergeIndexes(core, app) {
    if (!app) return core;
    const indexes = [...(core.indexes ?? [])];
    const seen = new Set(indexes.map(indexKey));
    for (const index of app.indexes ?? []) {
        if (!seen.has(indexKey(index))) {
            indexes.push(index);
            seen.add(indexKey(index));
        }
    }
    const overrides = [...(core.fieldOverrides ?? [])];
    const byKey = new Map(overrides.map((o) => [overrideKey(o), o]));
    for (const override of app.fieldOverrides ?? []) {
        const existing = byKey.get(overrideKey(override));
        if (!existing) {
            overrides.push(override);
            byKey.set(overrideKey(override), override);
        } else if (JSON.stringify(existing) !== JSON.stringify(override)) {
            throw new Error(`Both core and app indexes set a field override for ${overrideKey(override)}. Keep it in one file.`);
        }
    }
    return { ...core, indexes, fieldOverrides: overrides };
}

/** A content type's list index, made when the site's list needs it (functions/src/content-types/contentListIndexes.ts). */
const SITE_CONTENT_LIST = /^arc_.+_drafts$/;

/** An index by what it is, without the `__name__` Firebase adds to a live export. */
function fieldsKey(index) {
    return indexKey({ ...index, fields: (index.fields ?? []).filter((field) => field.fieldPath !== '__name__') });
}

/**
 * Live indexes minus the app's own and the site's content lists: what belongs in the core
 * file. A content list index the core file already ships stays (`core`).
 */
export function subtractIndexes(live, app, core = null) {
    const appIndexes = new Set((app?.indexes ?? []).map(indexKey));
    const appOverrides = new Set((app?.fieldOverrides ?? []).map(overrideKey));
    const shipped = new Set((core?.indexes ?? []).map(fieldsKey));
    const isSites = (index) => SITE_CONTENT_LIST.test(index.collectionGroup) && !shipped.has(fieldsKey(index));
    return {
        ...live,
        indexes: (live.indexes ?? []).filter((index) => !appIndexes.has(indexKey(index)) && !isSites(index)),
        fieldOverrides: (live.fieldOverrides ?? []).filter((o) => !appOverrides.has(overrideKey(o))),
    };
}

function readOptional(root, file) {
    const path = resolve(root, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function write(root, file, content) {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
}

/** Build every combined file. Returns what went into each, for the log. */
export function build(root = ROOT) {
    const report = [];
    for (const { core, app, out } of RULES_FILES) {
        const appRules = readOptional(root, app);
        write(root, out, injectAppRules(readFileSync(resolve(root, core), 'utf8'), appRules, app));
        report.push(`${out}: ${core}${appRules ? ` + ${app}` : ''}`);
    }
    const appIndexesText = readOptional(root, INDEX_FILES.app);
    const merged = mergeIndexes(
        JSON.parse(readFileSync(resolve(root, INDEX_FILES.core), 'utf8')),
        appIndexesText ? JSON.parse(appIndexesText) : null,
    );
    write(root, INDEX_FILES.out, `${JSON.stringify(merged, null, 2)}\n`);
    report.push(`${INDEX_FILES.out}: ${INDEX_FILES.core}${appIndexesText ? ` + ${INDEX_FILES.app}` : ''}`);
    return report;
}

/** `--split-indexes <live.json>`: rewrite the core index file from a live export. */
export function splitIndexes(liveFile, root = ROOT) {
    const live = JSON.parse(readFileSync(resolve(root, liveFile), 'utf8'));
    const appText = readOptional(root, INDEX_FILES.app);
    const coreText = readOptional(root, INDEX_FILES.core);
    const core = subtractIndexes(live, appText ? JSON.parse(appText) : null, coreText ? JSON.parse(coreText) : null);
    write(root, INDEX_FILES.core, `${JSON.stringify(core, null, 2)}\n`);
    return core;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const args = process.argv.slice(2);
        const split = args.indexOf('--split-indexes');
        if (split !== -1) {
            if (!args[split + 1]) throw new Error('--split-indexes needs the exported file.');
            splitIndexes(args[split + 1]);
            console.log(`Wrote ${INDEX_FILES.core} from ${args[split + 1]} (app indexes left in ${INDEX_FILES.app}).`);
        } else {
            for (const line of build()) console.log(`rules:build ${line}`);
        }
    } catch (err) {
        console.error(`rules:build failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
    }
}
