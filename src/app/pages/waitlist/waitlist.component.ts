/**
 * Waitlist Component
 * 
 * Parent container for the waitlist signup flow.
 * Supports both standalone mode (full page) and child mode (embedded).
 */

import { animate, query, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import {
    ChangeDetectorRef,
    Component,
    Input,
    OnInit,
    OnChanges,
    SimpleChanges,
    inject,
    signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { WaitlistService } from './waitlist.service';
import { IWaitlist, StepType, DEFAULT_UI_CONFIG } from './waitlist.model';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { EmailConfigStatusService } from '../../../shared/services/email-config-status.service';

@Component({
    selector: 'arc-waitlist',
    templateUrl: './waitlist.component.html',
    styleUrls: ['./waitlist.component.scss'],
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterLink],
    animations: [
        trigger('stepSlider', [
            transition('signup => verify', [
                style({ position: 'relative' }),
                query(':enter', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: 'translateX(100%)',
                        opacity: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    animate('500ms ease-in-out', style({
                        transform: 'translateX(-100%)',
                        opacity: 0,
                    })),
                ], { optional: true }),
                query(':enter', [
                    animate('500ms ease-in-out', style({
                        transform: 'translateX(0%)',
                        opacity: 1,
                    })),
                ], { optional: true }),
            ]),
            transition('verify => success', [
                style({ position: 'relative' }),
                query(':enter', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: 'translateX(100%)',
                        opacity: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    animate('500ms ease-in-out', style({
                        transform: 'translateX(-100%)',
                        opacity: 0,
                    })),
                ], { optional: true }),
                query(':enter', [
                    animate('500ms ease-in-out', style({
                        transform: 'translateX(0%)',
                        opacity: 1,
                    })),
                ], { optional: true }),
            ]),
            transition('* => signup', [
                style({ position: 'relative' }),
                query(':enter', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: 'translateX(-100%)',
                        opacity: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    animate('500ms ease-in-out', style({
                        transform: 'translateX(100%)',
                        opacity: 0,
                    })),
                ], { optional: true }),
                query(':enter', [
                    animate('500ms ease-in-out', style({
                        transform: 'translateX(0%)',
                        opacity: 1,
                    })),
                ], { optional: true }),
            ]),
            transition('* => *', [
                style({ position: 'relative' }),
                query(':enter', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        transform: 'translateY(50px)',
                        opacity: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    style({
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                    }),
                ], { optional: true }),
                query(':leave', [
                    animate('400ms ease-in-out', style({
                        transform: 'translateY(-50px)',
                        opacity: 0,
                    })),
                ], { optional: true }),
                query(':enter', [
                    animate('400ms ease-in-out', style({
                        transform: 'translateY(0)',
                        opacity: 1,
                    })),
                ], { optional: true }),
            ]),
        ]),
    ],
})
export class WaitlistComponent extends BaseComponent implements OnInit, OnChanges {
    @Input() waitlistIdInput: string | null = null;

    private waitlistService = inject(WaitlistService);
    private fb = inject(FormBuilder);
    private route = inject(ActivatedRoute);
    private cdr = inject(ChangeDetectorRef);
    private gaTracking = inject(GaTrackingService);
    private emailConfigService = inject(EmailConfigStatusService);

    // Form properties
    signupForm!: FormGroup;
    otpForm!: FormGroup;

    // State management
    currentStep: StepType = 'signup';
    loading = false;
    error = '';
    hasReferralCode = false;
    childLoaded = false;

    // Waitlist properties
    currentWaitlistId: string | null = null;
    theme = 'light';
    title = DEFAULT_UI_CONFIG.title;
    description = DEFAULT_UI_CONFIG.description;
    buttonText = DEFAULT_UI_CONFIG.buttonText;
    totalSignups = 0;

    // User data
    userData: Record<string, unknown> = {};
    successData: Record<string, unknown> = {};
    existingUserData: Record<string, unknown> = {};
    userId = '';

    waitlist = signal<IWaitlist | null>(null);
    alreadyVerified = signal<boolean>(false);

