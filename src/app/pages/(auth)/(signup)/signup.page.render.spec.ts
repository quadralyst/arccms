/**
 * The sign-in page, rendered with its services stubbed:
 * - its settings (Settings/users, F20): Continue tapped before they arrive waits
 *   for them, then goes on; settings that never arrive are said to be a connection
 *   problem, not a wrong email; a later visit starts from this browser's copy.
 * - someone already signed in (F19): "Opening…" and no form while their record
 *   is on its way, then forwarded; the form when nobody is, or the record is gone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';

const { mockCallableFn } = vi.hoisted(() => ({ mockCallableFn: vi.fn() }));
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn(() => mockCallableFn),
}));

import SignupComponent, { FIRST_ENTRY_WAIT_MS, ROUTER_SKIP_WAIT_MS, SETTINGS_WAIT_MS, SIGNED_IN_WAIT_MS } from './signup.page';
import { NavigationSkipped, type Event as RouterEvent } from '@angular/router';
import { Subject } from 'rxjs';
import { SIGNED_IN_KEY } from '../../../core/site/signed-in-hint';
import { AuthState } from '../auth.store';
import { AuthService } from '../auth.service';
import { SignInService } from '../sign-in.service';
import { OnboardingSetupService } from '../../(onboarding)/onboarding-setup.service';
import { SIGN_IN_SETTINGS_CACHE_KEY, UserSettingService } from '../../admin/(settings)/user-setting/user-setting.service';
import { IUserSettings } from '../../admin/(settings)/user-setting/user-setting.model';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { GlobalService } from '../../../../shared/services/global.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { SiteBrandService } from '../../../core/brand/site-brand';
import { SiteStylesService } from '../../../core/site/site-styles';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';
import { english } from '../../../../test/english';
import { CodeInputComponent } from '../../../../shared/components/code-input/code-input.component';
import { NewPinInputComponent } from '../../../../shared/components/new-pin-input/new-pin-input.component';
import { By } from '@angular/platform-browser';
import { WaitLineComponent } from '../../../../shared/components/wait-line/wait-line.component';
import { SLOW_AFTER_MS, STALLED_AFTER_MS } from '../../../../shared/utils/wait-stage';
import { CUSTOM_SIGN_IN_PAGE } from '../../../../custom/sign-in-page';

const OPEN: IUserSettings = { isSignupEnabled: true, defaultRole: 'user', phoneSignIn: true, phoneCountries: ['IN'], phoneCountry: 'IN' };

/** A promise the test settles when it wants: the server answering late. */
function later<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
};

let fixture: ComponentFixture<SignupComponent>;
let page: SignupComponent;
let settingsRead: ReturnType<typeof later<IUserSettings>>;
let signIn: Record<string, ReturnType<typeof vi.fn>>;
/** Firebase Auth on this device: who it says is signed in, once it has looked. */
let auth: { currentUser: { uid: string } | null; authStateReady: () => Promise<void> };
let authReady: ReturnType<typeof later<void>>;
/** AuthState.recordReady(): the record, or null for nobody (or no record). */
let record: ReturnType<typeof later<unknown>>;
let currentUser: ReturnType<typeof signal<unknown>>;
let navigateByUrl: ReturnType<typeof vi.fn>;

