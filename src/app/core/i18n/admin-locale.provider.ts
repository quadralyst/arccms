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
 * Spec: docs/multilingual-spec.md — Phase M6.
 */

import { LOCALE_ID, Provider } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHi from '@angular/common/locales/hi';
import { cachedAdminLanguage } from './admin-languages';

// One registration per language in ADMIN_LANGUAGES other than English, which
// Angular ships by default. Static imports on purpose: a bundler cannot follow
// `import(\`@angular/common/locales/${code}\`)`.
registerLocaleData(localeHi, 'hi');

export function provideAdminLocale(): Provider {
    return { provide: LOCALE_ID, useFactory: cachedAdminLanguage };
}
