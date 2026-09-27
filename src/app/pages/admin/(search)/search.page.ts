/**
 * Admin search results page: /admin/search?q=
 *
 * Where Enter in the header search box lands. Twenty results across every
 * language of the drafts index, each linking to its editor.
 *
 * Spec: docs/search-spec.md, phase S4 item 4.
 */

import { RouteMeta } from '@analogjs/router';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { SearchResultsComponent } from '../../../../shared/components/search-results/search-results.component';
import { SearchService } from '../../../core/services/search.service';
import { SearchResult } from '../../../../shared/models/search.model';
import { roleGuard } from '../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Search | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-admin-search-page',
    standalone: true,
    imports: [PageHeaderComponent, SearchResultsComponent, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <arc-page-header [title]="'admin.search.title' | transloco" [subtitle]="'admin.search.subtitle' | transloco"></arc-page-header>

        <div class="card">
            <div class="card-body">
                @if (!query()) {
                    <p class="text-muted mb-0">{{ 'admin.search.no_query' | transloco }}</p>
                } @else {
                    <h5 class="mb-1">{{ 'admin.search.results_for' | transloco: { query: query() } }}</h5>
                    @if (!loading()) {
                        <p class="text-muted small mb-3">{{ 'admin.search.count' | transloco: { count: results().length, ms: tookMs() } }}</p>
                    }
                    <arc-search-results
                        [results]="results()"
                        [loading]="loading()"
                        [fallbackUsed]="fallbackUsed()"
                        navigation="router"
                        [loadingText]="'common.state.loading' | transloco"
                        [emptyText]="'admin.search.empty' | transloco: { query: query() }"
                        [showingForText]="'common.search.showing_for' | transloco"></arc-search-results>
                }
            </div>
        </div>
    `,
})
export default class AdminSearchPage implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private searchService = inject(SearchService);
    private subscription?: Subscription;

    readonly query = signal('');
    readonly results = signal<SearchResult[]>([]);
    readonly loading = signal(false);
    readonly tookMs = signal(0);
    readonly fallbackUsed = signal<string | null>(null);

    ngOnInit(): void {
        this.subscription = this.route.queryParamMap.subscribe(params => {
            void this.run((params.get('q') ?? '').trim());
        });
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe();
    }

    async run(q: string): Promise<void> {
        this.query.set(q);
        if (!this.searchService.isSearchable(q)) {
            this.results.set([]);
            return;
        }
        this.loading.set(true);
        try {
            const response = await this.searchService.search({
                q, lang: 'all', scope: 'admin', sources: ['content-drafts'], limit: 20,
            });
            if (!response) return;
            this.results.set(response.results);
            this.tookMs.set(response.tookMs);
            this.fallbackUsed.set(response.fallbackUsed ?? null);
        } catch (error) {
            console.error('Search failed:', error);
            this.results.set([]);
        } finally {
            this.loading.set(false);
        }
    }
}
