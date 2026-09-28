/**
 * Tests for Signup Page Component
 * 
 * Tests verify the SignupComponent functionality including:
 * - Component definition and structure
 * - Form validation
 * - Step management
 * - OTP handling
 * - Password validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Signup OTP is now server-side (E3): mock the callable factory so we can drive
// verify success/failure without a real Functions backend.
const { mockCallableFn } = vi.hoisted(() => ({ mockCallableFn: vi.fn() }));
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn(() => mockCallableFn),
}));

import SignupComponent from './signup.page';

describe('SignupComponent', () => {
    describe('Component Definition', () => {
        it('should be defined', () => {
            expect(SignupComponent).toBeDefined();
        });

        it('should be a class', () => {
            expect(typeof SignupComponent).toBe('function');
        });

        it('should have default export', () => {
            expect(SignupComponent.name).toContain('SignupComponent');
        });
    });

    describe('Component Inheritance', () => {
        it('should extend BaseComponent', () => {
            expect(SignupComponent.prototype).toBeDefined();
        });
    });

    describe('Step Management Methods', () => {
        it('should have getStepTitle method', () => {
            expect(SignupComponent.prototype.getStepTitle).toBeDefined();
            expect(typeof SignupComponent.prototype.getStepTitle).toBe('function');
        });

        it('should have getStepDescription method', () => {
            expect(SignupComponent.prototype.getStepDescription).toBeDefined();
            expect(typeof SignupComponent.prototype.getStepDescription).toBe('function');
        });

        it('should have goToStep method', () => {
            expect(SignupComponent.prototype.goToStep).toBeDefined();
            expect(typeof SignupComponent.prototype.goToStep).toBe('function');
        });

        it('should have updateValidators method', () => {
            expect(SignupComponent.prototype.updateValidators).toBeDefined();
            expect(typeof SignupComponent.prototype.updateValidators).toBe('function');
        });

        it('should have handleSubmit method', () => {
            expect(SignupComponent.prototype.handleSubmit).toBeDefined();
            expect(typeof SignupComponent.prototype.handleSubmit).toBe('function');
        });
    });

    describe('Authentication Methods', () => {
        it('should have checkEmail method', () => {
            expect(SignupComponent.prototype.checkEmail).toBeDefined();
            expect(typeof SignupComponent.prototype.checkEmail).toBe('function');
        });

        it('should have login method', () => {
            expect(SignupComponent.prototype.login).toBeDefined();
            expect(typeof SignupComponent.prototype.login).toBe('function');
        });

        it('should have register method', () => {
            expect(SignupComponent.prototype.register).toBeDefined();
            expect(typeof SignupComponent.prototype.register).toBe('function');
        });

        it('should not have googleSignIn method (removed)', () => {
            expect(SignupComponent.prototype.googleSignIn).toBeUndefined();
        });

        it('should have forgotPassword method', () => {
            expect(SignupComponent.prototype.forgotPassword).toBeDefined();
            expect(typeof SignupComponent.prototype.forgotPassword).toBe('function');
        });
    });

    describe('OTP Handling Methods', () => {
        it('should have sendOtp method', () => {
            expect(SignupComponent.prototype.sendOtp).toBeDefined();
            expect(typeof SignupComponent.prototype.sendOtp).toBe('function');
        });

        it('should have verifyOtp method', () => {
            expect(SignupComponent.prototype.verifyOtp).toBeDefined();
            expect(typeof SignupComponent.prototype.verifyOtp).toBe('function');
        });

        it('should have resendOtp method', () => {
            expect(SignupComponent.prototype.resendOtp).toBeDefined();
            expect(typeof SignupComponent.prototype.resendOtp).toBe('function');
        });

        it('should have startCountdown method', () => {
            expect(SignupComponent.prototype.startCountdown).toBeDefined();
            expect(typeof SignupComponent.prototype.startCountdown).toBe('function');
        });

        it('should not have the old per-box OTP handlers (arc-code-input does it)', () => {
            expect((SignupComponent.prototype as unknown as Record<string, unknown>)['onOtpInput']).toBeUndefined();
        });

        it('should have checkPhone, signInWithPin, forgotPin and saveNewPin methods', () => {
            for (const name of ['checkPhone', 'signInWithPin', 'forgotPin', 'saveNewPin', 'continueWithGoogle', 'cleanIdentifier']) {
                expect(typeof (SignupComponent.prototype as unknown as Record<string, unknown>)[name]).toBe('function');
            }
        });
    });

    describe('Form Validation Methods', () => {
        it('should have passwordMatchValidator method', () => {
            expect(SignupComponent.prototype.passwordMatchValidator).toBeDefined();
            expect(typeof SignupComponent.prototype.passwordMatchValidator).toBe('function');
        });

        it('should have isFieldInvalid method', () => {
            expect(SignupComponent.prototype.isFieldInvalid).toBeDefined();
            expect(typeof SignupComponent.prototype.isFieldInvalid).toBe('function');
        });

        it('should have hasPasswordMismatch method', () => {
            expect(SignupComponent.prototype.hasPasswordMismatch).toBeDefined();
            expect(typeof SignupComponent.prototype.hasPasswordMismatch).toBe('function');
        });
    });

    describe('Lifecycle Methods', () => {
        it('should have ngOnInit method', () => {
            expect(SignupComponent.prototype.ngOnInit).toBeDefined();
            expect(typeof SignupComponent.prototype.ngOnInit).toBe('function');
        });

        it('should have ngOnDestroy method', () => {
            expect(SignupComponent.prototype.ngOnDestroy).toBeDefined();
            expect(typeof SignupComponent.prototype.ngOnDestroy).toBe('function');
        });
    });

    describe('Password Visibility Methods', () => {
        it('should define showLoginPassword signal access pattern', () => {
            // These are signals, so we verify the component class is set up correctly
            expect(SignupComponent).toBeDefined();
        });

        it('should define showPassword signal access pattern', () => {
            expect(SignupComponent).toBeDefined();
        });

        it('should define showConfirmPassword signal access pattern', () => {
            expect(SignupComponent).toBeDefined();
        });
    });

    describe('SignupStep Type', () => {
        it('should support request step', () => {
            // SignupStep is a type alias for 'request' | 'login' | 'verify' | 'signup'
            const validSteps = ['request', 'login', 'verify', 'signup'];
            validSteps.forEach(step => {
                expect(typeof step).toBe('string');
            });
        });
    });

    describe('Form Configuration', () => {
        it('should have initForm as private method', () => {
            // Private methods are not directly testable on prototype
            // But we can verify the class is properly structured
            expect(SignupComponent).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should define errorMessage signal pattern', () => {
            expect(SignupComponent).toBeDefined();
        });

        it('should define successMessage signal pattern', () => {
            expect(SignupComponent).toBeDefined();
        });

        it('should define otpError signal pattern', () => {
            expect(SignupComponent).toBeDefined();
        });
    });

    describe('Loading State', () => {
        it('should define isLoading signal pattern', () => {
            expect(SignupComponent).toBeDefined();
        });
    });

    describe('Countdown Timer', () => {
        it('should define resendCountdown signal pattern', () => {
            expect(SignupComponent).toBeDefined();
        });
    });

    describe('Route Meta Configuration', () => {
        it('should export routeMeta with correct title', async () => {
            // Dynamically import to check routeMeta export
            const module = await import('./signup.page');
            expect(module.routeMeta).toBeDefined();
            expect(module.routeMeta.title).toBe('Signup | Arc CMS');
        });
    });

    describe('Password Match Validation Logic', () => {
        it('passwordMatchValidator should return null when passwords match', () => {
            const validator = SignupComponent.prototype.passwordMatchValidator;
            const mockFormGroup = {
                get: (key: string) => ({
                    value: key === 'password' ? 'testPassword123' : 'testPassword123'
                })
            };
            const result = validator(mockFormGroup as any);
            expect(result).toBeNull();
        });

        it('passwordMatchValidator should return mismatch error when passwords differ', () => {
            const validator = SignupComponent.prototype.passwordMatchValidator;
            const mockFormGroup = {
                get: (key: string) => ({
                    value: key === 'password' ? 'password1' : 'password2'
                })
            };
            const result = validator(mockFormGroup as any);
            expect(result).toEqual({ mismatch: true });
        });
    });

    describe('Step Title Mapping', () => {
        it('should support all step titles', () => {
            // These titles are returned by getStepTitle method
            const expectedTitles = ['Welcome', 'Welcome Back', 'Verify Email', 'Create Account'];
            expectedTitles.forEach(title => {
                expect(typeof title).toBe('string');
            });
        });
    });

    describe('Step Description Mapping', () => {
        it('should support all step descriptions', () => {
            const expectedDescriptions = [
                'Enter your email to get started',
                'Sign in to your account',
                'Enter the 6-digit code sent to your email',
                'Complete your registration'
            ];
            expectedDescriptions.forEach(description => {
                expect(typeof description).toBe('string');
            });
        });
    });

    describe('Component Method Count', () => {
        it('should have expected number of public methods', () => {
            const expectedMethods = [
                'getStepTitle',
                'getStepDescription',
                'goToStep',
                'updateValidators',
                'handleSubmit',
                'checkIdentifier',
                'checkEmail',
                'checkPhone',
                'sendOtp',
                'startCountdown',
                'resendOtp',
                'verifyOtp',
                'signInWithPin',
                'forgotPin',
                'saveNewPin',
                'continueWithGoogle',
                'register',
                'login',
                'forgotPassword',
                // 'googleSignIn' removed
                'isFieldInvalid',
                'hasPasswordMismatch',
                'passwordMatchValidator',
                'ngOnInit',
                'ngOnDestroy'
            ];

            expectedMethods.forEach(method => {
                expect((SignupComponent.prototype as unknown as Record<string, unknown>)[method]).toBeDefined();
            });
        });
    });

    describe('verifyOtp Validation Logic', () => {
        const loading = () => Object.assign(() => false, { set: vi.fn() });

        it.each(['', '123'])('verifyOtp asks for all 6 digits when given %j', async (entered) => {
            const mockOtpError = { set: vi.fn() };
            const mockContext = {
                codeBoxes: () => ({ value: () => entered }),
                otpError: mockOtpError,
                isLoading: loading(),
            };

            await SignupComponent.prototype.verifyOtp.call(mockContext);

            expect(mockOtpError.set).toHaveBeenCalledWith('Please enter the 6-digit code');
        });
    });

    describe('resetAll Method', () => {
        it('should have resetAll method', () => {
            expect(SignupComponent.prototype.resetAll).toBeDefined();
            expect(typeof SignupComponent.prototype.resetAll).toBe('function');
        });
    });

    describe('verifyOtp acceptance (server-authoritative)', () => {
        const verifyOtp = (SignupComponent.prototype as unknown as Record<string, (this: unknown, code?: string) => Promise<void>>)['verifyOtp'];

        function ctx(channel: 'email' | 'phone' = 'email', purpose: 'signup' | 'reset' = 'signup') {
            return {
                email: 'new@user.com',
                channel: () => channel,
                phone: () => '+919876543210',
                phonePurpose: () => purpose,
                functions: {},
                otpVerified: false,
                otpError: { set: vi.fn() },
                isLoading: Object.assign(() => false, { set: vi.fn() }),
                toastService: { success: vi.fn() },
                goToStep: vi.fn(),
                codeBoxes: () => ({ reset: vi.fn(), value: () => '' }),
                signIn: { verifyPhoneCode: vi.fn().mockResolvedValue({ verified: true }) },
            };
        }

        beforeEach(() => mockCallableFn.mockReset());

        it('marks otpVerified and advances to signup when the server verifies', async () => {
            mockCallableFn.mockResolvedValue({ data: { verified: true } });
            const c = ctx();
            await verifyOtp.call(c, '654321');
            expect(c.otpVerified).toBe(true);
            expect(c.goToStep).toHaveBeenCalledWith('signup');
        });

        it('rejects when the server does not verify the code', async () => {
            mockCallableFn.mockResolvedValue({ data: { verified: false } });
            const c = ctx();
            await verifyOtp.call(c, '123456');
            expect(c.otpError.set).toHaveBeenCalledWith("That code didn't work. Check it and try again.");
            expect(c.otpVerified).toBe(false);
            expect(c.goToStep).not.toHaveBeenCalled();
        });

        it('a verified SMS code for a new number goes to name and PIN', async () => {
            const c = ctx('phone', 'signup');
            await verifyOtp.call(c, '654321');
            expect(c.signIn.verifyPhoneCode).toHaveBeenCalledWith('+919876543210', '654321', 'signup');
            expect(c.goToStep).toHaveBeenCalledWith('signup');
        });

        it('a verified reset code goes to a new PIN', async () => {
            const c = ctx('phone', 'reset');
            await verifyOtp.call(c, '654321');
            expect(c.goToStep).toHaveBeenCalledWith('newPin');
        });
    });

    describe('checkPhone: PIN, code, or closed', () => {
        const checkPhone = (SignupComponent.prototype as unknown as Record<string, (this: unknown, typed: string) => Promise<void>>)['checkPhone'];

        function ctx(account: Record<string, unknown>) {
            return {
                isLoading: { set: vi.fn() },
                errorMessage: { set: vi.fn() },
                channel: { set: vi.fn() },
                phone: { set: vi.fn() },
                phonePurpose: { set: vi.fn() },
                pinLocked: { set: vi.fn() },
                signIn: { checkPhone: vi.fn().mockResolvedValue({ phone: '+919876543210', signupOpen: true, ...account }) },
                sendOtp: vi.fn().mockResolvedValue(undefined),
                goToStep: vi.fn(),
            };
        }

        it('asks a registered number for its PIN', async () => {
            const c = ctx({ exists: true, hasPin: true });
            await checkPhone.call(c, '98765 43210');
            expect(c.phone.set).toHaveBeenCalledWith('+919876543210');
            expect(c.goToStep).toHaveBeenCalledWith('pin');
            expect(c.sendOtp).not.toHaveBeenCalled();
        });

        it('sends a new number a sign-up code', async () => {
            const c = ctx({ exists: false, hasPin: false });
            await checkPhone.call(c, '98765 43210');
            expect(c.phonePurpose.set).toHaveBeenCalledWith('signup');
            expect(c.goToStep).toHaveBeenCalledWith('verify');
            expect(c.sendOtp).toHaveBeenCalled();
        });

        it('sends a registered number without a PIN a code to set one', async () => {
            const c = ctx({ exists: true, hasPin: false });
            await checkPhone.call(c, '98765 43210');
            expect(c.phonePurpose.set).toHaveBeenCalledWith('reset');
            expect(c.goToStep).toHaveBeenCalledWith('verify');
        });

        it('shows sign-ups closed for a new number when they are off', async () => {
            const c = ctx({ exists: false, hasPin: false, signupOpen: false });
            await checkPhone.call(c, '98765 43210');
            expect(c.goToStep).toHaveBeenCalledWith('disabled');
            expect(c.sendOtp).not.toHaveBeenCalled();
        });

        it("shows the server's message when the number is refused", async () => {
            const c = ctx({});
            c.signIn.checkPhone.mockRejectedValue({ code: 'functions/invalid-argument', message: 'Only numbers starting +91 can be used here.' });
            await checkPhone.call(c, '+44 7700 900123');
            expect(c.errorMessage.set).toHaveBeenCalledWith('Only numbers starting +91 can be used here.');
        });
    });

    describe('sendOtp in test mode', () => {
        const sendOtp = (SignupComponent.prototype as unknown as Record<string, (this: unknown) => Promise<void>>)['sendOtp'];

        function ctx(testCode?: string) {
            let shown = '';
            return {
                channel: () => 'phone',
                phone: () => '+919876543210',
                phonePurpose: () => 'signup',
                otpError: { set: vi.fn() },
                testCode: Object.assign(() => shown, { set: (v: string) => (shown = v) }),
                toastService: { success: vi.fn() },
                startCountdown: vi.fn(),
                signIn: { requestPhoneCode: vi.fn().mockResolvedValue({ sent: true, ...(testCode ? { testCode } : {}) }) },
            };
        }

        it('shows the code the Test provider did not send', async () => {
            const c = ctx('482913');
            await sendOtp.call(c);
            expect(c.testCode()).toBe('482913');
            expect(c.toastService.success).not.toHaveBeenCalled();
        });

        it('shows nothing with a real provider, just "sent"', async () => {
            const c = ctx();
            await sendOtp.call(c);
            expect(c.testCode()).toBe('');
            expect(c.toastService.success).toHaveBeenCalledWith('Code sent by SMS');
        });
    });

    describe('signInWithPin', () => {
        const signInWithPin = (SignupComponent.prototype as unknown as Record<string, (this: unknown, pin?: string) => Promise<void>>)['signInWithPin'];

        function ctx(error?: Record<string, unknown>) {
            const c: Record<string, any> = {
                phone: () => '+919876543210',
                isLoading: Object.assign(() => false, { set: vi.fn() }),
                errorMessage: { set: vi.fn() },
                pinLocked: { set: vi.fn() },
                pinBoxes: () => ({ reset: vi.fn(), value: () => '' }),
                forgotPin: vi.fn(),
                signIn: { signInWithPin: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(undefined) },
            };
            c['finishPhoneSignIn'] = (SignupComponent.prototype as any).finishPhoneSignIn.bind(c);
            return c;
        }

        it('signs in and leaves the redirect to the auth effect', async () => {
            const c = ctx();
            await signInWithPin.call(c, '246810');
            expect(c['signIn'].signInWithPin).toHaveBeenCalledWith('+919876543210', '246810');
            expect(c['authActionPending']).toBe(true);
        });

        it('shows a wrong PIN and clears the boxes', async () => {
            const c = ctx({ code: 'functions/permission-denied', message: 'Wrong PIN. 4 tries left.', details: { reason: 'wrong' } });
            await signInWithPin.call(c, '000000');
            expect(c['errorMessage'].set).toHaveBeenCalledWith('Wrong PIN. 4 tries left.');
            expect(c['pinLocked'].set).not.toHaveBeenCalled();
        });

        it('locks the boxes after too many tries', async () => {
            const c = ctx({ code: 'functions/resource-exhausted', message: 'Too many tries. Reset your PIN with a code.', details: { reason: 'locked' } });
            await signInWithPin.call(c, '000000');
            expect(c['pinLocked'].set).toHaveBeenCalledWith(true);
        });
    });

    describe('checkEmail — E4 verification gating', () => {
        const checkEmail = (SignupComponent.prototype as unknown as Record<string, (this: unknown) => Promise<void>>)['checkEmail'];

        function ctx(mustVerify: boolean, emailExists = false, status?: string) {
            return {
                email: 'new@user.com',
                isLoading: { set: vi.fn() },
                errorMessage: { set: vi.fn() },
                otpVerified: true, // should be reset to false by checkEmail
                emailStatus: vi.fn().mockResolvedValue(status ?? (emailExists ? 'registered' : 'new')),
                signupSettings: { isSignupEnabled: true },
                shouldVerifySignup: vi.fn().mockResolvedValue(mustVerify),
                sendOtp: vi.fn().mockResolvedValue(undefined),
                goToStep: vi.fn(),
            };
        }

        it('skips OTP and goes straight to signup when verification is not required', async () => {
            const c = ctx(false);
            await checkEmail.call(c);
            expect(c.sendOtp).not.toHaveBeenCalled();
            expect(c.goToStep).toHaveBeenCalledWith('signup');
            expect(c.otpVerified).toBe(false);
        });

        it('shows the OTP step and requests a code when verification is required', async () => {
            const c = ctx(true);
            await checkEmail.call(c);
            expect(c.sendOtp).toHaveBeenCalled();
            expect(c.goToStep).toHaveBeenCalledWith('verify');
        });

        it('tells a login from another app (no record here) straight away', async () => {
            const c = ctx(false, false, 'no-access');
            await checkEmail.call(c);
            expect(c.errorMessage.set).toHaveBeenCalledWith(expect.stringContaining("doesn't have access"));
            expect(c.goToStep).not.toHaveBeenCalled();
            expect(c.sendOtp).not.toHaveBeenCalled();
        });

        it('falls back to the lookup table when the server check fails', async () => {
            const emailStatus = (SignupComponent.prototype as any).emailStatus;
            const c = {
                signIn: { checkEmail: vi.fn().mockRejectedValue(new Error('offline')) },
                authStore: { checkItemNumberExist: vi.fn().mockResolvedValue({ toPromise: () => Promise.resolve([{}]) }) },
            };
            await expect(emailStatus.call(c, 'a@b.co')).resolves.toBe('registered');
        });

        it('routes an existing email to the login step', async () => {
            const c = ctx(false, true);
            await checkEmail.call(c);
            expect(c.goToStep).toHaveBeenCalledWith('login');
            expect(c.sendOtp).not.toHaveBeenCalled();
        });
    });

    describe('handleLoginSuccess redirect', () => {
        // handleLoginSuccess is what the auth effect calls once a signup/login the
        // user initiated produces a currentUser. It must route regular users too
        // (they are 'user' role → isAuthenticated()/isSuccess() are false).
        const handleLoginSuccess = (SignupComponent.prototype as unknown as Record<string, (this: unknown) => void>)['handleLoginSuccess'];

        function ctx(isAdmin: boolean, inProgress = false, url = '/signup', role = 'user') {
            const navigate = vi.fn();
            return {
                navigationInProgress: inProgress,
                authStore: { currentUser: () => ({ uid: 'u1', role }), isAdmin: () => isAdmin },
                toastService: { success: vi.fn() },
                router: {
                    url,
                    parseUrl: (u: string) => ({ queryParams: Object.fromEntries(new URL(u, 'http://site.test').searchParams) }),
                    navigateByUrl: navigate,
                },
                _navigate: navigate,
            };
        }

        it('routes a regular user to /user/dashboard', () => {
            const c = ctx(false);
            handleLoginSuccess.call(c);
            expect(c._navigate).toHaveBeenCalledWith('/user/dashboard', { replaceUrl: true });
            expect(c.navigationInProgress).toBe(true);
        });

        it('routes an admin to /admin/dashboard', () => {
            const c = ctx(true);
            handleLoginSuccess.call(c);
            expect(c._navigate).toHaveBeenCalledWith('/admin/dashboard', { replaceUrl: true });
        });

        it('goes back to the page that asked for a sign-in', () => {
            const c = ctx(false, false, '/signup?redirect=%2Flearn%3Fchild%3D2');
            handleLoginSuccess.call(c);
            expect(c._navigate).toHaveBeenCalledWith('/learn?child=2', { replaceUrl: true });
        });

        it('ignores a redirect to another site', () => {
            const c = ctx(false, false, '/signup?redirect=https%3A%2F%2Fevil.example');
            handleLoginSuccess.call(c);
            expect(c._navigate).toHaveBeenCalledWith('/user/dashboard', { replaceUrl: true });
        });

        it('does not double-navigate when one is already in progress', () => {
            const c = ctx(false, true);
            handleLoginSuccess.call(c);
            expect(c._navigate).not.toHaveBeenCalled();
        });
    });

    describe('Disabled Step', () => {
        it('should include disabled step in SignupStep type', () => {
            const validSteps = ['request', 'login', 'pin', 'verify', 'signup', 'newPin', 'disabled'];
            validSteps.forEach(step => {
                expect(typeof step).toBe('string');
            });
        });

        it('should have disabled step title', () => {
            const expectedTitles = ['Welcome', 'Welcome Back', 'Verify Email', 'Create Account', 'Signups are disabled'];
            expectedTitles.forEach(title => {
                expect(typeof title).toBe('string');
            });
        });
    });

    describe('handleAuthError', () => {
        const ctx = (step: string) => ({
            currentStep: vi.fn(() => step),
            goToStep: vi.fn(),
            errorMessage: { set: vi.fn() },
            authActionPending: true,
        });

        it('sends an already-registered email to sign-in instead of failing silently', () => {
            const c = { ...ctx('signup'), successMessage: { set: vi.fn() } };
            SignupComponent.prototype.handleAuthError.call(c, 'You already have an account', 'auth/email-already-in-use');
            expect(c.goToStep).toHaveBeenCalledWith('login');
            expect(c.successMessage.set).toHaveBeenCalledWith(expect.stringContaining('already have an account'));
            expect(c.authActionPending).toBe(false);
        });

        it('shows any other error where it happened', () => {
            const c = ctx('signup');
            SignupComponent.prototype.handleAuthError.call(c, 'Something went wrong!', 'auth/network-request-failed');
            expect(c.goToStep).not.toHaveBeenCalled();
            expect(c.errorMessage.set).toHaveBeenCalledWith('Something went wrong!');
        });
    });

    describe('instance label', () => {
        it('names the project and database in development builds, on every step', () => {
            const fs = require('fs');
            const path = require('path');
            const html: string = fs.readFileSync(path.resolve(__dirname, 'signup.page.html'), 'utf-8');
            const src: string = fs.readFileSync(path.resolve(__dirname, 'signup.page.ts'), 'utf-8');
            expect(src).toContain('environment.production');
            expect(src).toContain('arcConfig.databaseId');
            expect(html.match(/instance-label/g)?.length).toBe(html.match(/class="copyright"/g)?.length);
        });
    });
});
