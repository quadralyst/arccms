/**
 * Public search results page: /search?q= and /{lang}/search?q=
 *
 * Where Enter in the header search box lands, and where the no-JavaScript
 * form on static pages submits. No static file exists at this path, so
 * Hosting falls through to the Angular shell (S-D18).
 *
 * Spec: docs/search-spec.md, phase S5 item 5.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { HeaderComponent } from './page.parts/header.component';
import { FooterComponent } from './page.parts/footer.component';
import { PUBLIC_SEARCH_STRINGS, PublicSearchStringKey } from './page.parts/public-search.component';
import { SearchResultsComponent } from '../../shared/components/search-results/search-results.component';
import { SearchService } from '../core/services/search.service';
import { LocalizationService } from '../core/services/localization.service';
import { UiStringsService } from '../core/services/ui-strings.service';
import { SearchResult } from '../../shared/models/search.model';

export const routeMeta: RouteMeta = {
    title: 'Search',
};

@Component({
    selector: 'arc-public-search-page',
    standalone: true,
    imports: [HeaderComponent, FooterComponent, SearchResultsComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <arc-header></arc-header>
        <main class="arc-search-page">
            <div class="container">
                <h1 class="arc-search-page__title">{{ text('search_results_title') }}</h1>
                @if (!query()) {
                    <p class="arc-search-page__lead">{{ text('search_no_query') }}</p>
                } @else {
                    <p class="arc-search-page__lead">{{ text('search_results_for').replace('{{query}}', query()) }}</p>
                    <arc-search-results
                        [results]="results()"
                        [loading]="loading()"
                        [fallbackUsed]="fallbackUsed()"
                        navigation="location"
                        [loadingText]="text('search_loading')"
                        [emptyText]="text('search_empty')"
                        [showingForText]="text('search_showing_for')"></arc-search-results>
                }
            </div>
        </main>
        <arc-footer></arc-footer>
    `,
    styles: [`
        .arc-search-page { padding: 3rem 0 4rem; min-height: 50vh; }
        .arc-search-page .container { max-width: 760px; margin: 0 auto; padding: 0 1rem; }
        .arc-search-page__title { font-size: 2rem; font-weight: 700; margin: 0 0 .5rem; }
        .arc-search-page__lead { color: #6e6e73; margin: 0 0 1.5rem; }
    `],
})
export default class PublicSearchPage implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private searchService = inject(SearchService);
    private localization = inject(LocalizationService);
    private uiStrings = inject(UiStringsService);
    private subscription?: Subscription;

    readonly query = signal('');
    readonly results = signal<SearchResult[]>([]);
    readonly loading = signal(false);
    readonly fallbackUsed = signal<string | null>(null);
    /** '' on the default language's URL, the code on /{lang}/search. */
    readonly routeLang = signal('');
    readonly lang = computed(() => this.routeLang() || this.localization.defaultLanguage());

    async ngOnInit(): Promise<void> {
        const lang = this.route.snapshot.paramMap.get('lang') || '';
        this.routeLang.set(lang);
        // Chrome for this page's language; '' restores the authored English.
        void this.uiStrings.use(lang);
        // The results page exists for every language.
        await this.localization.load();
        this.localization.languageVariants.set(
            this.localization.enabledLanguages().map(language => language.code),
        );
        this.subscription = this.route.queryParamMap.subscribe(params => {
            void this.run((params.get('q') ?? '').trim());
        });
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe();
        this.localization.languageVariants.set(null);
    }

    text(key: PublicSearchStringKey): string {
        return this.uiStrings.strings()[key]?.trim() || PUBLIC_SEARCH_STRINGS[key];
    }

    async run(q: string): Promise<void> {
        this.query.set(q);
        if (!this.searchService.isSearchable(q)) {
            this.results.set([]);
            return;
        }
        this.loading.set(true);
        try {
            const response = await this.searchService.search({ q, lang: this.lang(), scope: 'public', limit: 20 });
            if (!response) return;
            this.results.set(response.results);
            this.fallbackUsed.set(response.fallbackUsed ?? null);
        } catch (error) {
            console.error('Search failed:', error);
            this.results.set([]);
        } finally {
            this.loading.set(false);
        }
    }
}
