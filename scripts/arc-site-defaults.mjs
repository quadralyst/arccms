/**
 * Writes the default templates into the functions (specs/own-website-spec.md, W3):
 *
 *   functions/src/site-defaults.gen.ts   DEFAULT_TEMPLATES: the default folder's
 *                                        partials, list and detail, as this site
 *                                        serves them (src/custom/site/templates/default/
 *                                        over public/_site/templates/default/)
 *
 * Publishing reads every template from the live site; this copy is used only
 * when the live site cannot answer (hosting off, or not yet deployed with
 * /_site/), so a type on the default always publishes a full page. The functions
 * cannot read public/ (they compile only functions/src), so this runs before
 * every functions build (the `prebuild` script) and every test run. Gitignored:
 * no app ever has a merge conflict on it. Rewritten only when it changes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORE_PUBLIC, TEMPLATE_FILES, readSiteFile } from './arc-site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'functions/src/site-defaults.gen.ts');

const HEADER = '// Generated from the site\'s templates/default/ by scripts/arc-site-defaults.mjs. Do not edit.\n';

/** The generated file's content for a site root. */
export function renderSiteDefaults(root = ROOT) {
    const templates = Object.fromEntries(
        TEMPLATE_FILES.map((file) => [file, readSiteFile(root, `_site/templates/default/${file}.html`)]),
    );
    const missing = TEMPLATE_FILES.filter((file) => !templates[file].trim());
    if (missing.length) {
        throw new Error(`arc-site-defaults: the default template folder has no ${missing.join(', ')}.html.`);
    }
    return `${HEADER}export const DEFAULT_TEMPLATES: Record<'partials' | 'list' | 'detail', string> = ${JSON.stringify(templates, null, 4)};\n`;
}

export function main(root = ROOT, out = OUT) {
    // Only the functions folder is uploaded on deploy; if a build ever runs
    // there, keep the file generated locally.
    if (!existsSync(resolve(root, CORE_PUBLIC, '_site'))) {
        if (existsSync(out)) return false;
        throw new Error(`arc-site-defaults: ${resolve(root, CORE_PUBLIC, '_site')} not found, and no generated file to keep.`);
    }
    const content = renderSiteDefaults(root);
    if (existsSync(out) && readFileSync(out, 'utf8') === content) return false;
    writeFileSync(out, content);
    return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
