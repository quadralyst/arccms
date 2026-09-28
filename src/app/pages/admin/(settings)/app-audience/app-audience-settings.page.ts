/**
 * Settings, App audience (docs/coexistence-spec.md section 5b, CO6.2).
 *
 * Shows where the host app's users are (fixed at deploy time by arc:configure)
 * and sets how ArcCMS reads one of their documents: the unique key (asked every
 * time, never assumed), the email, phone and name fields, and the fields whose
 * changes are events. Field lists come from a sample of real documents, so the
 * admin picks paths instead of typing them. Saved to `Settings/app_audience`.
 */
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { arcCallable } from '../../../../core/config/arc-functions';
import { ToastService } from '../../../../../shared/services/toast.service';

/** Mirrors functions/src/app-audience/config.ts. */
export interface AppAudienceSettings {
    key: { source: 'docId' } | { source: 'field'; field: string };
    emailField?: string;
    phoneField?: string;
    nameField?: string;
    watchedFields: string[];
}

interface AppUsersLocation {
    configured: boolean;
    database: string;
    path: string;
    collection: string;
    /** This install's own users (CO6.8), not another app's. */
    own?: boolean;
}

interface SampledField {
    path: string;
    examples: string[];
    seenIn: number;
}

interface TestResult {
    resolved: { docId: string; key: string; email: string; phone: string; name: string } | null;
    fields: Record<string, string>;
}

