/**
 * Tests for WaitlistFormService
 */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { WaitlistFormService } from './waitlist-form.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { EmailConfigStatusService } from '../../../shared/services/email-config-status.service';
import { SignupMetadataService } from '../waitlist/signup-metadata.service';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PLATFORM_ID } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';

// Mock Firestore functions
const { mockGetCountFromServer, mockCollection, mockGetDoc, mockHttpsCallable } = vi.hoisted(() => {
    return {
        mockGetCountFromServer: vi.fn(),
        mockCollection: vi.fn(),
        mockGetDoc: vi.fn(),
        mockHttpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
    };
});

vi.mock('@angular/fire/firestore', () => ({
    getCountFromServer: mockGetCountFromServer,
    collection: mockCollection,
    getDoc: mockGetDoc,
    Firestore: class {},
    doc: vi.fn(),
}));

vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: mockHttpsCallable,
}));

describe('WaitlistFormService', () => {
    let service: WaitlistFormService;
    let mockWaitlistService: any;
    let mockEmailConfigService: any;
    let mockMetadataService: any;
    let mockFirestore: any;

    // Helper for async operations
    const flushPromises = async () => {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // clearAllMocks resets calls but keeps implementations, so restore the default
        // callable here — otherwise a test that stubs a rejection leaks into the rest.
        mockHttpsCallable.mockImplementation(() => vi.fn().mockResolvedValue({ data: { success: true } }));

        // Default Firestore mocks
        mockGetCountFromServer.mockResolvedValue({ data: () => ({ count: 0 }) });
        // getDoc default: doc doesn't exist → isOtpTemplateEnabled returns true (OTP enabled)
        mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });

        mockWaitlistService = {
            getWaitlistBySlug: vi.fn().mockResolvedValue(null),
            getWaitlist: vi.fn().mockResolvedValue(null),
            createWaitlistWithId: vi.fn().mockResolvedValue(undefined),
            joinWaitlist: vi.fn().mockResolvedValue({ userId: 'test-user-id' }),
            verifyOtpAndProcessUser: vi.fn().mockResolvedValue({ success: true, data: {} }),
            resendVerificationCode: vi.fn().mockResolvedValue(undefined),
            confirmWithoutOtp: vi.fn().mockResolvedValue({ queuePosition: 1, totalSignups: 1 }),
            storeReferralCodeWithExpiration: vi.fn(),
            getReferralCodeFromStorage: vi.fn().mockReturnValue(null),
            clearReferralCodeFromStorage: vi.fn(),
            getFirstNameFromEmail: vi.fn().mockReturnValue('TestUser'),
        };

        mockEmailConfigService = {
            isEmailConfigured: vi.fn().mockReturnValue(true),
            isLoading: vi.fn().mockReturnValue(false),
            bannerDismissed: vi.fn().mockReturnValue(false),
            shouldShowBanner: vi.fn().mockReturnValue(false),
            dismissBanner: vi.fn()
        };

        mockMetadataService = {
            collectAllMetadata: vi.fn().mockReturnValue({}),
            startBehaviorTracking: vi.fn(),
            trackFormInteraction: vi.fn(),
            collectMetadata: vi.fn().mockReturnValue({}),
            collectMetadataWithBehavior: vi.fn().mockReturnValue({}),
        };

        mockFirestore = {
             // Mock Firestore - methods are accessed via imports, not instance methods
        };

        TestBed.configureTestingModule({
            providers: [
                WaitlistFormService,
                { provide: WaitlistService, useValue: mockWaitlistService },
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService },
                { provide: SignupMetadataService, useValue: mockMetadataService },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: Firestore, useValue: mockFirestore },
                { provide: Functions, useValue: {} },
            ],
        });

        service = TestBed.inject(WaitlistFormService);
    });

    afterEach(() => {
        service.cleanup();
        vi.restoreAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('initWaitlistForms', () => {
        it('should start behavior tracking on init', async () => {
            const container = document.createElement('div');
            await service.initWaitlistForms(container);
            expect(mockMetadataService.startBehaviorTracking).toHaveBeenCalled();
        });

        it('should detect forms with data-waitlist-form attribute', async () => {
            const container = document.createElement('div');
            container.innerHTML = `
        <form data-waitlist-form data-waitlist-id="test-waitlist">
          <input name="email" value="test@example.com" />
          <button type="submit">Submit</button>
        </form>
      `;

            await service.initWaitlistForms(container);

            // Should have called getWaitlistBySlug to check if waitlist exists
            expect(mockWaitlistService.getWaitlistBySlug).toHaveBeenCalledWith('test-waitlist');
        });

        it('should use default waitlist id if not specified', async () => {
            const container = document.createElement('div');
            container.innerHTML = `
        <form data-waitlist-form>
          <input name="email" value="test@example.com" />
          <button type="submit">Submit</button>
        </form>
      `;

            await service.initWaitlistForms(container);

            expect(mockWaitlistService.getWaitlistBySlug).toHaveBeenCalledWith('default');
        });

        it('should render disabled overlay for inactive waitlists', async () => {
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue({
                id: 'test',
                name: 'Test Waitlist',
                isActive: false,
                disabledMessage: 'Custom\nclosed\nmessage'
            });

            const container = document.createElement('div');
            container.innerHTML = `
        <form data-waitlist-form data-waitlist-id="test-waitlist">
          <input name="email" value="test@example.com" />
        </form>
      `;

            await service.initWaitlistForms(container);

            const overlay = container.querySelector('.waitlist-disabled-overlay');
            expect(overlay).toBeTruthy();
            expect(overlay?.innerHTML).toContain('Custom<br>closed<br>message');
        });
    });

    describe('ensureWaitlistExists', () => {
        const formHtml = `
        <form data-waitlist-form data-waitlist-id="test-waitlist">
          <input name="email" value="test@example.com" />
        </form>
      `;

        it('should not call the callable when the waitlist already exists', async () => {
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue({ id: 'test-waitlist', isActive: true });

            const container = document.createElement('div');
            container.innerHTML = formHtml;
            await service.initWaitlistForms(container);

            expect(mockHttpsCallable).not.toHaveBeenCalled();
        });

        it('should create the waitlist before binding the form when it is missing', async () => {
            const order: string[] = [];
            const callable = vi.fn(async () => {
                order.push('ensure');
                return { data: { success: true, existed: false } };
            });
            mockHttpsCallable.mockReturnValue(callable);
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue(null);
            mockWaitlistService.getWaitlist.mockResolvedValue(null);

            const container = document.createElement('div');
            container.innerHTML = formHtml;
            await service.initWaitlistForms(container);

            const form = container.querySelector('form') as HTMLFormElement;
            form.addEventListener('submit', () => order.push('submit'));
            form.dispatchEvent(new Event('submit'));

            expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'ensureWaitlistExists');
            expect(callable).toHaveBeenCalledWith({ waitlistId: 'test-waitlist' });
            expect(order).toEqual(['ensure', 'submit']);
        });

        it('should report the callable error code instead of swallowing it', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockHttpsCallable.mockReturnValue(
                vi.fn().mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' })),
            );
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue(null);
            mockWaitlistService.getWaitlist.mockResolvedValue(null);

            const container = document.createElement('div');
            container.innerHTML = formHtml;
            await service.initWaitlistForms(container);

            expect(consoleError).toHaveBeenCalled();
            const message = consoleError.mock.calls[0][0] as string;
            expect(message).toContain('test-waitlist');
            expect(message).toContain('functions/internal');
            // A bare `internal` is a transport failure, so say so rather than leaving
            // the reader to guess the function rejected.
            expect(message).toContain('never completed');
        });

        it('should report a server-side refusal reason', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });
            mockHttpsCallable.mockReturnValue(
                vi.fn().mockResolvedValue({ data: { success: false, reason: 'invalid-waitlist-id' } }),
            );
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue(null);
            mockWaitlistService.getWaitlist.mockResolvedValue(null);

            const container = document.createElement('div');
            container.innerHTML = formHtml;
            await service.initWaitlistForms(container);

            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining('invalid-waitlist-id'),
            );
        });

        it('should still bind the form when creation fails', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { });
            mockHttpsCallable.mockReturnValue(vi.fn().mockRejectedValue(new Error('boom')));
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue(null);
            mockWaitlistService.getWaitlist.mockResolvedValue(null);

            const container = document.createElement('div');
            container.innerHTML = formHtml;
            await service.initWaitlistForms(container);

            const form = container.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit'));
            await flushPromises();

            expect(mockWaitlistService.joinWaitlist).toHaveBeenCalled();
        });
    });

    describe('cleanup', () => {
        it('should restore original form HTML on cleanup', async () => {
            const container = document.createElement('div');
            const originalHtml = '<input name="email"><button type="submit">Submit</button>';
            container.innerHTML = `<form data-waitlist-form>${originalHtml}</form>`;

            await service.initWaitlistForms(container);
            service.cleanup();

            // Service should clear form states
            expect(container.querySelector('form')).toBeTruthy();
        });
    });

    describe('getLeaderboardUrl', () => {
        it('should return correct leaderboard URL', () => {
            const container = document.createElement('div');
            container.innerHTML = `
        <form data-waitlist-form data-waitlist-id="my-waitlist">
        </form>
      `;

            const url = service.getLeaderboardUrl(container);
            expect(url).toBe('/leaderboard/my-waitlist');
        });

        it('should use default waitlist id if not specified', () => {
            const container = document.createElement('div');
            container.innerHTML = `
        <form data-waitlist-form>
        </form>
      `;

            const url = service.getLeaderboardUrl(container);
            expect(url).toBe('/leaderboard/default');
        });
    });

    describe('detectFormsWithoutWaitlistAttribute', () => {
        it('should show warning overlay for forms without data-waitlist-form attribute', async () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <form class="my-form">
                    <input name="email" />
                    <button type="submit">Submit</button>
                </form>
            `;

            await service.initWaitlistForms(container, 'test.html');

            const overlay = container.querySelector('.waitlist-missing-attribute-overlay');
            expect(overlay).toBeTruthy();
            expect(overlay?.innerHTML).toContain("This Form's Data Will NOT Be Saved!");
        });

        it('should not show warning overlay for forms with data-waitlist-form attribute', async () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <form data-waitlist-form data-waitlist-id="test">
                    <input name="email" />
                </form>
            `;

            await service.initWaitlistForms(container, 'test.html');

            const warningOverlay = container.querySelector('.waitlist-missing-attribute-overlay');
            expect(warningOverlay).toBeNull();
        });
    });

    describe('updateWaitlistCounts', () => {
        it('should fetch and update counts for elements with data-waitlist-count', async () => {
            mockGetCountFromServer.mockResolvedValue({
                data: () => ({ count: 123 })
            });

            const container = document.createElement('div');
            container.innerHTML = `
                <span data-waitlist-count="test-list">0</span>
                <section>
                    <div class="fc-progress-fill"></div>
                </section>
            `;

            await service.initWaitlistForms(container);

            expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'Waitlists', 'test-list', 'users');
            expect(mockGetCountFromServer).toHaveBeenCalled();
            
            await flushPromises();

            const countEl = container.querySelector('[data-waitlist-count]');
            expect(countEl?.textContent).toBe('123');
        });

        it('should use global waitlist id if specific one not provided', async () => {
            mockGetCountFromServer.mockResolvedValue({
                data: () => ({ count: 456 })
            });

            const container = document.createElement('div');
            container.innerHTML = `
                <form data-waitlist-form data-waitlist-id="global-list"></form>
                <div data-waitlist-count>0</div>
            `;

            await service.initWaitlistForms(container);

            expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'Waitlists', 'global-list', 'users');
        });
    });

    describe('Form Submission Flow', () => {
        let container: HTMLElement;
        let form: HTMLFormElement;

        // Helper for async operations
        const flushPromises = async () => {
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        };

        beforeEach(async () => {
            container = document.createElement('div');
            container.innerHTML = `
                <form data-waitlist-form data-waitlist-id="test-flow">
                    <input name="email" value="test@example.com" data-waitlist-email />
                    <input name="firstName" value="Test" data-waitlist-name />
                    <button type="submit">Join</button>
                    <div class="waitlist-inline-message"></div>
                </form>
            `;
            document.body.appendChild(container); // Append to body for events
            await service.initWaitlistForms(container);
            form = container.querySelector('form') as HTMLFormElement;
        });

        afterEach(() => {
            if (document.body.contains(container)) {
                document.body.removeChild(container);
            }
        });

        it('should handle successful submission and show OTP verification step', async () => {
            // Setup — OTP enabled by default (getDoc returns doc without otpEnabled field)
            mockWaitlistService.joinWaitlist.mockResolvedValue({ 
                userId: 'user123',
                verificationCode: '123456'
            });

            // Simulate submit
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            expect(mockWaitlistService.joinWaitlist).toHaveBeenCalledWith('test-flow', {
                firstName: 'Test',
                email: 'test@example.com',
                source: 'direct',
                formData: expect.any(Object),
                signupMetadata: expect.any(Object)
            });

            // Verify step should be rendered
            expect(container.querySelector('.waitlist-verify-step')).toBeTruthy();
            expect(container.innerHTML).toContain('Check Your Email');
        });

        it('should skip OTP verification if disabled or email not configured', async () => {
            mockWaitlistService.joinWaitlist.mockResolvedValue({ 
                userId: 'user123'
            });
            // email config false
            mockEmailConfigService.isEmailConfigured.mockReturnValue(false);

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // Success step should be rendered directly
            expect(container.querySelector('.waitlist-success-step')).toBeTruthy();
        });

        it('should skip OTP when waitlist document has otpEnabled set to false', async () => {
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user123',
            });
            // Email IS configured, but OTP is explicitly disabled on the waitlist doc
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ otpEnabled: false }),
            });
            mockWaitlistService.confirmWithoutOtp.mockResolvedValue({
                queuePosition: 1,
                totalSignups: 1,
            });

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // Should skip OTP and go straight to success
            expect(container.querySelector('.waitlist-success-step')).toBeTruthy();
            expect(mockWaitlistService.confirmWithoutOtp).toHaveBeenCalled();
        });

        it('should show OTP step when waitlist document has otpEnabled set to true', async () => {
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user123',
                verificationCode: '123456',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ otpEnabled: true }),
            });

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // Should show OTP verification step
            expect(container.querySelector('.waitlist-verify-step')).toBeTruthy();
        });

        it('should call confirmWithoutOtp with stored referral code when OTP is skipped', async () => {
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user123',
                referralCode: 'ABC123',
                referralLink: 'http://localhost/waitlist?ref=ABC123',
                waitlistedUserId: 'wl-user-123',
            });
            // email not configured → skip OTP
            mockEmailConfigService.isEmailConfigured.mockReturnValue(false);
            // Stored referral code from localStorage
            mockWaitlistService.getReferralCodeFromStorage.mockReturnValue('REF_FROM_STORAGE');
            mockWaitlistService.confirmWithoutOtp.mockResolvedValue({
                queuePosition: 7,
                totalSignups: 42,
            });

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            expect(mockWaitlistService.confirmWithoutOtp).toHaveBeenCalledWith(
                'test-flow',
                'user123',
                'REF_FROM_STORAGE',
            );
            // Success step should show the queue position from confirmWithoutOtp
            expect(container.querySelector('.waitlist-success-step')).toBeTruthy();
            expect(container.innerHTML).toContain('#7');
        });

        it('should call confirmWithoutOtp with empty string when no stored referral code', async () => {
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user456',
                referralCode: 'XYZ789',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(false);
            mockWaitlistService.getReferralCodeFromStorage.mockReturnValue(null);
            mockWaitlistService.confirmWithoutOtp.mockResolvedValue({
                queuePosition: 3,
                totalSignups: 10,
            });

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            expect(mockWaitlistService.confirmWithoutOtp).toHaveBeenCalledWith(
                'test-flow',
                'user456',
                '',
            );
            expect(container.querySelector('.waitlist-success-step')).toBeTruthy();
        });

        it('should clear referral code from storage after skip-OTP signup (regression: stale referral)', async () => {
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user789',
                referralCode: 'CODE789',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(false);
            mockWaitlistService.getReferralCodeFromStorage.mockReturnValue('SOME_REF');
            mockWaitlistService.confirmWithoutOtp.mockResolvedValue({
                queuePosition: 2,
                totalSignups: 5,
            });

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            expect(mockWaitlistService.clearReferralCodeFromStorage).toHaveBeenCalled();
        });

        it('should clear referral code from storage after OTP verification (regression: wrong key)', async () => {
            // 1. Submit form to get to verify step
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user-otp',
                verificationCode: '123456',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // 2. Enter OTP and verify
            const otpInput = container.querySelector('.waitlist-otp-input') as HTMLInputElement;
            otpInput.value = '123456';
            mockWaitlistService.verifyOtpAndProcessUser.mockResolvedValue({
                success: true,
                data: { queuePosition: 10, totalSignups: 50, referralCode: 'RC', referralLink: '', waitlistedUserId: 'wl' },
            });

            const verifyBtn = container.querySelector('.waitlist-verify-btn') as HTMLButtonElement;
            verifyBtn.click();
            await flushPromises();

            expect(mockWaitlistService.clearReferralCodeFromStorage).toHaveBeenCalled();
        });

        it('should handle API errors during submission', async () => {
            mockWaitlistService.joinWaitlist.mockRejectedValue(new Error('API Error'));

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // Error step
            expect(container.querySelector('.waitlist-error-step')).toBeTruthy();
            expect(container.innerHTML).toContain('API Error');
        });

        it('should verify OTP successfully', async () => {
            // 1. Submit form first to get to verify step
            mockWaitlistService.joinWaitlist.mockResolvedValue({ 
                userId: 'user123',
                verificationCode: '123456'
            });

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // 2. Input OTP
            const otpInput = container.querySelector('.waitlist-otp-input') as HTMLInputElement;
            otpInput.value = '123456';
            // Do NOT dispatch input event to avoid auto-submit, so we can test the button click
            
            // 3. Click Verify
            const verifyBtn = container.querySelector('.waitlist-verify-btn') as HTMLButtonElement;
            
            mockWaitlistService.verifyOtpAndProcessUser.mockResolvedValue({
                success: true,
                data: {
                    queuePosition: 5,
                    totalSignups: 100
                }
            });

            verifyBtn.click();
            await flushPromises();

            expect(mockWaitlistService.verifyOtpAndProcessUser).toHaveBeenCalledWith(
                'test-flow', 'user123', '123456', expect.any(Object)
            );
            
            // Success step
            expect(container.querySelector('.waitlist-success-step')).toBeTruthy();
            expect(container.innerHTML).toContain('#5');
        });

        it('should handle invalid OTP', async () => {
             // 1. Submit form first
            mockWaitlistService.joinWaitlist.mockResolvedValue({ userId: 'user123' });
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

             // 2. Input OTP and Click Verify
             const otpInput = container.querySelector('.waitlist-otp-input') as HTMLInputElement;
             otpInput.value = '000000';
             // Do NOT dispatch input event
             
             mockWaitlistService.verifyOtpAndProcessUser.mockResolvedValue({
                success: false,
                message: 'Invalid code'
            });

            const verifyBtn = container.querySelector('.waitlist-verify-btn') as HTMLButtonElement;
            verifyBtn.click();
            await flushPromises();

            // Should remain on verify step and show error
             expect(container.querySelector('.waitlist-verify-step')).toBeTruthy();
             const errorMsg = container.querySelector('.waitlist-error-msg');
             expect(errorMsg?.textContent).toBe('Invalid code');
        });

        it('should resend OTP', async () => {
            // 1. Submit form first
            mockWaitlistService.joinWaitlist.mockResolvedValue({ userId: 'user123' });
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // 2. Click Resend
            const resendBtn = container.querySelector('.waitlist-resend-btn') as HTMLButtonElement;
            resendBtn.click();
            
            await flushPromises();

            expect(mockWaitlistService.resendVerificationCode).toHaveBeenCalledWith('test-flow', 'user123');
            expect(container.querySelector('.waitlist-success-msg')).toBeTruthy();
        });

        it('should NOT auto-verify when OTP input reaches 6 digits (regression: allow referral code entry)', async () => {
            // 1. Submit form to get to verify step
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user123',
                verificationCode: '123456',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // 2. Type 6 digits in OTP input and fire input event
            const otpInput = container.querySelector('.waitlist-otp-input') as HTMLInputElement;
            otpInput.value = '123456';
            otpInput.dispatchEvent(new Event('input', { bubbles: true }));
            await flushPromises();

            // 3. Verify should NOT have been called — user must click the button
            expect(mockWaitlistService.verifyOtpAndProcessUser).not.toHaveBeenCalled();
            // Still on the verify step
            expect(container.querySelector('.waitlist-verify-step')).toBeTruthy();
        });

        it('should only verify OTP when the Verify button is clicked (not on input)', async () => {
            // 1. Submit form to get to verify step
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user123',
                verificationCode: '123456',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // 2. Type 6 digits — should NOT auto-verify
            const otpInput = container.querySelector('.waitlist-otp-input') as HTMLInputElement;
            otpInput.value = '123456';
            otpInput.dispatchEvent(new Event('input', { bubbles: true }));
            await flushPromises();
            expect(mockWaitlistService.verifyOtpAndProcessUser).not.toHaveBeenCalled();

            // 3. Now click the verify button — THIS should trigger verification
            mockWaitlistService.verifyOtpAndProcessUser.mockResolvedValue({
                success: true,
                data: { queuePosition: 5, totalSignups: 100 },
            });
            const verifyBtn = container.querySelector('.waitlist-verify-btn') as HTMLButtonElement;
            verifyBtn.click();
            await flushPromises();

            expect(mockWaitlistService.verifyOtpAndProcessUser).toHaveBeenCalledTimes(1);
            expect(container.querySelector('.waitlist-success-step')).toBeTruthy();
        });

        it('should allow entering referral code before clicking Verify', async () => {
            // 1. Submit form to get to verify step
            mockWaitlistService.joinWaitlist.mockResolvedValue({
                userId: 'user123',
                verificationCode: '123456',
            });
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);

            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            await flushPromises();

            // 2. Enter OTP and referral code
            const otpInput = container.querySelector('.waitlist-otp-input') as HTMLInputElement;
            otpInput.value = '123456';

            const referralInput = container.querySelector('.waitlist-referral-input') as HTMLInputElement;
            expect(referralInput).toBeTruthy();
            referralInput.value = 'REF123';

            // 3. Click verify — should include the referral code
            mockWaitlistService.verifyOtpAndProcessUser.mockResolvedValue({
                success: true,
                data: { queuePosition: 5, totalSignups: 100 },
            });
            const verifyBtn = container.querySelector('.waitlist-verify-btn') as HTMLButtonElement;
            verifyBtn.click();
            await flushPromises();

            expect(mockWaitlistService.verifyOtpAndProcessUser).toHaveBeenCalledWith(
                'test-flow', 'user123', '123456',
                expect.objectContaining({ referredBy: 'REF123' })
            );
        });
    });

    describe('Form Submission Integration', () => {
        it('should collect metadata and join waitlist on submit', async () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <form data-waitlist-form data-waitlist-id="test-waitlist">
                    <input name="email" value="test@example.com" />
                    <button type="submit">Submit</button>
                </form>
            `;

            // Mock metadata collection result
            const mockMetadata = { utmSource: 'test' };
            mockMetadataService.collectAllMetadata.mockResolvedValue(mockMetadata);

            // Init forms to bind listeners
            await service.initWaitlistForms(container);

            const form = container.querySelector('form')!;
            
            // Simulate submit
            const submitEvent = new Event('submit', { cancelable: true });
            form.dispatchEvent(submitEvent);

            // Wait for async operations (using generic delay or flushing if possible, 
            // but since we don't have fakeAsync here easily with vitest/this setup, 
            // we rely on the fact that handleFormSubmit is async void)
            
            // To properly await the async handler which isn't returned, 
            // we simulate a small delay or rely on spy calls if they happened synchronously enough (they involve awaits though).
            // A better way is to spy on the internal method if public, but handleFormSubmit is private.
            // We can wait a tick.
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockMetadataService.collectAllMetadata).toHaveBeenCalled();
            expect(mockWaitlistService.joinWaitlist).toHaveBeenCalledWith(
                'test-waitlist',
                expect.objectContaining({
                    email: 'test@example.com',
                    signupMetadata: mockMetadata
                })
            );
        });
    });
});
