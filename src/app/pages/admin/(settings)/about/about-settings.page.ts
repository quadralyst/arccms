/**
 * About Settings Page
 *
 * Admin settings page for configuring site identity:
 * - Site name (used in SEO meta tags, email templates)
 * - Final URL (production base URL for canonical links)
 * - Address (physical address for email footers)
 */

import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IAboutSettings, DEFAULT_ABOUT_SETTINGS, OrganizationType, parseSameAs, formatSameAs } from './about-settings.model';
import { AboutSettingsService } from './about-settings.service';

@Component({
    selector: 'arc-about-settings',
    template: `
        <div class="settings-section">
            <h3 class="mb-4">{{ 'admin.settings.hub.about.label' | transloco }}</h3>
            <p class="text-muted mb-4">
                {{ 'admin.settings.about.intro' | transloco }}
            </p>

            <div class="form-group mb-3">
                <label class="form-label" for="siteName">{{ 'admin.settings.about.site_name' | transloco }}</label>
                <input
                    type="text"
                    class="form-control"
                    id="siteName"
                    [placeholder]="'admin.settings.about.site_name_placeholder' | transloco"
                    [value]="settings().name"
                    (input)="updateField('name', $any($event.target).value)"
                />
                <small class="text-muted">
                    {{ 'admin.settings.about.site_name_hint' | transloco }}
                </small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="finalUrl">{{ 'admin.settings.about.production_url' | transloco }}</label>
                <input
                    type="url"
                    class="form-control"
                    id="finalUrl"
                    [placeholder]="'admin.settings.about.production_url_placeholder' | transloco"
                    [value]="settings().finalUrl"
                    (input)="updateField('finalUrl', $any($event.target).value)"
                />
                <small class="text-muted">
                    {{ 'admin.settings.about.production_url_hint' | transloco }}
                </small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="address">{{ 'admin.settings.about.address' | transloco }}</label>
                <textarea
                    class="form-control"
                    id="address"
                    rows="3"
                    [placeholder]="'admin.settings.about.address_placeholder' | transloco"
                    [value]="settings().address"
                    (input)="updateField('address', $any($event.target).value)"
                ></textarea>
                <small class="text-muted">
                    {{ 'admin.settings.about.address_hint' | transloco }}
                </small>
            </div>

            <!-- Publisher identity for structured data (docs/discoverability-spec.md, D-D4) -->
            <hr class="my-4">
            <h4 class="identity-heading">{{ 'admin.settings.about.identity_heading' | transloco }}</h4>
            <p class="text-muted mb-4">{{ 'admin.settings.about.identity_intro' | transloco }}</p>

            <div class="form-group mb-3">
                <label class="form-label" for="organizationType">{{ 'admin.settings.about.organization_type' | transloco }}</label>
                <select
                    class="form-select"
                    id="organizationType"
                    [value]="settings().organizationType"
                    (change)="updateField('organizationType', asOrganizationType($any($event.target).value))"
                >
                    <option value="Organization">{{ 'admin.settings.about.organization_type_org' | transloco }}</option>
                    <option value="Person">{{ 'admin.settings.about.organization_type_person' | transloco }}</option>
                </select>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="logoUrl">{{ 'admin.settings.about.logo_url' | transloco }}</label>
                <input
                    type="url"
                    class="form-control"
                    id="logoUrl"
                    [placeholder]="'admin.settings.about.logo_url_placeholder' | transloco"
                    [value]="settings().logoUrl"
                    (input)="updateField('logoUrl', $any($event.target).value)"
                />
                <small class="text-muted">{{ 'admin.settings.about.logo_url_hint' | transloco }}</small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="description">{{ 'admin.settings.about.description' | transloco }}</label>
                <textarea
                    class="form-control"
                    id="description"
                    rows="2"
                    [placeholder]="'admin.settings.about.description_placeholder' | transloco"
                    [value]="settings().description"
                    (input)="updateField('description', $any($event.target).value)"
                ></textarea>
                <small class="text-muted">{{ 'admin.settings.about.description_hint' | transloco }}</small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="sameAs">{{ 'admin.settings.about.same_as' | transloco }}</label>
                <textarea
                    class="form-control"
                    id="sameAs"
                    rows="3"
                    [placeholder]="'admin.settings.about.same_as_placeholder' | transloco"
                    [value]="sameAsText()"
                    (input)="updateSameAs($any($event.target).value)"
                ></textarea>
                <small class="text-muted">{{ 'admin.settings.about.same_as_hint' | transloco }}</small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="contactEmail">{{ 'admin.settings.about.contact_email' | transloco }}</label>
                <input
                    type="email"
                    class="form-control"
                    id="contactEmail"
                    [value]="settings().contactEmail"
                    (input)="updateField('contactEmail', $any($event.target).value)"
                />
                <small class="text-muted">{{ 'admin.settings.about.contact_email_hint' | transloco }}</small>
            </div>

            <div class="mt-4">
                <button
                    class="btn btn-primary"
                    (click)="saveSettings()"
                    [disabled]="isSaving()"
                >
                    @if (isSaving()) {
                        <i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.actions.saving' | transloco }}
                    } @else {
                        <i class="fas fa-save me-1"></i> {{ 'common.actions.save_settings' | transloco }}
                    }
                </button>

                @if (saveMessage()) {
                    <span class="ms-3" [class.text-success]="!saveError()" [class.text-danger]="saveError()">
                        <i class="fas me-1" [class.fa-check]="!saveError()" [class.fa-exclamation-triangle]="saveError()"></i>
                        {{ saveMessage() }}
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
        .identity-heading {
            font-size: 1.05rem;
            font-weight: 600;
            color: #212529;
        }
    `],
    imports: [CommonModule, FormsModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AboutSettingsPage implements OnInit {
    private t = injectT();
    private aboutService = inject(AboutSettingsService);

    settings = signal<IAboutSettings>(DEFAULT_ABOUT_SETTINGS);
    /** The sameAs textarea's raw text; parsed into the URL list on every edit. */
    sameAsText = signal('');
    isSaving = signal(false);
    saveMessage = signal('');
    saveError = signal(false);

    ngOnInit(): void {
        this.loadSettings();
    }

    async loadSettings(): Promise<void> {
        try {
            const data = await this.aboutService.load();
            this.settings.set(data);
            this.sameAsText.set(formatSameAs(data.sameAs));
        } catch (error) {
            console.error('Error loading about settings:', error);
        }
    }

    updateField<K extends keyof IAboutSettings>(field: K, value: IAboutSettings[K]): void {
        this.settings.update(s => ({ ...s, [field]: value }));
        this.saveMessage.set('');
        this.saveError.set(false);
    }

    updateSameAs(text: string): void {
        this.sameAsText.set(text);
        this.updateField('sameAs', parseSameAs(text));
    }

    /** Narrow the select's string to the union the model expects. */
    protected asOrganizationType(value: string): OrganizationType {
        return value === 'Person' ? 'Person' : 'Organization';
    }

    async saveSettings(): Promise<void> {
        this.isSaving.set(true);
        this.saveError.set(false);
        try {
            await this.aboutService.save(this.settings());
            this.saveMessage.set(this.t('common.messages.saved'));
            setTimeout(() => this.saveMessage.set(''), 3000);
        } catch (error) {
            console.error('Error saving about settings:', error);
            this.saveMessage.set(this.t('common.messages.save_failed'));
            this.saveError.set(true);
        } finally {
            this.isSaving.set(false);
        }
    }
}
