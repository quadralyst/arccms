/**
 * Signup Metadata Service
 *
 * Collects marketing metadata during form submission.
 * Phase 1: UTM parameters, device info, referrer, extended device
 * Phase 2: Behavioral tracking with cross-session localStorage persistence
 */

import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ISignupMetadata } from './signup-metadata.model';

/**
 * Shape of the consolidated localStorage object for cross-session tracking.
 * Replaces legacy arc_visit_count and arc_return_visitor keys.
 */
interface IArcSessionData {
  firstVisitTimestamp: number;
  lastVisitTimestamp: number;
  visitCount: number;
  maxScrollDepthPercent: number;
  totalTimeOnPageMs: number;
  formStartCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class SignupMetadataService {
  private platformId = inject(PLATFORM_ID);
  private pageLoadTimestamp = 0;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.pageLoadTimestamp = Date.now();
    }
  }

  /**
   * Collect all Phase 1 metadata
   */
  collectMetadata(): ISignupMetadata {
    if (!isPlatformBrowser(this.platformId)) {
      return {};
    }

    return {
      ...this.parseUTMParams(),
      ...this.getDeviceInfo(),
      ...this.getExtendedDeviceInfo(),
      referrerUrl: document.referrer || undefined,
      landingPage: window.location.href,
      pageLoadTimestamp: this.pageLoadTimestamp,
      queryParams: this.getNonUtmQueryParams(),
    };
  }

  /**
   * Parse UTM parameters from current URL
   */
  private parseUTMParams(): Partial<ISignupMetadata> {
    const params = new URLSearchParams(window.location.search);

    const utmSource = params.get('utm_source') || undefined;
    const utmMedium = params.get('utm_medium') || undefined;
    const utmCampaign = params.get('utm_campaign') || undefined;
    const utmContent = params.get('utm_content') || undefined;
    const utmTerm = params.get('utm_term') || undefined;

    // Only return if at least one UTM param exists
    if (!utmSource && !utmMedium && !utmCampaign && !utmContent && !utmTerm) {
      return {};
    }

    return {
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
    };
  }

  /**
   * Detect device type, browser, and OS from user agent
   */
  private getDeviceInfo(): Partial<ISignupMetadata> {
    const ua = navigator.userAgent;

    return {
      deviceType: this.detectDeviceType(ua),
      operatingSystem: this.detectOS(ua),
      browser: this.detectBrowser(ua),
      browserVersion: this.detectBrowserVersion(ua),
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language || undefined,
    };
  }

  /**
   * Extended device info: connection, display preferences, viewport, touch, temporal
   */
  private getExtendedDeviceInfo(): Partial<ISignupMetadata> {
    const conn = (navigator as any).connection;
    return {
      connectionType: conn?.effectiveType || undefined,
      downlinkSpeed: conn?.downlink || undefined,
      prefersDarkMode: window.matchMedia?.('(prefers-color-scheme: dark)').matches,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      isTouchDevice: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
      timezoneOffset: new Date().getTimezoneOffset(),
      signupHour: new Date().getHours(),
      signupDayOfWeek: new Date().getDay(),
      pageLoadTimeMs: this.getFirstContentfulPaint(),
    };
  }

  /**
   * Get First Contentful Paint time from Performance API
   */
  private getFirstContentfulPaint(): number | undefined {
    try {
      const entries = performance.getEntriesByName('first-contentful-paint');
      if (entries.length > 0) {
        return Math.round(entries[0].startTime);
      }
    } catch {
      // Performance API not available
    }
    return undefined;
  }

  /**
   * Get all non-UTM, non-ref query parameters from URL
   */
  private getNonUtmQueryParams(): Record<string, string> | undefined {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = {};
    const skipKeys = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref']);

    params.forEach((value, key) => {
      if (!skipKeys.has(key)) {
        result[key] = value;
      }
    });

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Detect device type from user agent
   */
  private detectDeviceType(ua: string): 'desktop' | 'mobile' | 'tablet' {
    // Tablet detection (must come before mobile)
    if (/iPad|Android(?!.*Mobile)|tablet/i.test(ua)) {
      return 'tablet';
    }

    // Mobile detection
    if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
      return 'mobile';
    }

    return 'desktop';
  }

  /**
   * Detect operating system from user agent
   */
  private detectOS(ua: string): string {
    if (/Windows NT 10/i.test(ua)) return 'Windows 10';
    if (/Windows NT 6.3/i.test(ua)) return 'Windows 8.1';
    if (/Windows NT 6.2/i.test(ua)) return 'Windows 8';
    if (/Windows NT 6.1/i.test(ua)) return 'Windows 7';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X/i.test(ua)) {
      const match = ua.match(/Mac OS X (\d+[._]\d+)/);
      return match ? `macOS ${match[1].replace('_', '.')}` : 'macOS';
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      const match = ua.match(/OS (\d+_\d+)/);
      return match ? `iOS ${match[1].replace('_', '.')}` : 'iOS';
    }
    if (/Android/i.test(ua)) {
      const match = ua.match(/Android (\d+\.?\d*)/);
      return match ? `Android ${match[1]}` : 'Android';
    }
    if (/Linux/i.test(ua)) return 'Linux';
    if (/CrOS/i.test(ua)) return 'Chrome OS';

    return 'Unknown';
  }

  /**
   * Detect browser name from user agent
   */
  private detectBrowser(ua: string): string {
    // Order matters - check more specific browsers first
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
    if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
    if (/Firefox/i.test(ua)) return 'Firefox';
    if (/MSIE|Trident/i.test(ua)) return 'Internet Explorer';

    return 'Unknown';
  }

  /**
   * Detect browser version from user agent
   */
  private detectBrowserVersion(ua: string): string {
    let match: RegExpMatchArray | null = null;

    if (/Edg\//i.test(ua)) {
      match = ua.match(/Edg\/(\d+)/);
    } else if (/OPR\//i.test(ua)) {
      match = ua.match(/OPR\/(\d+)/);
    } else if (/Chrome/i.test(ua)) {
      match = ua.match(/Chrome\/(\d+)/);
    } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
      match = ua.match(/Version\/(\d+)/);
    } else if (/Firefox/i.test(ua)) {
      match = ua.match(/Firefox\/(\d+)/);
    }

    return match ? match[1] : '';
  }

  // ========== Phase 2: Behavioral Tracking ==========

  private maxScrollDepth = 0;
  private scrollTrackingActive = false;
  private readonly SESSION_DATA_KEY = 'arc_session_data';
  private readonly LEGACY_RETURN_VISITOR_KEY = 'arc_return_visitor';
  private readonly LEGACY_VISIT_COUNT_KEY = 'arc_visit_count';
  private visitCount = 1;
  private sessionData: IArcSessionData | null = null;
  private formInteractedThisSession = false;
  private clickCount = 0;
  private tabSwitchCount = 0;

  /**
   * Start tracking behavioral signals (call on page load)
   */
  startBehaviorTracking(): void {
    if (!isPlatformBrowser(this.platformId) || this.scrollTrackingActive) return;

    this.scrollTrackingActive = true;

    // Load and update session data
    const data = this.loadSessionData();
    data.visitCount += 1;
    data.lastVisitTimestamp = Date.now();
    if (data.firstVisitTimestamp === 0 && data.visitCount === 1) {
      data.firstVisitTimestamp = Date.now();
    }
    this.visitCount = data.visitCount;

    // Restore persisted max scroll depth
    this.maxScrollDepth = data.maxScrollDepthPercent;

    this.saveSessionData();

    // Track scroll depth
    window.addEventListener('scroll', this.boundHandleScroll, { passive: true });

    // Track clicks
    window.addEventListener('click', this.boundHandleClick, { passive: true });

    // Track tab visibility changes
    document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);

    // Persist accumulated time on page unload
    window.addEventListener('beforeunload', this.boundHandleBeforeUnload);
  }

  // Bound handlers for proper cleanup
  private boundHandleScroll = this.handleScroll.bind(this);
  private boundHandleClick = this.handleClick.bind(this);
  private boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
  private boundHandleBeforeUnload = this.handleBeforeUnload.bind(this);

  /**
   * Handle scroll event to track max scroll depth
   */
  private handleScroll(): void {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 0) {
      const scrollPercent = Math.round((scrollTop / docHeight) * 100);
      if (scrollPercent > this.maxScrollDepth) {
        this.maxScrollDepth = Math.min(scrollPercent, 100);
        // Persist cross-session max
        if (this.sessionData && this.maxScrollDepth > this.sessionData.maxScrollDepthPercent) {
          this.sessionData.maxScrollDepthPercent = this.maxScrollDepth;
          this.saveSessionData();
        }
      }
    }
  }

  /**
   * Handle click event to count clicks before signup
   */
  private handleClick(): void {
    this.clickCount++;
  }

  /**
   * Handle tab visibility change to count tab switches
   */
  private handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      this.tabSwitchCount++;
    }
  }

  /**
   * Flush accumulated time to localStorage on page unload
   */
  private handleBeforeUnload(): void {
    if (!this.sessionData) return;
    this.sessionData.totalTimeOnPageMs += this.getTimeOnPage();
    this.sessionData.maxScrollDepthPercent = this.maxScrollDepth;
    this.saveSessionData();
  }

  /**
   * Track form interaction (called by WaitlistFormService on first focusin)
   */
  trackFormInteraction(): void {
    if (!isPlatformBrowser(this.platformId) || this.formInteractedThisSession) return;
    this.formInteractedThisSession = true;

    const data = this.loadSessionData();
    data.formStartCount += 1;
    this.saveSessionData();
  }

  /**
   * Get current scroll depth percentage
   */
  getScrollDepth(): number {
    return this.maxScrollDepth;
  }

  /**
   * Get time on page in milliseconds
   */
  getTimeOnPage(): number {
    if (!isPlatformBrowser(this.platformId) || !this.pageLoadTimestamp) {
      return 0;
    }
    return Date.now() - this.pageLoadTimestamp;
  }

  /**
   * Check if this is a return visitor
   */
  isReturnVisitor(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const data = this.loadSessionData();
    return data.visitCount > 1;
  }

  getVisitCount(): number {
    return this.visitCount;
  }

  // ========== localStorage Persistence ==========

  /**
   * Load session data from localStorage, migrating legacy keys if needed
   */
  private loadSessionData(): IArcSessionData {
    if (this.sessionData) return this.sessionData;
    if (!isPlatformBrowser(this.platformId)) {
      this.sessionData = this.getDefaultSessionData();
      return this.sessionData;
    }

    try {
      const stored = localStorage.getItem(this.SESSION_DATA_KEY);
      if (stored) {
        this.sessionData = JSON.parse(stored);
        return this.sessionData!;
      }

      // Migration: check legacy keys
      const legacyCount = parseInt(
        localStorage.getItem(this.LEGACY_VISIT_COUNT_KEY) || '0', 10
      );
      const legacyReturnVisitor =
        localStorage.getItem(this.LEGACY_RETURN_VISITOR_KEY) === 'true';

      let migratedCount = 0;
      if (legacyCount > 0) {
        migratedCount = legacyCount;
      } else if (legacyReturnVisitor) {
        migratedCount = 1;
      }

      this.sessionData = {
        firstVisitTimestamp: migratedCount > 0 ? 0 : Date.now(),
        lastVisitTimestamp: Date.now(),
        visitCount: migratedCount,
        maxScrollDepthPercent: 0,
        totalTimeOnPageMs: 0,
        formStartCount: 0,
      };

      // Clean up legacy keys after migration
      if (legacyCount > 0 || legacyReturnVisitor) {
        localStorage.removeItem(this.LEGACY_VISIT_COUNT_KEY);
        localStorage.removeItem(this.LEGACY_RETURN_VISITOR_KEY);
      }

      return this.sessionData;
    } catch {
      this.sessionData = this.getDefaultSessionData();
      return this.sessionData;
    }
  }

  /**
   * Save session data to localStorage
   */
  private saveSessionData(): void {
    if (!isPlatformBrowser(this.platformId) || !this.sessionData) return;
    try {
      localStorage.setItem(this.SESSION_DATA_KEY, JSON.stringify(this.sessionData));
    } catch {
      // Ignore localStorage errors (quota, private mode, etc.)
    }
  }

  /**
   * Create fresh session data object
   */
  private getDefaultSessionData(): IArcSessionData {
    return {
      firstVisitTimestamp: Date.now(),
      lastVisitTimestamp: Date.now(),
      visitCount: 0,
      maxScrollDepthPercent: 0,
      totalTimeOnPageMs: 0,
      formStartCount: 0,
    };
  }

  /**
   * Get behavioral metadata including cross-session and engagement data
   */
  private getBehavioralData(): Partial<ISignupMetadata> {
    const data = this.loadSessionData();
    const currentSessionTime = this.getTimeOnPage();

    return {
      // Existing fields
      timeOnPageMs: currentSessionTime,
      scrollDepthPercent: this.getScrollDepth(),
      isReturnVisitor: data.visitCount > 1,
      visitCount: data.visitCount,

      // Cross-session fields
      firstVisitTimestamp: data.firstVisitTimestamp || undefined,
      lastVisitTimestamp: data.lastVisitTimestamp || undefined,
      totalTimeOnPageMs: data.totalTimeOnPageMs + currentSessionTime,
      maxScrollDepthPercent: this.maxScrollDepth,
      formStartCount: data.formStartCount || undefined,

      // Engagement fields
      clickCount: this.clickCount || undefined,
      tabSwitchCount: this.tabSwitchCount || undefined,
    };
  }

  /**
   * Collect all metadata including behavioral data
   */
  collectMetadataWithBehavior(): ISignupMetadata {
    return {
      ...this.collectMetadata(),
      ...this.getBehavioralData(),
    };
  }

  // ========== Phase 3: Geolocation (async) ==========

  /**
   * Fetch geolocation data from configured API
   * Gracefully degrades if API not configured or fails
   */
  async fetchGeoData(settings?: { geoEnabled?: boolean; geoApiProvider?: string; geoApiKey?: string; geoApiEndpoint?: string }): Promise<Partial<ISignupMetadata>> {
    if (!isPlatformBrowser(this.platformId)) return {};

    // Graceful degradation: skip if not enabled
    if (!settings?.geoEnabled) {
      return {};
    }

    try {
      let url = '';
      const provider = settings.geoApiProvider || 'ipapi';
      const apiKey = settings.geoApiKey;

      switch (provider) {
        case 'ipapi':
          url = apiKey
            ? `https://ipapi.co/json/?key=${apiKey}`
            : 'https://ipapi.co/json/';
          break;
        case 'ipinfo':
          url = apiKey
            ? `https://ipinfo.io/json?token=${apiKey}`
            : 'https://ipinfo.io/json';
          break;
        case 'custom':
          url = settings.geoApiEndpoint || '';
          break;
      }

      if (!url) return {};

      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return {};

      const data = await response.json();

      // Map response fields (different APIs use different field names)
      return {
        country: data.country_name || data.country || undefined,
        region: data.region || data.region_name || undefined,
        city: data.city || undefined,
        timezone: data.timezone || data.time_zone || undefined,
        ipAddress: data.ip || undefined,
      };
    } catch {
      // Graceful degradation: return empty on any error
      return {};
    }
  }

  // ========== Phase 4: Email Quality ==========

  /**
   * Check if email is from a disposable domain
   */
  checkDisposableEmail(email: string): boolean {
    if (!email || !email.includes('@')) return false;

    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;

    // Inline check against common domains (full list in disposable-email-domains.ts)
    const commonDisposable = new Set([
      '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
      'tempmail.com', 'yopmail.com', 'throwaway.email', 'maildrop.cc',
      'fakeinbox.com', 'trashmail.com', 'getnada.com', 'temp-mail.org',
    ]);

    return commonDisposable.has(domain);
  }

  /**
   * Collect all metadata including async geolocation and email analysis
   */
  async collectAllMetadata(
    email: string,
    geoSettings?: { geoEnabled?: boolean; geoApiProvider?: string; geoApiKey?: string; geoApiEndpoint?: string }
  ): Promise<ISignupMetadata> {
    const baseMetadata = this.collectMetadataWithBehavior();

    // Fetch geo data (graceful degradation)
    const geoData = await this.fetchGeoData(geoSettings);

    // Check disposable email
    const isDisposableEmail = this.checkDisposableEmail(email);

    const result = {
      ...baseMetadata,
      ...geoData,
      isDisposableEmail,
    };

    return this.removeUndefined(result);
  }

  /**
   * Remove keys with undefined values to ensure Firestore compatibility
   */
  private removeUndefined<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    const result: any = {};

    Object.keys(obj).forEach((key) => {
      const value = (obj as any)[key];
      if (value !== undefined) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          result[key] = this.removeUndefined(value);
        } else {
          result[key] = value;
        }
      }
    });

    return result;
  }
}
