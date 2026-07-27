/**
 * The languages the admin UI is available in.
 *
 * Deliberately *not* the site's content languages (`Settings/localization`).
 * A site publishing in Hindi may be run by an admin who reads English, and
 * enabling a content language must not half-translate the admin UI — a
 * language belongs here only once its `src/assets/i18n/{code}.json` exists.
 *
 * Spec: docs/multilingual-spec.md — Phase M6, decision M-D11.
 */

export interface AdminLanguage {
    /** BCP-47 code, and the name of the translation file. */
    code: string;
    /** Shown in the picker, in the language itself. */
    label: string;
}

export const ADMIN_LANGUAGES: readonly AdminLanguage[] = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिन्दी' },
];

/** Falls back to English for anything missing, so a partial file is safe. */
export const DEFAULT_ADMIN_LANGUAGE = 'en';

export const ADMIN_LANGUAGE_CODES = ADMIN_LANGUAGES.map(language => language.code);

/** Whether a stored preference still names a language we ship. */
export function isAdminLanguage(code: string | null | undefined): boolean {
    return !!code && ADMIN_LANGUAGE_CODES.includes(code);
}

/**
 * Mirrors the preference stored on the user document.
 *
 * That document arrives well after the first paint, so without a local copy
 * the admin would render in English and visibly flip a moment later on every
 * load. It is also the only copy available to `LOCALE_ID`, which Angular
 * resolves once at bootstrap — before any user is signed in.
 */
export const ADMIN_LANGUAGE_CACHE_KEY = 'arc-admin-lang';

/** The remembered admin language, or the default. Safe on the server. */
export function cachedAdminLanguage(): string {
    if (typeof localStorage === 'undefined') return DEFAULT_ADMIN_LANGUAGE;
    try {
        const stored = localStorage.getItem(ADMIN_LANGUAGE_CACHE_KEY);
        return isAdminLanguage(stored) ? stored! : DEFAULT_ADMIN_LANGUAGE;
    } catch {
        // Private browsing or a full quota — the default is the right answer.
        return DEFAULT_ADMIN_LANGUAGE;
    }
}
