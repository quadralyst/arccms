/**
 * Signup Page Component
 * 
 * Multi-step signup flow:
 * 1. Email Entry (request) - Check if email exists
 * 2. Login Step - If email exists, show login form
 * 3. OTP Verification - For new users, verify email
 * 4. Registration - Create account with name and password
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule, isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { filter, firstValueFrom, take } from 'rxjs';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { AuthState } from '../auth.store';
import { AuthService } from '../auth.service';
import { ConstantVariables } from '../../../../shared/constants/common-constants';
import { UserSettingService } from '../../admin/(settings)/user-setting/user-setting.service';
import { OnboardingSetupService } from '../../(onboarding)/onboarding-setup.service';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';

export const routeMeta: RouteMeta = {
  title: 'Signup | Arc CMS',
};

type SignupStep = 'request' | 'login' | 'verify' | 'signup' | 'disabled';

@Component({
  selector: 'arc-signup',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterModule, NgOptimizedImage],
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
})
export default class SignupComponent extends BaseComponent implements OnInit {
  override constantVariables = inject(ConstantVariables);
  private platformId = inject(PLATFORM_ID);
  currentYear = new Date().getFullYear();
  authStore = inject(AuthState);
  private authService = inject(AuthService);
  private setupService = inject(OnboardingSetupService);
  private userSettingService = inject(UserSettingService);
  private emailConfigStatus = inject(EmailConfigStatusService);
  currentStep = signal<SignupStep>('request');

  isLoading = signal(false);
  errorMessage = signal('');
  successMessage = signal('');
  otpError = signal('');
  resendCountdown = signal(0);
  showLoginPassword = signal(false);
  showPassword = signal(false);
  showConfirmPassword = signal(false);
  private defaultRole = 'user';
  signupSettings: any;

  private countdownInterval: any;
  private generatedOtp = '';
  /** True only when the user actually completed the OTP step (email verification). */
  private otpVerified = false;

  registrationForm!: FormGroup;
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
    this.initForm();

    // Track auth state changes
    effect(() => {
      const loading = this.authStore.isLoading();
      const success = this.authStore.isSuccess();
      const authenticated = this.authStore.isAuthenticated();
      const error = this.authStore.error();
      const currentUser = this.authStore.currentUser();

      // Update loading state based on authStore
      this.isLoading.set(loading);

      // Handle error
      if (error) {
        this.errorMessage.set(error);
        this.authActionPending = false; // a failed attempt must not redirect later
      }

      // Redirect once a signup/login the user just initiated has produced a
      // currentUser. Gated on currentUser (NOT isAuthenticated/isSuccess, which are
      // false for the default 'user' role) so regular users are redirected too.
      void success;
      void authenticated;
      if (this.authActionPending && currentUser && !loading) {
        this.authActionPending = false;
        this.handleLoginSuccess();
      }
    });
  }

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Debug mode: bypass onboarding redirect for deployment verification
    if (new URLSearchParams(window.location.search).has('debug')) {
      return;
    }

    // Redirect to onboarding wizard if no users exist yet (first run)
    this.authService.isFirstRun().pipe(take(1)).subscribe((firstRun) => {
      if (firstRun) {
        this.router.navigate(['/onboarding']);
        return;
      }

      // Also redirect if onboarding wizard was started but not completed
      this.setupService.isOnboardingComplete().pipe(take(1)).subscribe((complete) => {
        if (!complete) {
          this.router.navigate(['/onboarding']);
          return;
        }

        // Check if signups are enabled
        this.userSettingService.getSettings().subscribe(settings => {
          this.signupSettings = settings;
          this.defaultRole = settings.defaultRole || 'user';
        });

        // Listen for auth state changes on initial load
        this.authStore.initAuthStateListener().subscribe((user: any) => {
          if (user && user.isActive) {
            this.handleLoginSuccess();
          }
        });
      });
    });
  }

  private initForm(): void {
    this.registrationForm = this.fb.group(
      {
        email: ['', [Validators.required, Validators.email]],
        loginPassword: [''],
        otp: [''],
        name: [''],
        password: [''],
        confirmPassword: [''],
      },
      { validators: this.passwordMatchValidator }
    );
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('password')?.value === g.get('confirmPassword')?.value
      ? null
      : { mismatch: true };
  }

  getStepTitle(): string {
    const titles: Record<SignupStep, string> = {
      request: 'Welcome',
      login: 'Welcome Back',
      verify: 'Verify Email',
      signup: 'Create Account',
      disabled: 'Signups are disabled',
    };
    return titles[this.currentStep()];
  }

  getStepDescription(): string {
    const descriptions: Record<SignupStep, string> = {
      request: 'Enter your email to get started',
      login: 'Sign in to your account',
      verify: 'Enter the 6-digit code sent to your email',
      signup: 'Complete your registration',
      disabled: 'Signups are disabled',
    };
    return descriptions[this.currentStep()];
  }

  goToStep(step: SignupStep) {
    this.currentStep.set(step);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.otpError.set('');
    this.updateValidators(step);
  }

  updateValidators(step: SignupStep) {
    const controls = this.registrationForm.controls;

    // Clear all validators
    Object.keys(controls).forEach((key) => {
      controls[key].clearValidators();
      controls[key].updateValueAndValidity();
    });

    // Set validators based on step
    switch (step) {
      case 'request':
        controls['email'].setValidators([Validators.required, Validators.email]);
        break;
      case 'login':
        controls['loginPassword'].setValidators([Validators.required, Validators.minLength(8)]);
        break;
      case 'verify':
        controls['otp'].setValidators([Validators.required, Validators.minLength(6)]);
        break;
      case 'signup':
        controls['name'].setValidators([Validators.required, Validators.minLength(2)]);
        controls['password'].setValidators([Validators.required, Validators.minLength(8)]);
        controls['confirmPassword'].setValidators([Validators.required]);
        break;
    }

    this.registrationForm.updateValueAndValidity();
  }

  handleSubmit() {
    switch (this.currentStep()) {
      case 'request':
        this.checkEmail();
        break;
      case 'login':
        this.login();
        break;
      case 'verify':
        this.verifyOtp();
        break;
      case 'signup':
        this.register();
        break;
    }
  }

  async checkEmail() {
    if (this.registrationForm.get('email')?.invalid) {
      this.registrationForm.get('email')?.markAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
    this.otpVerified = false; // reset for a fresh flow

    const email = this.registrationForm.get('email')?.value?.trim().toLowerCase();

    try {
      const res = await (await this.authStore.checkItemNumberExist(email)).toPromise();

      if (res && res.length) {
        // User exists, go to login
        this.goToStep('login');
      } else {
        if (!this.signupSettings.isSignupEnabled) {
          this.goToStep('disabled');
          return;
        }

        // Only verify email when an email channel is actually configured. With no
        // email/SMS to deliver a code, skip verification and go straight to account
        // creation (the account is then marked emailVerified: false — see register()).
        const emailEnabled = await this.isEmailChannelEnabled();
        if (emailEnabled) {
          this.sendOtp();
          this.goToStep('verify');
        } else {
          this.goToStep('signup');
        }
      }
    } catch (error) {
      this.errorMessage.set('Error checking email. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Resolve whether email is configured/enabled, waiting for the config-status
   * document to finish loading first so a slow read can't wrongly skip verification.
   */
  private async isEmailChannelEnabled(): Promise<boolean> {
    await firstValueFrom(this.emailConfigStatus.isLoading$.pipe(filter((loading) => !loading), take(1)));
    return this.emailConfigStatus.isEmailConfigured();
  }

  sendOtp() {
    // Generate 6-digit OTP
    this.generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // In production, this would send via email/SMS
    this.toastService.success('Verification code sent to your email');
    this.startCountdown();
  }

  startCountdown() {
    clearInterval(this.countdownInterval);
    this.resendCountdown.set(60);

    this.countdownInterval = setInterval(() => {
      const current = this.resendCountdown();
      if (current > 0) {
        this.resendCountdown.set(current - 1);
      } else {
        clearInterval(this.countdownInterval);
      }
    }, 1000);
  }

  resendOtp() {
    this.sendOtp();
    this.otpError.set('');
  }

  onOtpInput(event: any, index: number) {
    const input = event.target;
    const value = input.value.replace(/[^0-9]/g, '');
    input.value = value;

    if (value && index < 5) {
      const next = document.querySelector(`[data-index="${index + 1}"]`) as HTMLInputElement;
      next?.focus();
    }

    // Combine all OTP inputs into the form control. The boxes use the `.code-input`
    // class (see signup.page.scss); querying the old `.otp-input` matched nothing,
    // leaving `otp` empty so verification always failed.
    const otpInputs = document.querySelectorAll('.code-input') as NodeListOf<HTMLInputElement>;
    const otp = Array.from(otpInputs).map((i) => i.value).join('');
    this.registrationForm.get('otp')?.setValue(otp);
  }

  onOtpKeyDown(event: KeyboardEvent, index: number) {
    if (event.key === 'Backspace' && index > 0) {
      const current = event.target as HTMLInputElement;
      if (!current.value) {
        const prev = document.querySelector(`[data-index="${index - 1}"]`) as HTMLInputElement;
        prev?.focus();
      }
    }
  }

  verifyOtp() {
    const otp = this.registrationForm.get('otp')?.value;

    if (!otp || otp.length !== 6) {
      this.otpError.set('Please enter the 6-digit code');
      return;
    }

    this.isLoading.set(true);

    if (otp === this.generatedOtp) {
      this.otpVerified = true;
      this.isLoading.set(false);
      this.toastService.success('Email verified successfully');
      this.goToStep('signup');
    } else {
      this.isLoading.set(false);
      this.otpError.set('Invalid verification code');
    }
  }

  register() {
    if (this.registrationForm.invalid || this.hasPasswordMismatch()) {
      Object.keys(this.registrationForm.controls).forEach((key) => {
        this.registrationForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.errorMessage.set('');
    this.authStore.clearList(); // Clear previous error state

    const formData = {
      name: this.registrationForm.get('name')?.value,
      email: this.registrationForm.get('email')?.value?.trim().toLowerCase(),
      password: this.registrationForm.get('password')?.value,
      role: this.defaultRole,
      status: 'Active',
      isActive: true,
      // Verified only if the user actually completed the OTP step. When email is
      // disabled the OTP step is skipped, so this is false (unverified).
      emailVerified: this.otpVerified,
    };

    this.authActionPending = true;
    this.authStore.signup(formData);
  }

  login() {
    if (this.registrationForm.get('loginPassword')?.invalid) {
      this.registrationForm.get('loginPassword')?.markAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.authStore.clearList(); // Clear previous error state

    const email = this.registrationForm.get('email')?.value;
    const password = this.registrationForm.get('loginPassword')?.value;

    this.authActionPending = true;
    this.authStore.login({ email, password });
  }

  forgotPassword() {
    const email = this.registrationForm.get('email')?.value;
    if (email) {
      this.authStore.forgotPassword(email).then((res: any) => {
        if (res?.status === 200) {
          this.successMessage.set('Password reset email sent!');
        } else {
          this.errorMessage.set('Failed to send reset email');
        }
      });
    }
  }

  private navigationInProgress = false;
  /** Set when the user submits signup/login, so the auth effect only redirects
   *  after an action they initiated (not on passive currentUser changes). */
  private authActionPending = false;

  private handleLoginSuccess() {
    // Prevent duplicate navigation
    if (this.navigationInProgress) return;

    const user = this.authStore.currentUser();
    if (user) {
      this.navigationInProgress = true;
      const isAdmin = this.authStore.isAdmin();
      const route = isAdmin ? '/admin/dashboard' : '/user/dashboard';

      this.toastService.success('Please wait! Redirecting...');
      this.router.navigate([route], { replaceUrl: true });
    }
  }

  isFieldInvalid(fieldName: string): boolean {
    const control = this.registrationForm.get(fieldName);
    return !!(control && control.invalid && control.touched);
  }

  hasPasswordMismatch(): boolean {
    return !!(this.registrationForm.errors?.['mismatch'] && this.registrationForm.get('confirmPassword')?.touched);
  }

  ngOnDestroy() {
    clearInterval(this.countdownInterval);
  }

  resetAll() {
    if (isPlatformBrowser(this.platformId)) {
      window.location.reload();
    }
  }
}
