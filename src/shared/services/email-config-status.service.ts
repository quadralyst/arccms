/**
 * Email Configuration Status Service
 *
 * Provides reactive access to email configuration status across the application.
 * Used to show warning banners and disable email-related features when email is not configured.
 */

import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { Observable, BehaviorSubject } from 'rxjs';

const SETTINGS_COLLECTION = 'Settings';
const EMAIL_SETTINGS_DOC = 'email_status';
const BANNER_DISMISSED_KEY = 'email_banner_dismissed';

@Injectable({
  providedIn: 'root',
})
export class EmailConfigStatusService {
  private firestore = inject(Firestore);
  private platformId = inject(PLATFORM_ID);

  // Reactive state
  private _isEmailConfigured = new BehaviorSubject<boolean>(false);
  private _isLoading = new BehaviorSubject<boolean>(true);

  // Signals for easier template access
  isEmailConfigured = signal(false);
  isLoading = signal(true);
  bannerDismissed = signal(false);
  /** E4 — mirror of Settings/email.requireSignupVerification (public status doc). */
  requireSignupVerification = signal(false);
  /** True when the simulated "Debug Provider (Log Only)" is the active provider. */
  debugMode = signal(false);

  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.initializeListener();
    this.loadBannerDismissedState();
  }

  /**
   * Initialize real-time listener for email settings
   */
  private initializeListener(): void {
    if (!isPlatformBrowser(this.platformId)) {
      // Leave isLoading at its default (true) on the server. Forcing it false here
      // makes the SSR render disagree with the client's own pre-listener state
      // (also loading=true until the first snapshot arrives), and that mismatch at
      // the hydration boundary leaves the affected @if content permanently inert —
      // present in the DOM but with no live view/listeners attached to it.
      return;
    }

    const docRef = doc(this.firestore, SETTINGS_COLLECTION, EMAIL_SETTINGS_DOC);

    this.unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        const data = snapshot.data();

        const enabled = !!data?.['isEnabled'];

        this._isEmailConfigured.next(enabled);
        this.isEmailConfigured.set(enabled);
        this.requireSignupVerification.set(!!data?.['requireSignupVerification']);
        this.debugMode.set(!!data?.['debugMode']);

        this._isLoading.next(false);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Error listening to email settings:', error);
        this._isEmailConfigured.next(false);
        this.isEmailConfigured.set(false);
        this.requireSignupVerification.set(false);
        this.debugMode.set(false);
        this._isLoading.next(false);
        this.isLoading.set(false);
      }
    );
  }

  /**
   * Load banner dismissed state from session storage
   */
  private loadBannerDismissedState(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const dismissed =
          sessionStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
        this.bannerDismissed.set(dismissed);
      }
    } catch {
      // sessionStorage not available (SSR or restricted context)
    }
  }

  /**
   * Dismiss the warning banner for this session
   */
  dismissBanner(): void {
    this.bannerDismissed.set(true);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(BANNER_DISMISSED_KEY, 'true');
      }
    } catch {
      // sessionStorage not available (SSR or restricted context)
    }
  }

  /**
   * Check if warning banner should be shown
   */
  shouldShowBanner(): boolean {
    return (
      !this.isEmailConfigured() && !this.bannerDismissed() && !this.isLoading()
    );
  }

  /**
   * E4 — whether the signup flow should require email OTP verification:
   * email must be configured AND the admin toggle must be on. When email is
   * disabled this is always false (the step is skipped).
   */
  shouldVerifySignup(): boolean {
    return this.isEmailConfigured() && this.requireSignupVerification();
  }

  /**
   * Observable for email configuration status
   */
  get isEmailConfigured$(): Observable<boolean> {
    return this._isEmailConfigured.asObservable();
  }

  /**
   * Observable for loading status
   */
  get isLoading$(): Observable<boolean> {
    return this._isLoading.asObservable();
  }

  /**
   * Clean up listener on service destroy
   */
  ngOnDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
