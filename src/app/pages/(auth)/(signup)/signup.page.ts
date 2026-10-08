/**
 * Signup Page Component
 *
 * One flow for email and phone; only the channel differs:
 * 1. Request - "Phone number or email" (pasted text is cleaned up at once), or Google
 * 2. Registered: email → password (login), phone → 6-digit PIN (pin)
 * 3. New: a code by email or SMS (verify), then name and a password or PIN (signup)
 * Forgot PIN (or a registered number with no PIN yet): SMS code (verify), then a new PIN (newPin).
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import type { AuthCredential } from '@angular/fire/auth';
import { filter, firstValueFrom, take } from 'rxjs';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { AuthState, NO_ACCESS_KEY } from '../auth.store';
import { TranslocoPipe } from '@jsverse/transloco';
import { sentenceParts } from '../../../core/i18n/sentence-parts';
import type { TranslationKey } from '../../../core/i18n/translation-keys';
import { AuthService } from '../auth.service';
import { ConstantVariables } from '../../../../shared/constants/common-constants';
import { UserSettingService } from '../../admin/(settings)/user-setting/user-setting.service';
import { phoneCountrySettings, phoneSignInOn } from '../../admin/(settings)/user-setting/user-setting.model';
import { OnboardingSetupService } from '../../(onboarding)/onboarding-setup.service';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { LegalNoticeComponent } from '../../../../shared/components/legal-notice/legal-notice.component';
import { CodeInputComponent } from '../../../../shared/components/code-input/code-input.component';
import {
  classifyIdentifier, formatPhone, hasCountryCode, identifierProblem, looksLikePhone, withoutTrunk, type IdentifierProblem,
} from '../../../../shared/utils/identifier.util';
import { codesOf, countryByIso, DEFAULT_COUNTRY, startingCountry } from '../../../../shared/data/countries';
import { chipPhone, countryListText, rememberCountry, rememberedCountry, tidyChipNumber } from '../../../../shared/utils/phone-country';
import { PhoneCountryComponent } from '../../../../shared/components/phone-country/phone-country.component';
import { readSignInError, SignInService } from '../sign-in.service';
import { environment } from '../../../../environments/environment';
import { arcConfig } from '../../../core/config/arc-config';
import { homeFor, safeRedirect } from '../../../core/home/home';
import { SiteIdentityService } from '../../../core/services/site-identity.service';
import { useSiteStyles } from '../../../core/site/site-styles';
import { SignInPanelComponent, signInBrand } from '../../page.parts/sign-in-panel.component';
import { MemberLanguagePickerComponent } from '../../../../shared/components/member-language-picker/member-language-picker.component';
import { Title } from '@angular/platform-browser';

export const routeMeta: RouteMeta = {
  title: 'Signup | Arc CMS',
};

type SignupStep = 'request' | 'login' | 'pin' | 'verify' | 'signup' | 'newPin' | 'disabled';
type Channel = 'email' | 'phone';

@Component({
  selector: 'arc-signup',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterModule, TranslocoPipe, LegalNoticeComponent, CodeInputComponent, SignInPanelComponent, MemberLanguagePickerComponent, PhoneCountryComponent],
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
})
export default class SignupComponent extends BaseComponent implements OnInit {
  override constantVariables = inject(ConstantVariables);
  private platformId = inject(PLATFORM_ID);
  currentYear = new Date().getFullYear();

  /**
   * The site's own name and logo (Settings, About), so the page is the site's and
   * not Arc CMS's (signInBrand).
   */
  private siteIdentity = inject(SiteIdentityService);
  // Nothing until the identity is in, so Arc CMS's logo never flashes before the site's.
  private readonly brand = computed(() => this.siteIdentity.loaded()
    ? signInBrand(this.siteIdentity.identity(), this.constantVariables.APPLICATION_NAME)
    : { name: '', logo: '' });
  readonly brandName = computed(() => this.brand().name);
  readonly brandLogo = computed(() => this.brand().logo);
  private titleService = inject(Title);
  authStore = inject(AuthState);
  private authService = inject(AuthService);
  private setupService = inject(OnboardingSetupService);
  private userSettingService = inject(UserSettingService);
  private emailConfigStatus = inject(EmailConfigStatusService);
  private signIn = inject(SignInService);
  currentStep = signal<SignupStep>('request');

  isLoading = signal(false);
  errorMessage = signal('');
  successMessage = signal('');
  otpError = signal('');
  resendCountdown = signal(0);
  showLoginPassword = signal(false);
  showPassword = signal(false);
  showConfirmPassword = signal(false);
  showPin = signal(false);
  signupSettings: any;

  /** Which sign-in methods the site offers besides email (Settings, Users). */
  phoneEnabled = signal(false);
  googleEnabled = signal(false);

  /** Email or phone: decided at the request step. */
  channel = signal<Channel>('email');
  /** The number in E.164, as the server read it. */
  phone = signal('');
  /**
   * The countries a number can be from (Settings, SMS, copied to Settings/users) and
   * the one the chip beside the number shows (specs/phone-country-spec.md).
   * `countriesListed` is false for a copy from before countries were stored: a
   * number with its own `+code` is then left to the server.
   */
  phoneCountries = signal<string[]>([DEFAULT_COUNTRY]);
  countriesListed = signal(false);
  phoneCountry = signal(DEFAULT_COUNTRY);
  /** The chip's calling code: how a number typed without one is read. */
  countryCode = computed(() => countryByIso(this.phoneCountry())?.code ?? '91');
  /** What is in the sign-in box, for showing the chip as it changes. */
  identifierValue = signal('');
  /** The chip shows beside a number typed without its own code (PC-D1). */
  chipShown = computed(() => this.phoneEnabled() && looksLikePhone(this.identifierValue()) && !hasCountryCode(this.identifierValue()));
  phoneDisplay = computed(() => formatPhone(this.phone(), this.countryCode()));
  /** What the SMS code is for: a new account, or a new PIN. */
  phonePurpose = signal<'signup' | 'reset'>('signup');
  /** The PIN typed on the sign-up and new-PIN steps. */
  newPin = signal('');
  /** The PIN locked after too many wrong tries. */
  pinLocked = signal(false);
  /** Test SMS provider or Simulated email provider: the code that was not sent, shown under the boxes. */
  testCode = signal('');
  /** Test SMS provider, reset code: no SMS went out and the code is only in SMS Logs. */
  testCodeInLogs = signal(false);
  /**
   * Development builds only: which Firebase project and database this page signs
   * in to, so nobody signs in to the wrong install by mistake. Empty in production.
   */
  readonly instanceLabel = environment.production
    ? ''
    : `${environment.firebaseConfig.projectId} · ${arcConfig.databaseId} database`;

  private codeBoxes = viewChild<CodeInputComponent>('codeBoxes');
  private pinBoxes = viewChild<CodeInputComponent>('pinBoxes');

  private countdownInterval: any;
  /** True only when the user actually completed the OTP step (email verification). */
  private otpVerified = false;
  /** A Google sign-in that hit an existing email account: linked after the password. */
  private pendingGoogleCredential: AuthCredential | null = null;

  registrationForm!: FormGroup;
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
    // The site's styles (src/custom/site/site.css) and its name in the tab.
    useSiteStyles(['site']);
    // In the browser only: a server render may read another database than the browser's.
    if (isPlatformBrowser(this.platformId)) {
      this.siteIdentity.load().then(() => this.titleService.setTitle(this.t('member.auth.title_tab', { brand: this.brandName() }))).catch(() => undefined);
    }
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
        untracked(() => this.handleAuthError(error, this.authStore.errorCode()));
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

  /**
   * Show a failed sign-up or sign-in. A sign-up refused because the email is
   * already registered goes to the sign-in step instead: the "is this email
   * new?" check reads Firestore (email_lookup), but the account lives in
   * Firebase Auth, and the two disagree whenever the lookup entry was never
   * written (its trigger failed, the database was replaced) or the Auth pool is
   * shared with another app. Auth is the truth, so ask for the password.
   */
  handleAuthError(error: string, code: string): void {
    this.authActionPending = false; // a failed attempt must not redirect later
    if (code === 'auth/email-already-in-use' && this.currentStep() === 'signup') {
      this.goToStep('login');
      this.successMessage.set(this.t('member.auth.existing_account_password'));
      return;
    }
    this.errorMessage.set(error);
  }

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Debug mode: bypass onboarding redirect for deployment verification
    if (new URLSearchParams(window.location.search).has('debug')) {
      return;
    }

    // Redirect to the onboarding wizard on first run, or when it was started
    // but never finished.
    this.setupService.shouldShowOnboarding().pipe(take(1)).subscribe((showOnboarding) => {
      if (showOnboarding) {
        this.router.navigate(['/onboarding']);
        return;
      }

      // Check if signups are enabled, and which sign-in methods are on
      this.userSettingService.getSettings().subscribe(settings => {
        this.signupSettings = settings;
        this.phoneEnabled.set(phoneSignInOn(settings));
        const countries = phoneCountrySettings(settings);
        this.phoneCountries.set(countries.countries);
        this.countriesListed.set(countries.listed);
        this.phoneCountry.set(startingCountry(countries.countries, countries.country, rememberedCountry()));
        this.googleEnabled.set(settings.googleSignIn === true);
        this.updateValidators(this.currentStep());
        // Start the sign-in functions while the person types (each takes seconds to start).
        this.signIn.warmUp({ phone: this.phoneEnabled(), google: this.googleEnabled() });
      });

      // Listen for auth state changes on initial load
      this.authStore.initAuthStateListener().subscribe((user: any) => {
        if (user && user.isActive) {
          this.handleLoginSuccess();
        }
      });
    });
  }

  private initForm(): void {
    this.registrationForm = this.fb.group(
      {
        identifier: ['', [Validators.required]],
        loginPassword: [''],
        name: [''],
        password: [''],
        confirmPassword: [''],
      },
      { validators: this.passwordMatchValidator }
    );
    this.registrationForm.get('identifier')!.valueChanges.subscribe((value) => this.identifierValue.set(String(value ?? '')));
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('password')?.value === g.get('confirmPassword')?.value
      ? null
      : { mismatch: true };
  }

  /**
   * The request field accepts an email, and a phone number when phone sign-in is on.
   * The error names what is wrong ("too short", "starts with 6 to 9"), not just "invalid".
   */
  private identifierValidator = (control: AbstractControl): ValidationErrors | null => {
    const allowed = this.countriesListed() ? codesOf(this.phoneCountries()) : undefined;
    const problem = identifierProblem(this.beside(control.value), this.phoneEnabled(), this.countryCode(), allowed);
    return problem ? { identifier: problem } : null;
  };

  /** The box's text read beside the chip: the chip country's own domestic prefix taken off. */
  private beside(value: unknown): string {
    return withoutTrunk(value, countryByIso(this.phoneCountry())?.trunk);
  }

  /** The number in the box with its country code (E.164), or null when it is not one. */
  phoneNumber(value: unknown): string | null {
    return chipPhone(value, countryByIso(this.phoneCountry()));
  }

  /** A country chosen from the chip: read the number again and go back to typing it. */
  countryChosen(): void {
    this.registrationForm.get('identifier')?.updateValueAndValidity();
    this.cleanIdentifier();
    if (isPlatformBrowser(this.platformId)) document.getElementById('identifier')?.focus();
  }

  /** The message under the request field, for what is wrong with it. */
  identifierErrorKey(): string {
    const problem: IdentifierProblem = this.registrationForm.get('identifier')?.errors?.['identifier'] ?? 'empty';
    if (problem === 'empty') {
      return this.phoneEnabled() ? 'member.auth.identifier_error.empty_phone' : 'member.auth.identifier_error.empty_email';
    }
    // With several countries, an Indian-looking mistake may be a number from another one.
    if (problem === 'phone_start' && (this.phoneCountries?.() ?? []).length > 1) return 'member.auth.identifier_error.phone_start_choose';
    return `member.auth.identifier_error.${problem}`;
  }

  /** The countries the site takes, by name, for "This site takes numbers from India only." */
  identifierErrorParams(): Record<string, string> {
    return { countries: countryListText(this.phoneCountries(), this.transloco.getActiveLang()) };
  }

  /** The email the email steps work with. */
  get email(): string {
    return classifyIdentifier(this.registrationForm.get('identifier')?.value, this.countryCode()).value;
  }

  /** Where the code went, as the person reads it. */
  sentTo(): string {
    return this.channel() === 'phone' ? this.phoneDisplay() : this.email;
  }

  getStepTitle(): string {
    const phone = this.channel() === 'phone';
    const titles: Record<SignupStep, TranslationKey> = {
      request: 'member.auth.step_title_welcome',
      login: 'member.auth.step_title_welcome_back',
      pin: 'member.auth.step_title_welcome_back',
      verify: phone
        ? (this.phonePurpose() === 'reset' ? 'member.auth.step_title_set_pin' : 'member.auth.step_title_verify_number')
        : 'member.auth.step_title_verify_email',
      signup: 'member.auth.create_account',
      newPin: 'member.auth.step_title_new_pin',
      disabled: 'member.auth.step_title_closed',
    };
    return this.t(titles[this.currentStep()]);
  }

  getStepDescription(): string {
    const titles: Record<SignupStep, TranslationKey> = {
      request: this.phoneEnabled() ? 'member.auth.step_desc_start_phone' : 'member.auth.step_desc_start_email',
      login: 'member.auth.step_desc_sign_in',
      pin: 'member.auth.enter_pin',
      verify: this.channel() === 'phone' ? 'member.auth.step_desc_code_phone' : 'member.auth.step_desc_code_email',
      signup: 'member.auth.step_desc_complete',
      newPin: 'member.auth.step_desc_new_pin',
      disabled: 'member.auth.step_desc_closed',
    };
    return this.t(titles[this.currentStep()]);
  }

  /** A sentence split around its value, for the template to style the value (L-D15). */
  parts(key: TranslationKey): [string, string] {
    return sentenceParts((k, p) => this.t(k as TranslationKey, p), key);
  }

  goToStep(step: SignupStep) {
    this.currentStep.set(step);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.otpError.set('');
    this.newPin.set('');
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
        controls['identifier'].setValidators([Validators.required, this.identifierValidator]);
        break;
      case 'login':
        controls['loginPassword'].setValidators([Validators.required, Validators.minLength(8)]);
        break;
      case 'signup':
        controls['name'].setValidators([Validators.required, Validators.minLength(2)]);
        if (this.channel() === 'email') {
          controls['password'].setValidators([Validators.required, Validators.minLength(8)]);
          controls['confirmPassword'].setValidators([Validators.required]);
        }
        break;
    }

    Object.keys(controls).forEach((key) => controls[key].updateValueAndValidity({ emitEvent: false }));
    this.registrationForm.updateValueAndValidity();
  }

  handleSubmit() {
    switch (this.currentStep()) {
      case 'request':
        this.checkIdentifier();
        break;
      case 'login':
        this.login();
        break;
      case 'signup':
        this.register();
        break;
      case 'newPin':
        this.saveNewPin();
        break;
    }
  }

  /**
   * Pasted or finished typing: show the cleaned-up value at once, a number
   * without spaces or +91, an email in lower case with no spaces.
   */
  cleanIdentifier(): void {
    // A paste lands in the field after the event, so read it on the next tick.
    setTimeout(() => {
      const control = this.registrationForm.get('identifier');
      const value = control?.value;
      // A number with its own code from a country the site takes moves that code
      // to the chip (PC-D10); one from elsewhere stays in full, to be turned down.
      const tidy = this.phoneEnabled()
        ? tidyChipNumber(value, countryByIso(this.phoneCountry()), this.countriesListed() ? this.phoneCountries() : null)
        : null;
      if (tidy) {
        if (tidy.country) this.phoneCountry.set(tidy.country.iso);
        if (value !== tidy.shown) control?.setValue(tidy.shown);
        control?.updateValueAndValidity();
        return;
      }
      const id = classifyIdentifier(value, this.countryCode());
      if (id.kind === 'email' && value !== id.display) control?.setValue(id.display);
    });
  }

  /**
   * Leaving the box tidies it, but not on the way to the country chip: the number
   * is then read in the country about to be chosen, not the one being changed.
   */
  identifierBlur(event: FocusEvent): void {
    if ((event.relatedTarget as Element | null)?.closest?.('arc-phone-country')) return;
    this.cleanIdentifier();
  }

  /** Autofill, like a paste, can bring a whole number with its code: tidy it at once. */
  identifierInput(event: Event): void {
    const kind = (event as InputEvent).inputType;
    if (!kind || kind === 'insertReplacementText' || kind === 'insertFromPaste') this.cleanIdentifier();
  }

  /** Step 1: decide between email and phone, and between signing in and signing up. */
  async checkIdentifier(): Promise<void> {
    const control = this.registrationForm.get('identifier');
    if (control?.invalid) {
      control.markAsTouched();
      return;
    }
    const phone = this.phoneNumber(control?.value);
    if (phone) {
      if (!hasCountryCode(control?.value)) rememberCountry(this.phoneCountry());
      await this.checkPhone(phone);
    } else {
      this.channel.set('email');
      await this.checkEmail();
    }
  }

  async checkEmail() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.otpVerified = false; // reset for a fresh flow

    const email = this.email;

    try {
      const status = await this.emailStatus(email);

      // `unfinished`: a recent sign-up whose last step never answered; the
      // password step finishes it (auth.store login).
      if (status === 'registered' || status === 'unfinished') {
        this.goToStep('login');
      } else if (status === 'no-access') {
        this.errorMessage.set(this.t(NO_ACCESS_KEY));
      } else {
        if (!this.signupSettings.isSignupEnabled) {
          this.goToStep('disabled');
          return;
        }

        // E4: require the OTP step only when email is configured AND the admin
        // enabled "require signup verification". Otherwise skip straight to account
        // creation (the account is then marked emailVerified: false — see register()).
        // Signup must never block just because email is on.
        const mustVerify = await this.shouldVerifySignup();
        if (mustVerify) {
          this.goToStep('verify');
          await this.sendOtp();
        } else {
          this.goToStep('signup');
        }
      }
    } catch (error) {
      this.errorMessage.set(this.t('member.auth.check_email_failed'));
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Ask the server, which reads the user records themselves (see
   * functions/src/auth/emailAccount.ts). Should that call fail, fall back to the
   * `email_lookup` check, which can say "new" for a record whose lookup entry
   * was never written; the sign-up then lands on the password step instead.
   */
  private async emailStatus(email: string): Promise<'registered' | 'new' | 'no-access' | 'unfinished'> {
    try {
      return (await this.signIn.checkEmail(email)).status;
    } catch {
      const res = await (await this.authStore.checkItemNumberExist(email)).toPromise();
      return res && res.length ? 'registered' : 'new';
    }
  }

  /** A number: PIN when it has an account with one, otherwise an SMS code first. */
  async checkPhone(typed: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.channel.set('phone');
    try {
      const account = await this.signIn.checkPhone(typed);
      this.phone.set(account.phone);
      if (account.exists && account.hasPin) {
        this.pinLocked.set(false);
        this.goToStep('pin');
        return;
      }
      if (!account.exists && !account.signupOpen) {
        this.goToStep('disabled');
        return;
      }
      this.phonePurpose.set(account.exists ? 'reset' : 'signup');
      this.goToStep('verify');
      await this.sendOtp();
    } catch (err) {
      this.errorMessage.set(readSignInError(err).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * E4 gate: whether the OTP step is required (email configured AND the admin
   * toggle on). Waits for the config-status document to finish loading first so a
   * slow read can't wrongly skip verification.
   */
  private async shouldVerifySignup(): Promise<boolean> {
    await firstValueFrom(this.emailConfigStatus.isLoading$.pipe(filter((loading) => !loading), take(1)));
    return this.emailConfigStatus.shouldVerifySignup();
  }

  /**
   * Request a verification code from the server (E3). The code is generated,
   * hashed and delivered server-side (email pipeline or SMS), never in the client.
   */
  async sendOtp(): Promise<void> {
    this.otpError.set('');

    try {
      if (this.channel() === 'phone') {
        this.testCode.set('');
        const reply = await this.signIn.requestPhoneCode(this.phone(), this.phonePurpose());
        this.testCode.set(reply.testCode ?? '');
        this.testCodeInLogs.set(!!reply.testMode && !reply.testCode);
        if (!reply.testMode) this.toastService.success(this.t('member.auth.code_sent_sms'));
      } else {
        this.testCode.set('');
        const name = this.registrationForm.get('name')?.value || undefined;
        const reply = await this.signIn.requestSignupCode(this.email, name);
        this.testCode.set(reply.testCode ?? '');
        if (!reply.testMode) this.toastService.success(this.t('member.auth.code_sent_email'));
      }
      this.startCountdown();
    } catch (error: any) {
      const message = readSignInError(error, this.t('member.auth.send_code_failed')).message;
      this.otpError.set(message);
    }
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
    if (this.resendCountdown() > 0) return;
    this.otpError.set('');
    this.codeBoxes()?.reset();
    void this.sendOtp();
  }

  /** Test mode: put the shown code in the boxes, which verifies it. */
  useTestCode(): void {
    this.codeBoxes()?.fill(this.testCode());
  }

  /** The code boxes: verify on the last digit, or on the Verify button. */
  async verifyOtp(code?: string): Promise<void> {
    const otp = code ?? this.codeBoxes()?.value() ?? '';
    if (this.isLoading()) return;

    if (!otp || otp.length !== 6) {
      this.otpError.set(this.t('member.auth.enter_code'));
      return;
    }

    this.isLoading.set(true);
    this.otpError.set('');

    try {
      if (this.channel() === 'phone') {
        await this.signIn.verifyPhoneCode(this.phone(), otp, this.phonePurpose());
        this.goToStep(this.phonePurpose() === 'reset' ? 'newPin' : 'signup');
        return;
      }
      // Server-authoritative verification (E3): the server checks the hashed
      // code, expiry and attempt cap. Only a successful call marks the email verified.
      const result = await this.signIn.verifySignupCode(this.email, otp);
      if (result.verified) {
        this.otpVerified = true;
        this.toastService.success(this.t('member.auth.email_verified'));
        this.goToStep('signup');
      } else {
        this.otpError.set(this.t('member.auth.code_wrong'));
        this.codeBoxes()?.reset();
      }
    } catch (error: any) {
      this.otpError.set(readSignInError(error, this.t('member.auth.code_wrong_short')).message);
      this.codeBoxes()?.reset();
    } finally {
      this.isLoading.set(false);
    }
  }

  register() {
    if (this.channel() === 'phone') {
      void this.registerPhone();
      return;
    }
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
      email: this.email,
      password: this.registrationForm.get('password')?.value,
      // Always 'user': the rules refuse any other self-written role. The
      // site's default role (Settings/users.defaultRole) is applied by the
      // onUserRoleChange Cloud Function right after this document is created.
      role: 'user',
      status: 'Active',
      isActive: true,
      // Verified only if the user actually completed the OTP step. When email is
      // disabled the OTP step is skipped, so this is false (unverified).
      emailVerified: this.otpVerified,
    };

    this.authActionPending = true;
    this.authStore.signup(formData);
  }

  /** New number: name and PIN create the account on the server, which signs us in. */
  private async registerPhone(): Promise<void> {
    const nameControl = this.registrationForm.get('name');
    if (nameControl?.invalid) {
      nameControl.markAsTouched();
      return;
    }
    if (this.newPin().length !== 6) {
      this.errorMessage.set(this.t('member.auth.choose_pin'));
      return;
    }
    await this.finishPhoneSignIn(() => this.signIn.completePhoneSignup(this.phone(), nameControl?.value, this.newPin()));
  }

  /** Forgot PIN, or a number that never had one. */
  async saveNewPin(): Promise<void> {
    if (this.newPin().length !== 6) {
      this.errorMessage.set(this.t('member.auth.choose_pin'));
      return;
    }
    await this.finishPhoneSignIn(() => this.signIn.resetPin(this.phone(), this.newPin()));
  }

  /** The PIN boxes: sign in on the last digit, or on the Verify button. */
  async signInWithPin(pin?: string): Promise<void> {
    const value = pin ?? this.pinBoxes()?.value() ?? '';
    if (this.isLoading()) return;
    if (value.length !== 6) {
      this.errorMessage.set(this.t('member.auth.enter_pin'));
      return;
    }
    const failed = await this.finishPhoneSignIn(() => this.signIn.signInWithPin(this.phone(), value));
    if (failed?.reason === 'locked') this.pinLocked.set(true);
    if (failed?.reason === 'no-pin') this.forgotPin();
    if (failed) this.pinBoxes()?.reset();
  }

  /** Run a phone sign-in call; the session it starts is picked up by the auth effect. */
  private async finishPhoneSignIn(action: () => Promise<void>) {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.authActionPending = true;
    try {
      await action();
      return null;
    } catch (err) {
      this.authActionPending = false;
      const error = readSignInError(err);
      this.errorMessage.set(error.message);
      return error;
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Forgot PIN: a code by SMS, then a new PIN. */
  forgotPin(): void {
    this.phonePurpose.set('reset');
    this.goToStep('verify');
    void this.sendOtp();
  }

  login() {
    if (this.registrationForm.get('loginPassword')?.invalid) {
      this.registrationForm.get('loginPassword')?.markAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.authStore.clearList(); // Clear previous error state

    const password = this.registrationForm.get('loginPassword')?.value;

    this.authActionPending = true;
    this.authStore.login({ email: this.email, password });
  }

  forgotPassword() {
    const email = this.email;
    if (email) {
      this.authStore.forgotPassword(email).then((res: any) => {
        if (res?.status === 200) {
          this.successMessage.set(this.t('member.auth.reset_link_sent', { email }));
        } else {
          this.errorMessage.set(this.t('member.auth.reset_failed'));
        }
      });
    }
  }

  /** One tap. A first-timer gets an account from the Google profile. */
  async continueWithGoogle(): Promise<void> {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      await this.signIn.signInWithGoogle();
      this.authActionPending = true;
      const user = await this.authStore.refreshCurrentUser();
      if (!user) throw { code: 'no-record', message: this.t(NO_ACCESS_KEY) };
    } catch (err) {
      this.authActionPending = false;
      await this.handleGoogleError(err);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async handleGoogleError(err: unknown): Promise<void> {
    const code = String((err as { code?: string })?.code ?? '');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/account-exists-with-different-credential') {
      // An email account already has this address: sign in with the password
      // once, and Google is connected to it.
      this.pendingGoogleCredential = this.signIn.googleCredentialFrom(err);
      const email = (err as { customData?: { email?: string } })?.customData?.email ?? '';
      this.registrationForm.get('identifier')?.setValue(email);
      this.channel.set('email');
      this.goToStep('login');
      this.successMessage.set(this.t('member.auth.existing_account_google'));
      return;
    }
    const error = readSignInError(err, this.t('member.auth.google_failed'));
    // Signed in to Google but no access here: do not stay half signed in.
    await firstValueFrom(this.authStore.logout()).catch(() => undefined);
    if (error.reason === 'signup-closed') {
      this.goToStep('disabled');
      return;
    }
    this.errorMessage.set(code.startsWith('auth/') ? this.t('member.auth.google_failed') : error.message);
  }

  /** Back to the first step, keeping what was typed. */
  changeIdentifier(): void {
    this.testCode.set('');
    this.testCodeInLogs.set(false);
    clearInterval(this.countdownInterval);
    this.resendCountdown.set(0);
    this.goToStep('request');
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
      if (this.pendingGoogleCredential) {
        const credential = this.pendingGoogleCredential;
        this.pendingGoogleCredential = null;
        void this.signIn?.linkCredential(credential).catch((err) => console.warn('Could not connect Google:', err));
      }
      // Back to the page that sent them here (/signup?redirect=/learn), else
      // their role's home page (src/custom/home.ts over Arc CMS's defaults).
      const role = this.authStore.isAdmin() ? 'admin' : user.role;
      const asked = safeRedirect(this.router.parseUrl(this.router.url).queryParams['redirect']);
      const route = asked ?? homeFor(role);

      this.toastService.success(this.t('member.auth.redirecting'));
      this.router.navigateByUrl(route, { replaceUrl: true });
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
