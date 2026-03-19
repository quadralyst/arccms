/**
 * About Settings Page
 *
 * Admin settings page for configuring site identity:
 * - Site name (used in SEO meta tags, email templates)
 * - Final URL (production base URL for canonical links)
 * - Address (physical address for email footers)
 */

import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IAboutSettings, DEFAULT_ABOUT_SETTINGS } from './about-settings.model';
import { AboutSettingsService } from './about-settings.service';

@Component({
    selector: 'arc-about-settings',
    template: `
        <div class="settings-section">
            <h3 class="mb-4">About</h3>
            <p class="text-muted mb-4">
                Configure your site's identity. These values are used in SEO meta tags,
                canonical URLs, and email footers.
            </p>

            <div class="form-group mb-3">
                <label class="form-label" for="siteName">Site Name</label>
                <input
                    type="text"
                    class="form-control"
                    id="siteName"
                    placeholder="e.g. My Awesome Site"
                    [value]="settings().name"
                    (input)="updateField('name', $any($event.target).value)"
                />
                <small class="text-muted">
                    Displayed in browser tabs, social media shares, and email templates.
                </small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="finalUrl">Production URL</label>
                <input
                    type="url"
                    class="form-control"
                    id="finalUrl"
                    placeholder="e.g. https://www.example.com"
                    [value]="settings().finalUrl"
                    (input)="updateField('finalUrl', $any($event.target).value)"
                />
                <small class="text-muted">
                    The public base URL of your site. Used for canonical links, sitemaps, and SEO.
                </small>
            </div>

            <div class="form-group mb-3">
                <label class="form-label" for="address">Address</label>
                <textarea
                    class="form-control"
                    id="address"
                    rows="3"
                    placeholder="e.g. 123 Main St, City, Country"
                    [value]="settings().address"
                    (input)="updateField('address', $any($event.target).value)"
                ></textarea>
                <small class="text-muted">
                    Physical address shown in the footer of outgoing emails (required by anti-spam laws).
                </small>
            </div>

            <div class="mt-4">
                <button
                    class="btn btn-primary"
                    (click)="saveSettings()"
                    [disabled]="isSaving()"
                >
                    @if (isSaving()) {
                        <i class="fas fa-spinner fa-spin me-1"></i> Saving...
                    } @else {
                        <i class="fas fa-save me-1"></i> Save Settings
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
    `],
    imports: [CommonModule, FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AboutSettingsPage implements OnInit {
    private aboutService = inject(AboutSettingsService);

    settings = signal<IAboutSettings>(DEFAULT_ABOUT_SETTINGS);
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
        } catch (error) {
            console.error('Error loading about settings:', error);
        }
    }

    updateField<K extends keyof IAboutSettings>(field: K, value: IAboutSettings[K]): void {
        this.settings.update(s => ({ ...s, [field]: value }));
        this.saveMessage.set('');
        this.saveError.set(false);
    }

    async saveSettings(): Promise<void> {
        this.isSaving.set(true);
        this.saveError.set(false);
        try {
            await this.aboutService.save(this.settings());
            this.saveMessage.set('Settings saved successfully');
            setTimeout(() => this.saveMessage.set(''), 3000);
        } catch (error) {
            console.error('Error saving about settings:', error);
            this.saveMessage.set('Failed to save settings');
            this.saveError.set(true);
        } finally {
            this.isSaving.set(false);
        }
    }
}
