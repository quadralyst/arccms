/**
 * The sign-in page and its settings (Settings/users): Continue tapped before they
 * arrive waits for them, then goes on; settings that never arrive are said to be
 * a connection problem, not a wrong email; a later visit starts from this
 * browser's copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, RouterModule } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { of } from 'rxjs';

const { mockCallableFn } = vi.hoisted(() => ({ mockCallableFn: vi.fn() }));
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn(() => mockCallableFn),
}));

import SignupComponent, { SETTINGS_WAIT_MS } from './signup.page';
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

describe('SignupComponent: the sign-in settings (F20)', () => {
    let fixture: ComponentFixture<SignupComponent>;
    let page: SignupComponent;
    let settingsRead: ReturnType<typeof later<IUserSettings>>;
    let signIn: Record<string, ReturnType<typeof vi.fn>>;

    function render(): void {
        fixture = TestBed.createComponent(SignupComponent);
        page = fixture.componentInstance;
        fixture.detectChanges();
    }

    const button = () => fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement;
    const typed = (value: string) => page.registrationForm.get('identifier')!.setValue(value);
    const shown = () => fixture.nativeElement.textContent as string;

    beforeEach(async () => {
        localStorage.removeItem(SIGN_IN_SETTINGS_CACHE_KEY);
        settingsRead = later<IUserSettings>();
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
                    error: signal(''), errorCode: signal(''), currentUser: signal(null), isAdmin: signal(false),
                    initAuthStateListener: () => of(null),
                } },
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
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.removeItem(SIGN_IN_SETTINGS_CACHE_KEY);
    });

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
