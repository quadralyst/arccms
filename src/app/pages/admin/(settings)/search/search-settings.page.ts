/**
 * Search Settings Page
 *
 * Shows every registered search source with its entry counts from
 * `Settings/search_status`, and rebuilds the index per source or all at
 * once through the `reindexSearch` callable.
 *
 * Spec: docs/search-spec.md, phase S2 item 6.
 */

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SearchService } from '../../../../core/services/search.service';
import {
    KNOWN_SEARCH_SOURCES,
    SearchScope,
    SearchSourceStatus,
    SearchStatus,
} from '../../../../../shared/models/search.model';

interface SourceRow {
    id: string;
    labelKey: string;
    scope: SearchScope;
    status: SearchSourceStatus | null;
}

const SCOPE_KEY: Record<SearchScope, string> = {
    public: 'admin.settings.search.scope_public',
    authenticated: 'admin.settings.search.scope_authenticated',
    admin: 'admin.settings.search.scope_admin',
};

@Component({
    selector: 'arc-search-settings',
    standalone: true,
    imports: [CommonModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="settings-section">
      <h3 class="mb-3">{{ 'admin.settings.search.title' | transloco }}</h3>
      <p class="text-muted mb-4">{{ 'admin.settings.search.intro' | transloco }}</p>

      @if (isLoading()) {
        <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.state.loading' | transloco }}</p>
      } @else {
        <div class="table-responsive mb-3">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th>{{ 'admin.settings.search.col_source' | transloco }}</th>
                <th>{{ 'admin.settings.search.col_scope' | transloco }}</th>
                <th class="text-end">{{ 'admin.settings.search.col_documents' | transloco }}</th>
                <th class="text-end">{{ 'admin.settings.search.col_entries' | transloco }}</th>
                <th>{{ 'admin.settings.search.col_last_rebuilt' | transloco }}</th>
                <th style="width: 120px;"></th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <td>
                    <strong>{{ row.labelKey | transloco }}</strong>
                    <div class="text-muted small"><code>{{ row.id }}</code></div>
                  </td>
                  <td>{{ scopeKey(row.scope) | transloco }}</td>
                  <td class="text-end">{{ row.status?.documents ?? '–' }}</td>
                  <td class="text-end">{{ row.status?.entries ?? '–' }}</td>
                  <td>
                    @if (reindexedAt(row.status); as when) {
                      {{ when | date: 'medium' }}
                    } @else {
                      <span class="text-muted">{{ 'admin.settings.search.never' | transloco }}</span>
                    }
                  </td>
                  <td class="text-end">
                    <button type="button" class="btn btn-outline-primary btn-sm"
                            [disabled]="busy() !== null" (click)="rebuild(row.id)">
                      @if (busy() === row.id) {
                        <i class="fas fa-spinner fa-spin me-1"></i>
                      }
                      {{ 'admin.settings.search.rebuild' | transloco }}
                    </button>
                  </td>
                </tr>
              }
              @for (row of unknownRows(); track row.id) {
                <tr>
                  <td><code>{{ row.id }}</code></td>
                  <td class="text-muted">–</td>
                  <td class="text-end">{{ row.status?.documents ?? '–' }}</td>
                  <td class="text-end">{{ row.status?.entries ?? '–' }}</td>
                  <td>
                    @if (reindexedAt(row.status); as when) { {{ when | date: 'medium' }} }
                  </td>
                  <td class="text-end">
                    <button type="button" class="btn btn-outline-primary btn-sm"
                            [disabled]="busy() !== null" (click)="rebuild(row.id)">
                      {{ 'admin.settings.search.rebuild' | transloco }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <small class="text-muted">{{ 'admin.settings.search.entries_hint' | transloco }}</small>
        </div>

        <div class="d-flex align-items-center gap-3 flex-wrap">
          <button type="button" class="btn btn-primary" [disabled]="busy() !== null" (click)="rebuild()">
            @if (busy() === '*') {
              <i class="fas fa-spinner fa-spin me-1"></i> {{ 'admin.settings.search.rebuilding' | transloco }}
            } @else {
              {{ 'admin.settings.search.rebuild_all' | transloco }}
            }
          </button>
          @if (message()) { <span class="text-success">{{ message() }}</span> }
          @if (error()) { <span class="text-danger">{{ error() }}</span> }
        </div>

        <p class="text-muted small mt-4 mb-0">{{ 'admin.settings.search.developer_note' | transloco }}</p>
      }
    </div>
  `,
})
export class SearchSettingsPage implements OnInit {
    private firestore = inject(Firestore);
    private searchService = inject(SearchService);
    private transloco = inject(TranslocoService);

    readonly isLoading = signal(true);
    /** The source being rebuilt, '*' for all, null when idle. */
    readonly busy = signal<string | null>(null);
    readonly message = signal('');
    readonly error = signal('');
    readonly status = signal<SearchStatus>({});

    readonly rows = computed<SourceRow[]>(() => KNOWN_SEARCH_SOURCES.map(source => ({
        id: source.id,
        labelKey: source.labelKey,
        scope: source.scope,
        status: this.status().sources?.[source.id] ?? null,
    })));

    /** Sources the functions registry has that this page does not know by name. */
    readonly unknownRows = computed<SourceRow[]>(() => {
        const known = new Set(KNOWN_SEARCH_SOURCES.map(source => source.id));
        return Object.entries(this.status().sources ?? {})
            .filter(([id]) => !known.has(id))
            .map(([id, status]) => ({ id, labelKey: id, scope: 'public' as SearchScope, status }));
    });

    async ngOnInit(): Promise<void> {
        await this.load();
    }

    scopeKey(scope: SearchScope): string {
        return SCOPE_KEY[scope];
    }

    reindexedAt(status: SearchSourceStatus | null): Date | null {
        const raw = status?.reindexedAt;
        if (!raw) return null;
        if (raw instanceof Date) return raw;
        if (typeof raw.toDate === 'function') return raw.toDate();
        if (typeof raw.seconds === 'number') return new Date(raw.seconds * 1000);
        return null;
    }

    async rebuild(source?: string): Promise<void> {
        this.busy.set(source ?? '*');
        this.message.set('');
        this.error.set('');
        try {
            const results = await this.searchService.reindex(source ? { source } : {});
            const entries = results.reduce((sum, r) => sum + r.entries, 0);
            const documents = results.reduce((sum, r) => sum + r.documents, 0);
            this.message.set(this.transloco.translate('admin.settings.search.rebuilt', { entries, documents }));
            await this.load();
        } catch (err) {
            console.error('Search reindex failed:', err);
            this.error.set(this.transloco.translate('admin.settings.search.rebuild_failed'));
        } finally {
            this.busy.set(null);
        }
    }

    private async load(): Promise<void> {
        this.isLoading.set(true);
        try {
            const snap = await getDoc(doc(this.firestore, 'Settings', 'search_status'));
            this.status.set(snap.exists() ? (snap.data() as SearchStatus) : {});
        } catch (err) {
            console.error('Could not read search status:', err);
            this.status.set({});
        } finally {
            this.isLoading.set(false);
        }
    }
}

export default SearchSettingsPage;