function render(): void {
    fixture = TestBed.createComponent(SignupComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
}

const button = () => fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement;
const typed = (value: string) => page.registrationForm.get('identifier')!.setValue(value);
const shown = () => fixture.nativeElement.textContent as string;
const form = () => fixture.nativeElement.querySelector('form') as HTMLFormElement | null;
const opening = () => fixture.nativeElement.querySelector('.auth-opening') as HTMLElement | null;
/** Type a new PIN in its two rows ("Your new PIN", "Type it again"), the second as `again`. */
const typeNewPin = (pin: string, again = pin) => {
    fixture.detectChanges();
    const [first, second] = fixture.debugElement.query(By.directive(NewPinInputComponent))
        .queryAll(By.directive(CodeInputComponent)).map((row) => row.componentInstance as CodeInputComponent);
    first.fill(pin);
    second.fill(again);
};

beforeEach(async () => {
    localStorage.removeItem(SIGN_IN_SETTINGS_CACHE_KEY);
    localStorage.removeItem(SIGNED_IN_KEY);
    settingsRead = later<IUserSettings>();
    authReady = later<void>();
    auth = { currentUser: null, authStateReady: () => authReady.promise };
    record = later<unknown>();
    currentUser = signal<unknown>(null);
    signIn = {
        warmUp: vi.fn(),
        warm: vi.fn(),
        checkEmail: vi.fn().mockResolvedValue({ status: 'new' }),
        checkPhone: vi.fn().mockResolvedValue({ phone: '+919876543210', exists: false, hasPin: false, signupOpen: true }),
        requestSignupCode: vi.fn().mockResolvedValue({}),
        requestPhoneCode: vi.fn().mockResolvedValue({}),
    };
    TestBed.configureTestingModule({
        imports: [SignupComponent, translocoTestingModule()],
        providers: [
            provideRouter([]),
            { provide: AuthState, useValue: {
                isLoading: signal(false), isSuccess: signal(false), isAuthenticated: signal(false),
                error: signal(''), errorCode: signal(''), currentUser, isAdmin: signal(false),
                recordReady: () => record.promise,
            } },
            { provide: Auth, useValue: auth },
            { provide: AuthService, useValue: {} },
            { provide: SignInService, useValue: signIn },
            { provide: OnboardingSetupService, useValue: { shouldShowOnboarding: () => of(false) } },
            { provide: UserSettingService, useValue: { readSettings: () => settingsRead.promise } },
            { provide: EmailConfigStatusService, useValue: { isLoading$: of(false), shouldVerifySignup: () => true } },
            { provide: GlobalService, useValue: { debugMode: signal(false) } },
            { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
            { provide: NotifyService, useValue: {} },
            { provide: SiteBrandService, useValue: { brand: signal(null), load: () => Promise.resolve() } },
            { provide: SiteStylesService, useValue: { use: () => () => undefined } },
        ],
    });
    // The page's own children (language picker, brand panel, country chip) are not
    // under test here; the code boxes and the waiting line are real, since steps need their bindings.
    TestBed.overrideComponent(SignupComponent, {
        set: { imports: [ReactiveFormsModule, CommonModule, RouterModule, TranslocoPipe, CodeInputComponent, NewPinInputComponent, WaitLineComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    await TestBed.compileComponents();
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as never;
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(SIGN_IN_SETTINGS_CACHE_KEY);
    localStorage.removeItem(SIGNED_IN_KEY);
});

describe('SignupComponent: the sign-in settings (F20)', () => {

    it('holds an email Continue until the settings arrive, then goes to the code step', async () => {
        render();
        typed('new@person.com');
        page.handleSubmit();
        fixture.detectChanges();
        expect(button().disabled).toBe(true);
        expect(signIn['checkEmail']).not.toHaveBeenCalled();

        settingsRead.resolve(OPEN);
        await flush();
        fixture.detectChanges();
        // Sign-up needs a code here, so the check is asked to send it (specs/sign-in-speed-spec.md, SP-D6).
        expect(signIn['checkEmail']).toHaveBeenCalledWith('new@person.com', expect.objectContaining({ sendCode: true }));
        expect(page.currentStep()).toBe('verify');
        // This check sent nothing (a server before SP), so the page asks for the code itself.
        expect(signIn['requestSignupCode']).toHaveBeenCalled();
        expect(page.errorMessage()).toBe('');
        expect(shown()).not.toContain(english('member.auth.check_email_failed'));
    });

    it('holds a phone number the same way, and reads it as a number once phone sign-in is known to be on', async () => {
        render();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        expect(signIn['checkPhone']).not.toHaveBeenCalled();
        expect(page.isFieldInvalid('identifier')).toBe(false);

        settingsRead.resolve(OPEN);
        await flush();
        expect(signIn['checkPhone']).toHaveBeenCalledWith('+919876543210', { sendCode: true });
        expect(page.currentStep()).toBe('verify');
        expect(page.channel()).toBe('phone');
    });

    it('a code the check sent goes straight to the code boxes, with no second call (specs/sign-in-speed-spec.md, SP-D5)', async () => {
        signIn['checkPhone'].mockResolvedValue({
            phone: '+919876543210', exists: false, hasPin: false, signupOpen: true,
            code: { sent: true, phone: '+919876543210', testMode: true, testCode: '482913' },
        });
        settingsRead.resolve(OPEN);
        render();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
        expect(signIn['requestPhoneCode']).not.toHaveBeenCalled();
        expect(page.testCode()).toBe('482913');
        expect(page.resendCountdown()).toBeGreaterThan(55);
        expect(shown()).not.toContain(english('member.auth.sending_code'));
    });

    it('a send the check was refused shows on the code screen, with Resend there at once (SP-D7, SP-D9)', async () => {
        signIn['checkPhone'].mockResolvedValue({
            phone: '+919876543210', exists: false, hasPin: false, signupOpen: true,
            codeError: { code: 'resource-exhausted', message: 'Too many codes for this number.', details: { reason: 'too-many-codes' } },
        });
        settingsRead.resolve(OPEN);
        render();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
        expect(signIn['requestPhoneCode']).not.toHaveBeenCalled();
        expect(page.otpError()).toBe('Too many codes for this number.');
        expect(page.resendCountdown()).toBe(0);
    });

    it('while the code is on its way: the countdown runs and says so, so Resend is not offered (SP-D14)', async () => {
        const sending = later<Record<string, unknown>>();
        signIn['requestPhoneCode'].mockReturnValue(sending.promise);
        settingsRead.resolve(OPEN);
        render();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
        expect(page.resendCountdown()).toBeGreaterThan(55);
        expect(shown()).toContain(english('member.auth.sending_code'));
        expect(fixture.nativeElement.querySelector('#timer a')).toBeNull();

        sending.resolve({ sent: true, testMode: true, testCode: '482913' });
        await flush();
        fixture.detectChanges();
        expect(shown()).not.toContain(english('member.auth.sending_code'));
        expect(page.testCode()).toBe('482913');
    });

    it('says the sign-in options could not be loaded when the read fails, and tries again on the next Continue', async () => {
        render();
        typed('new@person.com');
        page.handleSubmit();
        settingsRead.reject(new Error('Failed to get document because the client is offline.'));
        await flush();
        fixture.detectChanges();
        expect(page.errorMessage()).toBe(english('member.auth.settings_failed'));
        expect(shown()).toContain(english('member.auth.settings_failed'));
        expect(shown()).not.toContain(english('member.auth.check_email_failed'));
        expect(signIn['checkEmail']).not.toHaveBeenCalled();
        expect(button().disabled).toBe(false);

        settingsRead = later<IUserSettings>();
        page.handleSubmit();
        settingsRead.resolve(OPEN);
        await flush();
        expect(page.currentStep()).toBe('verify');
    });

    it('gives up waiting after a while, and still puts in settings that answer late', async () => {
        vi.useFakeTimers();
        render();
        typed('new@person.com');
        page.handleSubmit();
        await vi.advanceTimersByTimeAsync(SETTINGS_WAIT_MS + 10);
        expect(page.errorMessage()).toBe(english('member.auth.settings_failed'));
        expect(page.continueHeld()).toBe(false);

        settingsRead.resolve(OPEN);
        await vi.advanceTimersByTimeAsync(0);
        expect(page.settings()).toEqual(OPEN);
        expect(page.phoneEnabled()).toBe(true);
    });

    it('starts from this browser\'s copy of the settings, so Continue goes on at once', async () => {
        localStorage.setItem(SIGN_IN_SETTINGS_CACHE_KEY, JSON.stringify(OPEN));
        render();
        expect(page.phoneEnabled()).toBe(true);
        typed('new@person.com');
        page.handleSubmit();
        await flush();
        expect(signIn['checkEmail']).toHaveBeenCalled();
        expect(page.currentStep()).toBe('verify');
    });

    it('keeps working from the copy when the server read fails', async () => {
        localStorage.setItem(SIGN_IN_SETTINGS_CACHE_KEY, JSON.stringify({ ...OPEN, isSignupEnabled: false }));
        render();
        settingsRead.reject(new Error('offline'));
        await flush();
        typed('new@person.com');
        page.handleSubmit();
        await flush();
        expect(page.currentStep()).toBe('disabled');
        expect(page.errorMessage()).toBe('');
    });

    it('checkEmail with no settings says so, rather than reporting the email', async () => {
        render();
        page.registrationForm.get('identifier')!.setValue('new@person.com');
        await page.checkEmail();
        expect(page.errorMessage()).toBe(english('member.auth.settings_failed'));
        expect(page.currentStep()).toBe('request');
    });
});

describe('SignupComponent: someone already signed in (F19)', () => {
    const signedInMember = { uid: 'u1', id: 'r1', role: 'user', isActive: true };

    it('shows "Opening…" and never the form while the record is on its way, then forwards', async () => {
        localStorage.setItem(SIGNED_IN_KEY, '1');
        auth.currentUser = { uid: 'u1' };
        render();
        expect(opening()).not.toBeNull();
        expect(form()).toBeNull();
        expect(opening()!.textContent).toContain(english('member.auth.opening'));

        authReady.resolve();
        await flush();
        fixture.detectChanges();
        expect(form()).toBeNull();

        currentUser.set(signedInMember);
        record.resolve(signedInMember);
        await flush();
        fixture.detectChanges();
        expect(navigateByUrl).toHaveBeenCalled();
        expect(form()).toBeNull();
    });

    it('waits for Auth when the hint is missing, and turns to "Opening…" once Auth finds someone', async () => {
        auth.currentUser = { uid: 'u1' };
        render();
        authReady.resolve();
        await flush();
        fixture.detectChanges();
        expect(opening()).not.toBeNull();
        expect(form()).toBeNull();
    });

    it('shows the form at once when nobody is signed in', async () => {
        render();
        expect(form()).not.toBeNull();
        authReady.resolve();
        record.resolve(null);
        await flush();
        fixture.detectChanges();
        expect(form()).not.toBeNull();
        expect(opening()).toBeNull();
    });

    it('shows the form after all when a stale hint meets an Auth with nobody', async () => {
        localStorage.setItem(SIGNED_IN_KEY, '1');
        render();
        expect(form()).toBeNull();
        authReady.resolve();
        await flush();
        fixture.detectChanges();
        expect(form()).not.toBeNull();
    });

    it('falls back to the form when the record never comes (a deleted account)', async () => {
        localStorage.setItem(SIGNED_IN_KEY, '1');
        auth.currentUser = { uid: 'u1' };
        render();
        authReady.resolve();
        await flush();
        record.resolve(null);
        await flush();
        fixture.detectChanges();
        expect(form()).not.toBeNull();
        expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('falls back to the form when the record takes too long', async () => {
        vi.useFakeTimers();
        localStorage.setItem(SIGNED_IN_KEY, '1');
        auth.currentUser = { uid: 'u1' };
        render();
        authReady.resolve();
        await vi.advanceTimersByTimeAsync(SIGNED_IN_WAIT_MS + 10);
        fixture.detectChanges();
        expect(form()).not.toBeNull();
    });
});

describe('UserSettingService: the copy this browser keeps', () => {
    it('is ignored when it is not settings', async () => {
        const { readStoredSignInSettings } = await import('../../admin/(settings)/user-setting/user-setting.service');
        localStorage.setItem(SIGN_IN_SETTINGS_CACHE_KEY, '{"nope":1}');
        expect(readStoredSignInSettings()).toBeNull();
        localStorage.setItem(SIGN_IN_SETTINGS_CACHE_KEY, 'not json');
        expect(readStoredSignInSettings()).toBeNull();
        localStorage.setItem(SIGN_IN_SETTINGS_CACHE_KEY, JSON.stringify({ isSignupEnabled: false }));
        expect(readStoredSignInSettings()).toMatchObject({ isSignupEnabled: false, defaultRole: 'user' });
        localStorage.removeItem(SIGN_IN_SETTINGS_CACHE_KEY);
    });
});

describe('SignupComponent: the first frame and the way out (F22)', () => {
    const label = () => fixture.nativeElement.querySelector('label[for=identifier]') as HTMLLabelElement;
    const input = () => fixture.nativeElement.querySelector('#identifier') as HTMLInputElement;

    it('never says "Email" on a first visit to a site with phone sign-in, and asks for the right thing once the settings are in', async () => {
        render();
        expect(label().classList).toContain('methods-pending');
        expect(fixture.nativeElement.querySelector('.auth-subtitle').classList).toContain('methods-pending');
        expect(input().placeholder).toBe('');

        settingsRead.resolve(OPEN);
        await flush();
        fixture.detectChanges();
        expect(label().classList).not.toContain('methods-pending');
        expect(label().textContent!.trim()).toBe(english('member.auth.identifier_label_phone'));
        expect(input().placeholder).toBe(english('member.auth.identifier_placeholder_phone'));
    });

    it('asks for an email, as before, when the settings cannot be read', async () => {
        render();
        settingsRead.reject(new Error('offline'));
        await flush();
        fixture.detectChanges();
        expect(label().classList).not.toContain('methods-pending');
        expect(label().textContent!.trim()).toBe(english('member.auth.identifier_label_email'));
    });

    it('keeps Create Account busy from the tap until the page has moved on', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        const created = later<void>();
        signIn['completePhoneSignup'] = vi.fn(() => created.promise);
        page.channel.set('phone');
        page.phone.set('+919876543210');
        page.goToStep('signup');
        page.registrationForm.get('name')!.setValue('Asha Rao');
        typeNewPin('135792');
        fixture.detectChanges();
        expect(button().disabled).toBe(false);

        page.register();
        fixture.detectChanges();
        expect(button().disabled).toBe(true);

        // The account is made; the record is still on its way.
        created.resolve();
        await flush();
        fixture.detectChanges();
        expect(page.isLoading()).toBe(false);
        expect(button().disabled).toBe(true);

        currentUser.set({ uid: 'u1', id: 'r1', role: 'user', isActive: true });
        await flush();
        fixture.detectChanges();
        // The step's history entry comes off first (RF6, 6.4); this test's router never answers, so its timer moves on.
        await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalled(), { timeout: FIRST_ENTRY_WAIT_MS + 1000 });
        fixture.detectChanges();
        expect(button().disabled).toBe(true);
        expect(signIn['completePhoneSignup']).toHaveBeenCalledTimes(1);
    });

    it('creates nothing when the two PINs differ, and says so', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        signIn['completePhoneSignup'] = vi.fn().mockResolvedValue(undefined);
        page.channel.set('phone');
        page.phone.set('+919876543210');
        page.goToStep('signup');
        page.registrationForm.get('name')!.setValue('Asha Rao');
        typeNewPin('135792', '135729');
        page.register();
        await flush();
        expect(signIn['completePhoneSignup']).not.toHaveBeenCalled();
        expect(page.errorMessage()).toBe(english('member.auth.pins_mismatch'));
    });

    it('gives Create Account back when the sign-up fails', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        signIn['completePhoneSignup'] = vi.fn().mockRejectedValue({ code: 'functions/already-exists', message: 'This number already has an account.' });
        page.channel.set('phone');
        page.phone.set('+919876543210');
        page.goToStep('signup');
        page.registrationForm.get('name')!.setValue('Asha Rao');
        typeNewPin('135792');
        page.register();
        await flush();
        fixture.detectChanges();
        expect(button().disabled).toBe(false);
        expect(page.errorMessage()).toBe('This number already has an account.');
    });
});

describe('SignupComponent: new passwords (F22)', () => {
    async function atEmailSignup(): Promise<void> {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        typed('asha.rao@example.com');
        page.channel.set('email');
        page.goToStep('signup');
        page.registrationForm.get('name')!.setValue('Asha Rao');
        fixture.detectChanges();
    }

    it('refuses a password too easy to guess, saying why, and never creates the account', async () => {
        await atEmailSignup();
        const signup = vi.fn();
        Object.assign(TestBed.inject(AuthState), { signup, clearList: vi.fn() });
        for (const [password, problem] of [['12345678', 'sequence'], ['Password123!', 'common'], ['Asha@2024', 'personal']]) {
            page.registrationForm.patchValue({ password, confirmPassword: password });
            form()!.dispatchEvent(new Event('submit'));
            fixture.detectChanges();
            expect(shown()).toContain(english(`member.auth.password_error.${problem}`));
        }
        expect(signup).not.toHaveBeenCalled();

        page.registrationForm.patchValue({ password: 'Monsoon-Train-42', confirmPassword: 'Monsoon-Train-42' });
        page.register();
        expect(signup).toHaveBeenCalledWith(expect.objectContaining({ email: 'asha.rao@example.com', password: 'Monsoon-Train-42' }));
    });

    it('checks the password against a name changed after it was typed', async () => {
        await atEmailSignup();
        page.registrationForm.patchValue({ name: 'Someone', password: 'Kavya2024!', confirmPassword: 'Kavya2024!' });
        expect(page.registrationForm.get('password')!.valid).toBe(true);
        page.registrationForm.get('name')!.setValue('Kavya Rao');
        page.register();
        expect(page.registrationForm.get('password')!.errors?.['password']).toBe('personal');
    });

    it('signs in with a password set before, whatever its length', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.goToStep('login');
        page.registrationForm.get('loginPassword')!.setValue('abc123');
        expect(page.registrationForm.get('loginPassword')!.valid).toBe(true);
    });
});

describe('SignupComponent: Forgot password by an emailed code', () => {
    let firebaseReset: ReturnType<typeof vi.fn>;
    let login: ReturnType<typeof vi.fn>;

    async function atLogin(): Promise<void> {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        typed('asha@example.com');
        page.goToStep('login');
        firebaseReset = vi.fn().mockResolvedValue({ status: 200 });
        login = vi.fn();
        Object.assign(TestBed.inject(AuthState), { forgotPassword: firebaseReset, login, clearList: vi.fn() });
        signIn['requestPasswordReset'] = vi.fn().mockResolvedValue({ sent: true, status: 'pending' });
        signIn['verifyResetCode'] = vi.fn().mockResolvedValue({ verified: true });
        signIn['resetPassword'] = vi.fn().mockResolvedValue(undefined);
        fixture.detectChanges();
    }
    async function forgot(): Promise<void> {
        (fixture.nativeElement.querySelector('.forgot-password') as HTMLElement).click();
        await flush();
        fixture.detectChanges();
    }
    const refusal = (reason: string, message: string) => Object.assign(new Error(message), { code: 'functions/failed-precondition', details: { reason } });

    it('emails a reset code and asks for it, with no Firebase email', async () => {
        await atLogin();
        await forgot();
        expect(signIn['requestPasswordReset']).toHaveBeenCalledWith('asha@example.com');
        expect(page.currentStep()).toBe('verify');
        expect(shown()).toContain(english('member.auth.step_title_reset_password'));
        expect(firebaseReset).not.toHaveBeenCalled();
    });

    it('shows the code while testing when an admin turned that on, else says it is in Email Logs', async () => {
        await atLogin();
        signIn['requestPasswordReset'].mockResolvedValue({ sent: true, status: 'pending', testMode: true, testCode: '482913' });
        await forgot();
        expect(shown()).toContain('482913');

        page.changeIdentifier();
        typed('ravi@example.com');
        page.goToStep('login');
        fixture.detectChanges();
        signIn['requestPasswordReset'].mockResolvedValue({ sent: true, status: 'pending', testMode: true, testCodeInLogs: true });
        await forgot();
        expect(shown()).toContain(english('member.auth.test_code_in_email_logs'));
    });

    it("falls back to Firebase's reset email when the email engine sent nothing", async () => {
        await atLogin();
        signIn['requestPasswordReset'].mockResolvedValue({ sent: false, status: 'skipped' });
        await forgot();
        expect(firebaseReset).toHaveBeenCalledWith('asha@example.com');
        expect(page.currentStep()).toBe('login');
        expect(shown()).toContain(english('member.auth.reset_link_sent', { email: 'asha@example.com' }));
    });

    it("says a host app's login is reset there, on the password step", async () => {
        await atLogin();
        signIn['requestPasswordReset'].mockRejectedValue(refusal('host-account', 'Reset your password in the app you signed up with.'));
        await forgot();
        expect(page.currentStep()).toBe('login');
        expect(shown()).toContain('Reset your password in the app you signed up with.');
        expect(firebaseReset).not.toHaveBeenCalled();
    });

    it('takes a new password after the code, checks it, saves it and signs in with it', async () => {
        await atLogin();
        await forgot();
        await page.verifyOtp('482913');
        fixture.detectChanges();
        expect(signIn['verifyResetCode']).toHaveBeenCalledWith('asha@example.com', '482913');
        expect(page.currentStep()).toBe('newPassword');
        expect(shown()).toContain(english('member.auth.step_title_new_password'));

        page.registrationForm.get('password')!.setValue('12345678');
        page.registrationForm.get('confirmPassword')!.setValue('12345678');
        await page.saveNewPassword();
        fixture.detectChanges();
        expect(shown()).toContain(english('member.auth.password_error.sequence'));
        expect(signIn['resetPassword']).not.toHaveBeenCalled();

        // Typed twice: two that differ save nothing.
        page.registrationForm.get('password')!.setValue('river-lamp-2024');
        page.registrationForm.get('confirmPassword')!.setValue('river-lamp-2042');
        await page.saveNewPassword();
        fixture.detectChanges();
        expect(signIn['resetPassword']).not.toHaveBeenCalled();
        expect(shown()).toContain(english('member.auth.passwords_mismatch'));

        page.registrationForm.get('confirmPassword')!.setValue('river-lamp-2024');
        await page.saveNewPassword();
        expect(signIn['resetPassword']).toHaveBeenCalledWith('asha@example.com', 'river-lamp-2024');
        expect(login).toHaveBeenCalledWith({ email: 'asha@example.com', password: 'river-lamp-2024' });
    });

    it('goes back to the code when it ran out before the password was saved', async () => {
        await atLogin();
        await forgot();
        await page.verifyOtp('482913');
        signIn['resetPassword'].mockRejectedValue(refusal('code-expired', 'That code has expired. Please ask for a new one.'));
        page.registrationForm.get('password')!.setValue('river-lamp-2024');
        page.registrationForm.get('confirmPassword')!.setValue('river-lamp-2024');
        await page.saveNewPassword();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
        expect(shown()).toContain('That code has expired. Please ask for a new one.');
        expect(login).not.toHaveBeenCalled();
    });
});

describe('SignupComponent: the cursor on each step (SS1)', () => {
    const codeBoxes = () => Array.from(fixture.nativeElement.querySelectorAll('.code-box')) as HTMLInputElement[];
    const nameBox = () => fixture.nativeElement.querySelector('input[formControlName=name]') as HTMLInputElement;

    /** The page in the document, so its fields can take focus. */
    async function inPage(): Promise<void> {
        settingsRead.resolve(OPEN);
        render();
        document.body.append(fixture.nativeElement);
        await flush();
        fixture.detectChanges();
    }

    afterEach(() => document.body.replaceChildren());

    it('puts the cursor in the first code box once the code is sent, though the boxes opened busy', async () => {
        await inPage();
        const sent = later<object>();
        signIn['requestSignupCode'] = vi.fn(() => sent.promise);
        typed('new@person.com');
        (fixture.nativeElement.querySelector('#identifier') as HTMLInputElement).focus();
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
        expect(codeBoxes()[0].disabled).toBe(true);

        sent.resolve({});
        await flush();
        fixture.detectChanges();
        expect(codeBoxes()[0].disabled).toBe(false);
        expect(document.activeElement).toBe(codeBoxes()[0]);
    });

    it('opens the details step on the name, not on the PIN boxes below it', async () => {
        await inPage();
        page.channel.set('phone');
        page.phone.set('+919876543210');
        page.goToStep('signup');
        fixture.detectChanges();
        // The PIN and its second row.
        expect(codeBoxes()).toHaveLength(12);
        expect(document.activeElement).toBe(nameBox());
    });
});

describe('SignupComponent: a wrong PIN (F29)', () => {
    // The layout rules are in signup.page.layout.spec.ts; measured in a browser at 320,
    // 375 and 1200px wide and at 150% text: the error 8px under Show PIN, the link on top.
    it('shows the error under Show PIN, in the same column, never in front of it', async () => {
        settingsRead.resolve(OPEN);
        signIn['signInWithPin'] = vi.fn().mockRejectedValue({
            code: 'functions/permission-denied', message: 'Wrong PIN. 3 left.', details: { reason: 'wrong-pin', left: 3 },
        });
        render();
        await flush();
        page.channel.set('phone');
        page.currentStep.set('pin');
        fixture.detectChanges();

        await page.signInWithPin('123456');
        fixture.detectChanges();

        const field = fixture.nativeElement.querySelector('.pin-field') as HTMLElement;
        const toggle = field.querySelector('.pin-toggle') as HTMLButtonElement;
        const error = field.querySelector('.alert-danger') as HTMLElement;
        expect(error.textContent!.trim()).toBe('Wrong PIN. 3 left.');
        expect(error.getAttribute('role')).toBe('alert');
        // The boxes, the link, then the error: siblings, in that order, nothing between.
        expect([...field.children].map((el) => el.tagName.toLowerCase() === 'arc-code-input' ? 'boxes' : el.classList.contains('pin-toggle') ? 'link' : 'error'))
            .toEqual(['boxes', 'link', 'error']);
        // The line that says the PIN is being checked comes just after, empty now (F33).
        expect(field.nextElementSibling!.tagName.toLowerCase()).toBe('arc-wait-line');
        expect(field.nextElementSibling!.textContent!.trim()).toBe('');
        expect(toggle.nextElementSibling).toBe(error);
        expect(toggle.disabled).toBe(false);
    });
});

describe('SignupComponent: saying it is working (F33)', () => {
    const waitLine = () => (fixture.nativeElement.querySelector('.pin-field + arc-wait-line') as HTMLElement).textContent!.trim();
    const boxesDisabled = () => [...fixture.nativeElement.querySelectorAll('.pin-field .code-box')].every((box) => (box as HTMLInputElement).disabled);

    async function onPinStep(): Promise<ReturnType<typeof later<void>>> {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.channel.set('phone');
        page.currentStep.set('pin');
        fixture.detectChanges();
        const answer = later<void>();
        signIn['signInWithPin'] = vi.fn(() => answer.promise);
        return answer;
    }

    it('says "Checking…" after the last PIN digit, then "Still checking…", then that no answer has come, the boxes still till the answer', async () => {
        const answer = await onPinStep();
        vi.useFakeTimers();
        void page.signInWithPin('123456');
        fixture.detectChanges();
        expect(waitLine()).toBe(english('member.wait.checking'));
        expect(boxesDisabled()).toBe(true);

        vi.advanceTimersByTime(SLOW_AFTER_MS);
        fixture.detectChanges();
        expect(waitLine()).toBe(english('member.wait.still_checking'));

        vi.advanceTimersByTime(STALLED_AFTER_MS - SLOW_AFTER_MS);
        fixture.detectChanges();
        expect(waitLine()).toBe(english('member.wait.no_answer'));
        expect(boxesDisabled()).toBe(true);

        // A wrong PIN at last: the line goes, the error says why, the boxes work again.
        answer.reject({ code: 'functions/permission-denied', message: 'Wrong PIN. 3 left.', details: { reason: 'wrong-pin', left: 3 } });
        await vi.runAllTimersAsync();
        fixture.detectChanges();
        expect(waitLine()).toBe('');
        expect(page.errorMessage()).toBe('Wrong PIN. 3 left.');
        expect(boxesDisabled()).toBe(false);
    });

    /** Spinners a person can see: not hidden themselves or inside something hidden. */
    const visibleSpinners = () => [...fixture.nativeElement.querySelectorAll('.spinner-border')]
        .filter((el) => !(el as HTMLElement).closest('[hidden]')).length;

    it('shows one spinner for one wait: the busy button\'s, with the words under it and no second spinner (F38)', async () => {
        const answer = await onPinStep();
        expect(visibleSpinners()).toBe(0);
        void page.signInWithPin('123456');
        fixture.detectChanges();
        expect(waitLine()).toBe(english('member.wait.checking'));
        expect(visibleSpinners()).toBe(1);
        expect(fixture.nativeElement.querySelector('.pin-field + arc-wait-line .spinner-border')).toBeNull();
        answer.reject({ code: 'functions/permission-denied', message: 'Wrong PIN.', details: { reason: 'wrong-pin', left: 3 } });
        await flush();
        fixture.detectChanges();
        expect(visibleSpinners()).toBe(0);
    });

    it('shows one spinner while Continue checks an email (F38)', async () => {
        settingsRead.resolve(OPEN);
        signIn['checkEmail'].mockReturnValue(new Promise(() => undefined));
        render();
        await flush();
        typed('new@person.com');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.checking()).toBe(true);
        expect(visibleSpinners()).toBe(1);
        expect((fixture.nativeElement.querySelector('arc-wait-line') as HTMLElement).textContent!.trim()).toBe(english('member.wait.checking'));
    });

    it('says "Opening…" once the PIN went through, while the next page loads', async () => {
        const answer = await onPinStep();
        void page.signInWithPin('123456');
        answer.resolve();
        await flush();
        fixture.detectChanges();
        expect(waitLine()).toBe(english('member.auth.opening'));
    });

    it('says nothing while Google\'s own window is open', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        const popup = later<void>();
        signIn['signInWithGoogle'] = vi.fn(() => popup.promise);
        void page.continueWithGoogle();
        fixture.detectChanges();
        expect(page.working()).toBe(true);
        expect(page.checking()).toBe(false);
    });

    it('wakes the functions a step calls as it opens, in case the page was open longer than they stay started', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.channel.set('phone');
        page.goToStep('pin');
        expect(signIn['warm']).toHaveBeenLastCalledWith(['signInWithPin', 'requestPhoneOtp']);
        page.channel.set('email');
        page.goToStep('pin');
        expect(signIn['warm']).toHaveBeenLastCalledWith(['signInWithEmailPin', 'requestEmailPinCode']);
        page.goToStep('newPassword');
        expect(signIn['warm']).toHaveBeenLastCalledWith(['resetPassword']);
    });
});

