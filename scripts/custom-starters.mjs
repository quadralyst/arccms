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
 *     export exactly these values, and every file of the custom space is still as
 *     SHIPPED_FILES records it.
 *
 * A new starter file is added here, and stubbed in the setup file of its side.
 */
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each starter file, from the repo root, and its exports as Arc CMS ships them. */
export const CUSTOM_STARTERS = [
    { file: 'src/custom/app-accounts.ts', exports: { CUSTOM_APP_ACCOUNTS: {} } },
    { file: 'src/custom/brand.ts', exports: { CUSTOM_BRAND: {} } },
    { file: 'src/custom/clock.ts', exports: { CUSTOM_CLOCK: {} } },
    { file: 'src/custom/features.ts', exports: { CUSTOM_FEATURES: {} } },
    { file: 'src/custom/home.ts', exports: { CUSTOM_HOME: {} } },
    { file: 'src/custom/languages.ts', exports: { MEMBER_LANGUAGES: [] } },
    // nav.ts shipped with CUSTOM_NAV_CHANGES before nav-changes.ts existed; core reads both.
    { file: 'src/custom/nav.ts', exports: { CUSTOM_NAV: [], CUSTOM_NAV_CHANGES: {} } },
    { file: 'src/custom/nav-changes.ts', exports: { CUSTOM_NAV_CHANGES: {} } },
    { file: 'src/custom/notices.ts', exports: { CUSTOM_NOTICES: {} } },
    { file: 'src/custom/pwa.ts', exports: { CUSTOM_PWA: {} } },
    { file: 'src/custom/routes.ts', exports: { CUSTOM_ROUTES: [] } },
    { file: 'src/custom/sign-in.ts', exports: { CUSTOM_SIGN_IN: {} } },
    { file: 'src/custom/user-dashboard.ts', exports: { CUSTOM_USER_DASHBOARD: null } },
    { file: 'functions/src/custom/index.ts', exports: {} },
    { file: 'functions/src/custom/search-sources.ts', exports: { SEARCH_COLLECTIONS: [], CUSTOM_SEARCH_SOURCES: [] } },
    { file: 'functions/src/custom/email-templates.ts', exports: { APP_EMAIL_TEMPLATES: [], ACCOUNT_EMAIL_LANGUAGES: {} } },
];

/**
 * Every file Arc CMS ships in the custom space, from the repo root, with a hash of its
 * contents as shipped (shippedHash). The app owns these files: Arc CMS never changes
 * or deletes one again, comments included, so pulling an update never conflicts with
 * what the app wrote (docs/app/custom-space.html#why-updates-never-conflict). A new
 * plug point is a new file, shipped empty and added here; its examples go in the docs.
 */
export const SHIPPED_FILES = {
    'custom/README.md': 'b75fe696180b271e',
    'docs/custom/README.md': '155f5a1e1e588b44',
    'functions/src/custom/email-templates.ts': 'a15388a8c3cc73ec',
    'functions/src/custom/index.ts': 'bc37230ec1e6fa32',
    'functions/src/custom/public-callables.txt': 'bd3f72e171f12f56',
    'functions/src/custom/search-sources.ts': '74da7f252bd88529',
    'src/custom/README.md': '19d24bc0d239b2e1',
    'src/custom/app-accounts.ts': '98766b44091a8f0c',
    'src/custom/brand.ts': '1d20a8595c79ea1f',
    'src/custom/clock.ts': '1d143597b6347503',
    'src/custom/features.ts': '3de9e391c9514eb2',
    'src/custom/home.ts': 'bc67fe8100ed3a16',
    'src/custom/i18n/en.json': 'ca3d163bab055381',
    'src/custom/i18n/hi.json': 'ca3d163bab055381',
    'src/custom/languages.ts': 'be2ef3b018631e32',
    'src/custom/nav-changes.ts': 'ee4433ead8d6c0a9',
    'src/custom/nav.ts': 'ff6e1483758b4f0a',
    'src/custom/notices.ts': 'd6fa1f28f80af9ad',
    'src/custom/pages/.gitkeep': 'e3b0c44298fc1c14',
    'src/custom/pwa.ts': '0c9032e2aa1b94eb',
    'src/custom/routes.ts': 'bb7388f7df4aae16',
    'src/custom/sign-in.ts': '5f916ed4918bab96',
    'src/custom/styles.css': '049c0e18bde8bd11',
    'src/custom/user-dashboard.ts': '3bc2d0bdeb9f01a4',
};

/** The hash SHIPPED_FILES records for a file's contents, the same on any line endings. */
export function shippedHash(text) {
    return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

const RULE = 'Arc CMS never changes a file it has shipped in the custom space: the app owns it, so a change conflicts with the app on its next update. Leave it as shipped; put a new plug point in a new file, shipped empty, and examples in the docs (docs/app/custom-space.html#why-updates-never-conflict).';

/**
 * What differs in the custom space from what Arc CMS shipped, one line per file:
 * a shipped file changed or deleted, or a new file not recorded yet. `files` maps
 * each file in the custom space now, from the repo root, to its contents. Empty when
 * everything is as shipped. Only Arc CMS itself checks this: in an app the files are
 * the app's to change.
 */
export function starterChanges(files, shipped = SHIPPED_FILES) {
    const problems = [];
    for (const [file, hash] of Object.entries(shipped)) {
        if (!(file in files)) problems.push(`${file} was deleted. ${RULE}`);
        else if (shippedHash(files[file]) !== hash) problems.push(`${file} changed from what Arc CMS shipped. ${RULE}`);
    }
    for (const file of Object.keys(files).filter((f) => !(f in shipped)).sort()) {
        problems.push(`${file} is new in the custom space. If it is a new starter file, ship it empty and record it in SHIPPED_FILES in scripts/custom-starters.mjs: '${file}': '${shippedHash(files[file])}',`);
    }
    return problems;
}

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
