/**
 * Search Settings Page
 *
 * What is searchable and how (docs/feature-flags-spec.md, section 6.4):
 *
 *  - every source in the index, the fields it tokenizes, its counts and a Rebuild button;
 *  - every collection in the database and where it stands: searchable, named
 *    but not set up, set up in code, not named (with the line a developer adds
 *    to functions/src/custom/search-sources.ts), set up but waiting for that line
 *    and a deploy, or never searchable;
 *  - the setup of a collection, named yet or not: which text fields to search and how much
 *    they count, what a result shows, who may search it, and a live preview.
 *    Saving writes `Settings/search_collections` and rebuilds that collection,
 *    with no deploy.
 *
 * Spec: docs/search-spec.md, phase S2 item 6.
 */

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SearchService } from '../../../../core/services/search.service';
import { isOn } from '../../../../core/features/features';
import {
    CORE_SOURCE_LABEL_KEYS,
    CollectionSample,
    CollectionSetup,
    SearchCollectionRow,
    SearchCollectionState,
    SearchScope,
    SearchSourceStatus,
    SearchStatus,
    SourceFields,
    collectionSourceId,
    fillLinkPattern,
} from '../../../../../shared/models/search.model';

interface SourceRow {
    id: string;
    /** A translation key for core's sources, the stored label for the rest. */
    label: string;
    translate: boolean;
    scope: SearchScope | null;
    status: SearchSourceStatus | null;
    /** What it tokenizes. */
    fields: SourceFields | null;
    /** The collection whose setup this source comes from, for Edit. */
    collection?: string;
}

interface FieldChoice {
    path: string;
    example: string;
    included: boolean;
    weight: 'high' | 'normal';
}

interface Editor {
    name: string;
    label: string;
    fields: FieldChoice[];
    title: string;
    snippet: string;
    link: string;
    scope: SearchScope;
    sample: CollectionSample;
    sampleIndex: number;
}

const SCOPE_KEY: Record<SearchScope, string> = {
    public: 'admin.settings.search.scope_public',
    authenticated: 'admin.settings.search.scope_authenticated',
    admin: 'admin.settings.search.scope_admin',
};

const STATE_ORDER: SearchCollectionState[] = ['needs_setup', 'waiting', 'searchable', 'code', 'not_listed', 'refused'];