describe('SignupComponent: the app\'s hooks (src/custom/sign-in-page.ts, F33)', () => {
    afterEach(() => {
        delete CUSTOM_SIGN_IN_PAGE.opened;
        delete CUSTOM_SIGN_IN_PAGE.signingUp;
    });

    it('tells the app once the form shows to someone not signed in, and its warm wakes the app\'s own functions', async () => {
        const opened = vi.fn(({ warm }) => warm(['openShop']));
        CUSTOM_SIGN_IN_PAGE.opened = opened;
        render();
        authReady.resolve();
        record.resolve(null);
        await flush();
        expect(opened).toHaveBeenCalledTimes(1);
        expect(signIn['warm']).toHaveBeenCalledWith(['custom-openShop']);
    });

    it('does not tell the app the page opened when the person is signed in and forwarded', async () => {
        const opened = vi.fn();
        CUSTOM_SIGN_IN_PAGE.opened = opened;
        auth.currentUser = { uid: 'u1' };
        currentUser.set({ id: 'u1', role: 'user' });
        render();
        authReady.resolve();
        record.resolve({ id: 'u1', role: 'user' });
        await flush();
        expect(opened).not.toHaveBeenCalled();
    });

    it('tells the app once when a new account is under way, with its channel', async () => {
        const signingUp = vi.fn(({ warm }) => warm(['createWorkspace']));
        CUSTOM_SIGN_IN_PAGE.signingUp = signingUp;
        settingsRead.resolve(OPEN);
        render();
        typed('new@person.com');
        page.handleSubmit();
        await flush();
        expect(page.currentStep()).toBe('verify');
        page.goToStep('signup');
        expect(signingUp).toHaveBeenCalledTimes(1);
        expect(signingUp.mock.calls[0][0].channel).toBe('email');
        expect(signIn['warm']).toHaveBeenCalledWith(['custom-createWorkspace']);
    });

    it('does not tell the app a sign-up is under way for a code that signs a known account in', async () => {
        const signingUp = vi.fn();
        CUSTOM_SIGN_IN_PAGE.signingUp = signingUp;
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.channel.set('phone');
        page.phonePurpose.set('device');
        page.goToStep('verify');
        page.goToStep('pin');
        expect(signingUp).not.toHaveBeenCalled();
    });

    it('keeps the page working when the app\'s hook throws', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        CUSTOM_SIGN_IN_PAGE.signingUp = () => { throw new Error('app bug'); };
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.channel.set('phone');
        page.phonePurpose.set('signup');
        expect(() => page.goToStep('verify')).not.toThrow();
        expect(page.currentStep()).toBe('verify');
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});

describe('SignupComponent: a new PIN after Forgot PIN, typed twice (F40)', () => {
    const rows = () => [...fixture.nativeElement.querySelectorAll('.pin-field arc-code-input')] as HTMLElement[];
    const digits = (row: HTMLElement) => [...row.querySelectorAll('.code-box')].map((box) => (box as HTMLInputElement).value).join('');

    async function onNewPin(): Promise<void> {
        signIn['resetPin'] = vi.fn().mockResolvedValue(undefined);
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.channel.set('phone');
        page.phone.set('+919876543210');
        page.goToStep('newPin');
        fixture.detectChanges();
    }

    it('asks for the new PIN, then for it again, under labels that say so', async () => {
        await onNewPin();
        expect(rows()).toHaveLength(2);
        const labels = [...fixture.nativeElement.querySelectorAll('.pin-field .new-pin-label')].map((el) => (el as HTMLElement).textContent!.trim());
        expect(labels).toEqual([english('member.auth.your_new_pin'), english('member.auth.pin_again')]);
    });

    it('saves nothing when the two differ: says so, and empties both rows to start again', async () => {
        await onNewPin();
        typeNewPin('482913', '482931');
        await flush();
        fixture.detectChanges();
        expect(signIn['resetPin']).not.toHaveBeenCalled();
        expect(page.errorMessage()).toBe(english('member.auth.pins_mismatch'));
        expect(shown()).toContain(english('member.auth.pins_mismatch'));
        expect(rows().map(digits)).toEqual(['', '']);

        // Save with nothing typed saves nothing either.
        page.handleSubmit();
        await flush();
        expect(signIn['resetPin']).not.toHaveBeenCalled();
    });

    it('saves nothing with only the first row typed, and asks for it again', async () => {
        await onNewPin();
        typeNewPin('482913', '');
        page.handleSubmit();
        await flush();
        expect(signIn['resetPin']).not.toHaveBeenCalled();
        expect(page.errorMessage()).toBe(english('member.auth.pin_again_needed'));
    });

    it('saves the PIN and signs in once both rows match, on the last digit of the second', async () => {
        await onNewPin();
        typeNewPin('482913');
        await flush();
        expect(signIn['resetPin']).toHaveBeenCalledTimes(1);
        expect(signIn['resetPin']).toHaveBeenCalledWith('+919876543210', '482913');
    });

    it('empties both rows when the server finds the PIN too easy, so the next is typed twice too', async () => {
        await onNewPin();
        signIn['resetPin'].mockRejectedValue({
            code: 'functions/invalid-argument', message: english('member.auth.server_error.weak_pin'), details: { reason: 'weak-pin' },
        });
        typeNewPin('482913');
        await flush();
        fixture.detectChanges();
        expect(page.errorMessage()).toBe(english('member.auth.server_error.weak_pin'));
        expect(rows().map(digits)).toEqual(['', '']);
    });

    it('asks twice on Choose PIN too, and saves nothing when the two differ', async () => {
        signIn['setPin'] = vi.fn().mockResolvedValue({});
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.goToStep('choosePin');
        typeNewPin('482913', '482931');
        await flush();
        expect(signIn['setPin']).not.toHaveBeenCalled();
        expect(page.errorMessage()).toBe(english('member.auth.pins_mismatch'));

        typeNewPin('482913');
        await flush();
        expect(signIn['setPin']).toHaveBeenCalledWith('482913');
    });
});

describe('SignupComponent: "please wait" on the first step counts down (F41)', () => {
    // The check refuses a number whose last code was used under a minute ago.
    const refuseFor = (wait: number) => signIn['checkPhone'].mockRejectedValue({
        code: 'functions/resource-exhausted',
        message: english('member.auth.server_error.wait', { wait }),
        details: { reason: 'wait', wait },
    });
    const alertText = () => (fixture.nativeElement.querySelector('.alert-danger') as HTMLElement | null)?.textContent!.trim() ?? '';

    async function refusedOnContinue(wait: number): Promise<void> {
        refuseFor(wait);
        settingsRead.resolve(OPEN);
        render();
        typed('98765 43210');
        // Only the countdown's timer and clock are faked: the page's other waits run as they do.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
    }

    it('counts the seconds down with Continue greyed out, then the message goes and Continue is back at 0', async () => {
        await refusedOnContinue(3);
        expect(page.currentStep()).toBe('request');
        expect(alertText()).toBe(english('member.auth.server_error.wait', { wait: 3 }));
        expect(button().disabled).toBe(true);

        vi.advanceTimersByTime(1000);
        fixture.detectChanges();
        expect(alertText()).toBe(english('member.auth.server_error.wait', { wait: 2 }));
        expect(button().disabled).toBe(true);

        // A tap while it counts asks nothing of the server.
        page.handleSubmit();
        await flush();
        expect(signIn['checkPhone']).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1000);
        fixture.detectChanges();
        expect(alertText()).toBe(english('member.auth.server_error.wait', { wait: 1 }));

        vi.advanceTimersByTime(1000);
        fixture.detectChanges();
        expect(page.requestWait()).toBe(0);
        expect(fixture.nativeElement.querySelector('.alert-danger')).toBeNull();
        expect(button().disabled).toBe(false);

        // At 0 Continue works again.
        signIn['checkPhone'].mockResolvedValue({ phone: '+919876543210', exists: false, hasPin: false, signupOpen: true });
        page.handleSubmit();
        await flush();
        expect(signIn['checkPhone']).toHaveBeenCalledTimes(2);
        expect(page.currentStep()).toBe('verify');
    });

    it('ends the wait when another number or address is typed, since it was for the first one', async () => {
        await refusedOnContinue(40);
        expect(button().disabled).toBe(true);
        // The same number written another way is still the same number.
        typed('+91 98765-43210');
        fixture.detectChanges();
        expect(page.requestWait()).toBe(40);
        expect(button().disabled).toBe(true);
        typed('98765 43211');
        fixture.detectChanges();
        expect(page.requestWait()).toBe(0);
        expect(fixture.nativeElement.querySelector('.alert-danger')).toBeNull();
        expect(button().disabled).toBe(false);
    });

    it('keeps any other refusal as a plain error, with Continue still there', async () => {
        signIn['checkPhone'].mockRejectedValue({ code: 'functions/invalid-argument', message: 'Enter a valid mobile number.', details: { reason: 'invalid-number' } });
        settingsRead.resolve(OPEN);
        render();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.requestWait()).toBe(0);
        expect(alertText()).toBe('Enter a valid mobile number.');
        expect(button().disabled).toBe(false);
    });
});

