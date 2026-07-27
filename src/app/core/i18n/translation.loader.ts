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

@Injectable({ providedIn: 'root' })
export class AdminTranslationLoader implements TranslocoLoader {
    async getTranslation(lang: string): Promise<Translation> {
        const load = TRANSLATIONS[lang] ?? TRANSLATIONS[DEFAULT_ADMIN_LANGUAGE];
        const module = await load();
        return module.default;
    }
}