const STATE_BADGE: Record<SearchCollectionState, string> = {
    needs_setup: 'bg-warning text-dark',
    waiting: 'bg-secondary',
    searchable: 'bg-success',
    code: 'bg-info text-dark',
    not_listed: 'bg-light text-muted border',
    refused: 'bg-light text-muted border',
    content: 'bg-light text-muted border',
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
        <h5 class="mb-2">{{ 'admin.settings.search.sources_heading' | transloco }}</h5>
        @if (sourceRows().length) {
        <div class="table-responsive mb-2">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th>{{ 'admin.settings.search.col_source' | transloco }}</th>
                <th>{{ 'admin.settings.search.col_scope' | transloco }}</th>
                <th class="text-end">{{ 'admin.settings.search.col_documents' | transloco }}</th>
                <th class="text-end">{{ 'admin.settings.search.col_entries' | transloco }}</th>
                <th>{{ 'admin.settings.search.col_last_rebuilt' | transloco }}</th>
                <th style="width: 180px;"></th>
              </tr>
            </thead>
            <tbody>
              @for (row of sourceRows(); track row.id) {
                <tr>
                  <td>
                    <strong>{{ row.translate ? (row.label | transloco) : row.label }}</strong>
                    <div class="text-muted small"><code>{{ row.id }}</code></div>
                    <!-- What it tokenizes; bold fields count most and match as you type. -->
                    <div class="small mt-1" data-testid="source-fields">
                      @if (row.fields?.byType; as byType) {
                        @for (t of byType; track t.type) {
                          <div><span class="text-muted">{{ t.type }}: </span>
                            @for (f of t.fields; track f.path; let last = $last) {<span [class.fw-semibold]="f.high">{{ f.path }}</span>@if (!last) {, }}
                          </div>
                        } @empty { <span class="text-muted">{{ 'admin.settings.search.no_content_types' | transloco }}</span> }
                      } @else if (row.fields?.fields; as fields) {
                        @for (f of fields; track f.path; let last = $last) {<span [class.fw-semibold]="f.high">{{ f.path }}</span>@if (!last) {, }}
                      } @else {
                        <span class="text-muted">{{ 'admin.settings.search.set_in_code' | transloco }}</span>
                      }
                    </div>
                  </td>
                  <td>{{ row.scope ? (scopeKey(row.scope) | transloco) : '–' }}</td>
                  <td class="text-end">{{ row.status?.documents ?? '–' }}</td>
                  <td class="text-end">{{ row.status?.entries ?? '–' }}</td>
                  <td>
                    @if (reindexedAt(row.status); as when) {
                      {{ when | date: 'medium' }}
                    } @else {
                      <span class="text-muted">{{ 'admin.settings.search.never' | transloco }}</span>
                    }
                  </td>
                  <td class="text-end text-nowrap">
                    @if (row.collection) {
                      <button type="button" class="btn btn-link btn-sm" [disabled]="busy() !== null" (click)="openEditor(row.collection)">
                        {{ 'common.actions.edit' | transloco }}
                      </button>
                    }
                    <button type="button" class="btn btn-outline-primary btn-sm"
                            [disabled]="busy() !== null" (click)="rebuild(row.id)">
                      @if (busy() === row.id) { <i class="fas fa-spinner fa-spin me-1"></i> }
                      {{ 'admin.settings.search.rebuild' | transloco }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <small class="text-muted">{{ 'admin.settings.search.entries_hint' | transloco }}</small>
        </div>
        } @else {
          <p class="text-muted">{{ 'admin.settings.search.no_sources' | transloco }}</p>
        }

        <div class="d-flex align-items-center gap-3 flex-wrap mb-4">
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

        @if (editor(); as ed) {
        <div class="card mb-4" data-testid="collection-editor">
          <div class="card-body">
            <h5 class="mb-3">{{ 'admin.settings.search.editor_title' | transloco: { name: ed.name } }}</h5>

            <label class="form-label small mb-1" for="search-label">{{ 'admin.settings.search.label' | transloco }}</label>
            <input id="search-label" class="form-control form-control-sm mb-3" style="max-width: 320px;"
                   [value]="ed.label" (input)="patch({ label: value($event) })">

            <h6 class="mb-1">{{ 'admin.settings.search.fields_heading' | transloco }}</h6>
            <p class="text-muted small mb-2">{{ 'admin.settings.search.fields_hint' | transloco }}</p>
            @if (ed.fields.length) {
            <table class="table table-sm align-middle mb-3">
              <tbody>
                @for (field of ed.fields; track field.path; let i = $index) {
                  <tr>
                    <td style="width: 32px;">
                      <input type="checkbox" class="form-check-input" [id]="'field-' + i"
                             [checked]="field.included" (change)="setField(i, { included: checked($event) })">
                    </td>
                    <td><label [for]="'field-' + i"><code>{{ field.path }}</code></label></td>
                    <td class="text-muted small text-truncate" style="max-width: 280px;">{{ field.example }}</td>
                    <td style="width: 130px;">
                      @if (field.included) {
                      <select class="form-select form-select-sm" (change)="setField(i, { weight: weight($event) })">
                        <option value="high" [selected]="field.weight === 'high'">{{ 'admin.settings.search.weight_high' | transloco }}</option>
                        <option value="normal" [selected]="field.weight === 'normal'">{{ 'admin.settings.search.weight_normal' | transloco }}</option>
                      </select>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            } @else {
              <p class="text-muted small">{{ 'admin.settings.search.no_fields' | transloco }}</p>
            }

            <h6 class="mb-2">{{ 'admin.settings.search.result_heading' | transloco }}</h6>
            <div class="row g-2 mb-2">
              <div class="col-md-4">
                <label class="form-label small mb-1" for="search-title">{{ 'admin.settings.search.result_title' | transloco }}</label>
                <select id="search-title" class="form-select form-select-sm" (change)="patch({ title: value($event) })">
                  <option value="" [selected]="!ed.title">–</option>
                  @for (field of ed.fields; track field.path) { <option [value]="field.path" [selected]="field.path === ed.title">{{ field.path }}</option> }
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label small mb-1" for="search-snippet">{{ 'admin.settings.search.result_snippet' | transloco }}</label>
                <select id="search-snippet" class="form-select form-select-sm" (change)="patch({ snippet: value($event) })">
                  <option value="" [selected]="!ed.snippet">{{ 'admin.settings.search.none' | transloco }}</option>
                  @for (field of ed.fields; track field.path) { <option [value]="field.path" [selected]="field.path === ed.snippet">{{ field.path }}</option> }
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label small mb-1" for="search-scope">{{ 'admin.settings.search.who_can_search' | transloco }}</label>
                <select id="search-scope" class="form-select form-select-sm" (change)="patch({ scope: scope($event) })">
                  <option value="admin" [selected]="ed.scope === 'admin'">{{ 'admin.settings.search.scope_admin' | transloco }}</option>
                  <option value="authenticated" [selected]="ed.scope === 'authenticated'">{{ 'admin.settings.search.scope_authenticated' | transloco }}</option>
                  <option value="public" [selected]="ed.scope === 'public'">{{ 'admin.settings.search.scope_public' | transloco }}</option>
                </select>
              </div>
            </div>
            @if (ed.scope === 'public') {
              <p class="small text-warning mb-2"><i class="fas fa-triangle-exclamation me-1"></i>{{ 'admin.settings.search.public_warning' | transloco }}</p>
            }
            <label class="form-label small mb-1" for="search-link">{{ 'admin.settings.search.result_link' | transloco }}</label>
            <input id="search-link" class="form-control form-control-sm" placeholder="/admin/lessons/{id}"
                   [value]="ed.link" (input)="patch({ link: value($event) })">
            <p class="text-muted small mt-1 mb-3">{{ 'admin.settings.search.link_hint' | transloco }}</p>

            <h6 class="mb-2">{{ 'admin.settings.search.preview_heading' | transloco }}</h6>
            @if (preview(); as p) {
              <div class="border rounded p-3 mb-3 bg-light" data-testid="collection-preview">
                <div class="d-flex align-items-baseline gap-2 flex-wrap">
                  <strong [class.text-primary]="!!p.link">{{ p.title || '–' }}</strong>
                  <span class="badge bg-secondary">{{ p.badge }}</span>
                  @if (ed.sample.samples.length > 1) {
                    <button type="button" class="btn btn-link btn-sm ms-auto p-0" (click)="nextSample()">
                      {{ ed.sampleIndex + 1 }} / {{ ed.sample.samples.length }} <i class="fas fa-chevron-right ms-1"></i>
                    </button>
                  }
                </div>
                @if (p.snippet) { <div class="small text-muted mt-1">{{ p.snippet }}</div> }
                @if (p.link) { <div class="small mt-1"><code>{{ p.link }}</code></div> }
              </div>
            } @else {
              <p class="text-muted small mb-3">{{ 'admin.settings.search.preview_empty' | transloco }}</p>
            }

            <div class="d-flex align-items-center gap-2 flex-wrap">
              <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() !== null" (click)="save()">
                @if (busy() === 'save') { <i class="fas fa-spinner fa-spin me-1"></i> }
                {{ 'admin.settings.search.save_rebuild' | transloco }}
              </button>
              <button type="button" class="btn btn-outline-secondary btn-sm" [disabled]="busy() !== null" (click)="editor.set(null)">
                {{ 'common.actions.cancel' | transloco }}
              </button>
              @if (editorError()) { <span class="text-danger small">{{ editorError() }}</span> }
            </div>
          </div>
        </div>
        }

        <h5 class="mb-1">{{ 'admin.settings.search.collections_heading' | transloco }}</h5>
        <p class="text-muted small mb-2">{{ 'admin.settings.search.collections_intro' | transloco }}</p>
        <div class="table-responsive">
          <table class="table table-sm align-middle">
            <tbody>
              @for (row of collectionRows(); track row.name) {
                <tr [class.text-muted]="row.state === 'refused'" [attr.data-testid]="'collection-' + row.name">
                  <td><code>{{ row.name }}</code></td>
                  <td>
                    <span class="badge" [ngClass]="badge(row.state)">{{ stateKey(row.state) | transloco }}</span>
                    @if (row.reason) { <span class="small ms-2">{{ row.reason }}</span> }
                  </td>
                  <td class="text-end text-nowrap">
                    @switch (row.state) {
                      @case ('needs_setup') {
                        <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy() !== null" (click)="openEditor(row.name)">
                          {{ 'admin.settings.search.set_up' | transloco }}
                        </button>
                      }
                      @case ('searchable') {
                        <button type="button" class="btn btn-link btn-sm" [disabled]="busy() !== null" (click)="openEditor(row.name)">
                          {{ 'common.actions.edit' | transloco }}
                        </button>
                      }
                      @case ('not_listed') {
                        <button type="button" class="btn btn-link btn-sm" (click)="copyLine(row.name)">
                          <i class="far fa-copy me-1"></i>{{ (copied() === row.name ? 'admin.settings.search.copied' : 'admin.settings.search.copy_line') | transloco }}
                        </button>
                        <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy() !== null" (click)="openEditor(row.name)">
                          {{ 'admin.settings.search.set_up' | transloco }}
                        </button>
                      }
                      @case ('waiting') {
                        <button type="button" class="btn btn-link btn-sm" (click)="copyLine(row.name)">
                          <i class="far fa-copy me-1"></i>{{ (copied() === row.name ? 'admin.settings.search.copied' : 'admin.settings.search.copy_line') | transloco }}
                        </button>
                        <button type="button" class="btn btn-link btn-sm" [disabled]="busy() !== null" (click)="openEditor(row.name)">
                          {{ 'common.actions.edit' | transloco }}
                        </button>
                      }
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (listError()) { <p class="text-danger small">{{ listError() }}</p> }

        <p class="text-muted small mt-3 mb-0">{{ 'admin.settings.search.developer_note' | transloco }}</p>
      }
    </div>
  `,
})
export class SearchSettingsPage implements OnInit {
    private firestore = inject(Firestore);
    private searchService = inject(SearchService);
    private transloco = inject(TranslocoService);

    readonly isLoading = signal(true);
    /** A source id being rebuilt, '*' for all, 'save' while saving a setup, null when idle. */
    readonly busy = signal<string | null>(null);
    readonly message = signal('');
    readonly error = signal('');
    readonly listError = signal('');
    readonly editorError = signal('');
    readonly copied = signal('');
    readonly status = signal<SearchStatus>({});
    readonly collections = signal<SearchCollectionRow[]>([]);
    readonly fields = signal<Record<string, SourceFields>>({});
    readonly editor = signal<Editor | null>(null);

    /** Content's two sources, then every collection or code source that has entries or a setup. */
    readonly sourceRows = computed<SourceRow[]>(() => {
        const statuses = this.status().sources ?? {};
        const fields = this.fields();
        const rows: SourceRow[] = [];
        if (isOn('content')) {
            rows.push(
                { id: 'content', label: CORE_SOURCE_LABEL_KEYS['content'], translate: true, scope: 'public', status: statuses['content'] ?? null, fields: fields['content'] ?? null },
                { id: 'content-drafts', label: CORE_SOURCE_LABEL_KEYS['content-drafts'], translate: true, scope: 'admin', status: statuses['content-drafts'] ?? null, fields: fields['content-drafts'] ?? null },
            );
        }
        for (const c of this.collections()) {
            if ((c.state !== 'searchable' && c.state !== 'code') || !c.sourceId) continue;
            rows.push({
                id: c.sourceId,
                label: c.label || c.name,
                translate: false,
                scope: c.setup?.scope ?? statuses[c.sourceId]?.scope ?? null,
                status: statuses[c.sourceId] ?? null,
                fields: fields[c.sourceId] ?? null,
                collection: c.state === 'searchable' ? c.name : undefined,
            });
        }
        return rows;
    });

    /** Every collection but content's own, the ones to act on first. */
    readonly collectionRows = computed(() => this.collections()
        .filter((c) => c.state !== 'content')
        .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name)));

    /** The selected sample document shown as a result. */
    readonly preview = computed(() => {
        const ed = this.editor();
        const sample = ed?.sample.samples[ed.sampleIndex];
        if (!ed || !sample) return null;
        return {
            title: sample.values[ed.title] ?? '',
            snippet: ed.snippet ? sample.values[ed.snippet] ?? '' : '',
            badge: ed.label || ed.name,
            link: ed.link ? fillLinkPattern(ed.link, sample.values, sample.id) : '',
        };
    });

    async ngOnInit(): Promise<void> {
        await this.load();
    }

    scopeKey(scope: SearchScope): string {
        return SCOPE_KEY[scope];
    }

    stateKey(state: SearchCollectionState): string {
        return `admin.settings.search.state_${state}`;
    }

    badge(state: SearchCollectionState): string {
        return STATE_BADGE[state];
    }

    reindexedAt(status: SearchSourceStatus | null): Date | null {
        const raw = status?.reindexedAt;
        if (!raw) return null;
        if (raw instanceof Date) return raw;
        if (typeof raw.toDate === 'function') return raw.toDate();
        if (typeof raw.seconds === 'number') return new Date(raw.seconds * 1000);
        return null;
    }

    value(event: Event): string {
        return (event.target as HTMLInputElement | HTMLSelectElement).value;
    }

    checked(event: Event): boolean {
        return (event.target as HTMLInputElement).checked;
    }

    weight(event: Event): 'high' | 'normal' {
        return this.value(event) === 'high' ? 'high' : 'normal';
    }

    scope(event: Event): SearchScope {
        const v = this.value(event);
        return v === 'public' || v === 'authenticated' ? v : 'admin';
    }

    patch(change: Partial<Editor>): void {
        const ed = this.editor();
        if (ed) this.editor.set({ ...ed, ...change });
        this.editorError.set('');
    }

    setField(index: number, change: Partial<FieldChoice>): void {
        const ed = this.editor();
        if (!ed) return;
        this.patch({ fields: ed.fields.map((f, i) => (i === index ? { ...f, ...change } : f)) });
    }

    nextSample(): void {
        const ed = this.editor();
        if (ed) this.patch({ sampleIndex: (ed.sampleIndex + 1) % ed.sample.samples.length });
    }

    /** Opens the setup of a named collection, prefilled from its setup or from its fields. */
    async openEditor(name: string): Promise<void> {
        this.editorError.set('');
        this.busy.set('open');
        try {
            const sample = await this.searchService.sampleFields(name);
            const setup = this.collections().find((c) => c.name === name)?.setup;
            const chosen = new Map((setup?.fields ?? []).map((f) => [f.path, f.weight]));
            // A saved field no longer in the sample stays, so saving never drops it silently.
            const paths = [...new Set([...sample.fields.map((f) => f.path), ...chosen.keys()])];
            const fields: FieldChoice[] = paths.map((path, i) => ({
                path,
                example: sample.fields.find((f) => f.path === path)?.example ?? '',
                included: setup ? chosen.has(path) : i < 2,
                weight: chosen.get(path) ?? (i === 0 ? 'high' : 'normal'),
            }));
            this.editor.set({
                name,
                label: setup?.label ?? name,
                fields,
                title: setup?.title ?? fields[0]?.path ?? '',
                snippet: setup?.snippet ?? '',
                link: setup?.link ?? '',
                scope: setup?.scope ?? 'admin',
                sample,
                sampleIndex: 0,
            });
        } catch (err) {
            console.error('Could not read the collection:', err);
            this.error.set(this.transloco.translate('admin.settings.search.load_failed'));
        } finally {
            this.busy.set(null);
        }
    }

    /** Saves the setup (no deploy: the functions read it on the next write or rebuild) and rebuilds it. */
    async save(): Promise<void> {
        const ed = this.editor();
        if (!ed) return;
        const fields = ed.fields.filter((f) => f.included).map((f) => ({ path: f.path, weight: f.weight }));
        if (!fields.length || !ed.title) {
            this.editorError.set(this.transloco.translate('admin.settings.search.needs_title'));
            return;
        }
        const setup: CollectionSetup = {
            fields,
            title: ed.title,
            scope: ed.scope,
            ...(ed.label.trim() && ed.label.trim() !== ed.name ? { label: ed.label.trim() } : {}),
            ...(ed.snippet ? { snippet: ed.snippet } : {}),
            ...(ed.link.trim() ? { link: ed.link.trim() } : {}),
        };
        this.busy.set('save');
        try {
            // Replace this collection's setup whole: a merge would keep fields un-ticked since.
            const ref = doc(this.firestore, 'Settings', 'search_collections');
            const current = ((await getDoc(ref)).data()?.['collections'] ?? {}) as Record<string, CollectionSetup>;
            await setDoc(ref, { collections: { ...current, [ed.name]: setup } });
            this.editor.set(null);
            this.busy.set(null);
            // Only a named collection has a trigger and a source to rebuild; the rest wait for the line and a deploy.
            const state = this.collections().find((c) => c.name === ed.name)?.state;
            if (state === 'searchable' || state === 'needs_setup') {
                await this.rebuild(collectionSourceId(ed.name));
            } else {
                this.message.set(this.transloco.translate('admin.settings.search.saved_waiting', { name: ed.name }));
                await this.load();
            }
        } catch (err) {
            console.error('Could not save the search setup:', err);
            this.editorError.set(this.transloco.translate('admin.settings.search.rebuild_failed'));
            this.busy.set(null);
        }
    }

    async copyLine(name: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(`'${name}',`);
            this.copied.set(name);
        } catch {
            this.copied.set('');
        }
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
        this.isLoading.set(this.collections().length === 0);
        this.listError.set('');
        const [status, collections] = await Promise.all([
            getDoc(doc(this.firestore, 'Settings', 'search_status'))
                .then((snap) => (snap.exists() ? (snap.data() as SearchStatus) : {}))
                .catch((err) => { console.error('Could not read search status:', err); return {} as SearchStatus; }),
            this.searchService.listCollections().catch((err) => {
                console.error('Could not list collections:', err);
                this.listError.set(this.transloco.translate('admin.settings.search.load_failed'));
                return { collections: [] as SearchCollectionRow[], fields: {} };
            }),
        ]);
        this.status.set(status);
        this.collections.set(collections.collections);
        this.fields.set(collections.fields);
        this.isLoading.set(false);
    }
}

export default SearchSettingsPage;