describe('SignupComponent: the phone\'s back button steps back through sign-in (RF6, 6.4)', () => {
    /** The browser's back button: wait for its popstate, which the page hears first. */
    async function back(): Promise<void> {
        const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
        history.back();
        await popped;
        await flush();
        fixture.detectChanges();
    }
    /** Let a history.go() the page made land before the next step. */
    async function settle(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await flush();
        fixture.detectChanges();
    }

    async function atCodeStep(): Promise<void> {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
    }

    it('goes from the code step back to the number, and adds one entry per step, at the same address', async () => {
        const address = location.href;
        const first = history.state;
        await atCodeStep();
        expect(location.href).toBe(address);
        // The router's own state stays in the entry, so it skips the popstate.
        expect(history.state).toEqual(expect.objectContaining({ arcSignInStep: expect.objectContaining({ depth: 1 }) }));

        await back();
        expect(history.state).toEqual(first);
        expect(page.currentStep()).toBe('request');
        expect(page.resendCountdown()).toBe(0);
        expect(page.registrationForm.get('identifier')!.value).toBe('98765 43210');
    });

    it('skips a code once it is used: back from the details step is the number', async () => {
        signIn['verifyPhoneCode'] = vi.fn().mockResolvedValue({ verified: true });
        await atCodeStep();
        await page.verifyOtp('482913');
        fixture.detectChanges();
        expect(page.currentStep()).toBe('signup');

        await back();
        expect(page.currentStep()).toBe('request');
    });

    it('goes from the code of Forgot password back to the password step, and from there to the address', async () => {
        settingsRead.resolve(OPEN);
        signIn['checkEmail'].mockResolvedValue({ status: 'registered', signupOpen: true, signInWith: 'password' });
        signIn['requestPasswordReset'] = vi.fn().mockResolvedValue({ sent: true });
        render();
        await flush();
        typed('asha@example.com');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('login');

        await page.forgotPassword();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');

        await back();
        expect(page.currentStep()).toBe('login');
        await back();
        expect(page.currentStep()).toBe('request');
    });

    it('takes its entries off when the person changes the address, so back then leaves the page', async () => {
        const first = history.state;
        await atCodeStep();
        (fixture.nativeElement.querySelector('.change-email') as HTMLButtonElement).click();
        await settle();
        expect(page.currentStep()).toBe('request');
        // Back on the entry the page opened on.
        expect(history.state).toEqual(first);
        // Forward to the code step left behind stays on the number.
        const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
        history.forward();
        await popped;
        await settle();
        expect(page.currentStep()).toBe('request');
        expect(history.state).toEqual(first);
    });

    it('stays on a step while it is still running, and on Choose PIN with no Not now', async () => {
        await atCodeStep();
        page.isLoading.set(true);
        await back();
        expect(page.currentStep()).toBe('verify');
        page.isLoading.set(false);

        page.pinSkipAllowed.set(false);
        page.goToStep('choosePin');
        await back();
        expect(page.currentStep()).toBe('choosePin');
    });

    it('takes the steps off the history before moving on after a sign-in, so back from the next page leaves sign-in', async () => {
        signIn['signInWithPin'] = vi.fn().mockResolvedValue(undefined);
        signIn['checkPhone'].mockResolvedValue({ phone: '+919876543210', exists: true, hasPin: true, signupOpen: true });
        settingsRead.resolve(OPEN);
        render();
        await flush();
        const first = history.state;
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('pin');
        expect(history.state?.arcSignInStep?.depth).toBe(1);

        await page.signInWithPin('123456');
        currentUser.set({ uid: 'u1', id: 'r1', role: 'user', isActive: true });
        fixture.detectChanges();
        expect(navigateByUrl).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalled(), { timeout: FIRST_ENTRY_WAIT_MS + 1000 });
        expect(history.state).toEqual(first);
    });

    /** Signed in on the PIN step, one step in: the page is about to move on. */
    async function signedInOnPin(moved: Promise<boolean> = Promise.resolve(true)): Promise<void> {
        navigateByUrl.mockReturnValue(moved);
        signIn['signInWithPin'] = vi.fn().mockResolvedValue(undefined);
        signIn['checkPhone'].mockResolvedValue({ phone: '+919876543210', exists: true, hasPin: true, signupOpen: true });
        settingsRead.resolve(OPEN);
        render();
        await flush();
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        fixture.detectChanges();
        await page.signInWithPin('123456');
        currentUser.set({ uid: 'u1', id: 'r1', role: 'user', isActive: true });
        fixture.detectChanges();
    }

    it('moves on as soon as the router has skipped the popstate, without waiting for a timer', async () => {
        const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
        await signedInOnPin();
        await popped;
        await new Promise((resolve) => setTimeout(resolve));
        expect(navigateByUrl).not.toHaveBeenCalled();
        (TestBed.inject(Router).events as Subject<RouterEvent>).next(new NavigationSkipped(1, '/signup', ''));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(navigateByUrl).toHaveBeenCalled();
        expect(ROUTER_SKIP_WAIT_MS).toBeGreaterThan(100);
    });

    it('gives the step its entry back when the move is refused, so back still goes to the first step', async () => {
        await signedInOnPin(Promise.resolve(false));
        await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalled(), { timeout: FIRST_ENTRY_WAIT_MS + 1000 });
        await flush();
        expect(page.leaving()).toBe(false);
        expect(page.currentStep()).toBe('pin');
        expect(history.state?.arcSignInStep?.depth).toBe(1);
        await back();
        expect(page.currentStep()).toBe('request');
    });

    /** Count the popstates of one back press, the page's own skip included. */
    async function backPress(): Promise<void> {
        history.back();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await flush();
        fixture.detectChanges();
    }

    it('leaves sign-in with one back press after a reload on a step', async () => {
        history.pushState({ before: 'sign-in' }, '');
        const before = history.state;
        // The earlier visit: its first entry, then its code step, where the page reloaded.
        history.pushState({ navigationId: 7 }, '');
        history.pushState({ navigationId: 7, arcSignInStep: { id: 'earlier', depth: 1 } }, '');
        settingsRead.resolve(OPEN);
        render();
        await flush();
        expect(page.currentStep()).toBe('request');
        await backPress();
        expect(history.state).toEqual(before);
    });

    it('leaves sign-in with one back press from an earlier visit\'s step, its own steps skipped', async () => {
        history.pushState({ before: 'sign-in' }, '');
        const before = history.state;
        history.pushState({ navigationId: 7 }, '');
        history.pushState({ navigationId: 7, arcSignInStep: { id: 'earlier', depth: 1 } }, '');
        history.pushState({ navigationId: 7, arcSignInStep: { id: 'earlier', depth: 2 } }, '');
        settingsRead.resolve(OPEN);
        render();
        await flush();
        // A step of this visit first: back from it is this visit's first step, then out.
        typed('98765 43210');
        page.handleSubmit();
        await flush();
        expect(page.currentStep()).toBe('verify');
        await back();
        expect(page.currentStep()).toBe('request');
        await backPress();
        expect(history.state).toEqual(before);
    });
});

