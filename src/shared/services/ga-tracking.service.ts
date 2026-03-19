/**
 * Google Analytics Tracking Service
 *
 * Centralized service for custom event tracking and user session management
 * using Firebase/Google Analytics 4.
 */
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Analytics, logEvent, setUserId, setUserProperties } from '@angular/fire/analytics';

export type WaitlistFunnelEvent =
    | 'waitlist_view'
    | 'waitlist_form_start'
    | 'waitlist_signup_submit'
    | 'waitlist_otp_send'
    | 'waitlist_otp_verify'
    | 'waitlist_signup_complete'
    | 'waitlist_existing_user'
    | 'waitlist_error'
    | 'waitlist_form_abandon';

@Injectable({ providedIn: 'root' })
export class GaTrackingService {
    private analytics = inject(Analytics, { optional: true });
    private platformId = inject(PLATFORM_ID);

    private initialized = false;

    /** Initialize tracking - call once on app startup */
    initializeTracking(): void {
        if (!isPlatformBrowser(this.platformId) || this.initialized || !this.analytics) return;

        this.trackUtmParameters();
        this.initialized = true;
    }

    private trackUtmParameters(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        const params = new URLSearchParams(window.location.search);
        const utmParams: Record<string, string> = {};

        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((param) => {
            const value = params.get(param);
            if (value) utmParams[param] = value;
        });

        const refCode = params.get('ref');
        if (refCode) {
            utmParams['referral_code'] = refCode;
            this.trackEvent('referral_code_used', { referral_code: refCode });
        }

        if (Object.keys(utmParams).length > 0 && this.analytics) {
            setUserProperties(this.analytics, utmParams);
        }
    }

    // ========== PUBLIC PAGE EVENTS ==========

    trackContentListView(contentType: string, itemCount: number): void {
        this.trackEvent('content_list_view', { content_type: contentType, item_count: itemCount });
    }

    trackContentDetailView(contentType: string, contentSlug: string, contentTitle: string): void {
        this.trackEvent('content_detail_view', {
            content_type: contentType,
            content_slug: contentSlug,
            content_title: contentTitle,
        });
    }

    trackPublicPageView(fileName: string): void {
        this.trackEvent('public_page_view', { page_name: fileName });
    }

    trackShareClick(platform: string, contentSlug: string): void {
        this.trackEvent('share_click', { platform, content_slug: contentSlug });
    }

    // ========== WAITLIST FUNNEL EVENTS ==========

    trackWaitlistView(waitlistId: string, waitlistName?: string): void {
        this.trackEvent('waitlist_view', { waitlist_id: waitlistId, waitlist_name: waitlistName });
    }

    trackWaitlistFormStart(waitlistId: string): void {
        this.trackEvent('waitlist_form_start', { waitlist_id: waitlistId });
    }

    trackWaitlistSignupSubmit(waitlistId: string, hasReferral: boolean): void {
        this.trackEvent('waitlist_signup_submit', { waitlist_id: waitlistId, has_referral: hasReferral });
    }

    trackWaitlistOtpSend(waitlistId: string, isResend = false): void {
        this.trackEvent('waitlist_otp_send', { waitlist_id: waitlistId, is_resend: isResend });
    }

    trackWaitlistOtpVerify(waitlistId: string, success: boolean): void {
        this.trackEvent('waitlist_otp_verify', { waitlist_id: waitlistId, success });
    }

    trackWaitlistSignupComplete(waitlistId: string, queuePosition: number, referredBy?: string): void {
        this.trackEvent('waitlist_signup_complete', {
            waitlist_id: waitlistId,
            queue_position: queuePosition,
            referred_by: referredBy || 'none',
        });
    }

    trackWaitlistExistingUser(waitlistId: string, queuePosition: number): void {
        this.trackEvent('waitlist_existing_user', { waitlist_id: waitlistId, queue_position: queuePosition });
    }

    trackWaitlistError(waitlistId: string, errorType: string, errorMessage: string): void {
        this.trackEvent('waitlist_error', {
            waitlist_id: waitlistId,
            error_type: errorType,
            error_message: errorMessage,
        });
    }

    // ========== REFERRAL EVENTS ==========

    trackReferralLinkCopy(waitlistId: string, referralCode: string): void {
        this.trackEvent('referral_link_copy', { waitlist_id: waitlistId, referral_code: referralCode });
    }

    trackLeaderboardView(waitlistId: string, userId?: string): void {
        this.trackEvent('leaderboard_view', { waitlist_id: waitlistId, user_id: userId });
    }

    trackUnsubscribeView(waitlistId: string, userId?: string): void {
        this.trackEvent('unsubscribe_view', { waitlist_id: waitlistId, user_id: userId });
    }

    /** Link anonymous user to registered user after signup */
    linkUserAfterSignup(userId: string, email: string, waitlistId: string): void {
        if (!this.analytics) return;
        setUserId(this.analytics, userId);
        setUserProperties(this.analytics, {
            user_email_domain: email.split('@')[1],
            primary_waitlist: waitlistId,
        });
    }

    private trackEvent(eventName: string, params?: Record<string, unknown>): void {
        if (!isPlatformBrowser(this.platformId) || !this.analytics) return;

        try {
            logEvent(this.analytics, eventName, {
                ...params,
                timestamp: Date.now(),
            });
        } catch (error) {
            console.warn(`GA event "${eventName}" failed:`, error);
        }
    }
}
