import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { AnalyticsConnectionStatusService } from '../../../../../shared/services/analytics-connection-status.service';
import { GoogleOAuthService } from '../../../../../shared/services/google-oauth.service';
import { roleGuard } from '../../../../guards/role.guard';
import { AnalyticsSettingService } from './analytics-setting.service';
import { DEFAULT_ANALYTICS_SETTINGS, IAnalyticsSettings } from './analytics-setting.model';

export const routeMeta: RouteMeta = {
    title: 'Analytics Settings | Arc CMS',
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
        MatTooltipModule, TranslocoPipe],
    template: `
        <div class="analytics-settings">
            @if (isLoading()) {
                <div class="disabled-state">
                    <div class="disabled-content">
                        <mat-spinner diameter="40"></mat-spinner>
                    </div>
                </div>
            } @else if (!connectionStatus.isConnected() && !hasCredentials() && !showSetup()) {
                <!-- Disabled State — matches Email Settings pattern -->
                <div class="disabled-state">
                    <div class="disabled-content">
                        <div class="disabled-icon">
                            <i class="fa-solid fa-chart-line"></i>
                        </div>
                        <h3>{{ 'admin.settings.analytics.not_connected' | transloco }}</h3>
                        <p class="text-muted">
                            {{ 'admin.settings.analytics.connect_intro' | transloco }}
                        </p>
                        <button mat-flat-button color="primary" (click)="showSetup.set(true)">
                            <i class="fa-solid fa-gear me-2"></i>
                            {{ 'admin.settings.analytics.configure' | transloco }}
                        </button>
                    </div>
                </div>
            } @else {
                <h3 class="settings-title">{{ 'admin.settings.analytics.title' | transloco }}</h3>
                <p class="text-muted mb-4">{{ 'admin.settings.analytics.subtitle' | transloco }}</p>

                <!-- Panel 1: Setup Guide -->
                <mat-card class="mb-4 setup-guide-card">
                    <div class="setup-guide-header" (click)="showSetupGuide.set(!showSetupGuide())">
                        <i class="fa-solid fa-book-open me-2"></i>
                        <span class="setup-guide-title">{{ 'admin.settings.analytics.guide' | transloco }}</span>
                        <button mat-icon-button type="button" class="toggle-btn">
                            <mat-icon>{{ showSetupGuide() ? 'expand_less' : 'expand_more' }}</mat-icon>
                        </button>
                    </div>

                    @if (showSetupGuide()) {
                    <mat-card-content class="pt-3">
                        <p class="guide-intro">
                            {{ 'admin.settings.analytics.intro' | transloco }}
                        </p>

                        <!-- Step 1 -->
                        <div class="setup-step">
                            <div class="step-number-badge">1</div>
                            <div class="step-content">
                                <h6 class="step-title">{{ 'admin.settings.analytics.s1_title' | transloco }}</h6>
                                <ol class="step-instructions">
                                    <li [innerHTML]="'admin.settings.analytics.s1_a' | transloco"></li>
                                    <li>{{ 'admin.settings.analytics.s1_b' | transloco }}</li>
                                    <li [innerHTML]="'admin.settings.analytics.s1_c' | transloco"></li>
                                    <li [innerHTML]="'admin.settings.analytics.s1_d' | transloco"></li>
                                    <li [innerHTML]="'admin.settings.analytics.s1_e' | transloco"></li>
                                </ol>
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div class="setup-step">
                            <div class="step-number-badge">2</div>
                            <div class="step-content">
                                <h6 class="step-title">{{ 'admin.settings.analytics.s2_title' | transloco }}</h6>
                                <ol class="step-instructions">
                                    <li [innerHTML]="'admin.settings.analytics.s2_a' | transloco"></li>
                                    <li [innerHTML]="'admin.settings.analytics.s2_b' | transloco"></li>
                                    <li>
                                        <span [innerHTML]="'admin.settings.analytics.s2_c' | transloco"></span>
                                        <ul>
                                            <li [innerHTML]="'admin.settings.analytics.s2_c1' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.analytics.s2_c2' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.analytics.s2_c3' | transloco"></li>
                                            <li [innerHTML]="'admin.settings.analytics.s2_c4' | transloco"></li>
                                        </ul>
                                    </li>
                                    <li [innerHTML]="'admin.settings.analytics.s2_d' | transloco"></li>
                                    <li>{{ 'admin.settings.analytics.s2_e' | transloco }}</li>
                                    <li>
                                        <span [innerHTML]="'admin.settings.analytics.s2_f' | transloco"></span>
                                        <ul>
                                            <li>
                                                <code>{{ siteOrigin }}</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard(siteOrigin)" [matTooltip]="'common.actions.copy' | transloco">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                                {{ 'admin.settings.analytics.live_site' | transloco }}
                                            </li>
                                            <li>
                                                <code>http://localhost:5173</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard('http://localhost:5173')" [matTooltip]="'common.actions.copy' | transloco">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                                {{ 'admin.settings.analytics.local_dev' | transloco }}
                                            </li>
                                            <li>
                                                <code>http://localhost</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard('http://localhost')" [matTooltip]="'common.actions.copy' | transloco">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                                {{ 'admin.settings.analytics.required_by_google' | transloco }}
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        <span [innerHTML]="'admin.settings.analytics.s2_g' | transloco"></span>
                                        <ul>
                                            <li>
                                                <code>{{ siteOrigin }}</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard(siteOrigin)" [matTooltip]="'common.actions.copy' | transloco">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                            </li>
                                            <li>
                                                <code>http://localhost:5173</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard('http://localhost:5173')" [matTooltip]="'common.actions.copy' | transloco">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                            </li>
                                        </ul>
                                    </li>
                                    <li [innerHTML]="'admin.settings.analytics.s2_h' | transloco"></li>
                                    <li [innerHTML]="'admin.settings.analytics.s2_i' | transloco"></li>
                                    <li>{{ 'admin.settings.analytics.s2_j' | transloco }}</li>
                                </ol>
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div class="setup-step last">
                            <div class="step-number-badge">3</div>
                            <div class="step-content">
                                <h6 class="step-title">{{ 'admin.settings.analytics.s3_title' | transloco }}</h6>
                                <ol class="step-instructions">
                                    <li [innerHTML]="'admin.settings.analytics.s3_a' | transloco"></li>
                                    <li [innerHTML]="'admin.settings.analytics.s3_b' | transloco"></li>
                                    <li [innerHTML]="'admin.settings.analytics.s3_c' | transloco"></li>
                                    <li>{{ 'admin.settings.analytics.s3_d' | transloco }}</li>
                                </ol>
                                <p class="step-note">
                                    <i class="fa-solid fa-circle-info me-1"></i>
                                    <span [innerHTML]="'admin.settings.analytics.why_note' | transloco"></span>
                                </p>
                            </div>
                        </div>
                    </mat-card-content>
                    }
                </mat-card>

                <!-- Panel 2: {{ 'admin.settings.analytics.oauth_credentials' | transloco }} Form -->
                <form [formGroup]="analyticsForm" (ngSubmit)="onSubmit()">
                    <mat-card class="mb-4">
                        <mat-card-header>
                            <mat-card-title>
                                <i class="fa-brands fa-google me-2"></i>
                                {{ 'admin.settings.analytics.oauth_credentials' | transloco }}
                                @if (hasCredentials()) {
                                    <span class="configured-badge">
                                        <i class="fa-solid fa-check-circle me-1"></i> {{ 'admin.settings.analytics.configured' | transloco }}
                                    </span>
                                }
                            </mat-card-title>
                            <mat-card-subtitle>
                                {{ 'admin.settings.analytics.creds_hint' | transloco }}
                            </mat-card-subtitle>
                        </mat-card-header>

                        <mat-card-content class="pt-3" formGroupName="oauth">
                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>{{ 'admin.settings.analytics.client_id' | transloco }}</mat-label>
                                        <input
                                            matInput
                                            formControlName="clientId"
                                            [placeholder]="'admin.settings.analytics.client_id_placeholder' | transloco"
                                            autocomplete="off"
                                        />
                                        @if (analyticsForm.get('oauth.clientId')?.hasError('required') &&
                                             analyticsForm.get('oauth.clientId')?.touched) {
                                            <mat-error>{{ 'admin.settings.analytics.client_id_required' | transloco }}</mat-error>
                                        }
                                    </mat-form-field>
                                </div>

                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>{{ 'admin.settings.analytics.client_secret' | transloco }}</mat-label>
                                        <input
                                            matInput
                                            formControlName="clientSecret"
                                            [type]="showSecret() ? 'text' : 'password'"
                                            [placeholder]="'admin.settings.analytics.client_secret_placeholder' | transloco"
                                            autocomplete="off"
                                        />
                                        <button
                                            mat-icon-button
                                            matSuffix
                                            type="button"
                                            (click)="showSecret.set(!showSecret())"
                                            [matTooltip]="showSecret() ? 'Hide' : 'Show'"
                                            aria-label="Toggle client secret visibility"
                                        >
                                            <mat-icon>{{ showSecret() ? 'visibility_off' : 'visibility' }}</mat-icon>
                                        </button>
                                        @if (analyticsForm.get('oauth.clientSecret')?.hasError('required') &&
                                             analyticsForm.get('oauth.clientSecret')?.touched) {
                                            <mat-error>{{ 'admin.settings.analytics.client_secret_required' | transloco }}</mat-error>
                                        }
                                    </mat-form-field>
                                </div>
                            </div>
                        </mat-card-content>
                    </mat-card>

                    <!-- Save Button -->
                    <div class="d-flex justify-content-end gap-2 mb-4">
                        <button
                            mat-stroked-button
                            type="button"
                            (click)="resetForm()"
                            [disabled]="isSaving() || analyticsForm.pristine"
                        >
                            {{ 'common.actions.cancel' | transloco }}
                        </button>
                        <button
                            mat-raised-button
                            color="primary"
                            type="submit"
                            [disabled]="isSaving() || analyticsForm.pristine || analyticsForm.invalid"
                        >
                            @if (isSaving()) {
                                <mat-spinner diameter="20" class="me-2"></mat-spinner>
                                {{ 'common.actions.saving' | transloco }}
                            } @else {
                                <i class="fa-solid fa-floppy-disk me-2"></i>
                                {{ 'admin.settings.analytics.save_credentials' | transloco }}
                            }
                        </button>
                    </div>
                </form>

                <!-- Panel 3: Connect to Google Analytics -->
                <mat-card class="mb-4">
                    <mat-card-header>
                        <mat-card-title>
                            <i class="fa-solid fa-plug me-2"></i>
                            {{ 'admin.settings.analytics.connection' | transloco }}
                        </mat-card-title>
                    </mat-card-header>
                    <mat-card-content class="pt-3">
                        @if (connectionStatus.isConnected()) {
                            <div class="d-flex align-items-center gap-3 flex-wrap">
                                <span class="badge bg-success py-2 px-3">
                                    <i class="fa-solid fa-check-circle me-1"></i> {{ 'admin.settings.analytics.connected' | transloco }}
                                </span>
                                @if (connectionStatus.propertyName()) {
                                    <span class="text-muted">
                                        {{ 'admin.settings.analytics.property' | transloco }} <strong>{{ connectionStatus.propertyName() }}</strong>
                                        ({{ connectionStatus.propertyId() }})
                                    </span>
                                }
                                <button
                                    mat-stroked-button
                                    color="warn"
                                    type="button"
                                    class="ms-auto"
                                    (click)="onDisconnect()"
                                    [disabled]="isDisconnecting()"
                                >
                                    @if (isDisconnecting()) {
                                        <mat-spinner diameter="18" class="me-1"></mat-spinner>
                                        {{ 'admin.settings.analytics.disconnecting' | transloco }}
                                    } @else {
                                        <i class="fa-solid fa-unlink me-1"></i> {{ 'admin.settings.analytics.disconnect' | transloco }}
                                    }
                                </button>
                            </div>
                        } @else if (hasCredentials()) {
                            <div class="text-center py-4">
                                <p class="text-muted mb-3">
                                    {{ 'admin.settings.analytics.saved_hint' | transloco }}
                                </p>
                                <button
                                    class="btn btn-primary btn-lg"
                                    (click)="connectGoogleAnalytics()"
                                    [disabled]="isConnecting()"
                                >
                                    @if (isConnecting()) {
                                        <span class="spinner-border spinner-border-sm me-2"></span> {{ 'admin.settings.analytics.connecting' | transloco }}
                                    } @else {
                                        <i class="fa-brands fa-google me-2"></i> {{ 'admin.settings.analytics.connect_button' | transloco }}
                                    }
                                </button>
                                <p class="gmail-hint mt-3">
                                    <i class="fa-solid fa-circle-info me-1"></i>
                                    {{ 'admin.settings.analytics.same_account' | transloco }}
                                </p>
                            </div>
                        } @else {
                            <div class="text-center py-4">
                                <p class="text-muted mb-0">
                                    <i class="fa-solid fa-circle-info me-2"></i>
                                    {{ 'admin.settings.analytics.save_first' | transloco }}
                                </p>
                            </div>
                        }
                    </mat-card-content>
                </mat-card>
            }
        </div>
    `,
    styles: [`
        .analytics-settings {
            max-width: 900px;
        }

        .settings-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #212529;
            margin-bottom: 4px;
        }

        /* Disabled / Not Configured State */
        .disabled-state {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 400px;
            padding: 40px;
        }

        .disabled-content {
            text-align: center;
            max-width: 400px;
        }

        .disabled-icon {
            font-size: 4rem;
            color: #dee2e6;
            margin-bottom: 24px;
        }

        .disabled-content h3 {
            font-size: 1.5rem;
            font-weight: 600;
            color: #495057;
            margin-bottom: 12px;
        }

        .disabled-content p {
            margin-bottom: 24px;
            line-height: 1.6;
        }

        mat-card {
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

        .configured-badge {
            display: inline-flex;
            align-items: center;
            font-size: 0.75rem;
            font-weight: 500;
            color: #198754;
            background: #d1e7dd;
            padding: 2px 8px;
            border-radius: 4px;
            margin-left: 10px;
            vertical-align: middle;
        }

        /* Setup Guide Header */
        .setup-guide-header {
            display: flex;
            align-items: center;
            padding: 16px;
            cursor: pointer;
            user-select: none;
            font-size: 1rem;
            font-weight: 600;
            color: #212529;
        }

        .setup-guide-header:hover {
            background-color: #f8f9fa;
        }

        .setup-guide-title {
            flex: 1;
        }

        .toggle-btn {
            margin-left: auto;
            flex-shrink: 0;
        }

        .guide-intro {
            font-size: 0.9rem;
            color: #495057;
            margin-bottom: 20px;
            padding: 10px 14px;
            background: #e7f1ff;
            border-radius: 6px;
            border-left: 3px solid #0d6efd;
        }

        .setup-step {
            display: flex;
            gap: 16px;
            padding-bottom: 24px;
            margin-bottom: 4px;
            position: relative;
        }

        /* Vertical connector line between steps */
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
            background: #0d6efd;
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

        .step-instructions ul {
            padding-left: 18px;
            margin: 4px 0 4px;
        }

        .step-instructions a {
            color: #0d6efd;
        }

        .step-instructions code {
            background: #f1f3f5;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 0.82rem;
            color: #c92a2a;
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

        .copy-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: #6c757d;
            padding: 2px 6px;
            font-size: 0.8rem;
            vertical-align: middle;
            border-radius: 3px;
            transition: all 0.15s ease;
        }

        .copy-btn:hover {
            color: #0d6efd;
            background: #e7f1ff;
        }

        .gmail-hint {
            font-size: 0.85rem;
            color: #6c757d;
            margin-bottom: 0;
        }
    `],
})
export default class AnalyticsSettingPageComponent extends BaseComponent implements OnInit {
    siteOrigin = window.location.origin;
    private fb = inject(FormBuilder);
    private analyticsSettingService = inject(AnalyticsSettingService);
    private googleOAuthService = inject(GoogleOAuthService);
    private dialog = inject(MatDialog);
    connectionStatus = inject(AnalyticsConnectionStatusService);

