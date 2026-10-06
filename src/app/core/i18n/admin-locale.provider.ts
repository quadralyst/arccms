/**
 * Locale data for the admin's date and number pipes.
 *
 * Transloco covers the strings we write; `| date` and `| number` are Angular's
 * and read `LOCALE_ID`. Without this they format in `en-US` however the rest of
 * the page reads — "27 July 2026" beside a fully Hindi table.
 *
 * **Applies from the next load, not mid-session.** Angular resolves `LOCALE_ID`
 * once at bootstrap, and the built-in pipes capture it when they are
 * constructed; there is no supported way to swap it live. Switching the
 * language therefore flips every string immediately and the date formats on
 * the next page load — which is why the choice is cached locally rather than
 * only on the user document, so that load already has the answer.
 *
 * Spec: specs/multilingual-spec.md — Phase M6.
 */

import { LOCALE_ID, Provider } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHi from '@angular/common/locales/hi';
import { cachedAdminLanguage } from './admin-languages';
import { MEMBER_LANGUAGES_DECLARED, startingMemberLanguage } from './member-language.service';
import { isAdminUrl } from './member-languages';

// One registration per language in ADMIN_LANGUAGES other than English, which
// Angular ships by default. Static imports on purpose: a bundler cannot follow
// `import(\`@angular/common/locales/${code}\`)`.
registerLocaleData(localeHi, 'hi');

/**
 * The locale for this page load (docs/app/member-languages.html, L-D7): the admin's in the
 * admin area, and outside it the member's when the app declares member languages.
 * Chosen once, from the address the page opened at.
 */
export function startupLocale(): string {
    const path = typeof location === 'undefined' ? '/' : location.pathname;
    if (!MEMBER_LANGUAGES_DECLARED || isAdminUrl(path)) return cachedAdminLanguage();
    return startingMemberLanguage().locale;
}

/**
 * Registers the member language's locale data before the first page renders, so dates and
 * numbers come out in it. Nothing to do in the admin area or without member languages.
 */
export async function loadStartupLocaleData(): Promise<void> {
    const path = typeof location === 'undefined' ? '/' : location.pathname;
    if (!MEMBER_LANGUAGES_DECLARED || isAdminUrl(path)) return;
    const language = startingMemberLanguage();
    if (!language.localeData) return;
    try {
        registerLocaleData((await language.localeData()).default);
    } catch (error) {
        console.warn(`Locale data for ${language.locale} could not be loaded; dates and numbers stay in English.`, error);
    }
}

export function provideAdminLocale(): Provider {
    return { provide: LOCALE_ID, useFactory: startupLocale };
}
