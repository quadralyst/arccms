/**
 * Tests for WaitlistComponent
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WaitlistComponent } from './waitlist.component';
import { WaitlistService } from './waitlist.service';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { EmailConfigStatusService } from '../../../shared/services/email-config-status.service';
import { Firestore } from '@angular/fire/firestore';

describe('WaitlistComponent', () => {
    let component: WaitlistComponent;
    let fixture: ComponentFixture<WaitlistComponent>;
    let mockWaitlistService: any;
    let mockGaTrackingService: any;
    let mockEmailConfigService: any;

    beforeEach(async () => {
        mockWaitlistService = {
            getWaitlist: vi.fn(),
            getWaitlistBySlug: vi.fn(),
            createWaitlistWithId: vi.fn(),
            joinWaitlist: vi.fn(),
            verifyAndConfirm: vi.fn(),
            confirmWithoutOtp: vi.fn().mockResolvedValue({ success: true, alreadyConfirmed: false }),
            resendVerificationCode: vi.fn().mockResolvedValue({ success: true, message: '' }),
            getFirstNameFromEmail: vi.fn().mockReturnValue('TestUser'),
        };

        mockGaTrackingService = {
            trackWaitlistView: vi.fn(),
            trackWaitlistFormStart: vi.fn(),
            trackWaitlistSignupSubmit: vi.fn(),
            trackWaitlistOtpVerify: vi.fn(),
            trackWaitlistSignupComplete: vi.fn(),
            trackWaitlistExistingUser: vi.fn(),
            trackWaitlistError: vi.fn(),
            linkUserAfterSignup: vi.fn(),
            logEvent: vi.fn(),
        };

        mockEmailConfigService = {
            isEmailConfigured: vi.fn().mockReturnValue(true),
            isLoading: vi.fn().mockReturnValue(false),
            bannerDismissed: vi.fn().mockReturnValue(false),
            shouldShowBanner: vi.fn().mockReturnValue(false),
            dismissBanner: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [WaitlistComponent, ReactiveFormsModule, BrowserAnimationsModule],
            providers: [
                { provide: WaitlistService, useValue: mockWaitlistService },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService },
                { provide: Firestore, useValue: {} },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: of({ get: () => 'default' }),
                        queryParamMap: of({ get: () => null }),
                        snapshot: {
                            queryParamMap: { get: () => null }
                        }
                    }
                }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(WaitlistComponent);
        component = fixture.componentInstance;
        // Do not verify calls yet as determineWaitlistId is called in ngOnInit
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('loadWaitlist', () => {
        it('should load existing waitlist by ID if found', async () => {
            const mockData = { id: 'default', slug: 'default', name: 'Default' };
            mockWaitlistService.getWaitlist.mockResolvedValue(mockData);

            await component.loadWaitlist('default');

            expect(mockWaitlistService.getWaitlist).toHaveBeenCalledWith('default');
            expect(component.waitlist()).toEqual(mockData);
        });

        it('should check by slug if ID lookup fails', async () => {
            mockWaitlistService.getWaitlist.mockResolvedValue(null); // ID check fails
            const mockData = { id: 'default', slug: 'default', name: 'Default' };
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue(mockData); // Slug check succeeds

            await component.loadWaitlist('default');

            expect(mockWaitlistService.getWaitlist).toHaveBeenCalledWith('default');
            expect(mockWaitlistService.getWaitlistBySlug).toHaveBeenCalledWith('default');
            expect(component.waitlist()).toEqual(mockData);
        });

        it('should create new waitlist with ID if neither ID nor Slug found', async () => {
            mockWaitlistService.getWaitlist.mockResolvedValue(null);
            mockWaitlistService.getWaitlistBySlug.mockResolvedValue(null);

            // Mock subsequent load to succeed
            const mockData = { id: 'new-id', slug: 'new-id', name: 'New' };
            mockWaitlistService.createWaitlistWithId.mockImplementation(() => {
                // After creation, subsequent getWaitlist should return data
                mockWaitlistService.getWaitlist.mockResolvedValue(mockData);
                return Promise.resolve();
            });

            await component.loadWaitlist('new-id');

            expect(mockWaitlistService.createWaitlistWithId).toHaveBeenCalledWith(
                'new-id',
                expect.objectContaining({ slug: 'new-id' })
            );
        });

        describe('error handling', () => {
            beforeEach(() => {
                // Both lookups reject → triggers the catch block in loadWaitlist()
                mockWaitlistService.getWaitlist.mockRejectedValue(new Error('Network failed'));
                mockWaitlistService.getWaitlistBySlug.mockRejectedValue(new Error('Network failed'));
            });

            it('should set currentStep to error when failure occurs while on signup step', async () => {
                component.currentStep = 'signup';
                await component.loadWaitlist('test-id');
                expect(component.currentStep).toBe('error');
                expect(component.error).toBe('Failed to load waitlist data');
            });

            it('should NOT overwrite currentStep when user is already on verify step (regression: "Something went wrong" flash)', async () => {
                // loadWaitlist() can still be in-flight when onSignup() succeeds and sets
                // currentStep = 'verify'. Without the guard it would flash "Something went wrong".
                component.currentStep = 'verify';
                component.error = '';
                await component.loadWaitlist('test-id');
                expect(component.currentStep).toBe('verify');
                expect(component.error).toBe('');
            });

            it('should NOT overwrite currentStep when user is already on success step', async () => {
                component.currentStep = 'success';
                await component.loadWaitlist('test-id');
                expect(component.currentStep).toBe('success');
            });
        });
    });

    describe('onSignup, skip-OTP path', () => {
        beforeEach(async () => {
            // Trigger ngOnInit to initialize forms
            fixture.detectChanges();

            // Set up a valid waitlist so onSignup can proceed
            const mockWaitlist = { id: 'test-waitlist', slug: 'test', name: 'Test' };
            mockWaitlistService.getWaitlist.mockResolvedValue(mockWaitlist);
            await component.loadWaitlist('test-waitlist');

            component.signupForm.setValue({ firstName: 'Alice', email: 'alice@test.com' });
            mockWaitlistService.joinWaitlist.mockResolvedValue({ userId: 'user-123' });
        });

        it('should skip OTP and go directly to success when email is not configured', async () => {
            mockEmailConfigService.isEmailConfigured.mockReturnValue(false);

            await component.onSignup({});

            expect(mockWaitlistService.confirmWithoutOtp).toHaveBeenCalledWith('test-waitlist', 'user-123');
            expect(component.currentStep).toBe('success');
            expect(mockGaTrackingService.trackWaitlistSignupComplete).toHaveBeenCalledWith('test-waitlist');
        });

        it('shows "already on the list" for someone confirmed before', async () => {
            mockEmailConfigService.isEmailConfigured.mockReturnValue(false);
            mockWaitlistService.confirmWithoutOtp.mockResolvedValue({ success: true, alreadyConfirmed: true });

            await component.onSignup({});

            expect(component.currentStep).toBe('existing-user');
            expect(mockGaTrackingService.trackWaitlistExistingUser).toHaveBeenCalledWith('test-waitlist');
        });

        it('should go to verify step when email IS configured', async () => {
            mockEmailConfigService.isEmailConfigured.mockReturnValue(true);

            await component.onSignup({});

            expect(mockWaitlistService.confirmWithoutOtp).not.toHaveBeenCalled();
            expect(component.currentStep).toBe('verify');
        });
    });

    describe('the code step', () => {
        beforeEach(async () => {
            fixture.detectChanges();
            mockWaitlistService.getWaitlist.mockResolvedValue({ id: 'test-waitlist', slug: 'test', name: 'Test' });
            await component.loadWaitlist('test-waitlist');
            component.signupForm.setValue({ firstName: 'Alice', email: 'alice@test.com' });
            mockWaitlistService.joinWaitlist.mockResolvedValue({ userId: 'user-123' });
            await component.onSignup({});
            component.otpForm.setValue({ otpCode: '123456' });
        });

        it('checks the code against the address typed, then shows the plain confirmation', async () => {
            mockWaitlistService.verifyAndConfirm.mockResolvedValue({ success: true, alreadyConfirmed: false });

            await component.onVerifyOtp();

            expect(mockWaitlistService.verifyAndConfirm).toHaveBeenCalledWith('test-waitlist', 'user-123', 'alice@test.com', '123456');
            expect(component.currentStep).toBe('success');
            fixture.detectChanges();
            const text = (fixture.nativeElement as HTMLElement).textContent || '';
            expect(text).toContain('We\'ll be in touch at alice@test.com.');
            expect(text).not.toMatch(/Leaderboard|Referral|Position/i);
        });

        it('stays on the code step with the server\'s message for a wrong code', async () => {
            mockWaitlistService.verifyAndConfirm.mockResolvedValue({ success: false, message: 'Wrong code' });

            await component.onVerifyOtp();

            expect(component.currentStep).toBe('verify');
            expect(component.error).toBe('Wrong code');
        });

        it('has no referral code box', () => {
            fixture.detectChanges();
            expect((fixture.nativeElement as HTMLElement).querySelector('[formcontrolname="referralCode"]')).toBeNull();
        });

        it('resends the code to the address typed', async () => {
            await component.resendOtp();
            expect(mockWaitlistService.resendVerificationCode).toHaveBeenCalledWith('test-waitlist', 'alice@test.com', 'Alice');
        });
    });
});
