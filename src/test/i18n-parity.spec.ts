/**
 * Guards the translation files against drift.
 *
 * English is the source language, so three things have to stay in step and
 * nothing about the running app makes it obvious when they do not:
 *
 *  - every key in en.json exists in every translation,
 *  - no translation invents a key with no English source,
 *  - the generated `TranslationKey` union matches en.json.
 *
 * A missing key falls back to English silently, which is what makes partial
 * translation shippable — and also what makes drift invisible. This is where it
 * becomes visible instead.
 */

import { describe, it, expect } from 'vitest';
import en from '../assets/i18n/en.json';
import hi from '../assets/i18n/hi.json';
import { TRANSLATION_KEYS } from '../app/core/i18n/translation-keys';
import { ADMIN_LANGUAGE_CODES } from '../app/core/i18n/admin-languages';

/** Dotted leaf paths. `_conventions` is developer documentation, never rendered. */
function flatten(node: unknown, prefix = ''): string[] {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return [prefix];
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return path.startsWith('_conventions') ? [] : flatten(value, path);
    });
}

const TRANSLATIONS: Record<string, unknown> = { hi };
const english = flatten(en).sort();

describe('translation files', () => {
    it.each(Object.keys(TRANSLATIONS))('%s has every key en.json has', (lang) => {
        const translated = new Set(flatten(TRANSLATIONS[lang]));
        const missing = english.filter(key => !translated.has(key));

        // Run `npm run i18n:keys` is not the fix here — add the keys.
        expect(missing, `${lang}.json is missing ${missing.length} key(s)`).toEqual([]);
    });

    it.each(Object.keys(TRANSLATIONS))('%s invents no key without an English source', (lang) => {
        const source = new Set(english);
        const extra = flatten(TRANSLATIONS[lang]).filter(key => !source.has(key));

        // An extra key is usually a rename that only landed in one file, so the
        // English still renders the old text somewhere.
        expect(extra, `${lang}.json has ${extra.length} key(s) en.json does not`).toEqual([]);
    });

    it('ships a translation file for every language the picker offers', () => {
        const shipped = new Set(['en', ...Object.keys(TRANSLATIONS)]);
        const offered = ADMIN_LANGUAGE_CODES.filter(code => !shipped.has(code));

        expect(offered, 'ADMIN_LANGUAGES offers a language with no JSON').toEqual([]);
    });

    it('has a TranslationKey union in step with en.json', () => {
        // Regenerate with `npm run i18n:keys`.
        expect([...TRANSLATION_KEYS].sort()).toEqual(english);
    });
});
