/**
 * Writes the functions' view of the app's features (specs/feature-flags-spec.md):
 *
 *   functions/src/enabled-features.gen.ts   the features that are on, for runtime checks
 *   functions/src/feature-exports.gen.ts    `export *` of each functions/src/features file
 *                                           whose features are all on, which all.ts
 *                                           re-exports: `forms.ts` needs forms,
 *                                           `search+content.ts` needs both
 *   functions/src/feature-tasks.gen.ts      FEATURE_TASKS: the scheduled tasks of each
 *                                           functions/src/feature-tasks file whose
 *                                           features are all on, by the same naming
 *                                           (specs/scheduled-tasks-spec.md)
 *   functions/src/sign-in.gen.ts            the password and PIN strength, the rule for new
 *                                           PINs (weakPins), and the sign-in choices the app
 *                                           fixed, in src/custom/sign-in.ts
 *                                           (specs/sign-in-strength-spec.md)
 *   functions/src/own-account.gen.ts        what a person may do to their own account, in
 *                                           src/custom/own-account.ts
 *
 * The functions cannot import src/custom/features.ts (they compile only
 * functions/src), so this runs before every functions build (the `prebuild`
 * script) and every test run. The files are gitignored: no app ever has a merge
 * conflict on them. A file is only rewritten when its content changes.
 *
 * Needs Node 22.18 or later, which loads the TypeScript files directly.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM = resolve(ROOT, 'src/custom/features.ts');
const REGISTRY = resolve(ROOT, 'src/app/core/features/feature-registry.ts');
const FUNCTIONS_SRC = resolve(ROOT, 'functions/src');
const ENABLED_OUT = resolve(FUNCTIONS_SRC, 'enabled-features.gen.ts');
const EXPORTS_OUT = resolve(FUNCTIONS_SRC, 'feature-exports.gen.ts');
const TASKS_OUT = resolve(FUNCTIONS_SRC, 'feature-tasks.gen.ts');
const SIGN_IN = resolve(ROOT, 'src/custom/sign-in.ts');
const STRENGTH = resolve(ROOT, 'src/shared/utils/sign-in-strength.ts');
const SIGN_IN_OUT = resolve(FUNCTIONS_SRC, 'sign-in.gen.ts');
const OWN_ACCOUNT = resolve(ROOT, 'src/custom/own-account.ts');
const OWN_ACCOUNT_RULE = resolve(ROOT, 'src/shared/utils/own-account.ts');
const OWN_ACCOUNT_OUT = resolve(FUNCTIONS_SRC, 'own-account.gen.ts');

const HEADER = '// Generated from src/custom/features.ts by scripts/arc-features.mjs. Do not edit.\n';

/** The files of a folder of functions/src, by name without `.ts`. */
const filesIn = (folder) => readdirSync(resolve(FUNCTIONS_SRC, folder))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.slice(0, -3))
    .sort();

/** The three files' content for a set of enabled feature ids, the feature files and the feature task files there are. */
export function renderFeatureFiles(enabled, files = filesIn('features'), taskFiles = filesIn('feature-tasks')) {
    const ids = [...enabled];
    const on = (name) => name.split('+').every((id) => ids.includes(id));
    const enabledFile = `${HEADER}export const ENABLED_FEATURES: readonly string[] = ${JSON.stringify(ids)};\n`;
    const exportLines = files.filter(on).map((name) => `export * from './features/${name}.js';`);
    const exportsFile = `${HEADER}${exportLines.length ? exportLines.join('\n') : 'export {};'}\n`;
    const tasks = taskFiles.filter(on);
    const tasksFile = HEADER
        + "import type { ArcTask } from './scheduled/tasks.js';\n"
        + tasks.map((name, i) => `import { TASKS as tasks${i} } from './feature-tasks/${name}.js';\n`).join('')
        + `\nexport const FEATURE_TASKS: readonly ArcTask[] = [${tasks.map((_, i) => `...tasks${i}`).join(', ')}];\n`;
    return { enabledFile, exportsFile, tasksFile };
}

/** The sign-in file's content: the strength, the rule for new PINs, and the choices the app fixed (null: the admin's). */
export function renderSignInFile(strength, fixed = { emailSignIn: null, newDeviceCode: null }, pinStrength = strength) {
    return '// Generated from src/custom/sign-in.ts by scripts/arc-features.mjs. Do not edit.\n'
        + "import type { FixedSignIn, SignInStrength } from './shared/sign-in-strength.js';\n\n"
        + `export const SIGN_IN_STRENGTH: SignInStrength = ${JSON.stringify(strength)};\n`
        + `export const SIGN_IN_PIN_STRENGTH: SignInStrength = ${JSON.stringify(pinStrength)};\n`
        + `export const SIGN_IN_FIXED: FixedSignIn = ${JSON.stringify({ emailSignIn: fixed.emailSignIn, newDeviceCode: fixed.newDeviceCode })};\n`;
}

