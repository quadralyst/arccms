import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import {
    Component,
    DestroyRef,
    effect,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    AbstractControl,
    FormBuilder,
    FormGroup,
    ReactiveFormsModule,
    ValidationErrors,
    Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { take, firstValueFrom } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthState } from '../(auth)/auth.store';
import { AuthService } from '../(auth)/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { ConstantVariables } from '../../../shared/constants/common-constants';
import { OnboardingSetupService } from './onboarding-setup.service';
import { EmailSettingService } from '../admin/(settings)/email-setting/email-setting.service';
import { TestConnectionDialogComponent } from '../admin/(settings)/email-setting/test-connection-dialog.component';
import {
    EMAIL_PROVIDERS,
    EmailProvider,
    IEmailSettings,
    DEFAULT_EMAIL_SETTINGS,
    PROVIDER_DEFAULT_LIMITS,
} from '../admin/(settings)/email-setting/email-setting.model';
import { environment } from '../../../environments/environment';

export const routeMeta: RouteMeta = {
    title: 'Onboarding | Arc CMS',
};

@Component({
    selector: 'arc-onboarding',
    standalone: true,
    imports: [ReactiveFormsModule, CommonModule, MatDialogModule],
    templateUrl: './onboarding.page.html',
    styleUrls: ['./onboarding.page.scss'],
})
export default class OnboardingComponent implements OnInit {
    private authService = inject(AuthService);
    private auth = inject(Auth);
    authStore = inject(AuthState);
    private router = inject(Router);
    private fb = inject(FormBuilder);
    private toastService = inject(ToastService);
    private setupService = inject(OnboardingSetupService);
    private emailSettingService = inject(EmailSettingService);
    private dialog = inject(MatDialog);
    private destroyRef = inject(DestroyRef);
    constantVariables = inject(ConstantVariables);

    currentYear = new Date().getFullYear();
    projectId = environment.firebaseConfig?.projectId || '';
    isLoading = signal(false);
    isSubmitted = signal(false);
    errorMessage = signal('');
    showPassword = signal(false);
    showConfirmPassword = signal(false);
    currentStep = signal<1 | 2 | 3 | 4 | 5>(1);

    // Step 3 signals
    isSavingSiteInfo = signal(false);

    // Step 4 signals
    providers = EMAIL_PROVIDERS;
    selectedProvider = signal<EmailProvider>('gmail');
    isSavingEmail = signal(false);
    isTesting = signal(false);
    testPassed = signal(false);
    showSmtpPassword = signal(false);
    showGmailPassword = signal(false);
    showApiKey = signal(false);
    gmailSenderLocked = signal(true); // Gmail is the default provider

    // Step 5 signals
    isCompleting = signal(false);
    setupFailed = signal(false);

    // Forms
    onboardingForm!: FormGroup;
    siteInfoForm!: FormGroup;
    emailForm!: FormGroup;

    // Re-entry guard for the post-signup effect
    private signupHandled = false;
    private signupTimeoutId: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.initForm();
        this.initSiteInfoForm();
        this.initEmailForm();
        this.setupGmailSenderSync();

        effect(() => {
            const loading = this.authStore.isLoading();
            const success = this.authStore.isSuccess();
            const error = this.authStore.error();
            const currentUser = this.authStore.currentUser();

            this.isLoading.set(loading);

            if (error) {
                this.errorMessage.set(error);
                this.isSubmitted.set(false);
            }

            // After signup succeeds, wait for custom claim then advance to step 3
            if (success && currentUser && !error && !this.signupHandled) {
                this.signupHandled = true;
                this.toastService.success('Admin account created! Setting up your site…');
                // Mark onboarding as in-progress so abandoned wizards are detected
                this.setupService.markOnboardingStarted()
                    .catch((err) => console.warn('Failed to mark onboarding started (non-fatal):', err));
                
                this.signupTimeoutId = setTimeout(() => this.checkAdminClaim(0), 2000);
            }
        });

