/**
 * Generates the `TranslationKey` union from src/assets/i18n/en.json.
 *
 * English is the source language, so its key set *is* the contract. Emitting it
 * as a type turns a mistyped key from "the UI renders ADMIN.FOO.BAR at runtime"
 * into a compile error.
 *
 *   npm run i18n:keys
 *
 * A spec checks the output is in step with en.json, so a forgotten run fails
 * the suite rather than shipping a stale union.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'src/assets/i18n/en.json');
const TARGET = join(root, 'src/app/core/i18n/translation-keys.ts');

/** Every leaf path in the JSON, dotted. `_conventions` is documentation. */
export function flattenKeys(node, prefix = '') {
    const keys = [];
    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (path.startsWith('_conventions')) continue;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            keys.push(...flattenKeys(value, path));
        } else {
            keys.push(path);
        }
    }
    return keys;
}

export function render(keys) {
    const union = keys.map(key => `    | '${key}'`).join('\n');
    return `/**
 * Every key in src/assets/i18n/en.json.
 *
 * GENERATED — do not edit. Run \`npm run i18n:keys\` after changing en.json.
 *
 * Typing a key parameter with this catches a typo at compile time instead of
 * rendering the key itself to a user. It covers the TypeScript side —
 * \`notify.*\`, \`t()\`, table column keys. Keys written in templates as
 * \`{{ 'x.y' | transloco }}\` are plain strings to the compiler and are not
 * checked; the i18n-parity spec is the backstop for those.
 */

export type TranslationKey =
${union};

/** The same list at runtime, for the parity spec and for validation. */
export const TRANSLATION_KEYS: readonly TranslationKey[] = [
${keys.map(key => `    '${key}',`).join('\n')}
];
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const en = JSON.parse(readFileSync(SOURCE, 'utf8'));
    const keys = flattenKeys(en).sort();
    writeFileSync(TARGET, render(keys), 'utf8');
    console.log(`generated ${keys.length} keys -> ${TARGET.replace(root + '/', '')}`);
}
