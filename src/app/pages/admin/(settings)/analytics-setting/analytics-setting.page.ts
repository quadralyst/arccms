import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
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
        RouterLink,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
    ],
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
                        <h3>Analytics Not Connected</h3>
                        <p class="text-muted">
                            Connect your Google Analytics property to see real-time website metrics
                            like sessions, users, and bounce rate on the dashboard.
                        </p>
                        <button mat-flat-button color="primary" (click)="showSetup.set(true)">
                            <i class="fa-solid fa-gear me-2"></i>
                            Configure Analytics
                        </button>
                    </div>
                </div>
            } @else {
                <h3 class="settings-title">Google Analytics</h3>
                <p class="text-muted mb-4">Connect your GA4 property to see website analytics on the dashboard.</p>

                <!-- Panel 1: Setup Guide -->
                <mat-card class="mb-4 setup-guide-card">
                    <div class="setup-guide-header" (click)="showSetupGuide.set(!showSetupGuide())">
                        <i class="fa-solid fa-book-open me-2"></i>
                        <span class="setup-guide-title">Setup Guide</span>
                        <button mat-icon-button type="button" class="toggle-btn">
                            <mat-icon>{{ showSetupGuide() ? 'expand_less' : 'expand_more' }}</mat-icon>
                        </button>
                    </div>

                    @if (showSetupGuide()) {
                    <mat-card-content class="pt-3">
                        <p class="guide-intro">
                            Follow these 3 steps to connect Google Analytics to your dashboard. This is a one-time setup that takes about 5 minutes.
                        </p>

                        <!-- Step 1 -->
                        <div class="setup-step">
                            <div class="step-number-badge">1</div>
                            <div class="step-content">
                                <h6 class="step-title">Enable the Google Analytics API</h6>
                                <ol class="step-instructions">
                                    <li>
                                        Open the
                                        <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a>
                                    </li>
                                    <li>
                                        Select your Firebase project from the project dropdown at the top (it has the same name as your Firebase project)
                                    </li>
                                    <li>
                                        Go to <strong>APIs &amp; Services</strong> &rarr; <strong>Library</strong>
                                        (or
                                        <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer">click here</a>)
                                    </li>
                                    <li>
                                        Search for <strong>"Google Analytics API"</strong>, click on it and press <strong>Enable</strong>
                                    </li>
                                    <li>
                                        Go back to the Library and also search for and enable <strong>"Google Analytics Admin API"</strong>
                                    </li>
                                </ol>
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div class="setup-step">
                            <div class="step-number-badge">2</div>
                            <div class="step-content">
                                <h6 class="step-title">Create OAuth Credentials</h6>
                                <ol class="step-instructions">
                                    <li>
                                        In Google Cloud Console, go to <strong>APIs &amp; Services</strong> &rarr; <strong>Credentials</strong>
                                        (or
                                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">click here</a>)
                                    </li>
                                    <li>
                                        Click <strong>+ Create Credentials</strong> at the top and select <strong>OAuth client ID</strong>
                                    </li>
                                    <li>
                                        If prompted to configure the <strong>OAuth consent screen</strong> first:
                                        <ul>
                                            <li>Choose <strong>External</strong> user type and click Create</li>
                                            <li>Fill in your <strong>App name</strong> and <strong>User support email</strong></li>
                                            <li>Add your email under <strong>Developer contact information</strong></li>
                                            <li>Click <strong>Save and Continue</strong> through the remaining steps</li>
                                        </ul>
                                    </li>
                                    <li>
                                        For <strong>Application type</strong>, select <strong>Web application</strong>
                                    </li>
                                    <li>
                                        Give it a name (e.g. "Arc CMS Analytics")
                                    </li>
                                    <li>
                                        Under <strong>Authorized JavaScript origins</strong>, click <strong>+ Add URI</strong> and add these URLs:
                                        <ul>
                                            <li>
                                                <code>{{ siteOrigin }}</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard(siteOrigin)" matTooltip="Copy">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                                (your live site)
                                            </li>
                                            <li>
                                                <code>http://localhost:5173</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard('http://localhost:5173')" matTooltip="Copy">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                                (for local development)
                                            </li>
                                            <li>
                                                <code>http://localhost</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard('http://localhost')" matTooltip="Copy">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                                (required by Google)
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        Under <strong>Authorized redirect URIs</strong>, click <strong>+ Add URI</strong> and add the same URLs:
                                        <ul>
                                            <li>
                                                <code>{{ siteOrigin }}</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard(siteOrigin)" matTooltip="Copy">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                            </li>
                                            <li>
                                                <code>http://localhost:5173</code>
                                                <button class="copy-btn" type="button" (click)="copyToClipboard('http://localhost:5173')" matTooltip="Copy">
                                                    <i class="fa-regular fa-copy"></i>
                                                </button>
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        Click <strong>Create</strong>
                                    </li>
                                    <li>
                                        A dialog will show your <strong>Client ID</strong> and <strong>Client Secret</strong> — copy both values
                                    </li>
                                    <li>
                                        Google will also offer to download a JSON file. You don't need the JSON file — just the Client ID and Client Secret values that you copied above
                                    </li>
                                </ol>
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div class="setup-step last">
                            <div class="step-number-badge">3</div>
                            <div class="step-content">
                                <h6 class="step-title">Save &amp; Connect</h6>
                                <ol class="step-instructions">
                                    <li>
                                        Paste the <strong>Client ID</strong> and <strong>Client Secret</strong> in the <strong>OAuth Credentials</strong> form below and click <strong>Save Credentials</strong>
                                    </li>
                                    <li>
                                        Click the <strong>Connect Google Analytics</strong> button at the bottom of this page
                                    </li>
                                    <li>
                                        A Google popup will appear — sign in with the Google account that has access to your Analytics property and click <strong>Allow</strong>
                                    </li>
                                    <li>
                                        Your GA4 property will be detected automatically and analytics data will appear on the dashboard
                                    </li>
                                </ol>
                                <p class="step-note">
                                    <i class="fa-solid fa-circle-info me-1"></i>
                                    <strong>Why is this step needed?</strong> Saving the credentials identifies your app to Google.
                                    The Connect button opens a Google popup where you grant permission for your app to read your Analytics data.
                                    This is a one-time authorization.
                                </p>
                            </div>
                        </div>
                    </mat-card-content>
                    }
                </mat-card>

                <!-- Panel 2: OAuth Credentials Form -->
                <form [formGroup]="analyticsForm" (ngSubmit)="onSubmit()">
                    <mat-card class="mb-4">
                        <mat-card-header>
                            <mat-card-title>
                                <i class="fa-brands fa-google me-2"></i>
                                OAuth Credentials
                                @if (hasCredentials()) {
                                    <span class="configured-badge">
                                        <i class="fa-solid fa-check-circle me-1"></i> Configured
                                    </span>
                                }
                            </mat-card-title>
                            <mat-card-subtitle>
                                Enter the credentials from the Google Cloud Console.
                                They are stored securely and only used server-side.
                            </mat-card-subtitle>
                        </mat-card-header>

                        <mat-card-content class="pt-3" formGroupName="oauth">
                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>OAuth Client ID</mat-label>
                                        <input
                                            matInput
                                            formControlName="clientId"
                                            placeholder="xxxx.apps.googleusercontent.com"
                                            autocomplete="off"
                                        />
                                        @if (analyticsForm.get('oauth.clientId')?.hasError('required') &&
                                             analyticsForm.get('oauth.clientId')?.touched) {
                                            <mat-error>Client ID is required</mat-error>
                                        }
                                    </mat-form-field>
                                </div>

                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>OAuth Client Secret</mat-label>
                                        <input
                                            matInput
                                            formControlName="clientSecret"
                                            [type]="showSecret() ? 'text' : 'password'"
                                            placeholder="Your Client Secret"
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
                                            <mat-error>Client Secret is required</mat-error>
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
                            Cancel
                        </button>
                        <button
                            mat-raised-button
                            color="primary"
                            type="submit"
                            [disabled]="isSaving() || analyticsForm.pristine || analyticsForm.invalid"
                        >
                            @if (isSaving()) {
                                <mat-spinner diameter="20" class="me-2"></mat-spinner>
                                Saving...
                            } @else {
                                <i class="fa-solid fa-floppy-disk me-2"></i>
                                Save Credentials
                            }
                        </button>
                    </div>
                </form>

                <!-- Panel 3: Connect to Google Analytics -->
                <mat-card class="mb-4">
                    <mat-card-header>
                        <mat-card-title>
                            <i class="fa-solid fa-plug me-2"></i>
                            Google Analytics Connection
                        </mat-card-title>
                    </mat-card-header>
                    <mat-card-content class="pt-3">
                        @if (connectionStatus.isConnected()) {
                            <div class="d-flex align-items-center gap-3 flex-wrap">
                                <span class="badge bg-success py-2 px-3">
                                    <i class="fa-solid fa-check-circle me-1"></i> Connected
                                </span>
                                @if (connectionStatus.propertyName()) {
                                    <span class="text-muted">
                                        Property: <strong>{{ connectionStatus.propertyName() }}</strong>
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
                                        Disconnecting...
                                    } @else {
                                        <i class="fa-solid fa-unlink me-1"></i> Disconnect
                                    }
                                </button>
                            </div>
                        } @else if (hasCredentials()) {
                            <div class="text-center py-4">
                                <p class="text-muted mb-3">
                                    Your OAuth credentials are saved. Click below to authorize access to your Google Analytics data.
                                </p>
                                <button
                                    class="btn btn-primary btn-lg"
                                    (click)="connectGoogleAnalytics()"
                                    [disabled]="isConnecting()"
                                >
                                    @if (isConnecting()) {
                                        <span class="spinner-border spinner-border-sm me-2"></span> Connecting...
                                    } @else {
                                        <i class="fa-brands fa-google me-2"></i> Connect Google Analytics
                                    }
                                </button>
                                <p class="gmail-hint mt-3">
                                    <i class="fa-solid fa-circle-info me-1"></i>
                                    Use the same Google account that you used to create your Firebase project.
                                </p>
                            </div>
                        } @else {
                            <div class="text-center py-4">
                                <p class="text-muted mb-0">
                                    <i class="fa-solid fa-circle-info me-2"></i>
                                    Please save your OAuth credentials above first, then you can connect to Google Analytics.
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
            this.toastService.success('Analytics credentials saved successfully.');
        } catch (error) {
            console.error('Error saving analytics settings:', error);
            this.toastService.error('Failed to save analytics settings. Please try again.');
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
            this.toastService.success('Google Analytics disconnected.');
        } catch (error) {
            console.error('Error disconnecting analytics:', error);
            this.toastService.error('Failed to disconnect. Please try again.');
        } finally {
            this.isDisconnecting.set(false);
        }
    }

    async connectGoogleAnalytics(): Promise<void> {
        this.isConnecting.set(true);
        try {
            const clientId = this.analyticsForm.get('oauth.clientId')?.value;
            if (!clientId) {
                this.toastService.error('Please save your OAuth credentials first.');
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
                this.toastService.success(`Connected to ${result.selectedProperty.displayName}`);
            } else if (result.allProperties?.length) {
                this.openPropertySelectionDialog(result.allProperties);
            } else {
                this.toastService.success('Google Analytics connected.');
            }
        } catch (error: any) {
            if (error?.message === 'popup_closed_by_user') return;
            console.error('Connect GA error:', error);
            this.toastService.error(error?.message || 'Failed to connect Google Analytics.');
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
                        this.toastService.success(`Connected to ${selected.displayName}`);
                    } catch (error: any) {
                        this.toastService.error(error?.message || 'Failed to select property.');
                    }
                }
            });
        });
    }

    copyToClipboard(text: string): void {
        navigator.clipboard.writeText(text).then(() => {
            this.toastService.success('Copied to clipboard');
        }).catch(() => {
            this.toastService.error('Failed to copy');
        });
    }
}
