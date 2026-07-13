import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter, firstValueFrom, Subscription } from 'rxjs';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Email Settings | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { EmailSettingService } from './email-setting.service';
import { TestConnectionDialogComponent } from './test-connection-dialog.component';
import { DEFAULT_EMAIL_FEATURES, EMAIL_FEATURE_META, EMAIL_PROVIDERS, EmailProvider, IEmailSettings, PROVIDER_DEFAULT_LIMITS } from './email-setting.model';
import { IEmailProviderComponent } from './providers/email-provider-base';
import { SmtpProviderComponent } from './providers/smtp-provider.component';
import { GmailProviderComponent } from './providers/gmail-provider.component';
import { ResendProviderComponent } from './providers/resend-provider.component';
import { DebugProviderComponent } from './providers/debug-provider.component';

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
        MatSlideToggleModule,
        MatRadioModule,
        SmtpProviderComponent,
        GmailProviderComponent,
        ResendProviderComponent,
        DebugProviderComponent,
    ],
    templateUrl: './email-setting.page.html',
    styleUrls: ['./email-setting.page.scss'],
})
export default class EmailSettingPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private emailSettingService = inject(EmailSettingService);
    private dialog = inject(MatDialog);
    private destroyRef = inject(DestroyRef);

    emailForm!: FormGroup;
    providers = EMAIL_PROVIDERS;
    featureMeta = EMAIL_FEATURE_META;

    emailEnabled = signal(false);
    /** True while the admin is configuring a provider but email is not yet enabled. */
    configuring = signal(false);
    showProviderList = signal(false);
    isLoading = signal(true);
    isSaving = signal(false);
    isTesting = signal(false);
    testPassed = signal(false);
    gmailSenderLocked = signal(false);

    /** Reference to the currently active provider component */
    activeProviderComponent = signal<IEmailProviderComponent | null>(null);

    /** Cached provider form data so switching back restores previous values */
    providerFormCache: Partial<Record<EmailProvider, any>> = {};

    /** Subscription to the active provider's form changes; cleaned up on provider switch */
    private providerFormSub: Subscription | null = null;

    ngOnInit(): void {
        this.initForm();
        this.loadSettings();
        this.setupFormChangeListener();
    }

    private initForm(): void {
        this.emailForm = this.fb.group({
            isEnabled: [false],
            activeProvider: ['smtp'],
            senderEmail: ['', [Validators.email]],
            senderName: [''],
            replyToEmail: ['', Validators.email],
            bccEmail: ['', [Validators.email]],
            rateLimit: this.fb.group({
                maxEmails: [1, [Validators.required, Validators.min(1)]],
                interval: ['second'],
            }),
            providerRateLimits: this.fb.group({
                smtp: this.fb.group({
                    perSecond: [1, [Validators.required, Validators.min(1)]],
                    perHour: [null as number | null],
                    perDay: [null as number | null],
                }),
                gmail: this.fb.group({
                    perSecond: [1, [Validators.required, Validators.min(1)]],
                    perHour: [null as number | null],
                    perDay: [500],
                }),
                resend: this.fb.group({
                    perSecond: [2, [Validators.required, Validators.min(1)]],
                    perHour: [null as number | null],
                    perDay: [100],
                }),
            }),
            autoPurge: this.fb.group({
                enabled: [true],
                retentionDays: [60, [Validators.required, Validators.min(1), Validators.max(365)]],
            }),
            features: this.fb.group({
                waitlistEmails: [DEFAULT_EMAIL_FEATURES.waitlistEmails],
                authEmails: [DEFAULT_EMAIL_FEATURES.authEmails],
                paymentEmails: [DEFAULT_EMAIL_FEATURES.paymentEmails],
                notificationEmails: [DEFAULT_EMAIL_FEATURES.notificationEmails],
                broadcasts: [DEFAULT_EMAIL_FEATURES.broadcasts],
                drips: [DEFAULT_EMAIL_FEATURES.drips],
                adminAlerts: [DEFAULT_EMAIL_FEATURES.adminAlerts],
            }),
            requireSignupVerification: [false],
            trackingPixelUrl: [''],
            liveUrl: [''],
        });
    }

    /** The features FormGroup — used by the template's toggle rows. */
    get featuresGroup(): FormGroup {
        return this.emailForm.get('features') as FormGroup;
    }

    private setupFormChangeListener(): void {
        this.emailForm.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (this.testPassed()) {
                    this.testPassed.set(false);
                }
            });
    }

    private loadSettings(): void {
        this.isLoading.set(true);
        this.emailSettingService.getEmailSettings().subscribe({
            next: (settings) => {
                // Migrate legacy rateLimit to providerRateLimits if needed
                if (!settings.providerRateLimits && settings.rateLimit) {
                    const legacy = settings.rateLimit;
                    const perSecond = legacy.interval === 'second' ? legacy.maxEmails
                        : legacy.interval === 'minute' ? Math.max(1, Math.round(legacy.maxEmails / 60))
                        : 1;
                    const provider = settings.activeProvider || 'smtp';
                    settings.providerRateLimits = {
                        ...PROVIDER_DEFAULT_LIMITS,
                        [provider]: { ...PROVIDER_DEFAULT_LIMITS[provider], perSecond },
                    };
                }

                // Seed provider form cache from settings
                this.providerFormCache = {
                    smtp: settings.smtp,
                    gmail: settings.gmail,
                    resend: settings.resend,
                };

                // Patch shared form fields (provider sub-groups are no longer in the form)
                this.emailForm.patchValue({
                    isEnabled: settings.isEnabled,
                    activeProvider: settings.activeProvider,
                    senderEmail: settings.senderEmail,
                    senderName: settings.senderName,
                    replyToEmail: settings.replyToEmail,
                    bccEmail: settings.bccEmail,
                    rateLimit: settings.rateLimit,
                    providerRateLimits: settings.providerRateLimits,
                    autoPurge: settings.autoPurge,
                    features: { ...DEFAULT_EMAIL_FEATURES, ...(settings.features || {}) },
                    requireSignupVerification: settings.requireSignupVerification ?? false,
                    trackingPixelUrl: settings.trackingPixelUrl ?? '',
                    liveUrl: settings.liveUrl ?? '',
                });

                this.emailEnabled.set(settings.isEnabled);

                // Set Gmail lock if Gmail is the active provider
                if (settings.activeProvider === 'gmail') {
                    this.gmailSenderLocked.set(true);
                }

                this.emailForm.markAsPristine();
                this.isLoading.set(false);
            },
            error: (error) => {
                console.error('Failed to load email settings:', error);
                this.toastService.openCustomSnackbar('Failed to load settings', 'error', 'error');
                this.isLoading.set(false);
            },
        });
    }

    getSelectedProvider() {
        const activeProvider = this.emailForm.get('activeProvider')?.value || 'smtp';
        return this.providers.find(p => p.id === activeProvider) || this.providers[0];
    }

    getActiveProviderRateLimitGroup(): FormGroup {
        const provider = this.emailForm.get('activeProvider')?.value || 'smtp';
        return this.emailForm.get(`providerRateLimits.${provider}`) as FormGroup;
    }

    /** Get initial data for a provider component (from cache) */
    getProviderData(providerId: EmailProvider): any {
        return this.providerFormCache[providerId];
    }

    /** Called by each provider component when it mounts */
    onProviderComponentReady(component: IEmailProviderComponent): void {
        this.activeProviderComponent.set(component);

        // Clean up previous provider's subscription before creating a new one
        this.providerFormSub?.unsubscribe();
        this.providerFormSub = component.formGroup.valueChanges.subscribe(() => {
            if (this.testPassed()) {
                this.testPassed.set(false);
            }
            this.emailForm.markAsDirty();
        });
    }

    /** Called by Gmail provider when the user email field changes */
    onGmailUserChanged(email: string): void {
        this.emailForm.patchValue({ senderEmail: email });
    }

    selectProvider(providerId: EmailProvider): void {
        // Cache current provider's form data before switching
        const currentProvider = this.emailForm.get('activeProvider')?.value as EmailProvider;
        const currentComponent = this.activeProviderComponent();
        if (currentComponent) {
            this.providerFormCache[currentProvider] = currentComponent.formGroup.value;
        }

        this.emailForm.patchValue({ activeProvider: providerId });
        this.emailForm.markAsDirty();
        this.testPassed.set(false);
        this.activeProviderComponent.set(null);

        // Handle Gmail sender email lock
        this.gmailSenderLocked.set(providerId === 'gmail');
        if (providerId !== 'gmail') {
            // Unlock sender email - don't clear it, just make it editable
        }
    }

    /**
     * Reveal the provider configuration form WITHOUT enabling email. Email only
     * becomes enabled once a valid provider is configured (see toggleEmail).
     */
    startConfiguring(): void {
        this.configuring.set(true);
    }

    toggleEmail(enabled: boolean): void {
        // Invariant: email cannot be enabled unless a valid provider is configured.
        if (enabled && !this.isProviderConfigValid()) {
            this.toastService.openCustomSnackbar(
                'Configure a valid email provider before enabling email.',
                'warning',
                'warning',
            );
            this.emailEnabled.set(false);
            this.emailForm.patchValue({ isEnabled: false });
            this.configuring.set(true); // keep the form open so they can finish configuring
            return;
        }
        this.emailEnabled.set(enabled);
        this.emailForm.patchValue({ isEnabled: enabled });
        this.emailForm.markAsDirty();
        this.onSubmit(true);
    }

    isProviderConfigValid(): boolean {
        return this.activeProviderComponent()?.isConfigValid() ?? false;
    }

    /** True when the simulated Debug Provider is selected — it needs no connection test. */
    isDebugProvider(): boolean {
        return this.emailForm.get('activeProvider')?.value === 'debug_log';
    }

    /**
     * Persist a Features / verification toggle change immediately.
     * These are independent of provider-connection testing, so we save directly
     * (type=true bypasses the "test connection first" gate).
     */
    onFeatureToggleChange(): void {
        this.emailForm.markAsDirty();
        this.onSubmit(true);
    }

    /** Build the full IEmailSettings object from shared form + all provider caches */
    private buildSettings(): IEmailSettings {
        // Cache the active provider's current data
        const activeProvider = this.emailForm.get('activeProvider')?.value as EmailProvider;
        const activeComponent = this.activeProviderComponent();
        if (activeComponent) {
            this.providerFormCache[activeProvider] = activeComponent.formGroup.value;
        }

        return {
            ...this.emailForm.value,
            smtp: this.providerFormCache['smtp'] ?? {},
            gmail: this.providerFormCache['gmail'] ?? {},
            resend: this.providerFormCache['resend'] ?? {},
        };
    }

    async onSubmit(type?: boolean): Promise<void> {
        // Enforce the invariant on every persist (defence-in-depth alongside
        // toggleEmail): never store isEnabled=true without a valid provider config.
        if (this.emailForm.get('isEnabled')?.value && !this.isProviderConfigValid()) {
            this.emailForm.patchValue({ isEnabled: false });
            this.emailEnabled.set(false);
        }

        // The simulated Debug Provider has no connection to test — never gate its save.
        if (!this.testPassed() && !type && !this.isDebugProvider()) {
            this.toastService.openCustomSnackbar('Please test the connection first', 'warning', 'warning');
            return;
        }

        this.isSaving.set(true);
        try {
            const settings: IEmailSettings = this.buildSettings();
            await this.emailSettingService.saveEmailSettings(settings);
            this.toastService.openCustomSnackbar('Email settings saved successfully', 'success', 'check_circle');
            this.emailForm.markAsPristine();
        } catch (error) {
            console.error('Failed to save email settings:', error);
            this.toastService.openCustomSnackbar('Failed to save settings', 'error', 'error');
        } finally {
            this.isSaving.set(false);
        }
    }

    async testConnection(): Promise<void> {
        if (!this.isProviderConfigValid()) {
            this.toastService.openCustomSnackbar('Please fill in the required provider configuration', 'warning', 'warning');
            return;
        }

        const dialogRef = this.dialog.open(TestConnectionDialogComponent, {
            width: '400px',
        });

        const dialogResult = await firstValueFrom(dialogRef.afterClosed());

        if (!dialogResult || !dialogResult.testEmail) {
            return;
        }

        this.isTesting.set(true);
        this.testPassed.set(false);

        try {
            const settings: IEmailSettings = this.buildSettings();
            const newObj: any = {
                config: settings,
                activeProvider: settings.activeProvider,
                testEmail: dialogResult.testEmail,
                subject: dialogResult.subject,
                message: dialogResult.message
            };

            await this.emailSettingService.testEmailConnection(newObj);

            // Monitor the test results
            this.emailSettingService.monitorConnectionTest()
                .pipe(
                    takeUntilDestroyed(this.destroyRef),
                    filter((result: any) => result && result.status !== 'processing')
                )
                .subscribe((result: any) => {
                    this.isTesting.set(false);
                    if (result.status === 'success') {
                        this.testPassed.set(true);
                        this.toastService.openCustomSnackbar('Connection successful! Test email sent.', 'success', 'check_circle');
                    } else {
                        this.toastService.openCustomSnackbar(result.message || 'Connection failed', 'error', 'error');
                    }
                });

        } catch (error) {
            console.error('Connection test failed:', error);
            this.toastService.openCustomSnackbar('Connection test failed', 'error', 'error');
            this.isTesting.set(false);
        }
    }
}