describe('SignupComponent: sign-in for screen readers and the keyboard (RF6, 6.5)', () => {
    const all = (selector: string) => [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];

    async function on(step: string, setup: () => void = () => undefined): Promise<void> {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        typed('asha@example.com');
        setup();
        page.goToStep(step as never);
        fixture.detectChanges();
    }

    it('has one h1 on every step, the step\'s title', async () => {
        for (const step of ['request', 'login', 'pin', 'verify', 'signup', 'newPin', 'newPassword', 'choosePin', 'disabled']) {
            await on(step);
            const h1 = all('h1');
            expect(h1.length, step).toBe(1);
            // The site's name above it is not a heading.
            expect(all('h2, h3, h4, h5, h6').length, step).toBe(0);
            expect(h1[0].textContent!.trim(), step).not.toBe('');
            fixture.destroy();
        }
    });

    it('makes every action a real button, never a link with no address', async () => {
        for (const step of ['login', 'pin', 'verify', 'signup', 'choosePin', 'disabled']) {
            await on(step);
            expect(all('form a:not([href])').length, step).toBe(0);
            for (const action of all('.change-email, .forgot-password, .auth-link button, button.auth-link')) {
                expect(action.tagName, step).toBe('BUTTON');
                expect(action.getAttribute('type'), step).toBe('button');
            }
            fixture.destroy();
        }
    });

    it('names the show-password buttons and says whether the password is shown', async () => {
        await on('login');
        const eye = all('button[aria-pressed]')[0] as HTMLButtonElement;
        expect(eye.getAttribute('aria-label')).toBe(english('member.auth.show_password'));
        expect(eye.getAttribute('aria-pressed')).toBe('false');
        eye.click();
        fixture.detectChanges();
        expect(eye.getAttribute('aria-pressed')).toBe('true');
        expect(eye.getAttribute('aria-label')).toBe(english('member.auth.show_password'));
        fixture.destroy();

        for (const step of ['signup', 'newPassword']) {
            await on(step, () => page.emailPin.set(false));
            const eyes = all('button[aria-pressed]');
            expect(eyes.length, step).toBe(2);
            for (const button of eyes) expect(button.getAttribute('aria-label'), step).toBe(english('member.auth.show_password'));
            fixture.destroy();
        }
    });

    it('links a label to the name and to the password typed again', async () => {
        await on('signup', () => page.emailPin.set(false));
        for (const id of ['name', 'password', 'confirmPassword']) {
            const label = fixture.nativeElement.querySelector(`label[for=${id}]`) as HTMLLabelElement | null;
            expect(label?.textContent!.trim(), id).toBeTruthy();
            expect(fixture.nativeElement.querySelector(`#${id}`), id).not.toBeNull();
        }
        expect((fixture.nativeElement.querySelector('label[for=name]') as HTMLElement).textContent!.trim()).toBe(english('member.auth.name_label'));
    });

    it('reads every error out as it appears, tied to its field', async () => {
        await on('signup', () => page.emailPin.set(false));
        page.registrationForm.get('password')!.setValue('a');
        page.registrationForm.get('confirmPassword')!.setValue('b');
        page.register();
        page.errorMessage.set('Something went wrong.');
        fixture.detectChanges();
        const errors = all('.text-danger, .alert-danger, .invalid-feedback');
        expect(errors.length).toBeGreaterThanOrEqual(4);
        for (const error of errors) expect(error.getAttribute('role'), error.textContent!).toBe('alert');
        const name = fixture.nativeElement.querySelector('#name') as HTMLInputElement;
        expect(name.getAttribute('aria-invalid')).toBe('true');
        expect(fixture.nativeElement.querySelector(`#${name.getAttribute('aria-describedby')}`)).not.toBeNull();
        fixture.destroy();

        await on('verify');
        page.otpError.set('That code didn\'t work.');
        fixture.detectChanges();
        expect(all('[role=alert]').map((el) => el.textContent!.trim())).toContain('That code didn\'t work.');
    });

    it('does not read the first step\'s "please wait" as an alert every second', async () => {
        await on('request');
        page.requestWait.set(30);
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.alert-danger') as HTMLElement).getAttribute('role')).toBeNull();
        page.errorMessage.set('Enter a valid mobile number.');
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('.alert-danger') as HTMLElement).getAttribute('role')).toBe('alert');
    });
});