/** The app's sign-in choice from src/custom/sign-in.ts, and the rule that reads it; null without the file (an older app). */
async function loadSignInChoice({ strengthPath, customPath }) {
    if (!existsSync(customPath)) return null;
    try {
        const rule = await import(pathToFileURL(strengthPath).href);
        const custom = await import(pathToFileURL(customPath).href);
        return { rule, choice: custom.CUSTOM_SIGN_IN };
    } catch (error) {
        throw new Error(`arc-features: could not load src/custom/sign-in.ts (Node 22.18 or later is needed): ${error.message}`);
    }
}

/** The strength this app chose; a copy without the file (an older app) is strict. A wrong value throws. */
export async function signInStrength({ strengthPath = STRENGTH, customPath = SIGN_IN } = {}) {
    const loaded = await loadSignInChoice({ strengthPath, customPath });
    return loaded ? loaded.rule.resolveSignInStrength(loaded.choice) : 'strict';
}

/** The rule for this app's new PINs: its strength, or strict with weakPins: 'refuse'. A wrong value throws. */
export async function pinStrength({ strengthPath = STRENGTH, customPath = SIGN_IN } = {}) {
    const loaded = await loadSignInChoice({ strengthPath, customPath });
    return loaded ? loaded.rule.resolvePinStrength(loaded.choice) : 'strict';
}

/** The own-account file's content: what a person may do to their own account. */
export function renderOwnAccountFile(choice = { selfDelete: true, moveIdentifiers: true }) {
    return '// Generated from src/custom/own-account.ts by scripts/arc-features.mjs. Do not edit.\n'
        + "import type { OwnAccount } from './own-account-choice.js';\n\n"
        + `export const OWN_ACCOUNT: OwnAccount = ${JSON.stringify({ selfDelete: choice.selfDelete, moveIdentifiers: choice.moveIdentifiers })};\n`;
}

/** What a person may do to their own account, from src/custom/own-account.ts; everything without the file. A wrong value throws. */
export async function ownAccount({ rulePath = OWN_ACCOUNT_RULE, customPath = OWN_ACCOUNT } = {}) {
    if (!existsSync(customPath)) return { selfDelete: true, moveIdentifiers: true };
    let rule, custom;
    try {
        rule = await import(pathToFileURL(rulePath).href);
        custom = await import(pathToFileURL(customPath).href);
    } catch (error) {
        throw new Error(`arc-features: could not load src/custom/own-account.ts (Node 22.18 or later is needed): ${error.message}`);
    }
    return rule.resolveOwnAccount(custom.CUSTOM_OWN_ACCOUNT);
}

/** The sign-in choices this app fixed (email PIN sign-in, the new-device code); none without the file. A wrong value throws. */
export async function fixedSignIn({ strengthPath = STRENGTH, customPath = SIGN_IN } = {}) {
    const loaded = await loadSignInChoice({ strengthPath, customPath });
    return loaded ? loaded.rule.resolveFixedSignIn(loaded.choice) : { emailSignIn: null, newDeviceCode: null };
}

function writeIfChanged(path, content) {
    if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
    writeFileSync(path, content);
    return true;
}

/** The features this app has on, from src/custom/features.ts and the registry's defaults. */
export async function enabledFeatures({ registryPath = REGISTRY, customPath = CUSTOM } = {}) {
    let registry, custom;
    try {
        registry = await import(pathToFileURL(registryPath).href);
        custom = await import(pathToFileURL(customPath).href);
    } catch (error) {
        throw new Error(`arc-features: could not load the feature files (Node 22.18 or later is needed): ${error.message}`);
    }
    return registry.resolveFeatures(custom.CUSTOM_FEATURES);
}

async function main() {
    // Only the functions folder is uploaded on deploy; if a build ever runs there,
    // keep the files generated locally.
    if (!existsSync(CUSTOM) || !existsSync(REGISTRY)) {
        if ([ENABLED_OUT, EXPORTS_OUT, TASKS_OUT, SIGN_IN_OUT, OWN_ACCOUNT_OUT].every((path) => existsSync(path))) return;
        throw new Error(`arc-features: ${CUSTOM} not found, and no generated files to keep.`);
    }

    const enabled = await enabledFeatures();
    const { enabledFile, exportsFile, tasksFile } = renderFeatureFiles(enabled);
    const changed = [writeIfChanged(ENABLED_OUT, enabledFile), writeIfChanged(EXPORTS_OUT, exportsFile), writeIfChanged(TASKS_OUT, tasksFile)].some(Boolean);
    if (changed) console.log(`arc-features: functions build with ${[...enabled].join(', ') || 'no optional features'}`);
    const [strength, pins] = [await signInStrength(), await pinStrength()];
    if (writeIfChanged(SIGN_IN_OUT, renderSignInFile(strength, await fixedSignIn(), pins))) {
        console.log(`arc-features: ${strength === pins ? `${strength} passwords and PINs` : `${strength} passwords, ${pins} PINs`}`);
    }
    writeIfChanged(OWN_ACCOUNT_OUT, renderOwnAccountFile(await ownAccount()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
