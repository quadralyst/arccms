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
 * (isSignedIn, isAdmin, isEditor, ownsUserRecord). firebase.json runs this as the
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
 * The core rules with the app rules in place of the marker line, indented like
 * the marker. With no app rules the marker line stays as it is.
 */
export function injectAppRules(core, app, appFileName = 'app rules') {
    const lines = core.split('\n');
    const at = lines.findIndex((line) => line.trim() === MARKER);
    if (at === -1) throw new Error(`The core rules have no "${MARKER}" line, so ${appFileName} has nowhere to go.`);
    if (!app || !app.trim()) return core;
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

/** Live indexes minus the app's own: what belongs in the core file. */
export function subtractIndexes(live, app) {
    if (!app) return live;
    const appIndexes = new Set((app.indexes ?? []).map(indexKey));
    const appOverrides = new Set((app.fieldOverrides ?? []).map(overrideKey));
    return {
        ...live,
        indexes: (live.indexes ?? []).filter((index) => !appIndexes.has(indexKey(index))),
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
    const core = subtractIndexes(live, appText ? JSON.parse(appText) : null);
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