describe('SignupComponent: no connection on a code or PIN step (RF6, 6.7)', () => {
    const offline = english('member.errors.network_request_failed');
    afterEach(() => vi.restoreAllMocks());
    /** What the Functions SDK throws when its fetch fails: `internal`, with no details. */
    const noNetwork = () => Object.assign(new Error('internal'), { code: 'functions/internal' });

    async function atStep(step: 'pin' | 'verify'): Promise<void> {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        page.channel.set('phone');
        page.phone.set('+919876543210');
        page.currentStep.set(step);
        fixture.detectChanges();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    }

    it('says "No internet connection" for a PIN, not a server error', async () => {
        signIn['signInWithPin'] = vi.fn().mockRejectedValue(noNetwork());
        await atStep('pin');
        await page.signInWithPin('123456');
        fixture.detectChanges();
        expect(page.errorMessage()).toBe(offline);
        expect(shown()).toContain(offline);
    });

    it('says so for a code, and for asking for another', async () => {
        signIn['verifyPhoneCode'] = vi.fn().mockRejectedValue(noNetwork());
        signIn['requestPhoneCode'] = vi.fn().mockRejectedValue(noNetwork());
        await atStep('verify');
        await page.verifyOtp('482913');
        expect(page.otpError()).toBe(offline);
        await page.sendOtp(true);
        expect(page.otpError()).toBe(offline);
    });

    it('says so on the first step, rather than blaming the email', async () => {
        signIn['checkEmail'].mockRejectedValue(noNetwork());
        settingsRead.resolve(OPEN);
        render();
        await flush();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        typed('asha@example.com');
        page.handleSubmit();
        await flush();
        expect(page.errorMessage()).toBe(offline);
    });
});

describe('SignupComponent: the resend countdown by the clock (RF6, 6.11)', () => {
    it('is right after the page was in the background, whose timers the browser slowed', async () => {
        settingsRead.resolve(OPEN);
        render();
        await flush();
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        page.startCountdown(60);
        expect(page.resendCountdown()).toBe(60);
        vi.advanceTimersByTime(1000);
        expect(page.resendCountdown()).toBe(59);

        // 45 seconds in the SMS app, with no timer run in the meantime.
        vi.setSystemTime(Date.now() + 45_000);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(page.resendCountdown()).toBe(14);
        vi.advanceTimersByTime(1000);
        expect(page.resendCountdown()).toBe(13);

        // Away past the end: Resend is back at once.
        vi.setSystemTime(Date.now() + 60_000);
        vi.advanceTimersByTime(1000);
        expect(page.resendCountdown()).toBe(0);
    });
});
