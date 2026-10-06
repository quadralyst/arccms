/**
 * What a member language still lacks (docs/app/member-languages.html):
 *
 *   npm run i18n:member -- --lang=de
 *
 * Lists every member-facing core key and every key of the app's src/custom/i18n/en.json
 * that src/custom/i18n/de.json (and a core file of that language, if any) does not have.
 * The same check as the parity test, for a translator's to-do list. Needs Node 22.18 or
 * later, which loads the TypeScript list directly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);

/** The member key list (TypeScript, which Node 22.18 loads directly). Swappable for tests. */
const loadKeys = (root) => import(pathToFileURL(resolve(root, 'src/app/core/i18n/member-keys.ts')).href);

/** The missing keys for one language, from the files under `root`. */
export async function memberGaps(lang, root = ROOT, load = loadKeys) {
    const { languageParity } = await load(root);
    const core = { en: read(resolve(root, 'src/assets/i18n/en.json')), [lang]: read(resolve(root, `src/assets/i18n/${lang}.json`)) };
    const custom = { en: read(resolve(root, 'src/custom/i18n/en.json')) ?? {}, [lang]: read(resolve(root, `src/custom/i18n/${lang}.json`)) };
    return languageParity([{ code: lang }], core, custom)[0]?.missing ?? [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const lang = process.argv.find((a) => a.startsWith('--lang='))?.slice('--lang='.length);
    if (!lang) {
        console.error('Which language? npm run i18n:member -- --lang=<code>');
        process.exit(1);
    }
    const missing = await memberGaps(lang);
    if (!missing.length) console.log(`${lang}: every member key is translated.`);
    else console.log(`${lang}: ${missing.length} key(s) to translate, in src/custom/i18n/${lang}.json:\n  ${missing.join('\n  ')}`);
}
