/**
 * Admin search results page: /admin/search?q=
 *
 * Where Enter in the header search box lands. Twenty results across every
 * language of the drafts index, each linking to its editor.
 *
 * Spec: specs/search-spec.md, phase S4 item 4.
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
    title: 'Search',
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
                    @if (failed() && !loading()) {
                        <!-- The detail is in the console; the admin reads a plain sentence and can try again. -->
                        <div class="alert alert-danger d-flex flex-wrap align-items-center gap-2 mt-3 mb-0" role="alert">
                            <span class="flex-grow-1">{{ 'admin.search.failed' | transloco }}</span>
                            <button type="button" class="btn btn-sm btn-outline-danger" (click)="run(query())">{{ 'common.table.retry' | transloco }}</button>
                        </div>
                    } @else {
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
    /** The search did not run: the page says so with Retry, not "nothing matched". */
    readonly failed = signal(false);

    ngOnInit(): void {
        this.subscription = this.route.queryParamMap.subscribe(params => {
            void this.run((params.get('q') ?? '').trim());
        });
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe();
    }

    /** Each run's number: only the latest may change the page, so a slow older one never overwrites it. */
    private runs = 0;

    async run(q: string): Promise<void> {
        const run = ++this.runs;
        this.query.set(q);
        this.failed.set(false);
        if (!this.searchService.isSearchable(q)) {
            this.results.set([]);
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        try {
            const response = await this.searchService.search({
                // Every source an admin may read but published content, whose
                // drafts it already finds (specs/feature-flags-spec.md 6.4).
                q, lang: 'all', scope: 'admin', except: ['content'], limit: 20,
            });
            if (run !== this.runs || !response) return;
            this.results.set(response.results);
            this.tookMs.set(response.tookMs);
            this.fallbackUsed.set(response.fallbackUsed ?? null);
        } catch (error) {
            console.error('Search failed:', error);
            if (run !== this.runs) return;
            this.results.set([]);
            this.failed.set(true);
        } finally {
            if (run === this.runs) this.loading.set(false);
        }
    }
}
