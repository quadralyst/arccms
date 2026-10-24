/**
 * Localization Settings Page
 *
 * Admin page for the site's language registry (`Settings/localization`):
 * which languages the site publishes in, and which one is the default.
 *
 * The default language is the one stored in the content documents themselves —
 * its pages keep their current URLs. Every other language is authored as a
 * translation and published under a `/{code}/` prefix.
 *
 * Spec: specs/multilingual-spec.md — Phase M1.
 */

import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LocalizationService } from '../../../../core/services/localization.service';
import { claimedFirstSegments } from '../../../../guards/language.guard';
import {
    ILanguage,
    ILocalizationSettings,
    DEFAULT_LOCALIZATION_SETTINGS,
} from '../../../../../shared/models/localization.model';
import {
    SUPPORTED_LANGUAGES,
    findSupportedLanguage,
    isValidLanguageCode,
} from '../../../../../shared/constants/languages';
import { ZonePickerComponent } from '../../../../../shared/components/zone-picker/zone-picker.component';
import { deviceZone, zoneLabel } from '../../../../core/time/zones';

@Component({
    selector: 'arc-localization-settings',
    standalone: true,
    imports: [CommonModule, FormsModule, TranslocoPipe, ZonePickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="settings-section">
      <h3 class="mb-4">{{ 'admin.settings.localization.title' | transloco }}</h3>

      <h4>{{ 'admin.settings.localization.languages' | transloco }}</h4>
      <p class="text-muted mb-4">
        {{ 'admin.settings.localization.intro_1' | transloco }}
        <strong>{{ 'admin.settings.localization.intro_default_language' | transloco }}</strong>
        {{ 'admin.settings.localization.intro_2' | transloco }} <code>/hi/articles/my-post</code>.
      </p>

      @if (isLoading()) {
        <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.state.loading' | transloco }}</p>
      } @else {

        <div class="table-responsive mb-3">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th style="width: 90px;">{{ 'admin.settings.localization.col_code' | transloco }}</th>
                <th>{{ 'admin.settings.localization.col_language' | transloco }}</th>
                <th style="width: 120px;">{{ 'admin.settings.localization.col_url_prefix' | transloco }}</th>
                <th style="width: 110px;">{{ 'admin.settings.localization.col_default' | transloco }}</th>
                <th style="width: 130px;" class="text-end">{{ 'admin.settings.localization.col_order' | transloco }}</th>
                <th style="width: 60px;"></th>
              </tr>
            </thead>
            <tbody>
              @for (lang of enabledLanguages(); track lang.code; let i = $index) {
                <tr>
                  <td><code>{{ lang.code }}</code></td>
                  <td>
                    {{ lang.label }}
                    @if (lang.nativeLabel && lang.nativeLabel !== lang.label) {
                      <span class="text-muted">· {{ lang.nativeLabel }}</span>
                    }
                    @if (lang.rtl) {
                      <span class="badge bg-secondary ms-2">{{ 'admin.settings.localization.rtl_badge' | transloco }}</span>
                    }
                  </td>
                  <td>
                    @if (lang.code === defaultLanguage()) {
                      <span class="text-muted">{{ 'admin.settings.localization.root_prefix' | transloco }}</span>
                    } @else {
                      <code>/{{ lang.code }}</code>
                    }
                  </td>
                  <td>
                    <div class="form-check">
                      <input
                        class="form-check-input"
                        type="radio"
                        name="defaultLanguage"
                        [id]="'default-' + lang.code"
                        [checked]="lang.code === defaultLanguage()"
                        (change)="setDefaultLanguage(lang.code)"
                      />
                      <label class="form-check-label visually-hidden" [for]="'default-' + lang.code">
                        {{ 'admin.settings.localization.make_default' | transloco: { language: lang.label } }}
                      </label>
                    </div>
                  </td>
                  <td class="text-end">
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      type="button"
                      [disabled]="i === 0"
                      (click)="move(i, -1)"
                      [attr.aria-label]="'admin.settings.localization.move_up' | transloco: { language: lang.label }"
                    >
                      <i class="fas fa-arrow-up"></i>
                    </button>
                    <button
                      class="btn btn-sm btn-outline-secondary ms-1"
                      type="button"
                      [disabled]="i === enabledLanguages().length - 1"
                      (click)="move(i, 1)"
                      [attr.aria-label]="'admin.settings.localization.move_down' | transloco: { language: lang.label }"
                    >
                      <i class="fas fa-arrow-down"></i>
                    </button>
                  </td>
                  <td class="text-end">
                    <button
                      class="btn btn-sm btn-outline-danger"
                      type="button"
                      [disabled]="lang.code === defaultLanguage()"
                      [title]="lang.code === defaultLanguage()
                        ? ('admin.settings.localization.cannot_remove_default' | transloco)
                        : ('admin.settings.localization.remove_language' | transloco: { language: lang.label })"
                      (click)="removeLanguage(lang.code)"
                      [attr.aria-label]="'admin.settings.localization.remove_language' | transloco: { language: lang.label }"
                    >
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="row g-2 align-items-end mb-2">
          <div class="col-md-6">
            <label class="form-label" for="addLanguage">{{ 'admin.settings.localization.add_a_language' | transloco }}</label>
            <select
              class="form-select"
              id="addLanguage"
              [ngModel]="languageToAdd()"
              (ngModelChange)="languageToAdd.set($event)"
            >
              <option value="">{{ 'admin.settings.localization.select_a_language' | transloco }}</option>
              @for (lang of availableToAdd(); track lang.code) {
                <option [value]="lang.code">{{ lang.label }} ({{ lang.nativeLabel }}) — {{ lang.code }}</option>
              }
              <option value="__custom__">{{ 'admin.settings.localization.other_enter_code' | transloco }}</option>
            </select>
          </div>

          @if (languageToAdd() === '__custom__') {
            <div class="col-md-2">
              <label class="form-label" for="customCode">{{ 'admin.settings.localization.custom_code' | transloco }}</label>
              <input
                type="text"
                class="form-control"
                id="customCode"
                [placeholder]="'admin.settings.localization.custom_code_placeholder' | transloco"
                [ngModel]="customCode()"
                (ngModelChange)="customCode.set($event)"
              />
            </div>
            <div class="col-md-3">
              <label class="form-label" for="customLabel">{{ 'admin.settings.localization.custom_name' | transloco }}</label>
              <input
                type="text"
                class="form-control"
                id="customLabel"
                [placeholder]="'admin.settings.localization.custom_name_placeholder' | transloco"
                [ngModel]="customLabel()"
                (ngModelChange)="customLabel.set($event)"
              />
            </div>
          }

          <div class="col-md-auto">
            <button class="btn btn-outline-primary" type="button" [disabled]="!canAdd()" (click)="addLanguage()">
              <i class="fas fa-plus me-1"></i> {{ 'common.actions.add' | transloco }}
            </button>
          </div>
        </div>

        @if (addError()) {
          <p class="text-danger small mb-3">{{ addError() }}</p>
        }

        <p class="text-muted small mb-4">
          {{ 'admin.settings.localization.removal_note' | transloco }}
        </p>

        <div class="mt-4">
          <button class="btn btn-primary" (click)="save()" [disabled]="isSaving()">
            @if (isSaving()) {
              <i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.actions.saving' | transloco }}
            } @else {
              <i class="fas fa-save me-1"></i> {{ 'admin.settings.localization.save_languages' | transloco }}
            }
          </button>

          @if (saveMessage()) {
            <span class="ms-3 text-success">
              <i class="fas fa-check me-1"></i> {{ saveMessage() }}
            </span>
          }
          @if (saveError()) {
            <span class="ms-3 text-danger">
              <i class="fas fa-triangle-exclamation me-1"></i> {{ saveError() }}
            </span>
          }
        </div>

        <!-- The site's time zone (specs/clock-and-zones-spec.md, T-D9), saved on its own. -->
        <section class="time-zone mt-5" aria-labelledby="site-time-zone-title">
          <h4 id="site-time-zone-title">{{ 'admin.settings.localization.time_zone_title' | transloco }}</h4>
          <p class="text-muted mb-3">{{ 'admin.settings.localization.time_zone_intro' | transloco }}</p>
          @if (!settings().timeZone) {
            <div class="alert alert-warning d-flex align-items-center flex-wrap gap-2 no-zone">
              <span class="me-auto">{{ 'admin.settings.localization.no_time_zone' | transloco }}</span>
              <button class="btn btn-sm btn-primary use-device-zone" type="button" [disabled]="isSavingZone()" (click)="saveZone(deviceZone)">
                {{ 'admin.settings.localization.use_zone' | transloco: { zone: deviceZoneLabel } }}
              </button>
            </div>
          }
          <arc-zone-picker inputId="siteTimeZone" [label]="'admin.settings.localization.time_zone_title' | transloco"
            [value]="zoneDraft()" (valueChange)="pickZone($event)"></arc-zone-picker>
          <div class="mt-3">
            <button class="btn btn-primary save-zone" type="button" (click)="saveZone(zoneDraft())"
              [disabled]="isSavingZone() || !zoneDraft() || zoneDraft() === settings().timeZone">
              @if (isSavingZone()) {
                <i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.actions.saving' | transloco }}
              } @else {
                <i class="fas fa-save me-1"></i> {{ 'admin.settings.localization.save_time_zone' | transloco }}
              }
            </button>
            @if (zoneMessage()) {
              <span class="ms-3 text-success"><i class="fas fa-check me-1"></i> {{ zoneMessage() }}</span>
            }
            @if (zoneError()) {
              <span class="ms-3 text-danger"><i class="fas fa-triangle-exclamation me-1"></i> {{ zoneError() }}</span>
            }
          </div>
        </section>
      }
    </div>
  `,
    styles: [`
    .settings-section {
      max-width: 900px;
    }
    h3 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #212529;
    }
    h4 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    code {
      font-size: 0.85em;
    }
  `],
})
export class LocalizationSettingsPage implements OnInit {
    private localization = inject(LocalizationService);
    private transloco = inject(TranslocoService);
    /** Addresses a page already uses, such as /pay: they cannot also be a language's prefix. */
    private claimed = claimedFirstSegments(inject(Router).config);

    /** Working copy — only written to Firestore on Save. */
    settings = signal<ILocalizationSettings>(DEFAULT_LOCALIZATION_SETTINGS);
    isLoading = signal(true);
    isSaving = signal(false);
    saveMessage = signal('');
    saveError = signal('');

    languageToAdd = signal('');
    customCode = signal('');
    customLabel = signal('');
    addError = signal('');

    /** The zone picked but not saved yet; the saved one until then. */
    zoneDraft = signal<string | null>(null);
    isSavingZone = signal(false);
    zoneMessage = signal('');
    zoneError = signal('');
    /** This admin's browser zone, offered when the site has none. */
    readonly deviceZone = deviceZone();
    readonly deviceZoneLabel = zoneLabel(this.deviceZone);

    defaultLanguage = computed(() => this.settings().defaultLanguage);
    enabledLanguages = computed(() => this.settings().enabledLanguages);

    /** Catalogue entries not already enabled, and not an address a page already uses. */
    availableToAdd = computed(() => {
        const enabled = new Set(this.enabledLanguages().map((l) => l.code));
        return SUPPORTED_LANGUAGES.filter((l) => !enabled.has(l.code) && !this.claimed.has(l.code));
    });

    canAdd = computed(() => {
        const selection = this.languageToAdd();
        if (!selection) return false;
        if (selection !== '__custom__') return true;
        return this.customCode().trim().length > 0 && this.customLabel().trim().length > 0;
    });

    async ngOnInit(): Promise<void> {
        try {
            const loaded = await this.localization.load(true);
            this.settings.set(loaded);
            this.zoneDraft.set(loaded.timeZone ?? null);
        } finally {
            this.isLoading.set(false);
        }
    }

    setDefaultLanguage(code: string): void {
        this.clearMessages();
        this.settings.update((s) => ({ ...s, defaultLanguage: code }));
    }

    addLanguage(): void {
        this.clearMessages();
        const selection = this.languageToAdd();

        let language: ILanguage | undefined;
        if (selection === '__custom__') {
            const code = this.customCode().trim().toLowerCase();
            if (!isValidLanguageCode(code)) {
                this.addError.set(this.transloco.translate('admin.settings.localization.invalid_code'));
                return;
            }
            // A custom code may still be a catalogue language typed by hand —
            // prefer the catalogue entry so we keep its native label and RTL flag.
            language = findSupportedLanguage(code) ?? {
                code,
                label: this.customLabel().trim(),
                nativeLabel: this.customLabel().trim(),
            };
        } else {
            language = findSupportedLanguage(selection);
        }

        if (!language) {
            this.addError.set(this.transloco.translate('admin.settings.localization.unresolved_language'));
            return;
        }
        // /{code} would be the language's home page, but a page already has that address.
        if (this.claimed.has(language.code)) {
            this.addError.set(this.transloco.translate('admin.settings.localization.code_taken', { code: language.code }));
            return;
        }
        if (this.enabledLanguages().some((l) => l.code === language!.code)) {
            this.addError.set(this.transloco.translate('admin.settings.localization.already_enabled', { language: language.label }));
            return;
        }

        this.settings.update((s) => ({ ...s, enabledLanguages: [...s.enabledLanguages, language!] }));
        this.languageToAdd.set('');
        this.customCode.set('');
        this.customLabel.set('');
    }

    removeLanguage(code: string): void {
        this.clearMessages();
        // Guarded in the template too — the default language must always exist.
        if (code === this.defaultLanguage()) return;
        this.settings.update((s) => ({
            ...s,
            enabledLanguages: s.enabledLanguages.filter((l) => l.code !== code),
        }));
    }

    move(index: number, delta: number): void {
        this.clearMessages();
        this.settings.update((s) => {
            const languages = [...s.enabledLanguages];
            const target = index + delta;
            if (target < 0 || target >= languages.length) return s;
            [languages[index], languages[target]] = [languages[target], languages[index]];
            return { ...s, enabledLanguages: languages };
        });
    }

    async save(): Promise<void> {
        this.isSaving.set(true);
        this.clearMessages();
        try {
            await this.localization.save(this.settings());
            // Re-read the normalized result so the table reflects exactly what
            // was stored (default language pinned first, codes lower-cased).
            this.settings.set(this.localization.settings());
            this.saveMessage.set(this.transloco.translate('admin.settings.localization.saved'));
            setTimeout(() => this.saveMessage.set(''), 3000);
        } catch (error) {
            console.error('Error saving localization settings:', error);
            this.saveError.set(this.transloco.translate('admin.settings.localization.save_failed'));
        } finally {
            this.isSaving.set(false);
        }
    }

    pickZone(zone: string | null): void {
        this.zoneMessage.set('');
        this.zoneError.set('');
        this.zoneDraft.set(zone);
    }

    /** Saves the site's zone alone; the languages on screen, saved or not, are left as they are. */
    async saveZone(zone: string | null): Promise<void> {
        if (!zone) return;
        this.isSavingZone.set(true);
        this.zoneMessage.set('');
        this.zoneError.set('');
        try {
            await this.localization.saveTimeZone(zone);
            const saved = this.localization.settings().timeZone;
            // Keep the working copy's zone in step, so saving languages later never writes an old one.
            this.settings.update((s) => ({ ...s, timeZone: saved }));
            this.zoneDraft.set(saved ?? null);
            this.zoneMessage.set(this.transloco.translate('admin.settings.localization.time_zone_saved'));
            setTimeout(() => this.zoneMessage.set(''), 3000);
        } catch (error) {
            console.error('Error saving the site time zone:', error);
            this.zoneError.set(this.transloco.translate('admin.settings.localization.time_zone_failed'));
        } finally {
            this.isSavingZone.set(false);
        }
    }

    private clearMessages(): void {
        this.saveMessage.set('');
        this.saveError.set('');
        this.addError.set('');
    }
}

export default LocalizationSettingsPage;
