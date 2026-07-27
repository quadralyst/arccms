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
 * Spec: docs/multilingual-spec.md — Phase M1.
 */

import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LocalizationService } from '../../../../core/services/localization.service';
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

@Component({
    selector: 'arc-localization-settings',
    standalone: true,
    imports: [CommonModule, FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="settings-section">
      <h3 class="mb-4">Localization</h3>

      <h4>Languages</h4>
      <p class="text-muted mb-4">
        Choose the languages this site publishes in. The <strong>default language</strong> is the one you
        write content in — its pages keep their existing URLs. Every other language is authored as a
        translation and published under a URL prefix, e.g. <code>/hi/articles/my-post</code>.
      </p>

      @if (isLoading()) {
        <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> Loading…</p>
      } @else {

        <div class="table-responsive mb-3">
          <table class="table table-sm align-middle">
            <thead>
              <tr>
                <th style="width: 90px;">Code</th>
                <th>Language</th>
                <th style="width: 120px;">URL prefix</th>
                <th style="width: 110px;">Default</th>
                <th style="width: 130px;" class="text-end">Order</th>
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
                      <span class="badge bg-secondary ms-2">RTL</span>
                    }
                  </td>
                  <td>
                    @if (lang.code === defaultLanguage()) {
                      <span class="text-muted">— (root)</span>
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
                        Make {{ lang.label }} the default language
                      </label>
                    </div>
                  </td>
                  <td class="text-end">
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      type="button"
                      [disabled]="i === 0"
                      (click)="move(i, -1)"
                      [attr.aria-label]="'Move ' + lang.label + ' up'"
                    >
                      <i class="fas fa-arrow-up"></i>
                    </button>
                    <button
                      class="btn btn-sm btn-outline-secondary ms-1"
                      type="button"
                      [disabled]="i === enabledLanguages().length - 1"
                      (click)="move(i, 1)"
                      [attr.aria-label]="'Move ' + lang.label + ' down'"
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
                        ? 'The default language cannot be removed'
                        : 'Remove ' + lang.label"
                      (click)="removeLanguage(lang.code)"
                      [attr.aria-label]="'Remove ' + lang.label"
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
            <label class="form-label" for="addLanguage">Add a language</label>
            <select
              class="form-select"
              id="addLanguage"
              [ngModel]="languageToAdd()"
              (ngModelChange)="languageToAdd.set($event)"
            >
              <option value="">Select a language…</option>
              @for (lang of availableToAdd(); track lang.code) {
                <option [value]="lang.code">{{ lang.label }} ({{ lang.nativeLabel }}) — {{ lang.code }}</option>
              }
              <option value="__custom__">Other (enter a code)…</option>
            </select>
          </div>

          @if (languageToAdd() === '__custom__') {
            <div class="col-md-2">
              <label class="form-label" for="customCode">Code</label>
              <input
                type="text"
                class="form-control"
                id="customCode"
                placeholder="e.g. sw"
                [ngModel]="customCode()"
                (ngModelChange)="customCode.set($event)"
              />
            </div>
            <div class="col-md-3">
              <label class="form-label" for="customLabel">Name</label>
              <input
                type="text"
                class="form-control"
                id="customLabel"
                placeholder="e.g. Swahili"
                [ngModel]="customLabel()"
                (ngModelChange)="customLabel.set($event)"
              />
            </div>
          }

          <div class="col-md-auto">
            <button class="btn btn-outline-primary" type="button" [disabled]="!canAdd()" (click)="addLanguage()">
              <i class="fas fa-plus me-1"></i> Add
            </button>
          </div>
        </div>

        @if (addError()) {
          <p class="text-danger small mb-3">{{ addError() }}</p>
        }

        <p class="text-muted small mb-4">
          Removing a language stops new pages being published for it. Pages already deployed for that
          language stay online until the content is republished or unpublished.
        </p>

        <div class="mt-4">
          <button class="btn btn-primary" (click)="save()" [disabled]="isSaving()">
            @if (isSaving()) {
              <i class="fas fa-spinner fa-spin me-1"></i> Saving...
            } @else {
              <i class="fas fa-save me-1"></i> Save Languages
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

    defaultLanguage = computed(() => this.settings().defaultLanguage);
    enabledLanguages = computed(() => this.settings().enabledLanguages);

    /** Catalogue entries not already enabled. */
    availableToAdd = computed(() => {
        const enabled = new Set(this.enabledLanguages().map((l) => l.code));
        return SUPPORTED_LANGUAGES.filter((l) => !enabled.has(l.code));
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
                this.addError.set('Enter a valid language code, e.g. "sw" or "pt-br".');
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
            this.addError.set('Could not resolve that language.');
            return;
        }
        if (this.enabledLanguages().some((l) => l.code === language!.code)) {
            this.addError.set(`${language.label} is already enabled.`);
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
            this.saveMessage.set('Languages saved successfully');
            setTimeout(() => this.saveMessage.set(''), 3000);
        } catch (error) {
            console.error('Error saving localization settings:', error);
            this.saveError.set('Could not save languages. Please try again.');
        } finally {
            this.isSaving.set(false);
        }
    }

    private clearMessages(): void {
        this.saveMessage.set('');
        this.saveError.set('');
        this.addError.set('');
    }
}

export default LocalizationSettingsPage;