    analyticsForm!: FormGroup;

    isLoading = signal(true);
    isSaving = signal(false);
    isDisconnecting = signal(false);
    isConnecting = signal(false);
    showSecret = signal(false);
    showSetupGuide = signal(true);
    showSetup = signal(false);
    hasCredentials = signal(false);

    private originalValues: IAnalyticsSettings | null = null;

    ngOnInit(): void {
        this.initForm();
        this.loadSettings();
    }

    private initForm(): void {
        this.analyticsForm = this.fb.group({
            oauth: this.fb.group({
                clientId: ['', Validators.required],
                clientSecret: ['', Validators.required],
            }),
        });
    }

    private loadSettings(): void {
        this.analyticsSettingService.getAnalyticsSettings().subscribe({
            next: (settings) => {
                this.analyticsForm.patchValue(settings);
                this.analyticsForm.markAsPristine();
                this.originalValues = this.analyticsForm.getRawValue();
                this.hasCredentials.set(!!settings.oauth?.clientId);
                // Auto-collapse setup guide when credentials are already configured
                if (settings.oauth?.clientId) {
                    this.showSetupGuide.set(false);
                }
                this.isLoading.set(false);
            },
            error: () => {
                this.analyticsForm.patchValue(DEFAULT_ANALYTICS_SETTINGS);
                this.analyticsForm.markAsPristine();
                this.originalValues = this.analyticsForm.getRawValue();
                this.hasCredentials.set(false);
                this.isLoading.set(false);
            },
        });
    }

