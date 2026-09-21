/**
 * The public search widget for statically published pages.
 *
 * The header partial carries `<arc-search>`. A static partial cannot know
 * the site's language, the callable's URL or the translated strings, so
 * the publish pipeline replaces the element with this markup per page, the
 * way it does the language switcher. The markup is a plain GET form to the
 * results page, so search works with JavaScript disabled; arc-search.js
 * adds the type-ahead.
 *
 * Spec: docs/search-spec.md, decision S-D16 and phase S5 item 2.
 */

import { langPrefix } from '../shared/content-translation.js';

/** The region the `search` callable deploys to (the project default). */
export const SEARCH_FUNCTION_REGION = 'us-central1';

export const SEARCH_WIDGET_SCRIPT = '/assets/js/arc-search.js';
export const SEARCH_WIDGET_STYLESHEET = '/assets/css/arc-search.css';

/** Strings the widget shows, with the keys used in public/i18n/{lang}/strings.json. */
export const SEARCH_WIDGET_DEFAULT_STRINGS = {
    search_placeholder: 'Search',
    search_empty: 'No results',
    search_showing_for: 'Showing results for "{{term}}"',
    search_all_results: 'See all results',
} as const;

export type SearchWidgetStringKey = keyof typeof SEARCH_WIDGET_DEFAULT_STRINGS;

/** The callable's HTTPS URL, which the callable protocol accepts over plain fetch. */
export function searchEndpoint(projectId: string, region = SEARCH_FUNCTION_REGION): string {
    return `https://${region}-${projectId}.cloudfunctions.net/search`;
}

/** The results page for a language: /search at the root, /{lang}/search elsewhere. */
export function searchResultsPath(lang: string, defaultLang: string): string {
    return `${langPrefix(lang, defaultLang)}/search`;
}

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export interface SearchWidgetOptions {
    projectId: string;
    lang: string;
    defaultLang: string;
    /** The page's UI strings; missing keys fall back to English. */
    strings?: Record<string, string>;
    /** Override the callable URL, for tests or a different region. */
    endpoint?: string;
}

/**
 * The widget markup. Returns '' when there is no project to call, which
 * removes `<arc-search>` from the page rather than shipping a dead box.
 */
export function buildSearchWidget(options: SearchWidgetOptions): string {
    if (!options.projectId && !options.endpoint) return '';

    const text = (key: SearchWidgetStringKey) => options.strings?.[key]?.trim() || SEARCH_WIDGET_DEFAULT_STRINGS[key];
    const endpoint = options.endpoint || searchEndpoint(options.projectId);
    const resultsUrl = searchResultsPath(options.lang, options.defaultLang);
    const placeholder = text('search_placeholder');

    return `<div class="arc-search"`
        + ` data-endpoint="${escapeAttr(endpoint)}"`
        + ` data-lang="${escapeAttr(options.lang)}"`
        + ` data-results-url="${escapeAttr(resultsUrl)}"`
        + ` data-empty="${escapeAttr(text('search_empty'))}"`
        + ` data-showing-for="${escapeAttr(text('search_showing_for'))}"`
        + ` data-all-results="${escapeAttr(text('search_all_results'))}">`
        + `<form class="arc-search__form" role="search" method="get" action="${escapeAttr(resultsUrl)}">`
        + `<label class="arc-search__field">`
        + `<svg class="arc-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`
        + `<input class="arc-search__input" type="search" name="q" autocomplete="off" spellcheck="false"`
        + ` placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(placeholder)}">`
        + `</label></form></div>`
        + `<link rel="stylesheet" href="${SEARCH_WIDGET_STYLESHEET}">`
        + `<script src="${SEARCH_WIDGET_SCRIPT}" defer></script>`;
}
