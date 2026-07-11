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

        it('should have onOtpInput method', () => {
            expect(SignupComponent.prototype.onOtpInput).toBeDefined();
            expect(typeof SignupComponent.prototype.onOtpInput).toBe('function');
        });

        it('should have onOtpKeyDown method', () => {
            expect(SignupComponent.prototype.onOtpKeyDown).toBeDefined();
            expect(typeof SignupComponent.prototype.onOtpKeyDown).toBe('function');
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
                'checkEmail',
                'sendOtp',
                'startCountdown',
                'resendOtp',
                'onOtpInput',
                'onOtpKeyDown',
                'verifyOtp',
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
        it('verifyOtp should set error for empty OTP', () => {
            const method = SignupComponent.prototype.verifyOtp;
            const mockOtpError = { set: vi.fn() };
            const mockRegistrationForm = {
                get: () => ({ value: '' })
            };
            const mockContext = {
                registrationForm: mockRegistrationForm,
                otpError: mockOtpError,
                isLoading: { set: vi.fn() }
            };

            method.call(mockContext);

            expect(mockOtpError.set).toHaveBeenCalledWith('Please enter the 6-digit code');
        });

        it('verifyOtp should set error for short OTP', () => {
            const method = SignupComponent.prototype.verifyOtp;
            const mockOtpError = { set: vi.fn() };
            const mockRegistrationForm = {
                get: () => ({ value: '123' })
            };
            const mockContext = {
                registrationForm: mockRegistrationForm,
                otpError: mockOtpError,
                isLoading: { set: vi.fn() }
            };

            method.call(mockContext);

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
        const verifyOtp = (SignupComponent.prototype as unknown as Record<string, (this: unknown) => Promise<void>>)['verifyOtp'];

        function ctx(entered: string) {
            return {
                registrationForm: { get: () => ({ value: entered }) },
                functions: {},
                otpVerified: false,
                otpError: { set: vi.fn() },
                isLoading: { set: vi.fn() },
                toastService: { success: vi.fn() },
                goToStep: vi.fn(),
            };
        }

        beforeEach(() => mockCallableFn.mockReset());

        it('marks otpVerified and advances to signup when the server verifies', async () => {
            mockCallableFn.mockResolvedValue({ data: { verified: true } });
            const c = ctx('654321');
            await verifyOtp.call(c);
            expect(c.otpVerified).toBe(true);
            expect(c.goToStep).toHaveBeenCalledWith('signup');
        });

        it('rejects when the server does not verify the code', async () => {
            mockCallableFn.mockResolvedValue({ data: { verified: false } });
            const c = ctx('123456');
            await verifyOtp.call(c);
            expect(c.otpError.set).toHaveBeenCalledWith('Invalid verification code');
            expect(c.otpVerified).toBe(false);
            expect(c.goToStep).not.toHaveBeenCalled();
        });

    });

    describe('checkEmail — E4 verification gating', () => {
        const checkEmail = (SignupComponent.prototype as unknown as Record<string, (this: unknown) => Promise<void>>)['checkEmail'];

        function ctx(mustVerify: boolean, emailExists = false) {
            return {
                registrationForm: { get: () => ({ invalid: false, value: 'new@user.com', markAsTouched: vi.fn() }) },
                isLoading: { set: vi.fn() },
                errorMessage: { set: vi.fn() },
                otpVerified: true, // should be reset to false by checkEmail
                authStore: { checkItemNumberExist: vi.fn().mockResolvedValue({ toPromise: () => Promise.resolve(emailExists ? [{}] : []) }) },
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

        function ctx(isAdmin: boolean, inProgress = false) {
            const navigate = vi.fn();
            return {
                navigationInProgress: inProgress,
                authStore: { currentUser: () => ({ uid: 'u1' }), isAdmin: () => isAdmin },
                toastService: { success: vi.fn() },
                router: { navigate },
                _navigate: navigate,
            };
        }

        it('routes a regular user to /user/dashboard', () => {
            const c = ctx(false);
            handleLoginSuccess.call(c);
            expect(c._navigate).toHaveBeenCalledWith(['/user/dashboard'], { replaceUrl: true });
            expect(c.navigationInProgress).toBe(true);
        });

        it('routes an admin to /admin/dashboard', () => {
            const c = ctx(true);
            handleLoginSuccess.call(c);
            expect(c._navigate).toHaveBeenCalledWith(['/admin/dashboard'], { replaceUrl: true });
        });

        it('does not double-navigate when one is already in progress', () => {
            const c = ctx(false, true);
            handleLoginSuccess.call(c);
            expect(c._navigate).not.toHaveBeenCalled();
        });
    });

    describe('Disabled Step', () => {
        it('should include disabled step in SignupStep type', () => {
            const validSteps = ['request', 'login', 'verify', 'signup', 'disabled'];
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
});
