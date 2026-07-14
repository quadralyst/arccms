/**
 * WaitlistFormService
 * 
 * Service for handling waitlist form detection, submission, and multi-step flow.
 * Extracted from PageContentComponent to be used in index.page.ts.
 */

import { inject, Injectable, Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { WaitlistService } from '../waitlist/waitlist.service';
import { IWaitlistFormData, IWaitlist } from '../waitlist/waitlist.model';
import { SignupMetadataService } from '../waitlist/signup-metadata.service';
import { EmailConfigStatusService } from '../../../shared/services/email-config-status.service';
import { GlobalService } from '../../../shared/services/global.service';
import { Firestore, doc, getDoc, collection, getCountFromServer } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { DEFAULT_INTEGRATIONS_SETTINGS, IGeoConfig } from '../admin/(settings)/integrations-setting/integrations-setting.model';

type WaitlistStep = 'signup' | 'verify' | 'success' | 'existing-user' | 'error';

interface WaitlistFormState {
    step: WaitlistStep;
    waitlistId: string;
    email: string;
    firstName: string;
    source: string;
    userId: string;
    originalFormHtml: string;
    formElement: HTMLFormElement;
    queuePosition?: number;
    totalSignups?: number;
    referralCode?: string;
    referralLink?: string;
    totalReferrals?: number;
    error?: string;
    waitlistedUserId?: string;
}

@Injectable({
    providedIn: 'root'
})
export class WaitlistFormService {
    private platformId = inject(PLATFORM_ID);
    private waitlistService = inject(WaitlistService);
    private emailConfigService = inject(EmailConfigStatusService);
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private globalService = inject(GlobalService);
    private metadataService = inject(SignupMetadataService);
    private injector = inject(Injector);

    private formStates = new Map<HTMLFormElement, WaitlistFormState>();
    private defaultWaitlistId = 'default';
    private templOtp: string | null = null;

    /**
     * Check if OTP verification template is enabled for a waitlist.
     * Reads from the Waitlist document (publicly readable) instead of
     * the admin-only EmailTemplate collection.
     * @param waitlistId The waitlist slug to check
     * @returns true if OTP template is active, false otherwise
     */
    private async isOtpTemplateEnabled(waitlistId: string): Promise<boolean> {
        try {
            const waitlistSnap = await runInInjectionContext(this.injector, () => {
                const waitlistRef = doc(this.firestore, 'Waitlists', waitlistId);
                return getDoc(waitlistRef);
            });
            if (waitlistSnap.exists()) {
                // otpEnabled defaults to true when not explicitly set
                return waitlistSnap.data()?.['otpEnabled'] !== false;
            }
            return true;
        } catch (error) {
            console.error('Error checking OTP status:', error);
            return true;
        }
    }

    private getBaseUrl(): string {
        if (!isPlatformBrowser(this.platformId)) return '';
        return window.location.origin;
    }

    /**
     * Fetch geolocation settings from integrations
     */
    private async getGeoSettings(): Promise<IGeoConfig> {
        if (!isPlatformBrowser(this.platformId)) return DEFAULT_INTEGRATIONS_SETTINGS.geo;

        try {
            const docSnap = await runInInjectionContext(this.injector, () => {
                const docRef = doc(this.firestore, 'Settings', 'integrations');
                return getDoc(docRef);
            });
            if (docSnap.exists()) {
                const data = docSnap.data();
                return { ...DEFAULT_INTEGRATIONS_SETTINGS.geo, ...data?.['geo'] };
            }
        } catch {
            // Permission error or other issue - degrade gracefully
        }
        return DEFAULT_INTEGRATIONS_SETTINGS.geo;
    }

    /**
     * Initialize waitlist forms within the given container element
     * @param container The HTML element to search for forms
     * @param htmlFileName Optional filename to display in warnings (e.g., 'index.html')
     */
    async initWaitlistForms(container: HTMLElement, htmlFileName?: string): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;

        // Start behavioral tracking for Phase 2 metadata
        this.metadataService.startBehaviorTracking();

        await this.detectFormsWithoutWaitlistAttribute(container, htmlFileName);
        await this.detectAndBindWaitlistForms(container);
        this.checkForReferralCode();
        this.updateWaitlistCounts(container);
    }

    /**
     * Update waitlist counts in the UI
     */
    private async updateWaitlistCounts(container: HTMLElement): Promise<void> {
        const countElements = Array.from(container.querySelectorAll('[data-waitlist-count]'));

        if (countElements.length === 0) return;

        // Try to find a global fallback waitlist ID
        let globalWaitlistId: string | null = null;
        const globalForm = container.querySelector('form[data-waitlist-id]');
        if (globalForm) {
            globalWaitlistId = globalForm.getAttribute('data-waitlist-id');
        }

        const countCache = new Map<string, number>();

        for (const element of countElements) {
            let waitlistId = element.getAttribute('data-waitlist-count');

            if (!waitlistId) {
                const section = element.closest('section') || container;
                const form = section.querySelector('form[data-waitlist-id]');
                waitlistId = form?.getAttribute('data-waitlist-id') || null;
            }

            // Fallback to global ID if everything else failed
            if (!waitlistId && globalWaitlistId) {
                waitlistId = globalWaitlistId;
            }

            if (waitlistId) {
                try {
                    let count = countCache.get(waitlistId);

                    if (count === undefined) {
                        const snapshot = await runInInjectionContext(this.injector, () => {
                            const usersRef = collection(this.firestore, 'Waitlists', waitlistId, 'users');
                            return getCountFromServer(usersRef);
                        });
                        count = snapshot.data().count;
                        countCache.set(waitlistId, count);
                    }

                    element.classList.remove('arc-skeleton');
                    element.textContent = count.toString();
                    const section = element.closest('section');
                    if (section) {
                        const progressBar = section.querySelector('.fc-progress-fill') as HTMLElement;
                        if (progressBar) {
                            const percentage = Math.min((count / 100) * 100, 100);
                            progressBar.style.width = `${percentage}%`;
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching waitlist count for ${waitlistId}:`, error);
                }
            } else {
                console.warn('Waitlist counts: Could not resolve waitlist ID for element', element);
            }
        }
    }

    /**
     * Detect forms that don't have the data-waitlist-form attribute and show a warning overlay
     * @param container The HTML element to search for forms
     * @param htmlFileName Optional filename to display in warnings
     */
    private async detectFormsWithoutWaitlistAttribute(container: HTMLElement, htmlFileName?: string): Promise<void> {
        // Find all forms that do NOT have the data-waitlist-form attribute
        const allForms = Array.from(container.querySelectorAll('form'));
        const formsWithoutAttribute = allForms.filter(form => !form.hasAttribute('data-waitlist-form'));

        if (formsWithoutAttribute.length === 0) return;

        // Try to fetch the HTML source to find line numbers
        let htmlSource: string | null = null;
        let detectedFileName = htmlFileName || this.getHtmlFileName();

        try {
            const fetchPath = window.location.pathname === '/' ? `/${detectedFileName}` : window.location.pathname;
            const response = await fetch(fetchPath);
            if (response.ok) {
                htmlSource = await response.text();
            }
        } catch {
            // Ignore fetch errors, we'll just show without line numbers
        }

        // Find all forms without data-waitlist-form in the source HTML and get their line numbers
        const formLineNumbers = this.findFormLineNumbers(htmlSource);

        formsWithoutAttribute.forEach((form, index) => {
            const formInfo = this.getFormTagInfo(form as HTMLFormElement, formLineNumbers[index] || null, detectedFileName);
            this.renderMissingAttributeWarning(form as HTMLFormElement, formInfo);
        });
    }

    /**
     * Get the HTML filename from the current URL
     */
    private getHtmlFileName(): string {
        const pathname = window.location.pathname;
        if (pathname === '/' || pathname === '') {
            return 'index.html';
        }
        // Extract filename from path
        const parts = pathname.split('/');
        const lastPart = parts[parts.length - 1];
        return lastPart.includes('.') ? lastPart : `${lastPart}.html`;
    }

    /**
     * Find line numbers for all forms without data-waitlist-form attribute in the source HTML
     */
    private findFormLineNumbers(htmlSource: string | null): (number | null)[] {
        if (!htmlSource) return [];

        const lineNumbers: number[] = [];
        const formTagRegex = /<form[^>]*>/gi;
        let match;

        while ((match = formTagRegex.exec(htmlSource)) !== null) {
            const formTag = match[0];
            // Check for data-waitlist-form as a complete attribute (not data-waitlist-form1, etc.)
            // The attribute must be followed by a space, > or = 
            const hasWaitlistFormAttr = /data-waitlist-form(?:\s|>|=)/.test(formTag);

            if (!hasWaitlistFormAttr) {
                // Count newlines before this match to get line number
                const textBefore = htmlSource.substring(0, match.index);
                const lineNumber = (textBefore.match(/\n/g) || []).length + 1;
                lineNumbers.push(lineNumber);
            }
        }

        return lineNumbers;
    }

    /**
     * Extract the opening form tag information
     */
    private getFormTagInfo(form: HTMLFormElement, lineNumber: number | null, htmlFileName: string): {
        openingTag: string;
        correctedTag: string;
        lineNumber: number | null;
        htmlFileName: string;
    } {
        // Build the opening tag representation from DOM attributes
        // Filter out Angular-generated attributes (starting with _ng)
        const attributes: string[] = [];
        for (const attr of Array.from(form.attributes)) {
            // Skip Angular internal attributes
            if (attr.name.startsWith('_ng') || attr.name.startsWith('ng-')) {
                continue;
            }
            if (attr.value) {
                attributes.push(`${attr.name}="${attr.value}"`);
            } else {
                attributes.push(attr.name);
            }
        }
        const openingTag = `<form${attributes.length > 0 ? ' ' + attributes.join(' ') : ''}>`;

        // Build the corrected tag with new attributes appended at the end
        const correctedTag = `<form${attributes.length > 0 ? ' ' + attributes.join(' ') : ''} data-waitlist-form data-waitlist-id="your-waitlist-name">`;

        return { openingTag, correctedTag, lineNumber, htmlFileName };
    }

    /**
     * Render a warning overlay for forms missing the data-waitlist-form attribute
     */
    private renderMissingAttributeWarning(form: HTMLFormElement, formInfo: {
        openingTag: string;
        correctedTag: string;
        lineNumber: number | null;
        htmlFileName: string;
    }): void {
        form.style.position = 'relative';
        form.style.minHeight = '200px';

        const lineNumberHtml = formInfo.lineNumber
            ? `<div style="background: #dc3545; color: white; padding: 6px 14px; border-radius: 6px; font-size: 0.9rem; font-weight: 600; display: inline-block; margin-bottom: 12px;">
                📍 Open <strong>${formInfo.htmlFileName}</strong> and go to <strong>Line ${formInfo.lineNumber}</strong>
               </div>`
            : '';

        const escapedTag = formInfo.openingTag
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const escapedCorrectedTag = formInfo.correctedTag
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/data-waitlist-form/g, '<span style="background: #ffc107; padding: 1px 4px; border-radius: 3px; font-weight: bold;">data-waitlist-form</span>')
            .replace(/data-waitlist-id="your-waitlist-name"/g, '<span style="background: #ffc107; padding: 1px 4px; border-radius: 3px; font-weight: bold;">data-waitlist-id="your-waitlist-name"</span>');

        const overlay = document.createElement('div');
        overlay.className = 'waitlist-missing-attribute-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 243, 205, 0.98);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            border-radius: 12px;
            backdrop-filter: blur(4px);
            border: 3px solid #ffc107;
        `;

        overlay.innerHTML = `
            <div style="text-align: center; padding: 20px; max-width: 95%;">
                <div style="font-size: 2.5rem; margin-bottom: 8px;">⚠️</div>
                <h3 style="color: #856404; margin: 0 0 12px 0; font-size: 1.2rem; font-weight: 700;">This Form's Data Will NOT Be Saved!</h3>
                ${lineNumberHtml}
                
                <div style="background: #fff; border-radius: 8px; padding: 12px; text-align: left; margin: 10px 0; border: 2px solid #dc3545;">
                    <p style="color: #721c24; margin: 0 0 8px 0; font-size: 0.8rem; font-weight: 600;">❌ Your current code looks like this:</p>
                    <code style="display: block; background: #f8d7da; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; color: #721c24; word-break: break-all; white-space: pre-wrap;">${escapedTag}</code>
                </div>
                
                <div style="background: #fff; border-radius: 8px; padding: 12px; text-align: left; border: 2px solid #28a745;">
                    <p style="color: #155724; margin: 0 0 8px 0; font-size: 0.8rem; font-weight: 600;">✅ Change it to this (add the highlighted parts):</p>
                    <code style="display: block; background: #d4edda; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; color: #155724; word-break: break-all; white-space: pre-wrap;">${escapedCorrectedTag}</code>
                </div>
                
                <div style="background: #e7f3ff; border-radius: 8px; padding: 10px; margin-top: 12px; border: 1px solid #b8daff;">
                    <p style="color: #004085; margin: 0; font-size: 0.75rem; line-height: 1.5;">
                        💡 <strong>Important:</strong> Replace <code style="background: #ffc107; padding: 1px 4px; border-radius: 3px;">your-waitlist-name</code> with a unique name for this form.<br>
                        Examples: <code style="background: #e9ecef; padding: 1px 4px; border-radius: 3px;">newsletter</code>, 
                        <code style="background: #e9ecef; padding: 1px 4px; border-radius: 3px;">beta-signup</code>, 
                        <code style="background: #e9ecef; padding: 1px 4px; border-radius: 3px;">contact-form</code>, or 
                        <code style="background: #e9ecef; padding: 1px 4px; border-radius: 3px;">default</code>
                    </p>
                </div>
            </div>
        `;

        form.appendChild(overlay);
    }

    /**
     * Cleanup form states
     */
    cleanup(): void {
        this.formStates.forEach((state) => {
            if (state.formElement && state.originalFormHtml) {
                state.formElement.innerHTML = state.originalFormHtml;
            }
        });
        this.formStates.clear();
    }

    private async detectAndBindWaitlistForms(container: HTMLElement): Promise<void> {
        const forms = Array.from(container.querySelectorAll('form[data-waitlist-form]'));

        for (const form of forms) {
            const waitlistId = form.getAttribute('data-waitlist-id') || this.defaultWaitlistId;

            let waitlist = await this.waitlistService.getWaitlistBySlug(waitlistId);
            if (!waitlist) {
                waitlist = await this.waitlistService.getWaitlist(waitlistId);
            }

            if (waitlist && !waitlist.isActive) {
                this.renderDisabledOverlay(form as HTMLFormElement, waitlist);
                continue;
            }

            const state: WaitlistFormState = {
                step: 'signup',
                waitlistId: waitlistId,
                email: '',
                firstName: '',
                source: '',
                userId: '',
                originalFormHtml: form.innerHTML,
                formElement: form as HTMLFormElement,
            };
            this.formStates.set(form as HTMLFormElement, state);

            this.ensureWaitlistExists(waitlistId);
            form.addEventListener('submit', (e: Event) => this.handleFormSubmit(e, form as HTMLFormElement));

            // Track form interaction for behavioral metadata
            form.addEventListener('focusin', () => {
                this.metadataService.trackFormInteraction();
            }, { once: true });
        }
    }

    private renderDisabledOverlay(form: HTMLFormElement, waitlist: IWaitlist): void {
        form.style.position = 'relative';
        form.style.minHeight = '200px';

        const defaultMessage = 'This waitlist is currently full. Please check back later for updates.';
        const displayMessage = (waitlist.disabledMessage || defaultMessage).replace(/\n/g, '<br>');

        const overlay = document.createElement('div');
        overlay.className = 'waitlist-disabled-overlay';
        overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      border-radius: 12px;
      backdrop-filter: blur(4px);
    `;

        overlay.innerHTML = `
      <div style="text-align: center; padding: 30px;">
        <div style="font-size: 3rem; margin-bottom: 15px;">🔒</div>
        <h3 style="color: #1a202c; margin: 0 0 10px 0; font-size: 1.5rem; font-weight: 700;">Waitlist Closed</h3>
        <p style="color: #64748b; margin: 0; line-height: 1.5;">${displayMessage}</p>
      </div>
    `;

        form.appendChild(overlay);
    }

    private async ensureWaitlistExists(waitlistId: string): Promise<void> {
        try {
            const callable = httpsCallable(this.functions, 'ensureWaitlistExists');
            await callable({ waitlistId });
        } catch (error) {
            console.error(`Error ensuring waitlist exists: ${waitlistId}`, error);
        }
    }

    private checkForReferralCode(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const refCode = urlParams.get('ref');
        if (refCode) {
            this.waitlistService.storeReferralCodeWithExpiration(refCode);
        }
    }

    private async handleFormSubmit(event: Event, form: HTMLFormElement): Promise<void> {
        event.preventDefault();

        const state = this.formStates.get(form);
        if (!state) return;

        const formData: Record<string, string> = {};
        const elements = form.elements;

        for (let i = 0; i < elements.length; i++) {
            const element = elements[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (!element.name || element.disabled) continue;
            if (element.type === 'submit' || element.type === 'button') continue;

            if (element.type === 'checkbox') {
                const checkbox = element as HTMLInputElement;
                if (checkbox.checked) {
                    formData[element.name] = formData[element.name]
                        ? `${formData[element.name]}, ${checkbox.value}`
                        : checkbox.value;
                }
            } else if (element.type === 'radio') {
                const radio = element as HTMLInputElement;
                if (radio.checked) {
                    formData[element.name] = radio.value;
                }
            } else {
                formData[element.name] = element.value;
            }
        }

        const emailInput = form.querySelector('[data-waitlist-email], [name="email"]') as HTMLInputElement;
        const nameInput = form.querySelector('[data-waitlist-name], [name="firstName"], [name="name"]') as HTMLInputElement;
        const sourceInput = form.querySelector('[data-waitlist-source], [name="source"]') as HTMLInputElement | HTMLSelectElement;

        if (!emailInput?.value) {
            this.showError(form, state, 'Email is required');
            return;
        }

        state.email = emailInput.value.trim().toLowerCase();
        state.firstName = nameInput?.value?.trim() || this.waitlistService.getFirstNameFromEmail(state.email);
        state.source = sourceInput?.value || 'direct';
        
        this.renderLoading(form, 'Signing you up...');

        try {
            // Fetch settings for geolocation (graceful degradation if fails)
            const geoSettings = await this.getGeoSettings();

            // Collect marketing metadata including behavioral data, geo, and email analysis
            const signupMetadata = await this.metadataService.collectAllMetadata(state.email, geoSettings);

            const result = await this.waitlistService.joinWaitlist(state.waitlistId, {
                firstName: state.firstName,
                email: state.email,
                source: state.source,
                formData: formData as unknown as IWaitlistFormData,
                signupMetadata,
            });

            this.templOtp = result.verificationCode || null;

            if ((result as Record<string, unknown>)['error']) {
                state.error = (result as Record<string, unknown>)['message'] as string;
                state.step = 'error';
                this.renderStep(form, state);
            } else {
                state.userId = result.userId || '';

                const isOtpEnabled = await this.isOtpTemplateEnabled(state.waitlistId);
                const shouldSkipOtp = !this.emailConfigService.isEmailConfigured() || !isOtpEnabled;

                if (shouldSkipOtp) {
                    // Skip OTP — confirm the user immediately (mark verified, assign position, process referral)
                    const storedRef = this.waitlistService.getReferralCodeFromStorage();
                    const confirmation = await this.waitlistService.confirmWithoutOtp(
                        state.waitlistId,
                        state.userId,
                        storedRef || '',
                    );

                    // Clear stored referral code after use
                    this.waitlistService.clearReferralCodeFromStorage();

                    const baseUrl = window.location.origin;
                    state.queuePosition = confirmation.queuePosition;
                    state.totalSignups = confirmation.totalSignups;
                    state.referralCode = (result as any).referralCode || '';
                    state.referralLink = (result as any).referralLink || `${baseUrl}?ref=${state.referralCode}`;
                    state.totalReferrals = 0;
                    state.waitlistedUserId = (result as any).waitlistedUserId || state.userId;
                    state.step = 'success';
                } else {
                    state.step = 'verify';
                }
                this.renderStep(form, state);
            }
        } catch (error) {
            state.error = error instanceof Error ? error.message : 'Failed to sign up. Please try again.';
            state.step = 'error';
            this.renderStep(form, state);
        }
    }

    private async handleOtpSubmit(form: HTMLFormElement, state: WaitlistFormState): Promise<void> {
        const otpInput = form.querySelector('.waitlist-otp-input') as HTMLInputElement;
        const referralInput = form.querySelector('.waitlist-referral-input') as HTMLInputElement;

        if (!otpInput?.value || otpInput.value.length !== 6) {
            this.showInlineError(form, 'Please enter a 6-digit code');
            return;
        }

        this.renderLoading(form, 'Verifying...');

        try {
            const storedRef = this.waitlistService.getReferralCodeFromStorage();
            const referralCode = referralInput?.value?.trim() || storedRef || '';

            const result = await this.waitlistService.verifyOtpAndProcessUser(
                state.waitlistId,
                state.userId,
                otpInput.value,
                {
                    email: state.email,
                    firstName: state.firstName,
                    referredBy: referralCode,
                }
            );

            if (result.success && result.data) {
                this.waitlistService.clearReferralCodeFromStorage();
                const baseUrl = window.location.origin;
                state.queuePosition = result.data.queuePosition;
                state.totalSignups = result.data.totalSignups;
                state.referralCode = result.data.referralCode;
                state.referralLink = result.data.referralLink || `${baseUrl}?ref=${result.data.referralCode}`;
                state.totalReferrals = (result.data['totalReferrals'] as number) || 0;
                state.waitlistedUserId = result.data.waitlistedUserId;

                state.step = result.isExistingVerifiedUser ? 'existing-user' : 'success';
                this.renderStep(form, state);
            } else {
                this.renderStep(form, state);
                this.showInlineError(form, result.message || 'Invalid verification code');
            }
        } catch (error) {
            this.showInlineError(form, 'Verification failed. Please try again.');
            this.renderStep(form, state);
        }
    }

    private async handleResendOtp(form: HTMLFormElement, state: WaitlistFormState): Promise<void> {
        try {
            await this.waitlistService.resendVerificationCode(state.waitlistId, state.userId);
            this.showInlineSuccess(form, 'New code sent to your email!');
        } catch (error) {
            this.showInlineError(form, 'Failed to resend code');
        }
    }

    private renderStep(form: HTMLFormElement, state: WaitlistFormState): void {
        switch (state.step) {
            case 'signup':
                form.innerHTML = state.originalFormHtml;
                form.addEventListener('submit', (e) => this.handleFormSubmit(e, form));
                break;
            case 'verify':
                this.renderVerifyStep(form, state);
                break;
            case 'success':
                this.renderSuccessStep(form, state);
                break;
            case 'existing-user':
                this.renderExistingUserStep(form, state);
                break;
            case 'error':
                this.renderErrorStep(form, state);
                break;
        }
    }

    private renderLoading(form: HTMLFormElement, message: string): void {
        form.innerHTML = `
      <div class="waitlist-loading">
        <div class="waitlist-spinner"></div>
        <p>${message}</p>
      </div>
    `;
    }

    private renderVerifyStep(form: HTMLFormElement, state: WaitlistFormState): void {
        const storedRef = this.waitlistService.getReferralCodeFromStorage();
        const hasReferralCode = !!storedRef;

        form.innerHTML = `
      <div class="waitlist-verify-step" style="max-width: 500px; margin: 20px auto; padding: 30px; border-radius: 12px; background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.1); font-family: sans-serif; text-align: center; border: 1px solid #eaeaea;">
        <h3 style="margin-top: 0; color: #1a1a1a; font-size: 24px; font-weight: 700;">Check Your Email</h3>
        <p style="color: #666; line-height: 1.5; font-size: 15px; margin-bottom: 25px;">
          We sent a 6-digit verification code to<br>
          <strong style="color: #1a1a1a;">${state.email}</strong>
        </p>

        <div class="waitlist-form-group" style="margin-bottom: 15px;">
          <input type="text" class="waitlist-otp-input" placeholder="000000" maxlength="6" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" style="width: 100%; padding: 12px; font-size: 24px; letter-spacing: 8px; text-align: center; border: 2px solid #ddd; border-radius: 8px; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
        </div>
        ${hasReferralCode ? '' : `<div class="waitlist-form-group" style="margin-bottom: 20px;">
          <input type="text" class="waitlist-referral-input" placeholder="Referral code (optional)" maxlength="10" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box;">
        </div>`}
        <div class="waitlist-inline-message" style="margin-bottom: 15px; color: #d93025; font-size: 13px; min-height: 18px;"></div>
        <button type="button" class="waitlist-verify-btn" style="width: 100%; padding: 14px; background-color: #007bff; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background-color 0.2s;">Verify Email</button>
        <div class="waitlist-action-links" style="margin-top: 20px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 10px;">
          <button type="button" class="waitlist-link-btn waitlist-resend-btn" style="background: none; border: none; color: #007bff; cursor: pointer; padding: 0; font-size: 14px; text-decoration: underline;">Resend code</button>
          <span class="waitlist-separator" style="color: #ccc;">|</span>
          <button type="button" class="waitlist-link-btn waitlist-back-btn" style="background: none; border: none; color: #666; cursor: pointer; padding: 0; font-size: 14px;">Change email</button>
        </div>
      </div>
    `;

        const verifyBtn = form.querySelector('.waitlist-verify-btn');
        const resendBtn = form.querySelector('.waitlist-resend-btn');
        const backBtn = form.querySelector('.waitlist-back-btn');
        const otpInput = form.querySelector('.waitlist-otp-input') as HTMLInputElement;

        verifyBtn?.addEventListener('click', () => this.handleOtpSubmit(form, state));
        resendBtn?.addEventListener('click', () => this.handleResendOtp(form, state));
        backBtn?.addEventListener('click', () => {
            state.step = 'signup';
            this.renderStep(form, state);
        });

        otpInput?.focus();
    }

    private renderSuccessStep(form: HTMLFormElement, state: WaitlistFormState): void {
        form.innerHTML = `
      <div class="waitlist-success-step" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 550px; margin: 20px auto; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; color: #333;">
        <div class="waitlist-success-icon" style="width: 60px; height: 60px; line-height: 60px; background-color: #4BB543; color: white; border-radius: 50%; font-size: 30px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">✓</div>
        <h3 style="margin: 0 0 25px 0; font-size: 24px; color: #1a1a1a;">You're on the list!</h3>
        <div class="waitlist-stats" style="display: flex; justify-content: space-around; background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 30px;">
          <div class="waitlist-stat" style="flex: 1;">
            <div class="waitlist-stat-number" style="font-size: 22px; font-weight: 700; color: #2563eb;">#${state.queuePosition || 1}</div>
            <div class="waitlist-stat-label" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 4px;">Your Position</div>
          </div>
          <div class="waitlist-stat" style="flex: 1; border-left: 1px solid #e0e0e0;">
            <div class="waitlist-stat-number" style="font-size: 22px; font-weight: 700; color: #2563eb;">${state.totalSignups || 1}</div>
            <div class="waitlist-stat-label" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 4px;">Total Signups</div>
          </div>
        </div>
        <div class="waitlist-referral-section" style="border-top: 1px solid #eee; padding-top: 25px; text-align: left;">
          <h4 style="margin: 0 0 8px 0; font-size: 18px; text-align: center;">🚀 Move up faster!</h4>
          <p style="margin: 0 0 20px 0; font-size: 14px; color: #666; text-align: center;">Each verified referral moves you up in the queue.</p>
          <div class="waitlist-copy-group" style="margin-bottom: 15px;">
            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #444;">Your Referral Code:</label>
            <div class="waitlist-copy-row" style="display: flex; gap: 8px;">
              <input type="text" readonly value="${state.referralCode || ''}" class="waitlist-copy-input" style="flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-family: monospace; background: #fdfdfd; font-size: 14px; outline: none;">
              <button type="button" class="waitlist-copy-btn" data-copy="${state.referralCode || ''}" style="padding: 10px 16px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 14px; transition: background 0.2s;">📋 Copy</button>
            </div>
          </div>
          <div class="waitlist-copy-group" style="margin-bottom: 25px;">
            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #444;">Share this link:</label>
            <div class="waitlist-copy-row" style="display: flex; gap: 8px;">
              <input type="text" readonly value="${state.referralLink || ''}" class="waitlist-copy-input" style="flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-family: monospace; background: #fdfdfd; font-size: 14px; outline: none;">
              <button type="button" class="waitlist-copy-btn" data-copy="${state.referralLink || ''}" style="padding: 10px 16px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 14px; transition: background 0.2s;">📋 Copy</button>
            </div>
          </div>
        </div>
        <a href="/leaderboard/${state.waitlistId}/${encodeURIComponent(state.waitlistedUserId || '')}" class="waitlist-leaderboard-btn" style="display: block; text-decoration: none; padding: 14px; background-color: #f0f4ff; color: #2563eb; border-radius: 10px; font-weight: 600; font-size: 15px; transition: all 0.2s;">🏆 View Leaderboard</a>
      </div>
    `;

        Array.from(form.querySelectorAll('.waitlist-copy-btn')).forEach((btn) => {
            btn.addEventListener('click', () => {
                const text = (btn as HTMLElement).dataset['copy'] || '';
                this.copyToClipboard(text, btn as HTMLElement);
            });
        });
    }

    private renderExistingUserStep(form: HTMLFormElement, state: WaitlistFormState): void {
        form.innerHTML = `
      <div class="waitlist-existing-step" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 450px; margin: 20px auto; padding: 30px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; color: #333;">
        <div class="waitlist-info-icon" style="width: 60px; height: 60px; line-height: 60px; background-color: #2563eb; color: white; border-radius: 50%; font-size: 30px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-style: italic; font-family: serif;">i</div>
        <h3 style="margin: 0 0 10px 0; font-size: 24px; color: #1a1a1a;">Welcome back, ${state.firstName}!</h3>
        <p style="margin: 0 0 25px 0; font-size: 16px; color: #666;">You're already on the waitlist.</p>
        <div class="waitlist-stats" style="display: flex; justify-content: space-around; background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 30px;">
          <div class="waitlist-stat" style="flex: 1;">
            <div class="waitlist-stat-number" style="font-size: 22px; font-weight: 700; color: #2563eb;">#${state.queuePosition || 1}</div>
            <div class="waitlist-stat-label" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 4px;">Your Position</div>
          </div>
          <div class="waitlist-stat" style="flex: 1; border-left: 1px solid #e0e0e0;">
            <div class="waitlist-stat-number" style="font-size: 22px; font-weight: 700; color: #2563eb;">${state.totalReferrals || 0}</div>
            <div class="waitlist-stat-label" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-top: 4px;">Your Referrals</div>
          </div>
        </div>
        <a href="/leaderboard/${state.waitlistId}/${encodeURIComponent(state.waitlistedUserId || '')}" class="waitlist-leaderboard-btn" style="display: block; text-decoration: none; padding: 14px; background-color: #2563eb; color: #ffffff; border-radius: 10px; font-weight: 600; font-size: 15px; transition: background 0.2s; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);">🏆 View Leaderboard</a>
      </div>
    `;
    }

    private renderErrorStep(form: HTMLFormElement, state: WaitlistFormState): void {
        form.innerHTML = `
      <div class="waitlist-error-step" style="padding: 20px; border-radius: 12px; background: #fffafb; border: 1px solid #f8d7da; text-align: center; font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
        <div class="waitlist-error-icon" style="font-size: 48px; color: #dc3545; margin-bottom: 15px; line-height: 1;">⚠</div>
        <h3 style="margin: 0 0 10px 0; color: #721c24; font-size: 22px; font-weight: 700;">Something went wrong</h3>
        <p style="margin: 0 0 25px 0; color: #842029; font-size: 15px; line-height: 1.5; opacity: 0.8;">${state.error || 'An unexpected error occurred.'}</p>
        <button type="button" class="waitlist-retry-btn" style="display: inline-block; padding: 12px 24px; background-color: #dc3545; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background-color 0.2s; box-shadow: 0 2px 4px rgba(220, 53, 69, 0.2);">Try Again</button>
      </div>
    `;

        form.querySelector('.waitlist-retry-btn')?.addEventListener('click', () => {
            state.step = 'signup';
            state.error = '';
            this.renderStep(form, state);
        });
    }

    private showError(form: HTMLFormElement, state: WaitlistFormState, message: string): void {
        state.error = message;
        state.step = 'error';
        this.renderStep(form, state);
    }

    private showInlineError(form: HTMLFormElement, message: string): void {
        const msgEl = form.querySelector('.waitlist-inline-message');
        if (msgEl) {
            msgEl.innerHTML = `<span class="waitlist-error-msg">${message}</span>`;
        }
    }

    private showInlineSuccess(form: HTMLFormElement, message: string): void {
        const msgEl = form.querySelector('.waitlist-inline-message');
        if (msgEl) {
            msgEl.innerHTML = `<span class="waitlist-success-msg">${message}</span>`;
            setTimeout(() => { msgEl.innerHTML = ''; }, 3000);
        }
    }

    private async copyToClipboard(text: string, btn: HTMLElement): Promise<void> {
        const success = await this.globalService.copyToClipboard(text);
        if (success) {
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);
        }
    }

    /**
     * Get leaderboard URL for a waitlist form
     */
    getLeaderboardUrl(container: HTMLElement): string {
        const form = container.querySelector('form[data-waitlist-form]') as HTMLFormElement;
        const waitlistId = form?.getAttribute('data-waitlist-id') || this.defaultWaitlistId;
        return `/leaderboard/${waitlistId}`;
    }
}
