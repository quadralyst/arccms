/**
 * Misc Settings Page
 *
 * Admin settings page for configuring miscellaneous features like:
 * - Branding options
 * - Media upload constraints
 */

import { Component, inject, Injector, runInInjectionContext, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { IMiscSettings, DEFAULT_MISC_SETTINGS } from './misc-settings.model';

@Component({
  selector: 'arc-misc-settings',
  template: `
    <div class="settings-section">
      <h3 class="mb-4">{{ 'admin.settings.hub.misc.label' | transloco }}</h3>

      <h4>{{ 'admin.settings.misc.media_upload' | transloco }}</h4>
      <p class="text-muted mb-4">
        Configure constraints for uploaded media images. Images exceeding the max dimensions will be automatically resized before upload.
      </p>

      <div class="row mb-3">
        <div class="col-md-4 mb-3">
          <label class="form-label" for="mediaMaxFileSize">{{ 'admin.settings.misc.max_file_size' | transloco }}</label>
          <input
            type="number"
            class="form-control"
            id="mediaMaxFileSize"
            [ngModel]="settings().mediaMaxFileSize"
            (ngModelChange)="updateField('mediaMaxFileSize', $event)"
            min="1"
            max="50"
          />
          <small class="text-muted d-block mt-1">{{ 'admin.settings.misc.max_file_size_hint' | transloco }}</small>
        </div>

        <div class="col-md-4 mb-3">
          <label class="form-label" for="mediaMaxWidth">{{ 'admin.settings.misc.max_width' | transloco }}</label>
          <input
            type="number"
            class="form-control"
            id="mediaMaxWidth"
            [ngModel]="settings().mediaMaxWidth"
            (ngModelChange)="updateField('mediaMaxWidth', $event)"
            min="100"
            max="7680"
          />
          <small class="text-muted d-block mt-1">{{ 'admin.settings.misc.max_width_hint' | transloco }}</small>
        </div>

        <div class="col-md-4 mb-3">
          <label class="form-label" for="mediaMaxHeight">{{ 'admin.settings.misc.max_height' | transloco }}</label>
          <input
            type="number"
            class="form-control"
            id="mediaMaxHeight"
            [ngModel]="settings().mediaMaxHeight"
            (ngModelChange)="updateField('mediaMaxHeight', $event)"
            min="100"
            max="4320"
          />
          <small class="text-muted d-block mt-1">{{ 'admin.settings.misc.max_height_hint' | transloco }}</small>
        </div>
      </div>

      <div class="form-group mb-4">
        <div class="form-check form-switch">
          <input
            type="checkbox"
            class="form-check-input"
            id="mediaConvertToWebp"
            [checked]="settings().mediaConvertToWebp"
            (change)="updateField('mediaConvertToWebp', $any($event.target).checked)"
          />
          <label class="form-check-label" for="mediaConvertToWebp">
            {{ 'admin.settings.misc.convert_webp' | transloco }}
          </label>
        </div>
        <small class="text-muted d-block mt-1">
          When enabled, all uploaded images (except GIFs) are automatically converted to WebP format for faster page loads and smaller file sizes.
        </small>
      </div>

      <div class="mt-4">
        <button
          class="btn btn-primary"
          (click)="saveMediaSettings()"
          [disabled]="isSavingMedia()"
        >
          @if(isSavingMedia()) {
          <i class="fas fa-spinner fa-spin me-1"></i> Saving...
          } @else {
          <i class="fas fa-save me-1"></i> {{ 'admin.settings.misc.save_media' | transloco }}
          }
        </button>

        @if(mediaSaveMessage()) {
        <span class="ms-3 text-success">
          <i class="fas fa-check me-1"></i> {{ mediaSaveMessage() }}
        </span>
        }
      </div>

      <hr class="my-4" />

      <h4>{{ 'admin.settings.misc.branding' | transloco }}</h4>
      <p class="text-muted mb-4">
        {{ 'admin.settings.misc.branding_hint' | transloco }}
      </p>

      <div class="form-group mb-4">
        <div class="form-check form-switch">
          <input
            type="checkbox"
            class="form-check-input"
            id="showPoweredBy"
            [checked]="settings().showPoweredBy"
            (change)="updateField('showPoweredBy', $any($event.target).checked)"
          />
          <label class="form-check-label" for="showPoweredBy">
            {{ 'admin.settings.misc.powered_by' | transloco }}
          </label>
        </div>
        <small class="text-muted d-block mt-1">
          When enabled, a small "Powered by Arc CMS" text is shown at the bottom of all public pages and outgoing emails.
        </small>
      </div>

      <div class="mt-4">
        <button
          class="btn btn-primary"
          (click)="saveBranding()"
          [disabled]="isSavingBranding()"
        >
          @if(isSavingBranding()) {
          <i class="fas fa-spinner fa-spin me-1"></i> Saving...
          } @else {
          <i class="fas fa-save me-1"></i> {{ 'admin.settings.misc.save_branding' | transloco }}
          }
        </button>

        @if(brandingSaveMessage()) {
        <span class="ms-3 text-success">
          <i class="fas fa-check me-1"></i> {{ brandingSaveMessage() }}
        </span>
        }
      </div>
    </div>
  `,
  styles: [`
    .settings-section {
      max-width: 600px;
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
  `],
  imports: [CommonModule, FormsModule, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiscSettingsPage implements OnInit {
    private t = injectT();
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  settings = signal<IMiscSettings>(DEFAULT_MISC_SETTINGS);
  isSavingBranding = signal(false);
  brandingSaveMessage = signal('');
  isSavingMedia = signal(false);
  mediaSaveMessage = signal('');

  ngOnInit(): void {
    this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    try {
      const docSnap = await runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'Settings', 'misc')));
      if (docSnap.exists()) {
        this.settings.set({ ...DEFAULT_MISC_SETTINGS, ...docSnap.data() });
      }
    } catch (error) {
      console.error('Error loading misc settings:', error);
    }
  }

  updateField<K extends keyof IMiscSettings>(field: K, value: IMiscSettings[K]): void {
    this.settings.update(s => ({ ...s, [field]: value }));
    this.brandingSaveMessage.set('');
    this.mediaSaveMessage.set('');
  }

  async saveBranding(): Promise<void> {
    this.isSavingBranding.set(true);
    try {
      const docRef = doc(this.firestore, 'Settings', 'misc');
      await setDoc(docRef, { showPoweredBy: this.settings().showPoweredBy }, { merge: true });
      this.brandingSaveMessage.set(this.t('admin.settings.misc.branding_saved'));
      setTimeout(() => this.brandingSaveMessage.set(''), 3000);
    } catch (error) {
      console.error('Error saving branding settings:', error);
    } finally {
      this.isSavingBranding.set(false);
    }
  }

  async saveMediaSettings(): Promise<void> {
    this.isSavingMedia.set(true);
    try {
      const docRef = doc(this.firestore, 'Settings', 'misc');
      const { mediaMaxFileSize, mediaMaxWidth, mediaMaxHeight, mediaConvertToWebp } = this.settings();
      await setDoc(docRef, { mediaMaxFileSize, mediaMaxWidth, mediaMaxHeight, mediaConvertToWebp }, { merge: true });
      this.mediaSaveMessage.set(this.t('admin.settings.misc.media_saved'));
      setTimeout(() => this.mediaSaveMessage.set(''), 3000);
    } catch (error) {
      console.error('Error saving media settings:', error);
    } finally {
      this.isSavingMedia.set(false);
    }
  }
}