        // Clean up timeout if component is destroyed during the 3-second wait
        this.destroyRef.onDestroy(() => {
            if (this.signupTimeoutId !== null) {
                clearTimeout(this.signupTimeoutId);
            }
        });
    }

    ngOnInit() {
        this.authService.isFirstRun().pipe(take(1)).subscribe((firstRun) => {
            if (!firstRun) {
                // Admin exists — check if onboarding was completed
                this.setupService.isOnboardingComplete().pipe(take(1)).subscribe((complete) => {
                    if (complete) {
                        this.router.navigate(['/']);
                    } else {
                        // Re-entry: admin account exists but wizard wasn't finished
                        this.signupHandled = true; // prevent effect from re-firing
                        this.currentStep.set(3);
                    }
                });
            }
        });
    }

    async checkAdminClaim(attempts: number = 0): Promise<void> {
        try {
            const tokenResult = await this.auth.currentUser?.getIdTokenResult(true);
            if (tokenResult?.claims?.['role'] === 'admin') {
                this.currentStep.set(3);
                this.errorMessage.set('');
                return;
            }
        } catch (err) {
            console.warn('Token refresh failed (non-fatal):', err);
        }
        
        if (attempts < 10) {
            this.signupTimeoutId = setTimeout(() => this.checkAdminClaim(attempts + 1), 2000);
        } else {
            this.currentStep.set(3);
            this.errorMessage.set('');
        }
    }

    // ─── Step 1-2: Admin Account (existing logic) ───

    private initForm(): void {
        this.onboardingForm = this.fb.group(
            {
                name: ['', [Validators.required, Validators.minLength(2)]],
                email: ['', [Validators.required, Validators.email]],
                confirmEmail: ['', [Validators.required, Validators.email]],
                password: ['', [Validators.required, Validators.minLength(8)]],
                confirmPassword: ['', [Validators.required]],
            },
            { validators: [this.passwordMatchValidator, this.emailMatchValidator] }
        );
    }

    private passwordMatchValidator(g: AbstractControl): ValidationErrors | null {
        return g.get('password')?.value === g.get('confirmPassword')?.value
            ? null
            : { passwordMismatch: true };
    }

    private emailMatchValidator(g: AbstractControl): ValidationErrors | null {
        return g.get('email')?.value?.trim().toLowerCase() ===
            g.get('confirmEmail')?.value?.trim().toLowerCase()
            ? null
            : { emailMismatch: true };
    }

    isFieldInvalid(fieldName: string, form?: FormGroup): boolean {
        const f = form || this.onboardingForm;
        const control = f.get(fieldName);
        return !!(control && control.invalid && control.touched);
    }

    hasPasswordMismatch(): boolean {
        return !!(
            this.onboardingForm.errors?.['passwordMismatch'] &&
            this.onboardingForm.get('confirmPassword')?.touched
        );
    }

    hasEmailMismatch(): boolean {
        return !!(
            this.onboardingForm.errors?.['emailMismatch'] &&
            this.onboardingForm.get('confirmEmail')?.touched
        );
    }

    goToStep2(): void {
        const step1Fields = ['name', 'email', 'confirmEmail'];
        step1Fields.forEach(field => this.onboardingForm.get(field)?.markAsTouched());

        const step1Valid = step1Fields.every(f => this.onboardingForm.get(f)?.valid);
        if (!step1Valid || this.hasEmailMismatch()) {
            return;
        }
        this.currentStep.set(2);
    }

    goBack(): void {
        this.errorMessage.set('');
        this.onboardingForm.get('password')?.reset();
        this.onboardingForm.get('confirmPassword')?.reset();
        this.currentStep.set(1);
    }

    register() {
        if (this.onboardingForm.invalid || this.hasPasswordMismatch() || this.hasEmailMismatch()) {
            ['password', 'confirmPassword'].forEach(f =>
                this.onboardingForm.get(f)?.markAsTouched()
            );
            return;
        }

        this.errorMessage.set('');
        this.isSubmitted.set(true);
        this.authStore.clearList();

        const formData = {
            name: this.onboardingForm.get('name')?.value?.trim(),
            email: this.onboardingForm.get('email')?.value?.trim().toLowerCase(),
            password: this.onboardingForm.get('password')?.value,
            role: this.constantVariables.ADMIN,
            status: 'Active',
            isActive: true,
            emailVerified: true,
            isOnBoardingComplete: true,
        };

        this.authStore.signup(formData);
    }

    // ─── Step 3: Site Info ───

    private initSiteInfoForm(): void {
        this.siteInfoForm = this.fb.group({
            siteName: ['', [Validators.required, Validators.minLength(2)]],
            siteUrl: [typeof window !== 'undefined' ? window.location.origin : '', [Validators.required]],
        });
    }

    async saveSiteInfo(): Promise<void> {
        if (this.siteInfoForm.invalid) {
            Object.keys(this.siteInfoForm.controls).forEach(key =>
                this.siteInfoForm.get(key)?.markAsTouched()
            );
            return;
        }

        this.isSavingSiteInfo.set(true);
        this.errorMessage.set('');

        try {
            const { siteName, siteUrl } = this.siteInfoForm.value;
            await this.setupService.saveSiteInfo(siteName.trim(), siteUrl.trim());
            await this.setupService.saveDefaultSettings();
            this.errorMessage.set('');
            this.currentStep.set(4);
        } catch (error) {
            console.error('Failed to save site info:', error);
            this.errorMessage.set('Failed to save site information. Please try again.');
            this.toastService.error('Failed to save site information');
        } finally {
            this.isSavingSiteInfo.set(false);
        }
    }

    // ─── Step 4: Email Setup ───

    private initEmailForm(): void {
        this.emailForm = this.fb.group({
            senderEmail: ['', [Validators.required, Validators.email]],
            senderName: [''],
            replyToEmail: ['', [Validators.email]],
            smtp: this.fb.group({
                host: [''],
                port: [587],
                secure: [false],
                user: [''],
                password: [''],
            }),
            gmail: this.fb.group({
                user: [''],
                password: [''],
            }),
            resend: this.fb.group({
                apiKey: [''],
            }),
        });
    }

    private setupGmailSenderSync(): void {
        // When Gmail user field changes, sync senderEmail
        this.emailForm.get('gmail.user')!.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(value => {
                if (this.selectedProvider() === 'gmail') {
                    this.emailForm.patchValue({ senderEmail: value || '' });
                }
            });
    }

    selectProvider(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as EmailProvider;
        this.selectedProvider.set(value);
        this.testPassed.set(false);
        this.gmailSenderLocked.set(value === 'gmail');

        // When switching to Gmail, sync senderEmail from Gmail user field
        if (value === 'gmail') {
            const gmailUser = this.emailForm.get('gmail.user')?.value;
            if (gmailUser) {
                this.emailForm.patchValue({ senderEmail: gmailUser });
            }
        }
    }

    getSelectedProviderInfo() {
        return this.providers.find(p => p.id === this.selectedProvider()) || this.providers[0]; // Gmail default
    }

    isProviderConfigValid(): boolean {
        const provider = this.selectedProvider();
        const providerGroup = this.emailForm.get(provider);
        if (!providerGroup) return false;

        switch (provider) {
            case 'smtp':
                return !!providerGroup.get('host')?.value && !!providerGroup.get('user')?.value && !!providerGroup.get('password')?.value;
            case 'gmail':
                return !!providerGroup.get('user')?.value && !!providerGroup.get('password')?.value;
            case 'resend':
                return !!providerGroup.get('apiKey')?.value;
            default:
                return false;
        }
    }

    async testConnection(): Promise<void> {
        if (!this.isProviderConfigValid()) {
            this.toastService.error('Please fill in the required provider configuration');
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
            const settings = this.buildEmailSettings();
            await this.emailSettingService.testEmailConnection({
                config: settings,
                activeProvider: settings.activeProvider,
                testEmail: dialogResult.testEmail,
                subject: dialogResult.subject,
                message: dialogResult.message,
            });

            // Monitor the test results
            const sub = this.emailSettingService.monitorConnectionTest()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe((result) => {
                    if (!result || result.status === 'processing') return;

                    this.isTesting.set(false);
                    if (result.status === 'success') {
                        this.testPassed.set(true);
                        this.toastService.success('Connection successful! Test email sent.');
                    } else {
                        this.toastService.error(result.message || 'Connection failed');
                    }
                    sub.unsubscribe();
                });
        } catch (error) {
            console.error('Connection test failed:', error);
            this.toastService.error('Connection test failed. Please check your settings.');
            this.isTesting.set(false);
        }
    }

    private buildEmailSettings(): IEmailSettings {
        const formValue = this.emailForm.value;
        return {
            ...DEFAULT_EMAIL_SETTINGS,
            isEnabled: true,
            activeProvider: this.selectedProvider(),
            senderEmail: formValue.senderEmail,
            senderName: formValue.senderName || this.siteInfoForm.get('siteName')?.value || '',
            replyToEmail: formValue.replyToEmail || formValue.senderEmail,
            smtp: formValue.smtp,
            gmail: formValue.gmail,
            resend: formValue.resend,
            providerRateLimits: { ...PROVIDER_DEFAULT_LIMITS },
            autoPurge: { enabled: true, retentionDays: 60 },
        };
    }

    async saveEmailAndContinue(): Promise<void> {
        if (!this.testPassed()) {
            this.toastService.error('Please test the connection first');
            return;
        }

        this.isSavingEmail.set(true);
        this.errorMessage.set('');

        try {
            const settings = this.buildEmailSettings();
            await this.setupService.saveEmailConfig(settings);
            this.errorMessage.set('');
            this.currentStep.set(5);
        } catch (error) {
            console.error('Failed to save email settings:', error);
            this.errorMessage.set('Failed to save email settings. Please try again.');
            this.toastService.error('Failed to save email settings');
        } finally {
            this.isSavingEmail.set(false);
        }
    }

    async skipEmail(): Promise<void> {
        this.isSavingEmail.set(true);
        this.errorMessage.set('');

        try {
            await this.setupService.saveEmailSkipped();
            this.currentStep.set(5);
            this.errorMessage.set('');
        } catch (error) {
            console.error('Failed to save email settings:', error);
            this.errorMessage.set('Failed to save settings. Please try again.');
            this.toastService.error('Failed to save settings');
        } finally {
            this.isSavingEmail.set(false);
        }
    }

    // ─── Step 5: Review & Complete ───

    async completeSetup(): Promise<void> {
        this.isCompleting.set(true);
        this.errorMessage.set('');
        this.setupFailed.set(false);

        try {
            await this.setupService.completeSetup();
            this.toastService.success('Setup complete! Welcome to Arc CMS.');
            this.router.navigate(['/admin/dashboard'], { replaceUrl: true });
        } catch (error) {
            console.error('Failed to complete setup:', error);
            this.errorMessage.set('Failed to create default content. Please try again.');
            this.toastService.error('Setup failed — please retry');
            this.setupFailed.set(true);
        } finally {
            this.isCompleting.set(false);
        }
    }

    async skipSetupAndGo(): Promise<void> {
        try {
            await this.setupService.markOnboardingComplete();
        } catch (err) {
            console.warn('Failed to mark onboarding complete (non-fatal):', err);
        }
        this.router.navigate(['/admin/dashboard'], { replaceUrl: true });
    }

    // ─── Progress helpers ───

    get totalSteps(): number {
        return 5;
    }

    get progressPercent(): number {
        return (this.currentStep() / this.totalSteps) * 100;
    }
}
