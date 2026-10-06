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
 * Spec: specs/multilingual-spec.md — Phase M6.
 */

import { Injectable, InjectionToken, inject } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { DEFAULT_ADMIN_LANGUAGE } from './admin-languages';
import { MEMBER_LANGUAGES } from '../../../custom/languages';

/**
 * One entry per language in ADMIN_LANGUAGES. Written out rather than built
 * from a template string because a bundler can only follow an import it can
 * see — `import(\`./${lang}.json\`)` would defeat the point.
 */
const TRANSLATIONS: Record<string, () => Promise<{ default: Translation }>> = {
    en: () => import('../../../assets/i18n/en.json'),
    hi: () => import('../../../assets/i18n/hi.json'),
};

type TranslationFile = () => Promise<{ default: Translation }>;

/**
 * The app's own translations (src/custom/i18n/<code>.json, docs/app/custom-space.html),
 * laid over the core ones: its own keys, rewording of core keys, and whole languages
 * Arc CMS does not ship (docs/app/member-languages.html). Found by the bundler from the
 * folder, so a new language needs no core edit. A language with no custom file uses the
 * core file alone.
 */
export function customTranslationFiles(files: Record<string, TranslationFile>): Record<string, TranslationFile> {
    return Object.fromEntries(Object.entries(files).flatMap(([path, load]) => {
        const code = /\/([^/]+)\.json$/.exec(path)?.[1];
        return code ? [[code, load]] : [];
    }));
}

/** The app's translation files by language code. A token so tests can give a fake language. */
export const MEMBER_TRANSLATION_SOURCES = new InjectionToken<Record<string, TranslationFile>>('ArcCustomTranslations', {
    providedIn: 'root',
    factory: () => customTranslationFiles(import.meta.glob<{ default: Translation }>('../../../custom/i18n/*.json')),
});

/** The languages an app added for its members, which have no core file: only the app's file, English fills the gaps. */
const MEMBER_ONLY = new Set(MEMBER_LANGUAGES.map((l) => l.code).filter((code) => !(code in TRANSLATIONS)));

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
    private custom = inject(MEMBER_TRANSLATION_SOURCES);

    async getTranslation(lang: string): Promise<Translation> {
        if (MEMBER_ONLY.has(lang)) return (await this.custom[lang]?.())?.default ?? {};
        const key = TRANSLATIONS[lang] ? lang : DEFAULT_ADMIN_LANGUAGE;
        const [core, custom] = await Promise.all([TRANSLATIONS[key](), this.custom[key]?.()]);
        return mergeTranslations(core.default, custom?.default);
    }
}