    /**
     * Whether to show referral link, leaderboard, and queue position (U3).
     * Defaults to true so existing waitlists are unchanged; only an explicit
     * `gamificationEnabled: false` turns this into a plain signup form.
     */
    get showGamification(): boolean {
        return this.waitlist()?.gamificationEnabled !== false;
    }

    get isUsedAsChild(): boolean {
        return !!this.waitlistIdInput;
    }

    get isStandalone(): boolean {
        return !this.waitlistIdInput;
    }

    ngOnInit(): void {
        this.initializeForms();
        this.determineWaitlistId();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['waitlistIdInput']) {
            this.determineWaitlistId();
        }
    }

    private initializeForms(): void {
        // Get referral code from URL or localStorage
        let referralCode = this.route.snapshot.queryParamMap.get('ref');

        if (!referralCode) {
            referralCode = this.waitlistService.getReferralCodeFromStorage();
        } else {
            this.waitlistService.storeReferralCodeWithExpiration(referralCode);
        }

        this.hasReferralCode = !!referralCode;

        this.signupForm = this.fb.group({
            firstName: ['', Validators.required],
            email: ['', [Validators.required, Validators.email]],
        });

        this.otpForm = this.fb.group({
            otpCode: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
            referralCode: [referralCode || ''],
        });
    }

    private determineWaitlistId(): void {
        this.route.paramMap.subscribe((params) => {
            const routeWaitlistId = params.get('waitlistId');

            let finalWaitlistId = this.waitlistIdInput || routeWaitlistId;

            if (!finalWaitlistId && this.isStandalone) {
                finalWaitlistId = 'default';
            }

            if (finalWaitlistId && finalWaitlistId !== this.currentWaitlistId) {
                this.currentWaitlistId = finalWaitlistId;
                this.loadWaitlist(finalWaitlistId);
            } else if (!finalWaitlistId) {
                this.error = 'Invalid waitlist configuration - no waitlist ID provided';
                this.currentStep = 'error';
            }
        });

        this.route.queryParamMap.subscribe((queryParams) => {
            const referralCode = queryParams.get('ref');
            if (this.otpForm && referralCode) {
                this.otpForm.patchValue({ referralCode });
            }
        });
    }

    async loadWaitlist(waitlistId: string): Promise<void> {
        try {
            // First try to get by ID
            let waitlistData = await this.waitlistService.getWaitlist(waitlistId);

            // If not found by ID, try to get by Slug
            if (!waitlistData) {
                waitlistData = await this.waitlistService.getWaitlistBySlug(waitlistId);
            }

            if (waitlistData) {
                this.currentWaitlistId = waitlistData.id; // Update current ID in case we found it by slug
                this.waitlist.set(waitlistData);
                this.title = waitlistData.uiConfig?.title || this.title;
                this.description = waitlistData.uiConfig?.description || this.description;
                this.buttonText = waitlistData.uiConfig?.buttonText || this.buttonText;
                this.totalSignups = waitlistData.totalSignups || 0;
                // Track waitlist view
                this.gaTracking.trackWaitlistView(waitlistData.id, waitlistData.name);
            } else {
                await this.createDefaultWaitlist(waitlistId);
            }
        } catch (error) {
            console.error('Error loading waitlist:', error);
            // Only show the error screen if the user hasn't already progressed past signup.
            // loadWaitlist() can run concurrently with onSignup() — if it fails after the
            // user has already moved to 'verify' or 'success', don't clobber their step.
            if (this.currentStep === 'signup') {
                this.error = 'Failed to load waitlist data';
                this.currentStep = 'error';
            }
        }
    }

    private async createDefaultWaitlist(waitlistId: string): Promise<void> {
        try {
            const formattedTitle = waitlistId
                .split('-')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            const data: Partial<IWaitlist> = {
                name: formattedTitle,
                slug: waitlistId,
                description: this.description,
                isActive: true,
                startingPoint: 1000,
                totalSignups: 0,
                uiConfig: {
                    ...DEFAULT_UI_CONFIG,
                    title: formattedTitle,
                },
            };

            // Use createWaitlistWithId to ensure ID matches slug and prevent duplicates
            await this.waitlistService.createWaitlistWithId(waitlistId, data);
            await this.loadWaitlist(waitlistId);
        } catch (error) {
            console.error('Error creating waitlist:', error);
        }
    }

    async onSignupSubmit(): Promise<void> {
        await this.onSignup({});
    }

    async onSignup(formData: Record<string, unknown>): Promise<void> {
        if (this.signupForm.valid && !this.loading) {
            this.loading = true;
            this.error = '';
            // Track signup submit
            this.gaTracking.trackWaitlistSignupSubmit(
                this.currentWaitlistId!,
                !!this.otpForm.get('referralCode')?.value
            );

            try {
                const formValue = this.signupForm.value;
                const { firstName, email } = formValue;

                if (!email) {
                    throw new Error('Email is required');
                }

                if (!this.currentWaitlistId) {
                    throw new Error('Waitlist ID is missing');
                }

                let finalFirstName = firstName;
                if (!finalFirstName || finalFirstName.trim() === '') {
                    finalFirstName = this.waitlistService.getFirstNameFromEmail(email);
                }

                const result = await this.waitlistService.joinWaitlist(this.currentWaitlistId, {
                    ...formData,
                    firstName: finalFirstName.trim(),
                    email: email.trim(),
                });

                if ((result as Record<string, unknown>)['isExisting'] && (result as Record<string, unknown>)['emailVerified']) {
                    this.alreadyVerified.set(true);
                    this.otpForm.get('referralCode')?.setValue('');
                }

                if ((result as Record<string, unknown>)['error']) {
                    this.error = (result as Record<string, unknown>)['message'] as string;
                    this.currentStep = 'error';
                    this.cdr.detectChanges();
                    return;
                }

                this.userData = { email, firstName };
                this.userId = result.userId || '';

                // Check if OTP should be skipped (email not configured)
                const shouldSkipOtp = !this.emailConfigService.isEmailConfigured();

                if (shouldSkipOtp) {
                    // Skip OTP — confirm the user immediately
                    const storedRef = this.waitlistService.getReferralCodeFromStorage();
                    const confirmation = await this.waitlistService.confirmWithoutOtp(
                        this.currentWaitlistId!,
                        this.userId,
                        storedRef || '',
                    );

                    // Clear stored referral code after use
                    this.waitlistService.clearReferralCodeFromStorage();

                    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
                    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
                    this.successData = {
                        queuePosition: confirmation.queuePosition,
                        totalSignups: confirmation.totalSignups,
                        referralCode: (result as any).referralCode || '',
                        referralLink: (result as any).referralLink || `${baseUrl}${pathname}?ref=${(result as any).referralCode || ''}`,
                        totalReferrals: 0,
                        waitlistedUserId: (result as any).waitlistedUserId || this.userId,
                        leaderboardLink: `${baseUrl}/leaderboard/${this.currentWaitlistId}/${(result as any).waitlistedUserId || this.userId}`,
                    };
                    this.currentStep = 'success';
                } else {
                    this.currentStep = 'verify';
                }
                this.cdr.detectChanges();
            } catch (error) {
                console.error('Error initiating signup:', error);
                this.error = error instanceof Error ? error.message : 'Failed to initiate signup. Please try again.';
                this.currentStep = 'error';
            } finally {
                this.loading = false;
            }
        }
    }

    async onVerifyOtp(): Promise<void> {
        if (this.otpForm.valid && !this.loading) {
            this.loading = true;
            try {
                const { otpCode, referralCode } = this.otpForm.value;

                const updatedUserData = {
                    ...this.userData,
                    referredBy: referralCode?.trim() || '',
                    leaderboardLink: typeof window !== 'undefined'
                        ? `${window.location.origin}/leaderboard/${this.userId}`
                        : `/leaderboard/${this.userId}`,
                };

                const result = await this.waitlistService.verifyOtpAndProcessUser(
                    this.currentWaitlistId!,
                    this.userId,
                    otpCode,
                    updatedUserData,
                );

                if (result.success && result.data) {
                    // Track successful OTP verification
                    this.gaTracking.trackWaitlistOtpVerify(this.currentWaitlistId!, true);
                    this.gaTracking.trackWaitlistSignupComplete(
                        this.currentWaitlistId!,
                        (result.data as Record<string, unknown>)['queuePosition'] as number || 0,
                        referralCode
                    );
                    this.gaTracking.linkUserAfterSignup(
                        this.userId,
                        this.userData['email'] as string,
                        this.currentWaitlistId!
                    );

                    this.waitlistService.clearReferralCodeFromStorage();

                    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
                    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

                    if (result.isExistingVerifiedUser) {
                        this.existingUserData = {
                            ...result.data,
                            referralLink: result.data.referralLink ||
                                `${baseUrl}${pathname}?ref=${result.data.referralCode}`,
                            leaderboardLink: result.data.leaderboardLink ||
                                `${baseUrl}/leaderboard/${this.userId}`,
                        };
                        this.gaTracking.trackWaitlistExistingUser(
                            this.currentWaitlistId!,
                            (result.data as Record<string, unknown>)['queuePosition'] as number || 0
                        );
                        this.currentStep = 'existing-user';
                    } else {
                        this.successData = {
                            ...result.data,
                            leaderboardLink: result.data.leaderboardLink ||
                                `${baseUrl}/leaderboard/${this.userId}`,
                            referralLink: result.data.referralLink ||
                                `${baseUrl}${pathname}?ref=${result.data.referralCode}`,
                        };
                        this.currentStep = 'success';
                    }
                } else {
                    // Track failed OTP verification
                    this.gaTracking.trackWaitlistOtpVerify(this.currentWaitlistId!, false);
                    this.gaTracking.trackWaitlistError(
                        this.currentWaitlistId!,
                        'otp_verification_failed',
                        result.message || 'Invalid code'
                    );
                    this.error = result.message || 'Invalid verification code';
                }

                this.cdr.detectChanges();
            } catch (error) {
                console.error('Error verifying OTP:', error);
                this.error = error instanceof Error ? error.message : 'Verification failed';
            } finally {
                this.loading = false;
            }
        }
    }

    async resendOtp(): Promise<void> {
        if (!this.loading) {
            this.loading = true;
            try {
                const result = await this.waitlistService.resendVerificationCode(
                    this.currentWaitlistId!,
                    this.userId,
                );
                if (!result.success) {
                    this.error = result.message || 'Failed to resend code';
                }
            } catch (error) {
                console.error('Error resending OTP:', error);
                this.error = error instanceof Error ? error.message : 'Failed to resend code';
            } finally {
                this.loading = false;
            }
        }
    }

    goBack(): void {
        this.currentStep = 'signup';
        this.otpForm.reset();
        this.router.navigate([]);
        this.cdr.detectChanges();
    }

    resetToSignup(): void {
        this.currentStep = 'signup';
        this.signupForm.reset();
        this.otpForm.reset();
        this.userData = {};
        this.existingUserData = {};
        this.successData = {};
        this.userId = '';
        this.cdr.detectChanges();
    }

    retry(): void {
        this.error = '';
        this.currentStep = 'signup';
        this.cdr.detectChanges();
    }

    async copyToClipboard(text: string): Promise<void> {
        const success = await this.globalService.copyToClipboard(text);
        if (success) {
            // Track referral link copy if applicable
            if (text.includes('ref=')) {
                this.gaTracking.trackReferralLinkCopy(
                    this.currentWaitlistId!,
                    (this.successData['referralCode'] as string) || ''
                );
            }
            this.toastService.success('Copied to clipboard!');
        } else {
            console.error('Failed to copy to clipboard');
        }
    }

    onChildLoaded(): void {
        this.childLoaded = true;
        this.cdr.detectChanges();
    }

    onChildUnloaded(): void {
        this.childLoaded = false;
        this.cdr.detectChanges();
    }
}