    resetForm(): void {
        if (this.originalValues) {
            this.analyticsForm.patchValue(this.originalValues);
            this.analyticsForm.markAsPristine();
        }
    }

    async onSubmit(): Promise<void> {
        if (this.analyticsForm.invalid || this.isSaving()) return;

        this.isSaving.set(true);
        try {
            await this.analyticsSettingService.saveAnalyticsSettings(
                this.analyticsForm.getRawValue(),
            );
            this.originalValues = this.analyticsForm.getRawValue();
            this.analyticsForm.markAsPristine();
            this.hasCredentials.set(true);
            this.showSetupGuide.set(false);
            this.notify.success('admin.settings.analytics.creds_saved');
        } catch (error) {
            console.error('Error saving analytics settings:', error);
            this.notify.error('admin.settings.analytics.creds_save_failed');
        } finally {
            this.isSaving.set(false);
        }
    }

    async onDisconnect(): Promise<void> {
        if (!confirm('Are you sure you want to disconnect Google Analytics? This will revoke access and clear all cached analytics data.')) {
            return;
        }

        this.isDisconnecting.set(true);
        try {
            await this.googleOAuthService.disconnectAnalytics();
            this.notify.success('admin.settings.analytics.disconnected');
        } catch (error) {
            console.error('Error disconnecting analytics:', error);
            this.notify.error('admin.settings.analytics.disconnect_failed');
        } finally {
            this.isDisconnecting.set(false);
        }
    }

