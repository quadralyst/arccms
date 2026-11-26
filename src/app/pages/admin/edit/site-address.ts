import type { PageRef } from '../more-pages/page-ref';

/**
 * Where a Visual Editor's Close goes (specs/visual-editing-spec.md, VE-D86): it
 * stays on the page being edited, as the site shows it. Kept apart from the two
 * editors so neither loads the other's screen.
 */

/**
 * The address of the site page an editor came from, to go back to on Close: the
 * path of a referrer on this site that is not an admin page, else ''.
 */
export function siteAddressOpenedFrom(referrer: string, origin: string): string {
    if (!referrer || !origin) return '';
    try {
        const url = new URL(referrer);
        if (url.origin !== origin || url.pathname.startsWith('//') || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return '';
        return url.pathname + url.search;
    } catch {
        return '';
    }
}

/** The path prefix of a language: '' for the default one. */
function languagePrefix(lang: string, defaultLang: string): string {
    return lang && lang !== defaultLang ? `/${encodeURIComponent(lang)}` : '';
}

/** An entry's page on the site, in the language on screen; '' while it has no live page (no published address). */
export function entrySitePath(type: string, slug: string, lang: string, defaultLang: string): string {
    if (!type || !slug) return '';
    return `${languagePrefix(lang, defaultLang)}/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`;
}

/** The home page's, a static page's or a list page's address on the site, in the language on screen (a static page has the default language only, VE-D43). */
export function pageSitePath(page: PageRef, lang: string, defaultLang: string): string {
    if (page.kind === 'static') return `/p/${encodeURIComponent(page.name)}`;
    const language = languagePrefix(lang, defaultLang);
    if (page.kind === 'list') return `${language}/${encodeURIComponent(page.name)}`;
    return language || '/';
}