@Component({
    selector: 'arc-app-audience-settings',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="settings-section">
      <h3 class="mb-2">{{ 'admin.settings.app_audience.title' | transloco }}</h3>
      <p class="text-muted mb-4">{{ 'admin.settings.app_audience.intro' | transloco }}</p>

      @if (loading()) {
        <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.state.loading' | transloco }}</p>
      } @else {
        <h5>{{ 'admin.settings.app_audience.location_title' | transloco }}</h5>
        @if (location()?.configured) {
          <p class="mb-1">
            {{ 'admin.settings.app_audience.database' | transloco }}: <code>{{ location()!.database }}</code>,
            {{ 'admin.settings.app_audience.collection' | transloco }}: <code>{{ location()!.path }}</code>
          </p>
          @if (location()!.own) {
            <div class="alert alert-info small">{{ 'admin.settings.app_audience.own_users' | transloco }}</div>
          }
          <p class="text-muted small mb-4">{{ 'admin.settings.app_audience.location_hint' | transloco }}</p>
        } @else {
          <div class="alert alert-info">{{ 'admin.settings.app_audience.not_configured' | transloco }}</div>
        }

        @if (error()) {
          <div class="alert alert-danger">{{ 'admin.settings.app_audience.load_failed' | transloco: { error: error() } }}</div>
        }

        @if (location()?.configured && !error()) {
          <h5>{{ 'admin.settings.app_audience.reading_title' | transloco }}</h5>

          <div class="mb-3">
            <label class="form-label fw-semibold">{{ 'admin.settings.app_audience.key' | transloco }}</label>
            <div class="text-muted small mb-2">{{ 'admin.settings.app_audience.key_hint' | transloco }}</div>
            <div class="form-check">
              <input class="form-check-input" type="radio" id="key-doc" name="keySource" value="docId"
                     [ngModel]="keySource()" (ngModelChange)="keySource.set($event)">
              <label class="form-check-label" for="key-doc">{{ 'admin.settings.app_audience.key_doc_id' | transloco }}</label>
            </div>
            <div class="form-check d-flex align-items-center gap-2">
              <input class="form-check-input" type="radio" id="key-field" name="keySource" value="field"
                     [ngModel]="keySource()" (ngModelChange)="keySource.set($event)">
              <label class="form-check-label" for="key-field">{{ 'admin.settings.app_audience.key_field' | transloco }}</label>
              <select class="form-select form-select-sm w-auto" [disabled]="keySource() !== 'field'"
                      [ngModel]="keyField()" (ngModelChange)="keyField.set($event)">
                <option value="">{{ 'admin.settings.app_audience.choose_field' | transloco }}</option>
                @for (f of fields(); track f.path) { <option [value]="f.path">{{ f.path }}</option> }
              </select>
            </div>
          </div>

          <div class="row g-3 mb-1">
            @for (channel of channels; track channel.id) {
              <div class="col-md-4">
                <label class="form-label fw-semibold">{{ channel.labelKey | transloco }}</label>
                <select class="form-select" [ngModel]="channel.value()" (ngModelChange)="channel.value.set($event)">
                  <option value="">{{ 'admin.settings.app_audience.none' | transloco }}</option>
                  @for (f of fields(); track f.path) { <option [value]="f.path">{{ f.path }}</option> }
                </select>
              </div>
            }
          </div>
          <p class="text-muted small mb-3">{{ 'admin.settings.app_audience.channels_hint' | transloco }}</p>

          <div class="mb-4">
            <label class="form-label fw-semibold">{{ 'admin.settings.app_audience.watched' | transloco }}</label>
            <div class="text-muted small mb-2">{{ 'admin.settings.app_audience.watched_hint' | transloco }}</div>
            <div class="row g-3 watch-picker">
              <div class="col-md-6">
                <div class="picker-box">
                  <div class="picker-head">
                    <span class="fw-semibold small">{{ 'admin.settings.app_audience.watched_available' | transloco: { count: availableFields().length } }}</span>
                    <input class="form-control form-control-sm mt-2" type="search"
                           [placeholder]="'admin.settings.app_audience.watched_filter' | transloco"
                           [ngModel]="watchFilter()" (ngModelChange)="watchFilter.set($event)">
                  </div>
                  <ul class="picker-list">
                    @for (f of availableFields(); track f.path) {
                      <li>
                        <label class="picker-row">
                          <input class="form-check-input mt-0" type="checkbox" [checked]="false" (change)="toggleWatched(f.path)">
                          <code>{{ f.path }}</code>
                        </label>
                      </li>
                    } @empty {
                      <li class="text-muted small p-2">{{ 'admin.settings.app_audience.watched_no_match' | transloco }}</li>
                    }
                  </ul>
                </div>
              </div>
              <div class="col-md-6">
                <div class="picker-box">
                  <div class="picker-head">
                    <span class="fw-semibold small">{{ 'admin.settings.app_audience.watched_selected' | transloco: { count: watched().length } }}</span>
                  </div>
                  <ul class="picker-list">
                    @for (path of watched(); track path) {
                      <li class="picker-row justify-content-between">
                        <code>{{ path }}</code>
                        <button type="button" class="btn btn-sm btn-link text-muted p-0 remove-btn"
                                [attr.aria-label]="'admin.settings.app_audience.watched_remove' | transloco: { field: path }"
                                (click)="toggleWatched(path)">&times;</button>
                      </li>
                    } @empty {
                      <li class="text-muted small p-2">{{ 'admin.settings.app_audience.watched_empty' | transloco }}</li>
                    }
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div class="d-flex gap-2 mb-4">
            <button type="button" class="btn btn-primary" [disabled]="saving() || !canSave()" (click)="save()">
              {{ 'admin.settings.app_audience.save' | transloco }}
            </button>
          </div>

          <h5>{{ 'admin.settings.app_audience.test' | transloco }}</h5>
          <div class="d-flex gap-2 align-items-center mb-2">
            <input class="form-control w-auto" [placeholder]="'admin.settings.app_audience.test_doc_id' | transloco"
                   [ngModel]="testDocId()" (ngModelChange)="testDocId.set($event)">
            <button type="button" class="btn btn-outline-primary" [disabled]="testing()" (click)="runTest()">
              {{ 'admin.settings.app_audience.test' | transloco }}
            </button>
          </div>
          @if (testError()) {
            <div class="alert alert-warning mb-4">{{ 'admin.settings.app_audience.test_failed' | transloco: { error: testError() } }}</div>
          }
          @if (testResult(); as t) {
            @if (t.resolved; as r) {
              <p class="fw-semibold mb-1">{{ 'admin.settings.app_audience.test_result' | transloco }}</p>
              <table class="table table-sm w-auto mb-4">
                <tbody>
                  <tr><th>{{ 'admin.settings.app_audience.key' | transloco }}</th><td><code>{{ r.key || '(empty)' }}</code></td></tr>
                  <tr><th>{{ 'admin.settings.app_audience.email_field' | transloco }}</th><td>{{ r.email || '(none)' }}</td></tr>
                  <tr><th>{{ 'admin.settings.app_audience.phone_field' | transloco }}</th><td>{{ r.phone || '(none)' }}</td></tr>
                  <tr><th>{{ 'admin.settings.app_audience.name_field' | transloco }}</th><td>{{ r.name || '(none)' }}</td></tr>
                </tbody>
              </table>
            } @else {
              <p class="text-muted">{{ 'admin.settings.app_audience.test_none' | transloco }}</p>
            }
          }

          <h5>{{ 'admin.settings.app_audience.fields_title' | transloco }}</h5>
          <p class="text-muted small">{{ 'admin.settings.app_audience.fields_hint' | transloco: { count: sampleSize() } }}</p>
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead>
                <tr>
                  <th>{{ 'admin.settings.app_audience.col_field' | transloco }}</th>
                  <th>{{ 'admin.settings.app_audience.col_examples' | transloco }}</th>
                  <th class="text-end">{{ 'admin.settings.app_audience.col_seen' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                @for (f of fields(); track f.path) {
                  <tr>
                    <td><code>{{ f.path }}</code></td>
                    <td class="text-muted small">{{ f.examples.join(', ') }}</td>
                    <td class="text-end">{{ f.seenIn }} / {{ sampleSize() }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
    `,
    styles: [`
        .picker-box { border: 1px solid #dee2e6; border-radius: 8px; background: #fff; }
        .picker-head { padding: 0.6rem 0.75rem; border-bottom: 1px solid #dee2e6; }
        .picker-list { list-style: none; margin: 0; padding: 0.25rem 0; max-height: 320px; overflow-y: auto; }
        .picker-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.75rem; margin: 0; cursor: pointer; }
        .picker-row:hover { background: #f8f9fa; }
        .picker-row code { font-size: 0.85rem; word-break: break-all; }
        .remove-btn { font-size: 1.25rem; line-height: 1; text-decoration: none; }
        .remove-btn:hover { color: #dc3545 !important; }
    `],
})
export class AppAudienceSettingsPage implements OnInit {
    private readonly functions = inject(Functions);
    private readonly firestore = inject(Firestore);
    private readonly toast = inject(ToastService);
    private readonly transloco = inject(TranslocoService);

    readonly loading = signal(true);
    readonly error = signal('');
    readonly location = signal<AppUsersLocation | null>(null);
    readonly fields = signal<SampledField[]>([]);
    readonly sampleSize = signal(0);

    readonly keySource = signal<'docId' | 'field'>('docId');
    readonly keyField = signal('');
    readonly emailField = signal('');
    readonly phoneField = signal('');
    readonly nameField = signal('');
    readonly watched = signal<string[]>([]);
    readonly watchFilter = signal('');

    /** Sampled fields not yet watched, narrowed by the filter box. */
    readonly availableFields = computed(() => {
        const chosen = new Set(this.watched());
        const filter = this.watchFilter().trim().toLowerCase();
        return this.fields().filter((f) => !chosen.has(f.path) && (!filter || f.path.toLowerCase().includes(filter)));
    });
    readonly saving = signal(false);

    readonly testDocId = signal('');
    readonly testing = signal(false);
    readonly testResult = signal<TestResult | null>(null);
    /** A failed Test, shown by the Test button. Not `error`, which hides the editor for a page that could not load. */
    readonly testError = signal('');

    readonly channels = [
        { id: 'email', labelKey: 'admin.settings.app_audience.email_field', value: this.emailField },
        { id: 'phone', labelKey: 'admin.settings.app_audience.phone_field', value: this.phoneField },
        { id: 'name', labelKey: 'admin.settings.app_audience.name_field', value: this.nameField },
    ];

    /** A field key needs its field chosen. */
    readonly canSave = computed(() => this.keySource() === 'docId' || !!this.keyField());

    async ngOnInit(): Promise<void> {
        try {
            const status = (await arcCallable<void, { location: AppUsersLocation; settings: AppAudienceSettings }>(
                this.functions, 'appAudienceStatus')()).data;
            this.location.set(status.location);
            this.applySettings(status.settings);
            if (status.location.configured) {
                const sample = (await arcCallable<void, { sampleSize: number; fields: SampledField[] }>(
                    this.functions, 'sampleAppUsers')()).data;
                this.fields.set(sample.fields);
                this.sampleSize.set(sample.sampleSize);
            }
        } catch (err) {
            this.error.set(err instanceof Error ? err.message : String(err));
        } finally {
            this.loading.set(false);
        }
    }

    private applySettings(s: AppAudienceSettings): void {
        this.keySource.set(s.key.source);
        this.keyField.set(s.key.source === 'field' ? s.key.field : '');
        this.emailField.set(s.emailField ?? '');
        this.phoneField.set(s.phoneField ?? '');
        this.nameField.set(s.nameField ?? '');
        this.watched.set([...(s.watchedFields ?? [])]);
    }

    /** The settings as currently edited. */
    currentSettings(): AppAudienceSettings {
        const optional = (v: string) => (v ? v : undefined);
        return {
            key: this.keySource() === 'field' ? { source: 'field', field: this.keyField() } : { source: 'docId' },
            emailField: optional(this.emailField()),
            phoneField: optional(this.phoneField()),
            nameField: optional(this.nameField()),
            watchedFields: this.watched(),
        };
    }

    toggleWatched(path: string): void {
        this.watched.update((list) => (list.includes(path) ? list.filter((p) => p !== path) : [...list, path]));
    }

    async save(): Promise<void> {
        this.saving.set(true);
        try {
            // Firestore rejects undefined; drop unset optional fields.
            const clean = JSON.parse(JSON.stringify(this.currentSettings()));
            await setDoc(doc(this.firestore, 'Settings', 'app_audience'), clean);
            this.toast.success(this.transloco.translate('admin.settings.app_audience.saved'));
        } catch {
            this.toast.error(this.transloco.translate('admin.settings.app_audience.save_failed'));
        } finally {
            this.saving.set(false);
        }
    }

    async runTest(): Promise<void> {
        this.testing.set(true);
        this.testError.set('');
        try {
            const res = await arcCallable<{ settings: AppAudienceSettings; docId?: string }, TestResult>(
                this.functions, 'testAppUser')({ settings: this.currentSettings(), docId: this.testDocId() || undefined });
            this.testResult.set(res.data);
        } catch (err) {
            this.testResult.set(null);
            this.testError.set(err instanceof Error ? err.message : String(err));
        } finally {
            this.testing.set(false);
        }
    }
}
