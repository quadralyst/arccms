/**
 * Tests for OnboardingComponent
 *
 * Covers:
 * - Component definition and structure
 * - Form initialization and validation
 * - Step navigation (step 1 → step 2, go back)
 * - Email / password match validators
 * - register() guard logic
 * - ngOnInit redirect behaviour (first-run vs not)
 * - Step 3: saveSiteInfo validation & error handling
 * - Step 4: provider selection, test connection flow, skipEmail error handling
 * - Step 5: completeSetup success, failure, retry, and skip-to-dashboard
 */

import { signal } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';
import OnboardingComponent from './onboarding.page';

describe('OnboardingComponent', () => {
    describe('Component Definition', () => {
        it('should be defined', () => {
            expect(OnboardingComponent).toBeDefined();
        });

        it('should be a class', () => {
            expect(typeof OnboardingComponent).toBe('function');
        });

        it('should be the default export', () => {
            expect(OnboardingComponent.name).toContain('OnboardingComponent');
        });
    });

    describe('Public Method Existence', () => {
        const publicMethods = [
            'ngOnInit',
            'isFieldInvalid',
            'hasPasswordMismatch',
            'hasEmailMismatch',
            'goToStep2',
            'goBack',
            'register',
            'saveSiteInfo',
            'selectProvider',
            'isProviderConfigValid',
            'testConnection',
            'saveEmailAndContinue',
            'skipEmail',
            'completeSetup',
            'skipSetupAndGo',
        ];

        publicMethods.forEach((method) => {
            it(`should expose ${method}`, () => {
                expect(typeof (OnboardingComponent.prototype as any)[method]).toBe('function');
            });
        });
    });

    // ─── Validator unit tests ───────────────────────────────────────────────

    describe('passwordMatchValidator', () => {
        const validator = (OnboardingComponent.prototype as any).passwordMatchValidator;

        it('returns null when passwords match', () => {
            const group = {
                get: (key: string) => ({ value: key === 'password' ? 'secret123' : 'secret123' }),
            };
            expect(validator(group as any)).toBeNull();
        });

        it('returns { passwordMismatch: true } when passwords differ', () => {
            const group = {
                get: (key: string) => ({ value: key === 'password' ? 'secret123' : 'different' }),
            };
            expect(validator(group as any)).toEqual({ passwordMismatch: true });
        });
    });

    describe('emailMatchValidator', () => {
        const validator = (OnboardingComponent.prototype as any).emailMatchValidator;

        it('returns null when emails match (case-insensitive)', () => {
            const group = {
                get: (key: string) => ({
                    value: key === 'email' ? 'User@Example.com' : 'user@example.com',
                }),
            };
            expect(validator(group as any)).toBeNull();
        });

        it('returns { emailMismatch: true } when emails differ', () => {
            const group = {
                get: (key: string) => ({
                    value: key === 'email' ? 'a@b.com' : 'x@y.com',
                }),
            };
            expect(validator(group as any)).toEqual({ emailMismatch: true });
        });
    });

    // ─── isFieldInvalid ─────────────────────────────────────────────────────

    describe('isFieldInvalid', () => {
        function makeComponent(fieldState: { invalid: boolean; touched: boolean }) {
            const fb = new FormBuilder();
            const form = fb.group({ name: [''] });
            const ctrl = form.get('name')!;
            Object.defineProperty(ctrl, 'invalid', { get: () => fieldState.invalid });
            Object.defineProperty(ctrl, 'touched', { get: () => fieldState.touched });

            const ctx = {
                onboardingForm: { get: () => ctrl },
            };
            return ctx;
        }

        it('returns true when control is invalid AND touched', () => {
            const ctx = makeComponent({ invalid: true, touched: true });
            expect(OnboardingComponent.prototype.isFieldInvalid.call(ctx, 'name')).toBe(true);
        });

        it('returns false when control is invalid but NOT touched', () => {
            const ctx = makeComponent({ invalid: true, touched: false });
            expect(OnboardingComponent.prototype.isFieldInvalid.call(ctx, 'name')).toBe(false);
        });

        it('returns false when control is valid and touched', () => {
            const ctx = makeComponent({ invalid: false, touched: true });
            expect(OnboardingComponent.prototype.isFieldInvalid.call(ctx, 'name')).toBe(false);
        });

        it('returns false when control does not exist', () => {
            const ctx = { onboardingForm: { get: () => null } };
            expect(OnboardingComponent.prototype.isFieldInvalid.call(ctx, 'missing')).toBe(false);
        });
    });

    // ─── hasPasswordMismatch ─────────────────────────────────────────────────

    describe('hasPasswordMismatch', () => {
        it('returns true when form has passwordMismatch error and confirmPassword is touched', () => {
            const ctx = {
                onboardingForm: {
                    errors: { passwordMismatch: true },
                    get: () => ({ touched: true }),
                },
            };
            expect(OnboardingComponent.prototype.hasPasswordMismatch.call(ctx)).toBe(true);
        });

        it('returns false when confirmPassword is not touched', () => {
            const ctx = {
                onboardingForm: {
                    errors: { passwordMismatch: true },
                    get: () => ({ touched: false }),
                },
            };
            expect(OnboardingComponent.prototype.hasPasswordMismatch.call(ctx)).toBe(false);
        });

        it('returns false when form has no errors', () => {
            const ctx = {
                onboardingForm: {
                    errors: null,
                    get: () => ({ touched: true }),
                },
            };
            expect(OnboardingComponent.prototype.hasPasswordMismatch.call(ctx)).toBe(false);
        });
    });

    // ─── hasEmailMismatch ────────────────────────────────────────────────────

    describe('hasEmailMismatch', () => {
        it('returns true when form has emailMismatch error and confirmEmail is touched', () => {
            const ctx = {
                onboardingForm: {
                    errors: { emailMismatch: true },
                    get: () => ({ touched: true }),
                },
            };
            expect(OnboardingComponent.prototype.hasEmailMismatch.call(ctx)).toBe(true);
        });

        it('returns false when confirmEmail is not touched', () => {
            const ctx = {
                onboardingForm: {
                    errors: { emailMismatch: true },
                    get: () => ({ touched: false }),
                },
            };
            expect(OnboardingComponent.prototype.hasEmailMismatch.call(ctx)).toBe(false);
        });
    });

    // ─── goToStep2 ───────────────────────────────────────────────────────────

    describe('goToStep2', () => {
        function makeCtx(step1Valid: boolean, hasEmailMismatch: boolean) {
            const touchedFields: string[] = [];
            const ctx = {
                onboardingForm: {
                    get: (field: string) => ({
                        markAsTouched: () => touchedFields.push(field),
                        valid: step1Valid,
                    }),
                },
                hasEmailMismatch: vi.fn().mockReturnValue(hasEmailMismatch),
                currentStep: signal<1 | 2>(1),
            };
            return { ctx, touchedFields };
        }

        it('does NOT advance when step 1 fields are invalid', () => {
            const { ctx } = makeCtx(false, false);
            OnboardingComponent.prototype.goToStep2.call(ctx);
            expect(ctx.currentStep()).toBe(1);
        });

        it('does NOT advance when emails mismatch', () => {
            const { ctx } = makeCtx(true, true);
            OnboardingComponent.prototype.goToStep2.call(ctx);
            expect(ctx.currentStep()).toBe(1);
        });

        it('advances to step 2 when step 1 is valid and emails match', () => {
            const { ctx } = makeCtx(true, false);
            OnboardingComponent.prototype.goToStep2.call(ctx);
            expect(ctx.currentStep()).toBe(2);
        });

        it('marks all step 1 fields as touched', () => {
            const { ctx, touchedFields } = makeCtx(false, false);
            OnboardingComponent.prototype.goToStep2.call(ctx);
            expect(touchedFields).toContain('name');
            expect(touchedFields).toContain('email');
            expect(touchedFields).toContain('confirmEmail');
        });
    });

    // ─── goBack ──────────────────────────────────────────────────────────────

    describe('goBack', () => {
        it('resets to step 1, clears error, and resets password fields', () => {
            const passwordReset = vi.fn();
            const confirmPasswordReset = vi.fn();
            const ctx = {
                errorMessage: signal('some error'),
                currentStep: signal<1 | 2>(2),
                onboardingForm: {
                    get: (field: string) => ({
                        reset: field === 'password' ? passwordReset : confirmPasswordReset,
                    }),
                },
            };
            OnboardingComponent.prototype.goBack.call(ctx);
            expect(ctx.currentStep()).toBe(1);
            expect(ctx.errorMessage()).toBe('');
            expect(passwordReset).toHaveBeenCalled();
            expect(confirmPasswordReset).toHaveBeenCalled();
        });
    });

    // ─── register guard logic ─────────────────────────────────────────────────

    describe('register', () => {
        it('does NOT call authStore.signup when form is invalid', () => {
            const signup = vi.fn();
            const ctx = {
                onboardingForm: {
                    invalid: true,
                    get: (f: string) => ({ markAsTouched: vi.fn(), value: '' }),
                    errors: null,
                },
                hasPasswordMismatch: vi.fn().mockReturnValue(false),
                hasEmailMismatch: vi.fn().mockReturnValue(false),
                errorMessage: signal(''),
                isSubmitted: signal(false),
                authStore: { clearList: vi.fn(), signup },
                constantVariables: { ADMIN: 'admin' },
            };
            OnboardingComponent.prototype.register.call(ctx);
            expect(signup).not.toHaveBeenCalled();
        });

        it('does NOT call authStore.signup when passwords mismatch', () => {
            const signup = vi.fn();
            const ctx = {
                onboardingForm: {
                    invalid: false,
                    get: (f: string) => ({ markAsTouched: vi.fn(), value: 'test' }),
                    errors: { passwordMismatch: true },
                },
                hasPasswordMismatch: vi.fn().mockReturnValue(true),
                hasEmailMismatch: vi.fn().mockReturnValue(false),
                errorMessage: signal(''),
                isSubmitted: signal(false),
                authStore: { clearList: vi.fn(), signup },
                constantVariables: { ADMIN: 'admin' },
            };
            OnboardingComponent.prototype.register.call(ctx);
            expect(signup).not.toHaveBeenCalled();
        });

        it('calls authStore.signup with role=admin when form is valid', () => {
            const signup = vi.fn();
            const formValues: Record<string, string> = {
                name: 'Alice Admin',
                email: 'alice@example.com',
                password: 'secret123',
            };
            const ctx = {
                onboardingForm: {
                    invalid: false,
                    get: (f: string) => ({ markAsTouched: vi.fn(), value: formValues[f] ?? '' }),
                    errors: null,
                },
                hasPasswordMismatch: vi.fn().mockReturnValue(false),
                hasEmailMismatch: vi.fn().mockReturnValue(false),
                errorMessage: signal(''),
                isSubmitted: signal(false),
                authStore: { clearList: vi.fn(), signup },
                constantVariables: { ADMIN: 'admin' },
            };
            OnboardingComponent.prototype.register.call(ctx);
            expect(signup).toHaveBeenCalledWith(
                expect.objectContaining({ role: 'admin', isActive: true, emailVerified: true })
            );
        });
    });

    // ─── ngOnInit redirects ──────────────────────────────────────────────────

    describe('ngOnInit', () => {
        it('navigates to "/" when NOT first run AND onboarding is complete', () => {
            const navigate = vi.fn();
            const ctx = {
                authService: { isFirstRun: vi.fn().mockReturnValue(of(false)) },
                setupService: { isOnboardingComplete: vi.fn().mockReturnValue(of(true)) },
                router: { navigate },
                signupHandled: false,
                currentStep: signal<number>(1),
            };
            OnboardingComponent.prototype.ngOnInit.call(ctx);
            expect(navigate).toHaveBeenCalledWith(['/']);
        });

        it('sets step to 3 when NOT first run AND onboarding is NOT complete (re-entry)', () => {
            const navigate = vi.fn();
            const ctx = {
                authService: { isFirstRun: vi.fn().mockReturnValue(of(false)) },
                setupService: { isOnboardingComplete: vi.fn().mockReturnValue(of(false)) },
                router: { navigate },
                signupHandled: false,
                currentStep: signal<number>(1),
            };
            OnboardingComponent.prototype.ngOnInit.call(ctx);
            expect(navigate).not.toHaveBeenCalled();
            expect(ctx.currentStep()).toBe(3);
            expect(ctx.signupHandled).toBe(true);
        });

        it('does NOT navigate when it IS first run', () => {
            const navigate = vi.fn();
            const ctx = {
                authService: { isFirstRun: vi.fn().mockReturnValue(of(true)) },
                router: { navigate },
            };
            OnboardingComponent.prototype.ngOnInit.call(ctx);
            expect(navigate).not.toHaveBeenCalled();
        });
    });

    // ─── Step 3: saveSiteInfo ──────────────────────────────────────────────

    describe('saveSiteInfo', () => {
        it('does NOT save when siteInfoForm is invalid', async () => {
            const saveSiteInfo = vi.fn();
            const ctx = {
                siteInfoForm: {
                    invalid: true,
                    controls: { siteName: {}, siteUrl: {} },
                    get: () => ({ markAsTouched: vi.fn() }),
                    value: {},
                },
                isSavingSiteInfo: signal(false),
                errorMessage: signal(''),
                setupService: { saveSiteInfo, saveDefaultSettings: vi.fn() },
                currentStep: signal<number>(3),
            };
            await OnboardingComponent.prototype.saveSiteInfo.call(ctx);
            expect(saveSiteInfo).not.toHaveBeenCalled();
        });

        it('saves site info and advances to step 4 when valid', async () => {
            const mockSaveSiteInfo = vi.fn().mockResolvedValue(undefined);
            const mockSaveDefaults = vi.fn().mockResolvedValue(undefined);
            const ctx = {
                siteInfoForm: {
                    invalid: false,
                    controls: {},
                    get: () => ({ markAsTouched: vi.fn() }),
                    value: { siteName: 'Test Site', siteUrl: 'https://test.com' },
                },
                isSavingSiteInfo: signal(false),
                errorMessage: signal(''),
                setupService: { saveSiteInfo: mockSaveSiteInfo, saveDefaultSettings: mockSaveDefaults },
                currentStep: signal<number>(3),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.saveSiteInfo.call(ctx);
            expect(mockSaveSiteInfo).toHaveBeenCalledWith('Test Site', 'https://test.com');
            expect(mockSaveDefaults).toHaveBeenCalled();
            expect(ctx.currentStep()).toBe(4);
        });

        it('clears errorMessage when advancing to step 4', async () => {
            const ctx = {
                siteInfoForm: {
                    invalid: false,
                    controls: {},
                    get: () => ({ markAsTouched: vi.fn() }),
                    value: { siteName: 'Test Site', siteUrl: 'https://test.com' },
                },
                isSavingSiteInfo: signal(false),
                errorMessage: signal('old error'),
                setupService: {
                    saveSiteInfo: vi.fn().mockResolvedValue(undefined),
                    saveDefaultSettings: vi.fn().mockResolvedValue(undefined),
                },
                currentStep: signal<number>(3),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.saveSiteInfo.call(ctx);
            expect(ctx.errorMessage()).toBe('');
        });

        it('stays on step 3 and shows error when saveSiteInfo fails', async () => {
            const ctx = {
                siteInfoForm: {
                    invalid: false,
                    controls: {},
                    get: () => ({ markAsTouched: vi.fn() }),
                    value: { siteName: 'Test Site', siteUrl: 'https://test.com' },
                },
                isSavingSiteInfo: signal(false),
                errorMessage: signal(''),
                setupService: {
                    saveSiteInfo: vi.fn().mockRejectedValue(new Error('Firestore write failed')),
                    saveDefaultSettings: vi.fn().mockResolvedValue(undefined),
                },
                currentStep: signal<number>(3),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.saveSiteInfo.call(ctx);
            expect(ctx.currentStep()).toBe(3);
            expect(ctx.errorMessage()).toContain('Failed to save site information');
            expect(ctx.toastService.error).toHaveBeenCalled();
        });

        it('stays on step 3 and shows error when saveDefaultSettings fails', async () => {
            const ctx = {
                siteInfoForm: {
                    invalid: false,
                    controls: {},
                    get: () => ({ markAsTouched: vi.fn() }),
                    value: { siteName: 'Test Site', siteUrl: 'https://test.com' },
                },
                isSavingSiteInfo: signal(false),
                errorMessage: signal(''),
                setupService: {
                    saveSiteInfo: vi.fn().mockResolvedValue(undefined),
                    saveDefaultSettings: vi.fn().mockRejectedValue(new Error('Firestore write failed')),
                },
                currentStep: signal<number>(3),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.saveSiteInfo.call(ctx);
            expect(ctx.currentStep()).toBe(3);
            expect(ctx.errorMessage()).toContain('Failed to save site information');
        });

        it('resets isSavingSiteInfo after error', async () => {
            const ctx = {
                siteInfoForm: {
                    invalid: false,
                    controls: {},
                    get: () => ({ markAsTouched: vi.fn() }),
                    value: { siteName: 'Test', siteUrl: 'https://t.com' },
                },
                isSavingSiteInfo: signal(false),
                errorMessage: signal(''),
                setupService: {
                    saveSiteInfo: vi.fn().mockRejectedValue(new Error('fail')),
                    saveDefaultSettings: vi.fn(),
                },
                currentStep: signal<number>(3),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.saveSiteInfo.call(ctx);
            expect(ctx.isSavingSiteInfo()).toBe(false);
        });
    });

    // ─── Step 4: selectProvider ────────────────────────────────────────────

    describe('selectProvider', () => {
        it('updates selectedProvider and resets testPassed', () => {
            const ctx = {
                selectedProvider: signal<string>('gmail'),
                testPassed: signal(true),
                gmailSenderLocked: signal(true),
                emailForm: {
                    get: () => ({ value: '' }),
                    patchValue: () => {},
                },
            };
            const fakeEvent = { target: { value: 'smtp' } } as unknown as Event;
            OnboardingComponent.prototype.selectProvider.call(ctx, fakeEvent);
            expect(ctx.selectedProvider()).toBe('smtp');
            expect(ctx.testPassed()).toBe(false);
            expect(ctx.gmailSenderLocked()).toBe(false);
        });
    });

    // ─── Step 4: isProviderConfigValid ─────────────────────────────────────

    describe('isProviderConfigValid', () => {
        it('returns true for gmail when user and password are filled', () => {
            const ctx = {
                selectedProvider: signal('gmail'),
                emailForm: {
                    get: (key: string) => {
                        if (key === 'gmail') {
                            return {
                                get: (field: string) => ({
                                    value: field === 'user' ? 'a@b.com' : 'pass',
                                }),
                            };
                        }
                        return null;
                    },
                },
            };
            expect(OnboardingComponent.prototype.isProviderConfigValid.call(ctx)).toBe(true);
        });

        it('returns false for gmail when password is empty', () => {
            const ctx = {
                selectedProvider: signal('gmail'),
                emailForm: {
                    get: (key: string) => {
                        if (key === 'gmail') {
                            return {
                                get: (field: string) => ({
                                    value: field === 'user' ? 'a@b.com' : '',
                                }),
                            };
                        }
                        return null;
                    },
                },
            };
            expect(OnboardingComponent.prototype.isProviderConfigValid.call(ctx)).toBe(false);
        });

        it('returns true for smtp when host, user, and password are filled', () => {
            const ctx = {
                selectedProvider: signal('smtp'),
                emailForm: {
                    get: (key: string) => {
                        if (key === 'smtp') {
                            return {
                                get: (field: string) => {
                                    const vals: Record<string, string> = { host: 'smtp.test.com', user: 'u', password: 'p' };
                                    return { value: vals[field] ?? '' };
                                },
                            };
                        }
                        return null;
                    },
                },
            };
            expect(OnboardingComponent.prototype.isProviderConfigValid.call(ctx)).toBe(true);
        });

        it('returns false for smtp when host is missing', () => {
            const ctx = {
                selectedProvider: signal('smtp'),
                emailForm: {
                    get: (key: string) => {
                        if (key === 'smtp') {
                            return {
                                get: (field: string) => {
                                    const vals: Record<string, string> = { host: '', user: 'u', password: 'p' };
                                    return { value: vals[field] ?? '' };
                                },
                            };
                        }
                        return null;
                    },
                },
            };
            expect(OnboardingComponent.prototype.isProviderConfigValid.call(ctx)).toBe(false);
        });

        it('returns true for resend when apiKey is filled', () => {
            const ctx = {
                selectedProvider: signal('resend'),
                emailForm: {
                    get: (key: string) => {
                        if (key === 'resend') {
                            return { get: (field: string) => ({ value: 're_123' }) };
                        }
                        return null;
                    },
                },
            };
            expect(OnboardingComponent.prototype.isProviderConfigValid.call(ctx)).toBe(true);
        });

        it('returns false when provider group does not exist', () => {
            const ctx = {
                selectedProvider: signal('unknown'),
                emailForm: { get: () => null },
            };
            expect(OnboardingComponent.prototype.isProviderConfigValid.call(ctx)).toBe(false);
        });
    });

    // ─── Step 4: saveEmailAndContinue ───────────────────────────────────────

    describe('saveEmailAndContinue', () => {
        // buildEmailSettings is a private method called by saveEmailAndContinue.
        // We bind it to the test context so prototype.call() can find it.
        const buildEmailSettings = (OnboardingComponent.prototype as any).buildEmailSettings;

        function makeEmailCtx(overrides: Record<string, any> = {}) {
            const ctx: Record<string, any> = {
                testPassed: signal(true),
                isSavingEmail: signal(false),
                errorMessage: signal(''),
                setupService: { saveEmailConfig: vi.fn().mockResolvedValue(undefined) },
                currentStep: signal<number>(4),
                selectedProvider: signal('gmail'),
                emailForm: {
                    value: {
                        senderEmail: 'test@gmail.com',
                        senderName: 'Test',
                        replyToEmail: '',
                        smtp: {},
                        gmail: { user: 'test@gmail.com', password: 'pass' },
                        resend: {},
                    },
                },
                siteInfoForm: { get: () => ({ value: 'My Site' }) },
                toastService: { error: vi.fn() },
                ...overrides,
            };
            // Attach the private method so this.buildEmailSettings() works
            ctx.buildEmailSettings = buildEmailSettings.bind(ctx);
            return ctx;
        }

        it('does NOT save when testPassed is false', async () => {
            const mockSaveConfig = vi.fn();
            const ctx = makeEmailCtx({
                testPassed: signal(false),
                setupService: { saveEmailConfig: mockSaveConfig },
            });
            await OnboardingComponent.prototype.saveEmailAndContinue.call(ctx);
            expect(mockSaveConfig).not.toHaveBeenCalled();
            expect(ctx.currentStep()).toBe(4);
            expect(ctx.toastService.error).toHaveBeenCalledWith('Please test the connection first');
        });

        it('saves email settings and advances to step 5 on success', async () => {
            const mockSaveConfig = vi.fn().mockResolvedValue(undefined);
            const ctx = makeEmailCtx({ setupService: { saveEmailConfig: mockSaveConfig } });
            await OnboardingComponent.prototype.saveEmailAndContinue.call(ctx);
            expect(mockSaveConfig).toHaveBeenCalled();
            expect(ctx.currentStep()).toBe(5);
            expect(ctx.errorMessage()).toBe('');
        });

        it('stays on step 4 and shows error when save fails', async () => {
            const mockSaveConfig = vi.fn().mockRejectedValue(new Error('write failed'));
            const ctx = makeEmailCtx({ setupService: { saveEmailConfig: mockSaveConfig } });
            await OnboardingComponent.prototype.saveEmailAndContinue.call(ctx);
            expect(ctx.currentStep()).toBe(4);
            expect(ctx.errorMessage()).toContain('Failed to save email settings');
            expect(ctx.toastService.error).toHaveBeenCalled();
        });

        it('resets isSavingEmail after completion', async () => {
            const ctx = makeEmailCtx();
            await OnboardingComponent.prototype.saveEmailAndContinue.call(ctx);
            expect(ctx.isSavingEmail()).toBe(false);
        });
    });

    // ─── Step 4: skipEmail ─────────────────────────────────────────────────

    describe('skipEmail', () => {
        it('saves email as skipped and advances to step 5', async () => {
            const mockSkip = vi.fn().mockResolvedValue(undefined);
            const ctx = {
                isSavingEmail: signal(false),
                errorMessage: signal(''),
                setupService: { saveEmailSkipped: mockSkip },
                currentStep: signal<number>(4),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.skipEmail.call(ctx);
            expect(mockSkip).toHaveBeenCalled();
            expect(ctx.currentStep()).toBe(5);
            expect(ctx.errorMessage()).toBe('');
        });

        it('stays on step 4 and shows error when skip save fails', async () => {
            const mockSkip = vi.fn().mockRejectedValue(new Error('Firestore error'));
            const ctx = {
                isSavingEmail: signal(false),
                errorMessage: signal(''),
                setupService: { saveEmailSkipped: mockSkip },
                currentStep: signal<number>(4),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.skipEmail.call(ctx);
            expect(ctx.currentStep()).toBe(4);
            expect(ctx.errorMessage()).toContain('Failed to save settings');
            expect(ctx.toastService.error).toHaveBeenCalled();
        });

        it('resets isSavingEmail after error', async () => {
            const ctx = {
                isSavingEmail: signal(false),
                errorMessage: signal(''),
                setupService: { saveEmailSkipped: vi.fn().mockRejectedValue(new Error('fail')) },
                currentStep: signal<number>(4),
                toastService: { error: vi.fn() },
            };
            await OnboardingComponent.prototype.skipEmail.call(ctx);
            expect(ctx.isSavingEmail()).toBe(false);
        });
    });

    // ─── Step 5: completeSetup ─────────────────────────────────────────────

    describe('completeSetup', () => {
        it('calls setupService.completeSetup and navigates to dashboard on success', async () => {
            const mockComplete = vi.fn().mockResolvedValue(undefined);
            const navigate = vi.fn();
            const ctx = {
                isCompleting: signal(false),
                errorMessage: signal(''),
                setupFailed: signal(false),
                setupService: { completeSetup: mockComplete },
                toastService: { success: vi.fn(), error: vi.fn() },
                router: { navigate },
            };
            await OnboardingComponent.prototype.completeSetup.call(ctx);
            expect(mockComplete).toHaveBeenCalled();
            expect(navigate).toHaveBeenCalledWith(['/admin/dashboard'], { replaceUrl: true });
            expect(ctx.setupFailed()).toBe(false);
        });

        it('does NOT navigate to dashboard when setup fails', async () => {
            const mockComplete = vi.fn().mockRejectedValue(new Error('Firestore error'));
            const navigate = vi.fn();
            const ctx = {
                isCompleting: signal(false),
                errorMessage: signal(''),
                setupFailed: signal(false),
                setupService: { completeSetup: mockComplete },
                toastService: { success: vi.fn(), error: vi.fn() },
                router: { navigate },
            };
            await OnboardingComponent.prototype.completeSetup.call(ctx);
            expect(navigate).not.toHaveBeenCalled();
        });

        it('sets setupFailed to true when setup fails', async () => {
            const ctx = {
                isCompleting: signal(false),
                errorMessage: signal(''),
                setupFailed: signal(false),
                setupService: { completeSetup: vi.fn().mockRejectedValue(new Error('fail')) },
                toastService: { success: vi.fn(), error: vi.fn() },
                router: { navigate: vi.fn() },
            };
            await OnboardingComponent.prototype.completeSetup.call(ctx);
            expect(ctx.setupFailed()).toBe(true);
        });

        it('shows error message when setup fails', async () => {
            const ctx = {
                isCompleting: signal(false),
                errorMessage: signal(''),
                setupFailed: signal(false),
                setupService: { completeSetup: vi.fn().mockRejectedValue(new Error('fail')) },
                toastService: { success: vi.fn(), error: vi.fn() },
                router: { navigate: vi.fn() },
            };
            await OnboardingComponent.prototype.completeSetup.call(ctx);
            expect(ctx.errorMessage()).toContain('Failed to create default content');
            expect(ctx.toastService.error).toHaveBeenCalled();
        });

        it('resets isCompleting after failure', async () => {
            const ctx = {
                isCompleting: signal(false),
                errorMessage: signal(''),
                setupFailed: signal(false),
                setupService: { completeSetup: vi.fn().mockRejectedValue(new Error('fail')) },
                toastService: { success: vi.fn(), error: vi.fn() },
                router: { navigate: vi.fn() },
            };
            await OnboardingComponent.prototype.completeSetup.call(ctx);
            expect(ctx.isCompleting()).toBe(false);
        });

        it('resets setupFailed on retry attempt', async () => {
            const ctx = {
                isCompleting: signal(false),
                errorMessage: signal('old error'),
                setupFailed: signal(true),
                setupService: { completeSetup: vi.fn().mockResolvedValue(undefined) },
                toastService: { success: vi.fn(), error: vi.fn() },
                router: { navigate: vi.fn() },
            };
            await OnboardingComponent.prototype.completeSetup.call(ctx);
            expect(ctx.setupFailed()).toBe(false);
            expect(ctx.router.navigate).toHaveBeenCalledWith(['/admin/dashboard'], { replaceUrl: true });
        });
    });

    // ─── Step 5: skipSetupAndGo ────────────────────────────────────────────

    describe('skipSetupAndGo', () => {
        it('marks onboarding complete and navigates to dashboard', async () => {
            const navigate = vi.fn();
            const markComplete = vi.fn().mockResolvedValue(undefined);
            const ctx = {
                setupService: { markOnboardingComplete: markComplete },
                router: { navigate },
            };
            await OnboardingComponent.prototype.skipSetupAndGo.call(ctx);
            expect(markComplete).toHaveBeenCalled();
            expect(navigate).toHaveBeenCalledWith(['/admin/dashboard'], { replaceUrl: true });
        });

        it('navigates to dashboard even if markOnboardingComplete fails', async () => {
            const navigate = vi.fn();
            const markComplete = vi.fn().mockRejectedValue(new Error('fail'));
            const ctx = {
                setupService: { markOnboardingComplete: markComplete },
                router: { navigate },
            };
            await OnboardingComponent.prototype.skipSetupAndGo.call(ctx);
            expect(navigate).toHaveBeenCalledWith(['/admin/dashboard'], { replaceUrl: true });
        });
    });
    // ─── checkAdminClaim ───────────────────────────────────────────────────

    describe('checkAdminClaim', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('advances to step 3 when token has admin claim', async () => {
            const ctx = {
                auth: {
                    currentUser: {
                        getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'admin' } }),
                    },
                },
                currentStep: signal<number>(2),
                errorMessage: signal('some error'),
            };
            await OnboardingComponent.prototype.checkAdminClaim.call(ctx, 0);
            expect(ctx.currentStep()).toBe(3);
            expect(ctx.errorMessage()).toBe('');
            expect(ctx.auth.currentUser.getIdTokenResult).toHaveBeenCalledWith(true);
        });

        it('retries when token does not have admin claim and attempts < 10', async () => {
            const checkAdminClaimSpy = vi.spyOn(OnboardingComponent.prototype, 'checkAdminClaim');
            const ctx: any = {
                auth: {
                    currentUser: {
                        getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'user' } }),
                    },
                },
                currentStep: signal<number>(2),
                errorMessage: signal(''),
                signupTimeoutId: null,
            };
            ctx.checkAdminClaim = checkAdminClaimSpy.bind(ctx);

            await OnboardingComponent.prototype.checkAdminClaim.call(ctx, 0);

            // Hasn't advanced
            expect(ctx.currentStep()).toBe(2);
            // Timeout should be set
            expect(ctx.signupTimeoutId).toBeTruthy();

            // Fast-forward timer
            vi.advanceTimersByTime(2000);

            expect(checkAdminClaimSpy).toHaveBeenCalledWith(1);

            checkAdminClaimSpy.mockRestore();
        });

        it('advances to step 3 after 10 failed attempts', async () => {
            const ctx = {
                auth: {
                    currentUser: {
                        getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'user' } }),
                    },
                },
                currentStep: signal<number>(2),
                errorMessage: signal('error'),
                signupTimeoutId: null,
            };
            await OnboardingComponent.prototype.checkAdminClaim.call(ctx, 10);
            expect(ctx.currentStep()).toBe(3);
            expect(ctx.errorMessage()).toBe('');
        });

        it('retries even if getIdTokenResult throws an error', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const checkAdminClaimSpy = vi.spyOn(OnboardingComponent.prototype, 'checkAdminClaim');
            const ctx: any = {
                auth: {
                    currentUser: {
                        getIdTokenResult: vi.fn().mockRejectedValue(new Error('Network error')),
                    },
                },
                currentStep: signal<number>(2),
                errorMessage: signal(''),
                signupTimeoutId: null,
            };
            ctx.checkAdminClaim = checkAdminClaimSpy.bind(ctx);

            await OnboardingComponent.prototype.checkAdminClaim.call(ctx, 0);
            expect(consoleWarnSpy).toHaveBeenCalledWith('Token refresh failed (non-fatal):', expect.any(Error));

            vi.advanceTimersByTime(2000);
            expect(checkAdminClaimSpy).toHaveBeenCalledWith(1);

            consoleWarnSpy.mockRestore();
            checkAdminClaimSpy.mockRestore();
        });
    });
});
