import { Timestamp } from 'firebase-admin/firestore';

export interface EmailTemplateData {
  senderEmail: string;
  senderName: string;
  subject: string;
  template: string;
  previewText?: string;
  waitlistId?: string;
  type: string;
  [key: string]: any;
}

export interface WaitlistUserData {
  id?: string;
  waitlistId: string;
  waitlistIds?: string[];
  email: string;
  name?: string;
  firstName?: string; // Sometimes used instead of name
  verificationCode?: string;
  emailVerified?: boolean;
  isConfirmed?: boolean;
  referralLink?: string;
  leaderboardLink?: string;
  [key: string]: any;
}

/** Email category — drives consent/suppression rules (see spec §2.3). */
export type EmailCategory = 'transactional' | 'marketing';

/** Which feature produced an email — used for the per-feature toggle gate. */
export type EmailSource =
  | 'waitlist'
  | 'auth'
  | 'payment'
  | 'notification'
  | 'broadcast'
  | 'drip'
  | 'event'
  | 'test';

/** EmailLogs.status lifecycle (spec §3.4). */
export type EmailLogStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'retrying'
  | 'deferred'
  | 'skipped'
  | 'suppressed';

/** Why a send was blocked before/at send time (spec §3.4). */
export type EmailSkipReason =
  | 'email_disabled'
  | 'feature_disabled'
  | 'template_inactive'
  | 'unsubscribed'
  | 'suppressed'
  | 'quota';

export interface EmailLogData {
  id?: string;
  senderEmail: string;
  senderName: string;
  toName: string;
  toEmail: string;
  subject: string;
  template: string;
  text: string;
  bcc?: string;
  type: string;
  createdAt: Timestamp;
  otp?: string;
  currency?: string;
  price?: string;
  waitlistName?: string;
  referralLink?: string;
  leaderboardLink?: string;
  // ── Email-core pipeline fields (Phase 1) ──
  /** transactional vs marketing — controls consent/suppression rules */
  category?: EmailCategory;
  /** Which feature produced this email */
  source?: EmailSource;
  /** sha256(lowercase(trim(toEmail))) — stable recipient key, matches email_lookup scheme */
  emailHash?: string;
  /** Delivery attempts so far (0 when freshly queued) */
  attempts?: number;
  /** Max delivery attempts before giving up (default 3) */
  maxAttempts?: number;
  /** When the next retry/deferred send should be attempted */
  nextAttemptAt?: Timestamp;
  /** Reason a send was blocked (set alongside status skipped/suppressed/deferred) */
  skipReason?: EmailSkipReason;
  // Post-send processed data
  processedSubject?: string;
  processedTemplate?: string;
  usedTags?: string[];
  unmappedTags?: string[];
  activeProvider?: string;
  status?: EmailLogStatus;
  sendingTime?: Timestamp;
  messageId?: string;
  errorMessage?: string;
  broadcastId?: string;
  // Webhook/tracking fields (written by handlers, typed here for safety)
  lastWebhookEvent?: string;
  lastWebhookAt?: Timestamp;
  isOpened?: boolean;
  openedAt?: Timestamp;
  ipAddress?: string;
  [key: string]: any;
}

// ── Email provider configuration interfaces ──

export interface SmtpConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  secure?: boolean;
}

export interface GmailConfig {
  user: string;
  password: string;
}

export interface ResendConfig {
  apiKey: string;
}

/** Rate limit configuration for broadcast emails (legacy) */
export interface RateLimitConfig {
  /** Maximum number of emails allowed within the interval */
  maxEmails: number;
  /** Time interval */
  interval: 'second' | 'minute' | 'hour' | 'day';
}

/** Three-tier rate limit for a specific email provider */
export interface ProviderRateLimits {
  /** Max emails per second (burst control). Default: 1 */
  perSecond: number;
  /** Max emails per hour (optional rolling limit) */
  perHour?: number;
  /** Max emails per day (daily quota) */
  perDay?: number;
}

/** Auto-purge configuration for email logs */
export interface AutoPurgeConfig {
  /** Whether auto-purge is enabled */
  enabled: boolean;
  /** Number of days to retain email logs */
  retentionDays: number;
}

/**
 * Per-feature email toggles (spec §3.1). All default TRUE and are moot when
 * the master `isEnabled` is false. A feature toggle OFF disables only that
 * feature's email delivery.
 */
export interface EmailFeatureToggles {
  /** OTP + welcome + waitlist broadcasts */
  waitlistEmails?: boolean;
  /** signup OTP + welcome-on-signup */
  authEmails?: boolean;
  /** payment lifecycle + trial/updates reminders */
  paymentEmails?: boolean;
  /** notification → email delivery */
  notificationEmails?: boolean;
  broadcasts?: boolean;
  drips?: boolean;
  /** instant admin alerts + daily digest */
  adminAlerts?: boolean;
}

/** Admin digest configuration (spec §3.1) */
export interface AdminDigestConfig {
  enabled: boolean;
  hourUtc: number;
}

