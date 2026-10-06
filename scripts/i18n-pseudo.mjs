/**
 * A pseudo translation of the member keys, for checking member screens by eye
 * (specs/app-member-language-spec.md, L-D11): every word comes out accented and in
 * brackets, so any English left on a screen stands out.
 *
 *   npm run i18n:pseudo -- --out=src/custom/i18n/zz.json
 *
 * Then declare { code: 'zz', label: 'Pseudo', locale: 'en-GB' } in a local
 * src/custom/languages.ts, open the member screens, and remove both afterwards.
 * {{ params }} and HTML tags are kept as they are. Nothing in Arc CMS ships the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', A: 'Á', E: 'É', I: 'Í', O: 'Ö', U: 'Ü', c: 'ç', n: 'ñ', s: 'š', z: 'ž', y: 'ý' };

/** One string, accented and bracketed; {{ params }} and <tags> untouched. */
export function pseudo(text) {
    const parts = String(text).split(/({{[^}]*}}|<[^>]+>|&\w+;)/);
    return `[${parts.map((part, i) => (i % 2 ? part : part.replace(/[a-zA-Z]/g, (c) => ACCENTS[c] ?? c))).join('')}]`;
}

/** The member key list (TypeScript, which Node 22.18 loads directly). Swappable for tests. */
const loadKeys = (root) => import(pathToFileURL(resolve(root, 'src/app/core/i18n/member-keys.ts')).href);

/** The pseudo file: only member keys, nested as in en.json. */
export async function pseudoFile(root = ROOT, load = loadKeys) {
    const { isMemberKey } = await load(root);
    const walk = (node, prefix) => Object.fromEntries(Object.entries(node).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (path.startsWith('_conventions')) return [];
        if (value && typeof value === 'object') {
            const inner = walk(value, path);
            return Object.keys(inner).length ? [[key, inner]] : [];
        }
        return isMemberKey(path) ? [[key, pseudo(value)]] : [];
    }));
    return walk(JSON.parse(readFileSync(resolve(root, 'src/assets/i18n/en.json'), 'utf8')), '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const out = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
    if (!out) {
        console.error('Where to? npm run i18n:pseudo -- --out=src/custom/i18n/zz.json');
        process.exit(1);
    }
    writeFileSync(resolve(ROOT, out), `${JSON.stringify(await pseudoFile(), null, 2)}\n`);
    console.log(`Wrote a pseudo translation of the member keys to ${out}.`);
}
