/**
 * The code files Arc CMS ships in the custom space (docs/app/custom-space.html), with
 * what each exports as shipped. An app fills them in; Arc CMS never edits them again.
 *
 * Read by:
 *   - the test setup (src/test/setup.ts, functions/src/__tests__/setup.ts): core specs
 *     see these shipped values, whatever an app puts in the files, so an app can run
 *     the whole suite. An app's own specs see its real files.
 *   - the docs checks (scripts/docs-checks.mjs): reference/config-keys.html lists these
 *     exports, and nothing else an app's custom code exports.
 *   - src/app/custom-space.spec.ts: in Arc CMS itself, the files are exactly these and
 *     export exactly these values.
 *
 * A new starter file is added here, and stubbed in the setup file of its side.
 */
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each starter file, from the repo root, and its exports as Arc CMS ships them. */
export const CUSTOM_STARTERS = [
    { file: 'src/custom/app-accounts.ts', exports: { CUSTOM_APP_ACCOUNTS: {} } },
    { file: 'src/custom/features.ts', exports: { CUSTOM_FEATURES: {} } },
    { file: 'src/custom/home.ts', exports: { CUSTOM_HOME: {} } },
    { file: 'src/custom/languages.ts', exports: { MEMBER_LANGUAGES: [] } },
    { file: 'src/custom/nav.ts', exports: { CUSTOM_NAV: [] } },
    { file: 'src/custom/pwa.ts', exports: { CUSTOM_PWA: {} } },
    { file: 'src/custom/routes.ts', exports: { CUSTOM_ROUTES: [] } },
    { file: 'src/custom/user-dashboard.ts', exports: { CUSTOM_USER_DASHBOARD: null } },
    { file: 'functions/src/custom/index.ts', exports: {} },
    { file: 'functions/src/custom/search-sources.ts', exports: { SEARCH_COLLECTIONS: [], CUSTOM_SEARCH_SOURCES: [] } },
];

/** The folders whose specs are the app's own, from the repo root. */
export const APP_SPEC_FOLDERS = ['src/custom/', 'functions/src/custom/', 'custom/'];

/** Whether a spec file (an absolute path) is the app's own rather than Arc CMS's. */
export function isAppSpec(testPath, repoRoot = REPO_ROOT) {
    if (!testPath) return false;
    const path = relative(repoRoot, testPath).split('\\').join('/');
    return APP_SPEC_FOLDERS.some((folder) => path.startsWith(folder));
}

/** A fresh copy of a starter file's shipped exports, for a test to change freely. */
export function starterExports(file) {
    const starter = CUSTOM_STARTERS.find((s) => s.file === file);
    if (!starter) throw new Error(`${file} is not a custom starter file (scripts/custom-starters.mjs)`);
    return structuredClone(starter.exports);
}

/**
 * What a spec sees for a starter file: the shipped exports in a core spec, the real
 * file in an app's own spec. `actual` loads the real file.
 */
export function starterFor(file, testPath, actual) {
    return isAppSpec(testPath) ? actual() : starterExports(file);
}