/** Shape of the Firestore Settings/email document */
export interface EmailSettings {
  isEnabled?: boolean;
  activeProvider?: 'smtp' | 'resend' | 'gmail';
  replyToEmail?: string;
  companyName?: string;
  senderName?: string;
  senderEmail?: string;
  smtp?: SmtpConfig;
  resend?: ResendConfig;
  gmail?: GmailConfig;
  /** Legacy flat SMTP credentials (before nested smtp object) */
  smtpUser?: string;
  smtpPassword?: string;
  bccEmail?: string;
  /** Rate limit for broadcast sending (legacy) */
  rateLimit?: RateLimitConfig;
  /** Per-provider rate limits (new). Overrides legacy rateLimit when present. */
  providerRateLimits?: Record<string, ProviderRateLimits>;
  /** Auto-purge old email logs */
  autoPurge?: AutoPurgeConfig;
  // ── Email-core additions (Phase 1) ──
  /** Per-feature email toggles */
  features?: EmailFeatureToggles;
  /** E4 — require email verification on signup (default false) */
  requireSignupVerification?: boolean;
  /** Daily admin digest config (default disabled, 08:00 UTC) */
  adminDigest?: AdminDigestConfig;
  /** Random secret used to sign one-click unsubscribe tokens (generated once) */
  unsubscribeSecret?: string;
  /**
   * Dev/test mode: compose and record the full email in EmailLogs but DON'T call
   * a provider. Marks the log `success` with `logOnly:true`. Lets you verify the
   * whole pipeline from logs alone, no inbox / real provider.
   */
  logOnlyMode?: boolean;
  /** Base URL for the open-tracking pixel (moved out of source constant). */
  trackingPixelUrl?: string;
  /** Public base URL for links (unsubscribe/preferences), overrides constant.live_url. */
  liveUrl?: string;
}

/**
 * Broadcast audience (Phase 6, §3.13). When present, recipients are resolved
 * server-side at send time from `Contacts` (not a frozen inline array).
 */
export interface BroadcastAudience {
  kind: 'list' | 'waitlist';
  listId?: string;
  waitlistId?: string;
  filters?: Array<{ field: 'premiumType' | 'source' | 'createdAfter'; op: '==' | '>='; value: any }>;
}

/** Schema for BroadcastEmails document processed server-side */
export interface BroadcastEmailDoc {
  waitlistId: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  previewText?: string;
  template: string;
  /** Recipient list stored inline (legacy path; ~10K max within 1MB doc limit) */
  recipients: BroadcastRecipient[];
  /** Audience (Phase 6). When set, recipients are resolved from Contacts at send time. */
  audience?: BroadcastAudience;
  /** Scheduled send time. Status stays 'scheduled' until due. */
  scheduledAt?: Timestamp;
  /** Total number of recipients */
  totalCount: number;
  /** How many have been sent successfully */
  sentCount: number;
  /** How many failed after all retry attempts */
  failedCount: number;
  /** How many were skipped by consent/suppression gates (Phase 6 summary) */
  skippedCount?: number;
  /** Index of the next recipient to process (legacy cursor) */
  processedIndex: number;
  /** Contacts paging cursor (audience path): last processed contact doc id */
  lastContactId?: string;
  /** Current processing status */
  status: 'scheduled' | 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** Snapshot of rate limit config at creation time (legacy) */
  rateLimitSnapshot?: RateLimitConfig;
  /** Snapshot of per-provider rate limits at creation time */
  providerRateLimitsSnapshot?: ProviderRateLimits;
  /** Number of chunk invocations completed */
  chunkNumber: number;
  /** Error message if the entire broadcast failed */
  errorMessage?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface BroadcastRecipient {
  toName: string;
  toEmail: string;
}

/** Return type of processEmailTemplate */
export interface ProcessedTemplate {
  template: string;
  subject: string;
  usedTags: string[];
  unmappedTags: string[];
}

/** Return type of getAnalyticsPropertyInfo */
export interface AnalyticsPropertyInfo {
  propertyId: string;
  propertyName?: string | null;
  parentAccount?: string | null;
  timeZone?: string | null;
  currencyCode?: string | null;
  industryCategory?: string | null;
}

// ── Analytics OAuth interfaces ──

export interface AnalyticsOAuthTokens {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number; // Unix timestamp ms
  scope?: string;
  connectedAt?: Timestamp;
  connectedBy?: string; // uid of admin who connected
}

export interface AnalyticsSelectedProperty {
  propertyId: string;
  displayName?: string;
  measurementId?: string;
}

/** Shape of the Firestore Settings/analytics document */
export interface AnalyticsSettings {
  authMethod?: 'service_account' | 'oauth';
  oauth?: AnalyticsOAuthTokens;
  selectedProperty?: AnalyticsSelectedProperty;
  isConnected?: boolean;
  lastError?: string | null;
  // Legacy service account fields
  serviceAccountJson?: string;
  propertyId?: string;
}

/** Shape of the Firestore Settings/analytics_status document (public, no tokens) */
export interface AnalyticsStatusDoc {
  isConnected: boolean;
  propertyName?: string | null;
  propertyId?: string | null;
  connectedAt?: Timestamp | null;
  lastSyncDate?: Timestamp | null;
}

/** Metric card format used by the dashboard */
export interface MetricCard {
  title: string;
  value: string;
  icon: string;
  change: string;
  changeType: 'positive' | 'negative';
}

/** Single row inside an acquisition list panel */
export interface ListItem {
  name: string;
  value: number;
  percentage: number;
}

/** Acquisition insight panel (Top Pages, Traffic Sources, etc.) */
export interface ListCard {
  title: string;
  icon: string;
  items: ListItem[];
}