    async connectGoogleAnalytics(): Promise<void> {
        this.isConnecting.set(true);
        try {
            const clientId = this.analyticsForm.get('oauth.clientId')?.value;
            if (!clientId) {
                this.notify.error('admin.settings.analytics.save_creds_first');
                return;
            }

            // Open Google consent popup
            const authCode = await this.googleOAuthService.requestAuthorizationCode(clientId);

            // Exchange code via cloud function
            // measurementId is read from Settings/analytics_status if available (reconnect scenario)
            const result = await this.googleOAuthService.connectAnalytics({
                authorizationCode: authCode,
                redirectUri: 'postmessage',
                measurementId: this.connectionStatus.measurementId?.() || '',
            });

            // Handle result
            if (result.selectedProperty) {
                this.notify.success('admin.settings.analytics.connected_to', { property: result.selectedProperty.displayName });
            } else if (result.allProperties?.length) {
                this.openPropertySelectionDialog(result.allProperties);
            } else {
                this.notify.success('admin.settings.analytics.connect_success');
            }
        } catch (error: any) {
            if (error?.message === 'popup_closed_by_user') return;
            console.error('Connect GA error:', error);
            error?.message ? this.notify.raw(error.message, 'error') : this.notify.error('admin.settings.analytics.connect_failed');
        } finally {
            this.isConnecting.set(false);
        }
    }

    private openPropertySelectionDialog(properties: any[]): void {
        import('../../(dashboard)/property-selection-dialog.component').then((m) => {
            const dialogRef = this.dialog.open(m.PropertySelectionDialogComponent, {
                data: { properties },
                width: '500px',
            });
            dialogRef.afterClosed().subscribe(async (selected) => {
                if (selected) {
                    try {
                        await this.googleOAuthService.selectProperty({
                            propertyId: selected.propertyId,
                            displayName: selected.displayName,
                        });
                        this.notify.success('admin.settings.analytics.connected_to', { property: selected.displayName });
                    } catch (error: any) {
                        error?.message ? this.notify.raw(error.message, 'error') : this.notify.error('admin.settings.analytics.select_property_failed');
                    }
                }
            });
        });
    }

    copyToClipboard(text: string): void {
        navigator.clipboard.writeText(text).then(() => {
            this.notify.success('admin.settings.analytics.copied');
        }).catch(() => {
            this.notify.error('admin.settings.analytics.copy_failed');
        });
    }
}
