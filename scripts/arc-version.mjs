/**
 * The app's version and build number (docs/app/version.html, specs/app-version-spec.md),
 * such as "v1.2.0.25 android": `version` in custom/package.json, set by hand; `build`,
 * which every `npm run build` counts (scripts/arc-website-build.mjs); and `buildLabel`, any
 * text, or `--label=<text>` for one build.
 *
 * custom/package.json is the app's own file: Arc CMS never ships it. With no file, or no
 * `version` in it, there is no version anywhere and nothing is counted.
 *
 * vite.config.ts reads appVersion() and builds it into the site as APP_VERSION
 * (src/app/core/version/app-version.ts).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './arc-install-config.mjs';

/** Where the app's version lives, from the repo root. */
export const APP_PACKAGE = 'custom/package.json';
/** The longest build label (AV-D5). */
export const MAX_LABEL_LENGTH = 40;

const DOCS = 'docs/app/version.html';

/** Three whole numbers, then a pre-release or build suffix as npm allows: 1.2.0, 1.2.0-beta.1. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** custom/package.json's text and contents, or null when the app has none. A file that is not JSON stops here. */
export function readAppPackage(root = ROOT) {
    const path = resolve(root, APP_PACKAGE);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    let pkg;
    try {
        pkg = JSON.parse(text);
    } catch (error) {
        throw new Error(`${APP_PACKAGE} is not valid JSON: ${error.message} (${DOCS}).`);
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error(`${APP_PACKAGE} must hold a JSON object (${DOCS}).`);
    return { path, text, pkg };
}

/** The app's version, such as "1.2.0", or '' when it sets none. One that is not three whole numbers stops here. */
export function versionOf(pkg) {
    if (!pkg || pkg.version === undefined) return '';
    if (typeof pkg.version !== 'string' || !VERSION_PATTERN.test(pkg.version.trim())) {
        throw new Error(`${APP_PACKAGE}: "version" must be three whole numbers, such as "1.2.0", not ${JSON.stringify(pkg.version)} (${DOCS}).`);
    }
    return pkg.version.trim();
}

/** A build label, trimmed: any text up to 40 characters, with no control characters. '' for none. */
export function checkLabel(raw, from = '--label') {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') throw new Error(`${from} must be text, not ${JSON.stringify(raw)} (${DOCS}).`);
    const label = raw.trim();
    if (CONTROL_CHARACTERS.test(label)) throw new Error(`${from} has a control character (a line break or a tab); use plain text (${DOCS}).`);
    if (label.length > MAX_LABEL_LENGTH) throw new Error(`${from} is ${label.length} characters; keep it to ${MAX_LABEL_LENGTH} (${DOCS}).`);
    return label;
}

/**
 * The next build number, one more than `build` (AV-D3): missing or 0 makes 1, -1 makes 0,
 * a whole number below -1 counts as -1 (with a warning), and anything else stops here,
 * since starting again from 1 would reuse numbers that already went out.
 */
export function nextBuild(pkg) {
    const last = pkg?.build;
    if (last === undefined || last === null) return { build: 1, warning: '' };
    if (typeof last !== 'number' || !Number.isInteger(last)) {
        throw new Error(`${APP_PACKAGE}: "build" must be a whole number, such as 24, not ${JSON.stringify(last)}. Set it to the last build number, or 0 to start again from 1 (${DOCS}).`);
    }
    if (last < -1) return { build: 0, warning: `${APP_PACKAGE}: "build" is ${last}; the lowest is -1, so this build is 0.` };
    return { build: last + 1, warning: '' };
}

/** custom/package.json's text with `build` set, right after `version`, everything else as it was. */
export function withBuild(text, build) {
    const pkg = JSON.parse(text);
    const out = {};
    for (const [key, value] of Object.entries(pkg)) {
        if (key === 'build') continue;
        out[key] = value;
        if (key === 'version') out.build = build;
    }
    if (!('build' in out)) out.build = build;
    const indent = text.match(/^[{[]\r?\n([ \t]+)\S/)?.[1] ?? '  ';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return JSON.stringify(out, null, indent).replace(/\n/g, eol) + eol;
}

/**
 * The commit this build is made from, 8 characters, with "+changes" when files other than
 * custom/package.json are changed and not committed (AV-D7); '' outside a git checkout.
 */
export function buildCommit(root = ROOT, run = spawnSync) {
    const git = (args) => run('git', args, { cwd: root, encoding: 'utf8' });
    const head = git(['rev-parse', '--short=8', 'HEAD']);
    if (head.status !== 0 || !head.stdout?.trim()) return '';
    const status = git(['status', '--porcelain', '--', '.', `:(exclude)${APP_PACKAGE}`]);
    const changed = status.status === 0 && !!status.stdout?.trim();
    return `${head.stdout.trim()}${changed ? '+changes' : ''}`;
}

/** "v1.2.0.25 android", "v1.2.0" with no number, '' with no version (AV-D6). */
export function versionText({ version, build, label }) {
    if (!version) return '';
    const number = build === null || build === undefined ? '' : `.${build}`;
    return `v${version}${number}${label ? ` ${label}` : ''}`;
}

/** A build number handed to the build in VITE_ARC_BUILD: a whole number from 0, else none. */
export function buildFromEnv(value) {
    const n = String(value ?? '').trim();
    return /^(0|[1-9]\d*)$/.test(n) ? Number(n) : null;
}

/**
 * This build's version, as the site shows it (APP_VERSION): the version and default label
 * from custom/package.json, the number from VITE_ARC_BUILD (set by `npm run build`), the
 * label from ARC_BUILD_LABEL when set (even empty), and the commit.
 */
export function appVersion({ root = ROOT, env = process.env, run = spawnSync } = {}) {
    const found = readAppPackage(root);
    const version = versionOf(found?.pkg);
    if (!version) return { text: '', version: '', build: null, label: '', commit: '' };
    const label = env.ARC_BUILD_LABEL !== undefined
        ? checkLabel(env.ARC_BUILD_LABEL, 'ARC_BUILD_LABEL')
        : checkLabel(found.pkg.buildLabel, `${APP_PACKAGE}: "buildLabel"`);
    const build = buildFromEnv(env.VITE_ARC_BUILD);
    return { text: versionText({ version, build, label }), version, build, label, commit: buildCommit(root, run) };
}
