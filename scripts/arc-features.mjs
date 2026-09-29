/**
 * Writes the functions' view of the app's features (docs/feature-flags-spec.md):
 *
 *   functions/src/enabled-features.gen.ts   the features that are on, for runtime checks
 *   functions/src/feature-exports.gen.ts    `export *` of functions/src/features/<id>.ts
 *                                           for each of them, which all.ts re-exports
 *
 * The functions cannot import src/custom/features.ts (they compile only
 * functions/src), so this runs before every functions build (the `prebuild`
 * script) and every test run. Both files are gitignored: no app ever has a merge
 * conflict on them. A file is only rewritten when its content changes.
 *
 * Needs Node 22.18 or later, which loads the TypeScript files directly.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM = resolve(ROOT, 'src/custom/features.ts');
const REGISTRY = resolve(ROOT, 'src/app/core/features/feature-registry.ts');
const FUNCTIONS_SRC = resolve(ROOT, 'functions/src');
const ENABLED_OUT = resolve(FUNCTIONS_SRC, 'enabled-features.gen.ts');
const EXPORTS_OUT = resolve(FUNCTIONS_SRC, 'feature-exports.gen.ts');

const HEADER = '// Generated from src/custom/features.ts by scripts/arc-features.mjs. Do not edit.\n';

/** The two files' content for a set of enabled feature ids. */
export function renderFeatureFiles(enabled, hasFunctions = (id) => existsSync(resolve(FUNCTIONS_SRC, 'features', `${id}.ts`))) {
    const ids = [...enabled];
    const enabledFile = `${HEADER}export const ENABLED_FEATURES: readonly string[] = ${JSON.stringify(ids)};\n`;
    const exportLines = ids.filter(hasFunctions).map((id) => `export * from './features/${id}.js';`);
    const exportsFile = `${HEADER}${exportLines.length ? exportLines.join('\n') : 'export {};'}\n`;
    return { enabledFile, exportsFile };
}

function writeIfChanged(path, content) {
    if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
    writeFileSync(path, content);
    return true;
}

async function main() {
    // Only the functions folder is uploaded on deploy; if a build ever runs there,
    // keep the files generated locally.
    if (!existsSync(CUSTOM) || !existsSync(REGISTRY)) {
        if (existsSync(ENABLED_OUT) && existsSync(EXPORTS_OUT)) return;
        throw new Error(`arc-features: ${CUSTOM} not found, and no generated files to keep.`);
    }

    let registry, custom;
    try {
        registry = await import(pathToFileURL(REGISTRY).href);
        custom = await import(pathToFileURL(CUSTOM).href);
    } catch (error) {
        throw new Error(`arc-features: could not load the feature files (Node 22.18 or later is needed): ${error.message}`);
    }

    const enabled = registry.resolveFeatures(custom.CUSTOM_FEATURES);
    const { enabledFile, exportsFile } = renderFeatureFiles(enabled);
    const changed = [writeIfChanged(ENABLED_OUT, enabledFile), writeIfChanged(EXPORTS_OUT, exportsFile)].some(Boolean);
    if (changed) console.log(`arc-features: functions build with ${[...enabled].join(', ') || 'no optional features'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
