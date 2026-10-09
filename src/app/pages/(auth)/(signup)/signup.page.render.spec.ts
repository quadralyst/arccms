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

import SignupComponent, { SETTINGS_WAIT_MS, SIGNED_IN_WAIT_MS } from './signup.page';
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
    // under test here; the code boxes are real, since a later step needs their bindings.
    TestBed.overrideComponent(SignupComponent, {
        set: { imports: [ReactiveFormsModule, CommonModule, RouterModule, TranslocoPipe, CodeInputComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
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
        expect(signIn['checkEmail']).toHaveBeenCalledWith('new@person.com');
        expect(page.currentStep()).toBe('verify');
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
        expect(signIn['checkPhone']).toHaveBeenCalledWith('+919876543210');
        expect(page.currentStep()).toBe('verify');
        expect(page.channel()).toBe('phone');
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
        page.newPin.set('135792');
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
        expect(navigateByUrl).toHaveBeenCalled();
        expect(button().disabled).toBe(true);
        expect(signIn['completePhoneSignup']).toHaveBeenCalledTimes(1);
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
        page.newPin.set('135792');
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
        await page.saveNewPassword();
        fixture.detectChanges();
        expect(shown()).toContain(english('member.auth.password_error.sequence'));
        expect(signIn['resetPassword']).not.toHaveBeenCalled();

        page.registrationForm.get('password')!.setValue('river-lamp-2024');
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
        await page.saveNewPassword();
        fixture.detectChanges();
        expect(page.currentStep()).toBe('verify');
        expect(shown()).toContain('That code has expired. Please ask for a new one.');
        expect(login).not.toHaveBeenCalled();
    });
});
