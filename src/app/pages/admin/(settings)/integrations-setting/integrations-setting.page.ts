import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
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
        MatSlideToggleModule, TranslocoPipe],
    template: `
        <div class="integrations-settings">
            <h3 class="settings-title">{{ 'admin.settings.hub.integrations.label' | transloco }}</h3>
            <p class="text-muted mb-4">{{ 'admin.settings.integrations.subtitle' | transloco }}</p>

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
                            {{ 'admin.settings.integrations.unsplash' | transloco }}
                        </mat-card-title>
                        <mat-card-subtitle>
                            {{ 'admin.settings.integrations.unsplash_subtitle' | transloco }}
                        </mat-card-subtitle>
                    </mat-card-header>

                    <mat-card-content class="pt-3">
                        <!-- Unsplash Setup Guide -->
                        <div class="setup-guide-section">
                            <div class="setup-guide-header" (click)="showUnsplashGuide.set(!showUnsplashGuide())">
                                <i class="fa-solid fa-image guide-icon unsplash-accent me-2"></i>
                                <span class="setup-guide-title">{{ 'admin.settings.integrations.unsplash_guide' | transloco }}</span>
                                <button mat-icon-button type="button" class="toggle-btn">
                                    <mat-icon>{{ showUnsplashGuide() ? 'expand_less' : 'expand_more' }}</mat-icon>
                                </button>
                            </div>

                            @if (showUnsplashGuide()) {
                            <div class="setup-guide-body">
                                <p class="guide-intro unsplash-intro">
                                    {{ 'admin.settings.integrations.unsplash_intro' | transloco }}
                                </p>

                                <div class="setup-step">
                                    <div class="step-number-badge unsplash-badge">1</div>
                                    <div class="step-content">
                                        <h6 class="step-title">{{ 'admin.settings.integrations.unsplash_s1_title' | transloco }}</h6>
                                        <ol class="step-instructions">
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s1_a' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s1_b' | transloco"></li>
                                            <li>{{ 'admin.settings.integrations.unsplash_s1_c' | transloco }}</li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step">
                                    <div class="step-number-badge unsplash-badge">2</div>
                                    <div class="step-content">
                                        <h6 class="step-title">{{ 'admin.settings.integrations.unsplash_s2_title' | transloco }}</h6>
                                        <ol class="step-instructions">
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s2_a' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s2_b' | transloco"></li>
                                            <li>{{ 'admin.settings.integrations.unsplash_s2_c' | transloco }}</li>
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s2_d' | transloco"></li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step last">
                                    <div class="step-number-badge unsplash-badge">3</div>
                                    <div class="step-content">
                                        <h6 class="step-title">{{ 'admin.settings.integrations.unsplash_s3_title' | transloco }}</h6>
                                        <ol class="step-instructions">
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s3_a' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s3_b' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.unsplash_s3_c' | transloco"></li>
                                        </ol>
                                        <p class="step-note">
                                            <i class="fa-solid fa-circle-info me-1"></i>
                                            {{ 'admin.settings.integrations.unsplash_note' | transloco }}
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
                                            <mat-label>{{ 'admin.settings.integrations.access_key' | transloco }}</mat-label>
                                            <input
                                                matInput
                                                formControlName="accessKey"
                                                [type]="showAccessKey() ? 'text' : 'password'"
                                                [placeholder]="'admin.settings.integrations.access_key_placeholder' | transloco"
                                                autocomplete="off"
                                            />
                                            <button
                                                mat-icon-button
                                                matSuffix
                                                type="button"
                                                (click)="showAccessKey.set(!showAccessKey())"
                                                [matTooltip]="(showAccessKey() ? 'common.actions.hide' : 'common.actions.show') | transloco"
                                                aria-label="Toggle access key visibility"
                                            >
                                                <mat-icon>{{ showAccessKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                                            </button>
                                        </mat-form-field>
                                    </div>

                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>{{ 'admin.settings.integrations.secret_key' | transloco }}</mat-label>
                                            <input
                                                matInput
                                                formControlName="secretKey"
                                                [type]="showSecretKey() ? 'text' : 'password'"
                                                [placeholder]="'admin.settings.integrations.secret_key_placeholder' | transloco"
                                                autocomplete="off"
                                            />
                                            <button
                                                mat-icon-button
                                                matSuffix
                                                type="button"
                                                (click)="showSecretKey.set(!showSecretKey())"
                                                [matTooltip]="(showSecretKey() ? 'common.actions.hide' : 'common.actions.show') | transloco"
                                                aria-label="Toggle secret key visibility"
                                            >
                                                <mat-icon>{{ showSecretKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                                            </button>
                                        </mat-form-field>
                                    </div>
                                </div>

                                <p class="hint-text">
                                    <i class="fa-solid fa-circle-info me-1"></i>
                                    <span [innerHTML]="'admin.settings.integrations.unsplash_hint' | transloco"></span>
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
                                    {{ 'common.actions.cancel' | transloco }}
                                </button>
                                <button
                                    mat-raised-button
                                    color="primary"
                                    type="submit"
                                    [disabled]="isSavingUnsplash() || unsplashForm.pristine"
                                >
                                    @if (isSavingUnsplash()) {
                                        <mat-spinner diameter="20" class="me-2"></mat-spinner>
                                        {{ 'common.actions.saving' | transloco }}
                                    } @else {
                                        <i class="fa-solid fa-floppy-disk me-2"></i>
                                        {{ 'admin.settings.integrations.save_unsplash' | transloco }}
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
                            {{ 'admin.settings.integrations.geo' | transloco }}
                        </mat-card-title>
                        <mat-card-subtitle>
                            {{ 'admin.settings.integrations.geo_subtitle' | transloco }}
                        </mat-card-subtitle>
                    </mat-card-header>

                    <mat-card-content class="pt-3">
                        <!-- Geolocation Setup Guide -->
                        <div class="setup-guide-section">
                            <div class="setup-guide-header" (click)="showGeoGuide.set(!showGeoGuide())">
                                <i class="fa-solid fa-location-dot guide-icon geo-accent me-2"></i>
                                <span class="setup-guide-title">{{ 'admin.settings.integrations.geo_guide' | transloco }}</span>
                                <button mat-icon-button type="button" class="toggle-btn">
                                    <mat-icon>{{ showGeoGuide() ? 'expand_less' : 'expand_more' }}</mat-icon>
                                </button>
                            </div>

                            @if (showGeoGuide()) {
                            <div class="setup-guide-body">
                                <p class="guide-intro geo-intro">
                                    {{ 'admin.settings.integrations.geo_intro' | transloco }}
                                </p>

                                <div class="setup-step">
                                    <div class="step-number-badge geo-badge">1</div>
                                    <div class="step-content">
                                        <h6 class="step-title">{{ 'admin.settings.integrations.geo_s1_title' | transloco }}</h6>
                                        <ol class="step-instructions">
                                            <li [innerHTML]="'admin.settings.integrations.geo_s1_a' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.geo_s1_b' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.geo_s1_c' | transloco"></li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step">
                                    <div class="step-number-badge geo-badge">2</div>
                                    <div class="step-content">
                                        <h6 class="step-title">{{ 'admin.settings.integrations.geo_s2_title' | transloco }}</h6>
                                        <ol class="step-instructions">
                                            <li [innerHTML]="'admin.settings.integrations.geo_s2_a' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.geo_s2_b' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.integrations.geo_s2_c' | transloco"></li>
                                        </ol>
                                    </div>
                                </div>

                                <div class="setup-step last">
                                    <div class="step-number-badge geo-badge">3</div>
                                    <div class="step-content">
                                        <h6 class="step-title">{{ 'admin.settings.integrations.geo_s3_title' | transloco }}</h6>
                                        <ol class="step-instructions">
                                            <li [innerHTML]="'admin.settings.integrations.geo_s3_a' | transloco"></li>
                                            <li>{{ 'admin.settings.integrations.geo_s3_b' | transloco }}</li>
                                            <li [innerHTML]="'admin.settings.integrations.geo_s3_c' | transloco"></li>
                                        </ol>
                                        <p class="step-note">
                                            <i class="fa-solid fa-circle-info me-1"></i>
                                            {{ 'admin.settings.integrations.geo_note' | transloco }}
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
                                        {{ 'admin.settings.integrations.geo_enable' | transloco }}
                                    </mat-slide-toggle>
                                    <p class="hint-text mt-1">
                                        {{ 'admin.settings.integrations.geo_disabled_hint' | transloco }}
                                    </p>
                                </div>

                                @if (geoForm.get('geoEnabled')?.value) {
                                <div class="row">
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>{{ 'admin.settings.integrations.geo_provider' | transloco }}</mat-label>
                                            <mat-select formControlName="geoApiProvider">
                                                <mat-option value="ipapi">{{ 'admin.settings.integrations.geo_ipapi_option' | transloco }}</mat-option>
                                                <mat-option value="ipinfo">{{ 'admin.settings.integrations.geo_ipinfo_option' | transloco }}</mat-option>
                                                <mat-option value="custom">{{ 'admin.settings.integrations.geo_custom_option' | transloco }}</mat-option>
                                            </mat-select>
                                        </mat-form-field>
                                    </div>

                                    @if (geoForm.get('geoApiProvider')?.value === 'ipapi') {
                                    <div class="col-md-6 d-flex align-items-center">
                                        <p class="hint-text mb-0">
                                            <i class="fa-solid fa-circle-check text-success me-1"></i>
                                            {{ 'admin.settings.integrations.geo_ipapi_hint' | transloco }}
                                        </p>
                                    </div>
                                    }

                                    @if (geoForm.get('geoApiProvider')?.value === 'ipinfo') {
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>{{ 'admin.settings.integrations.geo_token' | transloco }}</mat-label>
                                            <input
                                                matInput
                                                formControlName="geoApiKey"
                                                [placeholder]="'admin.settings.integrations.geo_token_placeholder' | transloco"
                                                autocomplete="off"
                                            />
                                            <mat-hint [innerHTML]="'admin.settings.integrations.geo_token_hint' | transloco"></mat-hint>
                                        </mat-form-field>
                                    </div>
                                    }

                                    @if (geoForm.get('geoApiProvider')?.value === 'custom') {
                                    <div class="col-md-6">
                                        <mat-form-field appearance="outline" class="w-100">
                                            <mat-label>{{ 'admin.settings.integrations.geo_key' | transloco }}</mat-label>
                                            <input
                                                matInput
                                                formControlName="geoApiKey"
                                                [placeholder]="'admin.settings.integrations.geo_key_placeholder' | transloco"
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
                                            <mat-label>{{ 'admin.settings.integrations.geo_endpoint' | transloco }}</mat-label>
                                            <input
                                                matInput
                                                formControlName="geoApiEndpoint"
                                                [placeholder]="'admin.settings.integrations.geo_endpoint_placeholder' | transloco"
                                                autocomplete="off"
                                            />
                                            <mat-hint>{{ 'admin.settings.integrations.geo_endpoint_hint' | transloco }}</mat-hint>
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
                                    {{ 'common.actions.cancel' | transloco }}
                                </button>
                                <button
                                    mat-raised-button
                                    color="primary"
                                    type="submit"
                                    [disabled]="isSavingGeo() || geoForm.pristine"
                                >
                                    @if (isSavingGeo()) {
                                        <mat-spinner diameter="20" class="me-2"></mat-spinner>
                                        {{ 'common.actions.saving' | transloco }}
                                    } @else {
                                        <i class="fa-solid fa-floppy-disk me-2"></i>
                                        {{ 'admin.settings.integrations.save_geo' | transloco }}
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
            this.notify.success('admin.settings.integrations.unsplash_saved');
        } catch (error) {
            console.error('Error saving Unsplash settings:', error);
            this.notify.error('admin.settings.integrations.unsplash_save_failed');
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
            this.notify.success('admin.settings.integrations.geo_saved');
        } catch (error) {
            console.error('Error saving Geolocation settings:', error);
            this.notify.error('admin.settings.integrations.geo_save_failed');
        } finally {
            this.isSavingGeo.set(false);
        }
    }
}
