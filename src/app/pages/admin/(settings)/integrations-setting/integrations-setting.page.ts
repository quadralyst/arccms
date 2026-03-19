import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { roleGuard } from '../../../../guards/role.guard';
import { IntegrationsSettingService } from './integrations-setting.service';
import { DEFAULT_INTEGRATIONS_SETTINGS } from './integrations-setting.model';

export const routeMeta: RouteMeta = {
    title: 'Integrations Settings | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatSelectModule,
        MatSlideToggleModule,
    ],
    template: `
        <div class="integrations-settings">
            <h3 class="settings-title">Integrations</h3>
            <p class="text-muted mb-4">Configure third-party API keys and services used by Arc CMS.</p>

            @if (isLoading()) {
                <div class="d-flex justify-content-center py-5">
                    <mat-spinner diameter="40"></mat-spinner>
                </div>
            } @else {

                <!-- ═══════════════════ Unsplash Card ═══════════════════ -->
                <mat-card class="mb-4 integration-card">
                    <mat-card-header>
                        <mat-card-title>
                            <i class="fa-solid fa-image me-2"></i>
                            Unsplash
                        </mat-card-title>
                        <mat-card-subtitle>
                            Free stock photo search used in the Media Manager.
                            Keys are stored server-side and never sent to the browser.
                        </mat-card-subtitle>
                    </mat-card-header>

                    <mat-card-content class="pt-3">
                        <!-- Unsplash Setup Guide -->
                        <div class="setup-guide-section">
                            <div class="setup-guide-header" (click)="showUnsplashGuide.set(!showUnsplashGuide())">
                                <i class="fa-solid fa-image guide-icon unsplash-accent me-2"></i>
                                <span class="setup-guide-title">Unsplash Setup Guide</span>
                                <button mat-icon-button type="button" class="toggle-btn">
                                    <mat-icon>{{ showUnsplashGuide() ? 'expand_less' : 'expand_more' }}</mat-icon>
                                </button>
                            </div>

                            @if (showUnsplashGuide()) {
                            <div class="setup-guide-body">
                                <p class="guide-intro unsplash-intro">
                                    Follow these steps to get your Unsplash API key. This is a one-time setup that takes about 2 minutes.
                                </p>

                                <div class="setup-step">
                                    <div class="step-number-badge unsplash-badge">1</div>
                                    <div class="step-content">
                                        <h6 class="step-title">Create an Unsplash Developer Account</h6>
                                        <ol class="step-instructions">
                                            <li>
                                                Go to
                                                <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer">unsplash.com/developers</a>
                                            </li>
                                            <li>Click <strong>Register as a developer</strong> (or log in if you already have an Unsplash account)</li>
                                            <li>Accept the API Use and Guidelines</li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step">
                                    <div class="step-number-badge unsplash-badge">2</div>
                                    <div class="step-content">
                                        <h6 class="step-title">Create a New Application</h6>
                                        <ol class="step-instructions">
                                            <li>On the developer dashboard, click <strong>New Application</strong></li>
                                            <li>Accept the API Use and Guidelines checkboxes and click <strong>Accept</strong></li>
                                            <li>Fill in a name (e.g. "My CMS") and a short description</li>
                                            <li>Click <strong>Create application</strong></li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step last">
                                    <div class="step-number-badge unsplash-badge">3</div>
                                    <div class="step-content">
                                        <h6 class="step-title">Copy Your Keys</h6>
                                        <ol class="step-instructions">
                                            <li>On the application page, scroll down to the <strong>Keys</strong> section</li>
                                            <li>Copy the <strong>Access Key</strong> and <strong>Secret Key</strong></li>
                                            <li>Paste them into the fields below and click <strong>Save</strong></li>
                                        </ol>
                                        <p class="step-note">
                                            <i class="fa-solid fa-circle-info me-1"></i>
                                            The free tier allows 50 requests per hour, which is sufficient for most CMS usage.
                                            Keys are stored server-side and never exposed to the browser.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            }
                        </div>

                        <!-- Unsplash Form Fields -->
                        <form [formGroup]="unsplashForm" (ngSubmit)="saveUnsplash()">
                            <div class="mt-3">
                                <div class="row">
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>Access Key</mat-label>
                                            <input
                                                matInput
                                                formControlName="accessKey"
                                                [type]="showAccessKey() ? 'text' : 'password'"
                                                placeholder="Your Unsplash Access Key"
                                                autocomplete="off"
                                            />
                                            <button
                                                mat-icon-button
                                                matSuffix
                                                type="button"
                                                (click)="showAccessKey.set(!showAccessKey())"
                                                [matTooltip]="showAccessKey() ? 'Hide' : 'Show'"
                                                aria-label="Toggle access key visibility"
                                            >
                                                <mat-icon>{{ showAccessKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                                            </button>
                                        </mat-form-field>
                                    </div>

                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>Secret Key</mat-label>
                                            <input
                                                matInput
                                                formControlName="secretKey"
                                                [type]="showSecretKey() ? 'text' : 'password'"
                                                placeholder="Your Unsplash Secret Key"
                                                autocomplete="off"
                                            />
                                            <button
                                                mat-icon-button
                                                matSuffix
                                                type="button"
                                                (click)="showSecretKey.set(!showSecretKey())"
                                                [matTooltip]="showSecretKey() ? 'Hide' : 'Show'"
                                                aria-label="Toggle secret key visibility"
                                            >
                                                <mat-icon>{{ showSecretKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                                            </button>
                                        </mat-form-field>
                                    </div>
                                </div>

                                <p class="hint-text">
                                    <i class="fa-solid fa-circle-info me-1"></i>
                                    Get your keys at
                                    <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer">
                                        unsplash.com/developers
                                    </a>
                                </p>
                            </div>

                            <!-- Unsplash Save -->
                            <div class="d-flex justify-content-end gap-2 mt-3">
                                <button
                                    mat-stroked-button
                                    type="button"
                                    (click)="resetUnsplash()"
                                    [disabled]="isSavingUnsplash() || unsplashForm.pristine"
                                >
                                    Cancel
                                </button>
                                <button
                                    mat-raised-button
                                    color="primary"
                                    type="submit"
                                    [disabled]="isSavingUnsplash() || unsplashForm.pristine"
                                >
                                    @if (isSavingUnsplash()) {
                                        <mat-spinner diameter="20" class="me-2"></mat-spinner>
                                        Saving…
                                    } @else {
                                        <i class="fa-solid fa-floppy-disk me-2"></i>
                                        Save Unsplash Settings
                                    }
                                </button>
                            </div>
                        </form>
                    </mat-card-content>
                </mat-card>

                <!-- ═══════════════════ Geolocation Card ═══════════════════ -->
                <mat-card class="mb-4 integration-card">
                    <mat-card-header>
                        <mat-card-title>
                            <i class="fa-solid fa-location-dot me-2"></i>
                            Geolocation
                        </mat-card-title>
                        <mat-card-subtitle>
                            IP-based geolocation to capture country, region, and city for leads.
                            Data is collected at signup time and stored with user metadata.
                        </mat-card-subtitle>
                    </mat-card-header>

                    <mat-card-content class="pt-3">
                        <!-- Geolocation Setup Guide -->
                        <div class="setup-guide-section">
                            <div class="setup-guide-header" (click)="showGeoGuide.set(!showGeoGuide())">
                                <i class="fa-solid fa-location-dot guide-icon geo-accent me-2"></i>
                                <span class="setup-guide-title">Geolocation Setup Guide</span>
                                <button mat-icon-button type="button" class="toggle-btn">
                                    <mat-icon>{{ showGeoGuide() ? 'expand_less' : 'expand_more' }}</mat-icon>
                                </button>
                            </div>

                            @if (showGeoGuide()) {
                            <div class="setup-guide-body">
                                <p class="guide-intro geo-intro">
                                    Set up IP-based geolocation to automatically capture location data for your leads.
                                    The default provider works out of the box with no signup required.
                                </p>

                                <div class="setup-step">
                                    <div class="step-number-badge geo-badge">1</div>
                                    <div class="step-content">
                                        <h6 class="step-title">Choose a Provider</h6>
                                        <ol class="step-instructions">
                                            <li><strong>ipapi.co</strong> — Free: 1,000 requests/day, 30,000/month. <strong>No API key needed</strong> — works instantly</li>
                                            <li><strong>ipinfo.io</strong> — Free "Lite" tier with unlimited basic lookups. Requires a free account to get a token</li>
                                            <li><strong>Custom Endpoint</strong> — Use your own API that returns JSON with <code>country</code>, <code>region</code>, <code>city</code>, <code>timezone</code></li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step">
                                    <div class="step-number-badge geo-badge">2</div>
                                    <div class="step-content">
                                        <h6 class="step-title">Get an API Token (only if using ipinfo.io or custom)</h6>
                                        <ol class="step-instructions">
                                            <li>If using <strong>ipapi.co</strong> — skip this step, no key required</li>
                                            <li>If using <strong>ipinfo.io</strong> — sign up at <a href="https://ipinfo.io/signup" target="_blank" rel="noopener noreferrer">ipinfo.io/signup</a> and copy your token from the dashboard</li>
                                            <li>If using <strong>Custom</strong> — use whatever key your endpoint requires</li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step last">
                                    <div class="step-number-badge geo-badge">3</div>
                                    <div class="step-content">
                                        <h6 class="step-title">Enable &amp; Save</h6>
                                        <ol class="step-instructions">
                                            <li>Toggle <strong>Enable Geolocation</strong> on</li>
                                            <li>Select your provider (ipapi.co is the default — it just works)</li>
                                            <li>Click <strong>Save</strong></li>
                                        </ol>
                                        <p class="step-note">
                                            <i class="fa-solid fa-circle-info me-1"></i>
                                            When disabled, geographic data is simply not collected — no errors or broken functionality.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            }
                        </div>

                        <!-- Geolocation Form Fields -->
                        <form [formGroup]="geoForm" (ngSubmit)="saveGeo()">
                            <div class="mt-3">
                                <div class="mb-3">
                                    <mat-slide-toggle
                                        formControlName="geoEnabled"
                                        color="primary"
                                    >
                                        Enable Geolocation
                                    </mat-slide-toggle>
                                    <p class="hint-text mt-1">
                                        When disabled, geographic data will not be collected (graceful degradation).
                                    </p>
                                </div>

                                @if (geoForm.get('geoEnabled')?.value) {
                                <div class="row">
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>API Provider</mat-label>
                                            <mat-select formControlName="geoApiProvider">
                                                <mat-option value="ipapi">ipapi.co (No key needed)</mat-option>
                                                <mat-option value="ipinfo">ipinfo.io (Token required)</mat-option>
                                                <mat-option value="custom">Custom Endpoint</mat-option>
                                            </mat-select>
                                        </mat-form-field>
                                    </div>

                                    @if (geoForm.get('geoApiProvider')?.value === 'ipapi') {
                                    <div class="col-md-6 d-flex align-items-center">
                                        <p class="hint-text mb-0">
                                            <i class="fa-solid fa-circle-check text-success me-1"></i>
                                            ipapi.co works without an API key. Free tier: 1,000 lookups/day.
                                        </p>
                                    </div>
                                    }

                                    @if (geoForm.get('geoApiProvider')?.value === 'ipinfo') {
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>API Token</mat-label>
                                            <input
                                                matInput
                                                formControlName="geoApiKey"
                                                placeholder="Your ipinfo.io token"
                                                autocomplete="off"
                                            />
                                            <mat-hint>
                                                Get your token at
                                                <a href="https://ipinfo.io/account/token" target="_blank" rel="noopener noreferrer">ipinfo.io/account/token</a>
                                            </mat-hint>
                                        </mat-form-field>
                                    </div>
                                    }

                                    @if (geoForm.get('geoApiProvider')?.value === 'custom') {
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>API Key (if required)</mat-label>
                                            <input
                                                matInput
                                                formControlName="geoApiKey"
                                                placeholder="Enter your API key"
                                                autocomplete="off"
                                            />
                                        </mat-form-field>
                                    </div>
                                    }
                                </div>

                                @if (geoForm.get('geoApiProvider')?.value === 'custom') {
                                <div class="row">
                                    <div class="col-12">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>Custom Endpoint URL</mat-label>
                                            <input
                                                matInput
                                                formControlName="geoApiEndpoint"
                                                placeholder="https://your-api.com/geo"
                                                autocomplete="off"
                                            />
                                            <mat-hint>Endpoint should return JSON with: country, region, city, timezone</mat-hint>
                                        </mat-form-field>
                                    </div>
                                </div>
                                }
                                }
                            </div>

                            <!-- Geolocation Save -->
                            <div class="d-flex justify-content-end gap-2 mt-3">
                                <button
                                    mat-stroked-button
                                    type="button"
                                    (click)="resetGeo()"
                                    [disabled]="isSavingGeo() || geoForm.pristine"
                                >
                                    Cancel
                                </button>
                                <button
                                    mat-raised-button
                                    color="primary"
                                    type="submit"
                                    [disabled]="isSavingGeo() || geoForm.pristine"
                                >
                                    @if (isSavingGeo()) {
                                        <mat-spinner diameter="20" class="me-2"></mat-spinner>
                                        Saving…
                                    } @else {
                                        <i class="fa-solid fa-floppy-disk me-2"></i>
                                        Save Geolocation Settings
                                    }
                                </button>
                            </div>
                        </form>
                    </mat-card-content>
                </mat-card>

            }
        </div>
    `,
    styles: [`
        .integrations-settings {
            max-width: 900px;
        }

        .settings-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #212529;
            margin-bottom: 4px;
        }

        /* Integration Cards */
        .integration-card {
            border: 1px solid #dee2e6;
            box-shadow: none !important;
        }

        mat-card-title {
            font-size: 1rem !important;
            font-weight: 600;
        }

        .hint-text {
            font-size: 0.8rem;
            color: #6c757d;
            margin-top: 4px;
            margin-bottom: 0;
        }

        .hint-text a {
            color: #0d6efd;
        }

        /* Setup Guide (shared) */
        .setup-guide-section {
            border: 1px solid #e9ecef;
            border-radius: 8px;
            overflow: hidden;
            background: #fafbfc;
        }

        .setup-guide-header {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            user-select: none;
            font-size: 0.9rem;
            font-weight: 600;
            color: #212529;
        }

        .setup-guide-header:hover {
            background-color: #f0f2f4;
        }

        .guide-icon {
            font-size: 0.9rem;
        }

        .setup-guide-title {
            flex: 1;
        }

        .toggle-btn {
            margin-left: auto;
            flex-shrink: 0;
        }

        .setup-guide-body {
            padding: 0 16px 16px;
        }

        /* Unsplash accent */
        .unsplash-accent { color: #111; }
        .unsplash-badge { background: #111; }
        .unsplash-intro {
            background: #f5f5f5;
            border-left: 3px solid #111;
        }

        /* Geolocation accent */
        .geo-accent { color: #e74c3c; }
        .geo-badge { background: #e74c3c; }
        .geo-intro {
            background: #fef2f0;
            border-left: 3px solid #e74c3c;
        }

        .guide-intro {
            font-size: 0.85rem;
            color: #495057;
            margin-bottom: 20px;
            padding: 10px 14px;
            border-radius: 6px;
        }

        .setup-step {
            display: flex;
            gap: 16px;
            padding-bottom: 24px;
            margin-bottom: 4px;
            position: relative;
        }

        .setup-step::before {
            content: '';
            position: absolute;
            left: 15px;
            top: 36px;
            bottom: 0;
            width: 2px;
            background: #dee2e6;
        }

        .setup-step.last::before {
            display: none;
        }

        .step-number-badge {
            flex-shrink: 0;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 0.85rem;
            position: relative;
            z-index: 1;
        }

        .step-content {
            flex: 1;
            min-width: 0;
        }

        .step-title {
            font-weight: 600;
            color: #212529;
            margin-bottom: 8px;
            font-size: 0.95rem;
        }

        .step-instructions {
            margin: 0;
            padding-left: 18px;
            font-size: 0.85rem;
            color: #495057;
            line-height: 1.7;
        }

        .step-instructions li {
            margin-bottom: 4px;
        }

        .step-instructions li:last-child {
            margin-bottom: 0;
        }

        .step-instructions a {
            color: #0d6efd;
        }

        .step-instructions code {
            background: #e9ecef;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 0.8rem;
        }

        .step-note {
            margin-top: 12px;
            padding: 10px 14px;
            background: #fff8e1;
            border-radius: 6px;
            border-left: 3px solid #ffc107;
            font-size: 0.85rem;
            color: #495057;
        }
    `],
})
export default class IntegrationsSettingPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private integrationsSettingService = inject(IntegrationsSettingService);

    unsplashForm!: FormGroup;
    geoForm!: FormGroup;

    isLoading = signal(true);
    isSavingUnsplash = signal(false);
    isSavingGeo = signal(false);
    showAccessKey = signal(false);
    showSecretKey = signal(false);
    showUnsplashGuide = signal(true);
    showGeoGuide = signal(true);

    private originalUnsplash: any = null;
    private originalGeo: any = null;

    ngOnInit(): void {
        this.initForms();
        this.loadSettings();
    }

    private initForms(): void {
        this.unsplashForm = this.fb.group({
            accessKey: [''],
            secretKey: [''],
        });

        this.geoForm = this.fb.group({
            geoEnabled: [false],
            geoApiProvider: ['ipapi'],
            geoApiKey: [''],
            geoApiEndpoint: [''],
        });
    }

    private loadSettings(): void {
        this.integrationsSettingService.getIntegrationsSettings().subscribe({
            next: (settings) => {
                if (settings.unsplash) {
                    this.unsplashForm.patchValue(settings.unsplash);
                }
                if (settings.geo) {
                    this.geoForm.patchValue(settings.geo);
                }
                this.unsplashForm.markAsPristine();
                this.geoForm.markAsPristine();
                this.originalUnsplash = this.unsplashForm.getRawValue();
                this.originalGeo = this.geoForm.getRawValue();

                if (settings.unsplash?.accessKey) {
                    this.showUnsplashGuide.set(false);
                }
                if (settings.geo?.geoEnabled) {
                    this.showGeoGuide.set(false);
                }
                this.isLoading.set(false);
            },
            error: () => {
                this.unsplashForm.patchValue(DEFAULT_INTEGRATIONS_SETTINGS.unsplash);
                this.geoForm.patchValue(DEFAULT_INTEGRATIONS_SETTINGS.geo);
                this.unsplashForm.markAsPristine();
                this.geoForm.markAsPristine();
                this.originalUnsplash = this.unsplashForm.getRawValue();
                this.originalGeo = this.geoForm.getRawValue();
                this.isLoading.set(false);
            },
        });
    }

    resetUnsplash(): void {
        if (this.originalUnsplash) {
            this.unsplashForm.patchValue(this.originalUnsplash);
            this.unsplashForm.markAsPristine();
        }
    }

    resetGeo(): void {
        if (this.originalGeo) {
            this.geoForm.patchValue(this.originalGeo);
            this.geoForm.markAsPristine();
        }
    }

    async saveUnsplash(): Promise<void> {
        if (this.isSavingUnsplash()) return;

        this.isSavingUnsplash.set(true);
        try {
            const payload = {
                unsplash: this.unsplashForm.getRawValue(),
                geo: this.originalGeo,
            };
            await this.integrationsSettingService.saveIntegrationsSettings(payload);
            this.originalUnsplash = this.unsplashForm.getRawValue();
            this.unsplashForm.markAsPristine();
            this.toastService.success('Unsplash settings saved successfully.');
        } catch (error) {
            console.error('Error saving Unsplash settings:', error);
            this.toastService.error('Failed to save Unsplash settings. Please try again.');
        } finally {
            this.isSavingUnsplash.set(false);
        }
    }

    async saveGeo(): Promise<void> {
        if (this.isSavingGeo()) return;

        this.isSavingGeo.set(true);
        try {
            const payload = {
                unsplash: this.originalUnsplash,
                geo: this.geoForm.getRawValue(),
            };
            await this.integrationsSettingService.saveIntegrationsSettings(payload);
            this.originalGeo = this.geoForm.getRawValue();
            this.geoForm.markAsPristine();
            this.toastService.success('Geolocation settings saved successfully.');
        } catch (error) {
            console.error('Error saving Geolocation settings:', error);
            this.toastService.error('Failed to save Geolocation settings. Please try again.');
        } finally {
            this.isSavingGeo.set(false);
        }
    }
}
