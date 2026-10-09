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
import { of, Subject } from 'rxjs';
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
/** The auth listener's record: a user, or null for nobody (or no record). */
let record: Subject<unknown>;
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
    record = new Subject<unknown>();
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
                initAuthStateListener: () => record,
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
    // The page's own children (language picker, brand panel, country chip, code boxes)
    // are not under test here.
    TestBed.overrideComponent(SignupComponent, {
        set: { imports: [ReactiveFormsModule, CommonModule, RouterModule, TranslocoPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
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
        record.next(signedInMember);
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
        record.next(null);
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
        record.next(null);
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
