/**
 * Waitlist Store
 * 
 * NgRx Signals store for managing waitlist state.
 */

import { computed, inject, Injectable, signal } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { IWaitlist, IWaitlistUser, StepType, IVerifyOtpResult } from './waitlist.model';
import { WaitlistService } from './waitlist.service';

/**
 * State interface for waitlist store
 */
export interface WaitlistState {
    currentWaitlist: IWaitlist | null;
    currentUser: IWaitlistUser | null;
    currentStep: StepType;
    loading: boolean;
    error: string;
    successData: IVerifyOtpResult | null;
    existingUserData: IWaitlistUser | null;
    userId: string;
    alreadyVerified: boolean;
}

/**
 * Initial state
 */
const initialState: WaitlistState = {
    currentWaitlist: null,
    currentUser: null,
    currentStep: 'signup',
    loading: false,
    error: '',
    successData: null,
    existingUserData: null,
    userId: '',
    alreadyVerified: false,
};

/**
 * Waitlist Store using NgRx Signals
 */
export const WaitlistStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withComputed((state) => ({
        isSignupStep: computed(() => state.currentStep() === 'signup'),
        isVerifyStep: computed(() => state.currentStep() === 'verify'),
        isSuccessStep: computed(() => state.currentStep() === 'success'),
        isExistingUserStep: computed(() => state.currentStep() === 'existing-user'),
        isErrorStep: computed(() => state.currentStep() === 'error'),
        waitlistTitle: computed(() => state.currentWaitlist()?.uiConfig?.title || 'Join the Waitlist'),
        waitlistDescription: computed(() => state.currentWaitlist()?.uiConfig?.description || 'Be the first to know when we launch'),
        waitlistButtonText: computed(() => state.currentWaitlist()?.uiConfig?.buttonText || 'Join Waitlist'),
        waitlistTheme: computed(() => state.currentWaitlist()?.uiConfig?.theme || 'light'),
    })),
    withMethods((store, waitlistService = inject(WaitlistService)) => ({
        /**
         * Load waitlist by ID
         */
        async loadWaitlist(waitlistId: string): Promise<void> {
            patchState(store, { loading: true, error: '' });
            try {
                const waitlist = await waitlistService.getWaitlist(waitlistId);
                patchState(store, { currentWaitlist: waitlist, loading: false });
            } catch (error) {
                patchState(store, {
                    error: error instanceof Error ? error.message : 'Failed to load waitlist',
                    loading: false,
                });
            }
        },

        /**
         * Join waitlist
         */
        async joinWaitlist(waitlistId: string, userData: Partial<IWaitlistUser>): Promise<void> {
            patchState(store, { loading: true, error: '' });
            try {
                const result = await waitlistService.joinWaitlist(waitlistId, userData);

                if ((result as Record<string, unknown>)['error']) {
                    patchState(store, {
                        error: (result as Record<string, unknown>)['message'] as string,
                        currentStep: 'error',
                        loading: false,
                    });
                    return;
                }

                if (result.exists && result.verified) {
                    // Existing verified user
                    patchState(store, {
                        existingUserData: result.userData || null,
                        currentStep: 'existing-user',
                        userId: result.userId || '',
                        alreadyVerified: true,
                        loading: false,
                    });
                } else {
                    // New user or unverified - go to OTP step
                    patchState(store, {
                        userId: result.userId || '',
                        currentUser: { email: result.email } as IWaitlistUser,
                        currentStep: 'verify',
                        alreadyVerified: false,
                        loading: false,
                    });
                }
            } catch (error) {
                patchState(store, {
                    error: error instanceof Error ? error.message : 'Failed to join waitlist',
                    currentStep: 'error',
                    loading: false,
                });
            }
        },

        /**
         * Verify OTP
         */
        async verifyOtp(waitlistId: string, otp: string, userData: Partial<IWaitlistUser>): Promise<void> {
            patchState(store, { loading: true, error: '' });
            try {
                const result = await waitlistService.verifyOtpAndProcessUser(
                    waitlistId,
                    store.userId(),
                    otp,
                    userData,
                );

                if (result.success && result.data) {
                    patchState(store, {
                        successData: result.data as IVerifyOtpResult,
                        currentStep: 'success',
                        loading: false,
                    });
                } else {
                    patchState(store, {
                        error: result.message || 'Verification failed',
                        loading: false,
                    });
                }
            } catch (error) {
                patchState(store, {
                    error: error instanceof Error ? error.message : 'Verification failed',
                    loading: false,
                });
            }
        },

        /**
         * Resend OTP
         */
        async resendOtp(waitlistId: string): Promise<void> {
            patchState(store, { loading: true, error: '' });
            try {
                await waitlistService.resendVerificationCode(waitlistId, store.userId());
                patchState(store, { loading: false });
            } catch (error) {
                patchState(store, {
                    error: error instanceof Error ? error.message : 'Failed to resend code',
                    loading: false,
                });
            }
        },

        /**
         * Set current step
         */
        setStep(step: StepType): void {
            patchState(store, { currentStep: step, error: '' });
        },

        /**
         * Set error
         */
        setError(error: string): void {
            patchState(store, { error });
        },

        /**
         * Reset to signup
         */
        resetToSignup(): void {
            patchState(store, {
                currentStep: 'signup',
                error: '',
                userId: '',
                currentUser: null,
                successData: null,
                existingUserData: null,
                alreadyVerified: false,
            });
        },

        /**
         * Go back to signup from verify
         */
        goBack(): void {
            patchState(store, { currentStep: 'signup', error: '' });
        },

        /**
         * Reset store to initial state
         */
        reset(): void {
            patchState(store, initialState);
        },
    })),
);

/**
 * Injectable wrapper for the store
 */
@Injectable({ providedIn: 'root' })
export class WaitlistStoreService {
    readonly store = inject(WaitlistStore);
}
