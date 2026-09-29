/**
 * Transloco loader that imports the translation files rather than fetching
 * them.
 *
 * Transloco's stock loader is an HttpClient GET against `/assets/i18n/{lang}`.
 * That would mean the server render has no translations to hand — it would
 * either fetch itself over the network, or serialize a page of empty strings
 * that the browser then fills in, which is the hydration flicker M6 says to
 * avoid. A static `import()` is resolved by the bundler, so the same module is
 * available on both sides, split into its own chunk per language and loaded
 * only when that language is activated.
 *
 * Spec: docs/multilingual-spec.md — Phase M6.
 */

import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { DEFAULT_ADMIN_LANGUAGE } from './admin-languages';

/**
 * One entry per language in ADMIN_LANGUAGES. Written out rather than built
 * from a template string because a bundler can only follow an import it can
 * see — `import(\`./${lang}.json\`)` would defeat the point.
 */
const TRANSLATIONS: Record<string, () => Promise<{ default: Translation }>> = {
    en: () => import('../../../assets/i18n/en.json'),
    hi: () => import('../../../assets/i18n/hi.json'),
};

/**
 * The app's own translations (src/custom/i18n, docs/custom-code.md), laid over
 * the core ones: its own keys, and rewording of core keys. A language with no
 * custom file uses the core file alone.
 */
const CUSTOM_TRANSLATIONS: Record<string, () => Promise<{ default: Translation }>> = {
    en: () => import('../../../custom/i18n/en.json'),
    hi: () => import('../../../custom/i18n/hi.json'),
};

/** `core` with `custom` laid over it, nested objects merged key by key. */
export function mergeTranslations(core: Translation, custom: Translation | undefined): Translation {
    if (!custom) return core;
    const merged: Translation = { ...core };
    for (const [key, value] of Object.entries(custom)) {
        const base = merged[key];
        merged[key] = isObject(value) && isObject(base) ? mergeTranslations(base, value) : value;
    }
    return merged;
}

function isObject(value: unknown): value is Translation {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable({ providedIn: 'root' })
export class AdminTranslationLoader implements TranslocoLoader {
    async getTranslation(lang: string): Promise<Translation> {
        const key = TRANSLATIONS[lang] ? lang : DEFAULT_ADMIN_LANGUAGE;
        const [core, custom] = await Promise.all([TRANSLATIONS[key](), CUSTOM_TRANSLATIONS[key]?.()]);
        return mergeTranslations(core.default, custom?.default);
    }
}
