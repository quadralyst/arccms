/**
 * Signup Metadata Interface
 *
 * Marketing data collected during waitlist signup for attribution,
 * lead qualification, and behavioral analysis.
 */

/**
 * Core metadata collected during signup
 */
export interface ISignupMetadata {
  // Phase 1: Attribution & Source
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrerUrl?: string;
  landingPage?: string;
  queryParams?: Record<string, string>;

  // Phase 1: Device & Technical
  deviceType?: 'desktop' | 'mobile' | 'tablet';
  operatingSystem?: string;
  browser?: string;
  browserVersion?: string;
  screenResolution?: string;
  language?: string;

  // Phase 1b: Device Extended
  connectionType?: string;
  downlinkSpeed?: number;
  prefersDarkMode?: boolean;
  viewportSize?: string;
  isTouchDevice?: boolean;
  timezoneOffset?: number;
  signupHour?: number;
  signupDayOfWeek?: number;
  pageLoadTimeMs?: number;

  // Phase 2: Behavioral
  timeOnPageMs?: number;
  scrollDepthPercent?: number;
  isReturnVisitor?: boolean;
  visitCount?: number;
  pageLoadTimestamp?: number;

  // Phase 2b: Cross-Session Behavioral
  firstVisitTimestamp?: number;
  lastVisitTimestamp?: number;
  totalTimeOnPageMs?: number;
  maxScrollDepthPercent?: number;
  formStartCount?: number;

  // Phase 2c: Engagement
  clickCount?: number;
  tabSwitchCount?: number;

  // Phase 3: Geographic (optional, requires API config)
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
  ipAddress?: string;

  // Phase 4: Lead Quality
  isDisposableEmail?: boolean;
}
