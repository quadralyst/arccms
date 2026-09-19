/**
 * Public search box for the SPA.
 *
 * Lives in the header partial as `<arc-search>`. That partial is used two
 * ways, so this element is handled twice, like the language switcher:
 *  - in the SPA it is this component;
 *  - in statically published pages the publish pipeline replaces the
 *    element with markup plus arc-search.js (functions/src/search/widget.ts).
 *
 * Searches the language being viewed. Picking a result loads the page with
 * a full navigation, because published pages are static files on Hosting.
 *
 * Spec: docs/search-spec.md, decision S-D16 and phase S5 item 4.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SearchBoxComponent } from '../../../shared/components/search-box/search-box.component';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';

/** English defaults; public/i18n/{lang}/strings.json overrides them per language. */
export const PUBLIC_SEARCH_STRINGS = {
    search_placeholder: 'Search',
    search_empty: 'No results',
    search_showing_for: 'Showing results for "{{term}}"',
    search_all_results: 'See all results',
    search_results_title: 'Search',
    search_results_for: 'Results for "{{query}}"',
    search_no_query: 'Type something to search for.',
    search_loading: 'Searching...',
} as const;

export type PublicSearchStringKey = keyof typeof PUBLIC_SEARCH_STRINGS;

@Component({
    selector: 'arc-search',
    standalone: true,
    imports: [SearchBoxComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <arc-search-box
            scope="public"
            [lang]="lang()"
            [resultsUrl]="resultsUrl()"
            navigation="location"
            [placeholder]="text('search_placeholder')"
            [emptyText]="text('search_empty')"
            [showingForText]="text('search_showing_for')"
            [allResultsText]="text('search_all_results')"></arc-search-box>
    `,
    styles: [':host { display: block; width: 220px; max-width: 100%; }'],
})
export class PublicSearchComponent {
    private localization = inject(LocalizationService);
    private uiStrings = inject(UiStringsService);

    constructor() {
        this.localization.load();
    }

    /** The language on screen: the route's, or the site default. */
    readonly lang = computed(() => this.uiStrings.activeLang() || this.localization.defaultLanguage());

    readonly resultsUrl = computed(() => {
        const active = this.uiStrings.activeLang();
        return active && active !== this.localization.defaultLanguage() ? `/${active}/search` : '/search';
    });

    text(key: PublicSearchStringKey): string {
        return this.uiStrings.strings()[key]?.trim() || PUBLIC_SEARCH_STRINGS[key];
    }
}

export default PublicSearchComponent;
