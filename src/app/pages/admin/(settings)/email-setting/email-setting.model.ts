/**
 * Email Provider Types
 */
export type EmailProvider = 'smtp' | 'resend' | 'gmail' | 'debug_log';

/**
 * SMTP Configuration
 */
export interface ISmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
}

/**
 * Gmail Configuration
 */
export interface IGmailConfig {
    user?: string;
    password?: string;
}

/**
 * Resend Configuration
 */
export interface IResendConfig {
    apiKey: string;
}

/**
 * Rate Limit Configuration (legacy)
 */
export interface IRateLimitConfig {
    /** Maximum number of emails allowed within the interval */
    maxEmails: number;
    /** Time interval */
    interval: 'second' | 'minute' | 'hour' | 'day';
}

/**
 * Three-tier rate limit for a specific email provider
 */
export interface IProviderRateLimits {
    /** Max emails per second (burst control). Default: 1 */
    perSecond: number;
    /** Max emails per hour (optional rolling limit) */
    perHour?: number;
    /** Max emails per day (daily quota) */
    perDay?: number;
}

/**
 * Auto-Purge Configuration
 */
export interface IAutoPurgeConfig {
    /** Whether auto-purge is enabled */
    enabled: boolean;
    /** Number of days to retain email logs */
    retentionDays: number;
}

/**
 * Per-feature email toggles (spec §3.1).
 * All default TRUE and are moot when the master `isEnabled` is off.
 */
export interface IEmailFeatureToggles {
    /** OTP + welcome + waitlist broadcasts */
    waitlistEmails: boolean;
    /** signup OTP + welcome-on-signup */
    authEmails: boolean;
    /** payment lifecycle + trial/updates reminders */
    paymentEmails: boolean;
    /** notification → email delivery */
    notificationEmails: boolean;
    broadcasts: boolean;
    drips: boolean;
    /** instant admin alerts + daily digest */
    adminAlerts: boolean;
}

/** Default feature toggles — everything on. */
export const DEFAULT_EMAIL_FEATURES: IEmailFeatureToggles = {
    waitlistEmails: true,
    authEmails: true,
    paymentEmails: true,
    notificationEmails: true,
    broadcasts: true,
    drips: true,
    adminAlerts: true,
};

/** UI metadata for rendering the Features toggle group. */
export const EMAIL_FEATURE_META: Array<{
    key: keyof IEmailFeatureToggles;
    label: string;
    description: string;
}> = [
    { key: 'waitlistEmails', label: 'Waitlist emails', description: 'OTP, welcome & waitlist broadcasts' },
    { key: 'authEmails', label: 'Account emails', description: 'Signup OTP & welcome-on-signup' },
    { key: 'paymentEmails', label: 'Payment emails', description: 'Receipts, trial & renewal reminders' },
    { key: 'notificationEmails', label: 'Notification emails', description: 'Email delivery of in-app notifications' },
    { key: 'broadcasts', label: 'Broadcasts', description: 'One-off campaign sends' },
    { key: 'drips', label: 'Drip campaigns', description: 'Automated sequences' },
    { key: 'adminAlerts', label: 'Admin alerts', description: 'Instant admin alerts & daily digest' },
];

/**
 * Email Settings Model
 */
export interface IEmailSettings {
    id?: string;
    /** Whether email sending is enabled */
    isEnabled: boolean;
    /** Active email provider */
    activeProvider: EmailProvider;
    /** Default sender email address */
    senderEmail: string;
    /** Default sender display name */
    senderName: string;
    /** Reply-to email address (optional) */
    replyToEmail?: string;
    /** SMTP configuration */
    smtp: ISmtpConfig;
    /** Resend configuration */
    resend: IResendConfig;
    /** Timestamp when settings were created */
    createdAt?: Date;
    /** Timestamp when settings were last updated */
    updatedAt?: Date;
    /** Gmail SMTP Configuration*/
    gmail: IGmailConfig;
    /** BCC email for admin copies */
    bccEmail?: string;
    /** Rate limit for broadcast sending (legacy) */
    rateLimit?: IRateLimitConfig;
    /** Per-provider rate limits (new). Overrides legacy rateLimit. */
    providerRateLimits?: Record<string, IProviderRateLimits>;
    /** Auto-purge old email logs */
    autoPurge?: IAutoPurgeConfig;
    /** Per-feature email toggles (spec §3.1) */
    features?: IEmailFeatureToggles;
    /** E4 — require email verification on signup (default false) */
    requireSignupVerification?: boolean;
    /** Open-tracking pixel base URL (moved out of source). */
    trackingPixelUrl?: string;
    /** Public base URL for unsubscribe/preferences links. */
    liveUrl?: string;
}

/**
 * Payload for the `testSmtpConfigConnection` callable.
 *
 * Provider credentials travel in the request body and are never persisted.
 * This replaced a Firestore round-trip through `Settings/emailTestingConnection`,
 * which left the SMTP password / Resend API key sitting in the database
 * indefinitely — nothing ever cleared them.
 */
export interface IConnectionTestPayload {
    config: IEmailSettings;
    activeProvider: EmailProvider;
    testEmail?: string;
    subject?: string;
    message?: string;
}

/** Result returned by the `testSmtpConfigConnection` callable. */
export interface IConnectionTestResult {
    success: boolean;
    message: string;
}

/**
 * Whether `settings` carries a valid provider configuration.
 * Mirrors the Email Settings page's `isProviderConfigValid()` but operates on
 * plain data so callers without a live provider component (e.g. the onboarding
 * wizard, E6) can enforce the same "no enable without a valid provider" rule.
 */
export function hasValidProviderConfig(settings: Partial<IEmailSettings>): boolean {
    switch (settings.activeProvider) {
        case 'smtp':
            return !!settings.smtp?.host && !!settings.smtp?.user && !!settings.smtp?.password;
        case 'gmail':
            return !!settings.gmail?.user && !!settings.gmail?.password;
        case 'resend':
            return !!settings.resend?.apiKey;
        case 'debug_log':
            // Simulated provider — no credentials required.
            return true;
        default:
            return false;
    }
}

/**
 * Default rate limits per provider (based on provider guidelines)
 */
export const PROVIDER_DEFAULT_LIMITS: Record<EmailProvider, IProviderRateLimits> = {
    smtp:   { perSecond: 1 },
    gmail:  { perSecond: 1, perDay: 500 },
    resend: { perSecond: 2, perDay: 100 },
    // Simulated provider — effectively unlimited (never blocks in testing).
    debug_log: { perSecond: 1000 },
};

/**
 * Default email settings values
 */
export const DEFAULT_EMAIL_SETTINGS: IEmailSettings = {
    isEnabled: false,
    activeProvider: 'smtp',
    senderEmail: '',
    senderName: 'Arc CMS',
    replyToEmail: '',
    smtp: {
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
    },
    resend: {
        apiKey: '',
    },
    gmail: {
        user: '',
        password: '',
    },
    bccEmail: '',
    rateLimit: {
        maxEmails: 1,
        interval: 'second',
    },
    providerRateLimits: {
        smtp:   { perSecond: 1 },
        gmail:  { perSecond: 1, perDay: 500 },
        resend: { perSecond: 2, perDay: 100 },
        debug_log: { perSecond: 1000 },
    },
    autoPurge: {
        enabled: true,
        retentionDays: 60,
    },
    features: { ...DEFAULT_EMAIL_FEATURES },
    requireSignupVerification: false,
};

/**
 * Provider display information
 */
export interface IEmailProviderInfo {
    id: EmailProvider;
    name: string;
    description: string;
    icon: string;
    helpUrl: string;
    helpLabel: string;
    bestFor: string;
    freeLimit: string;
    /** If true, the provider requires senderEmail to match a provider-specific email */
    locksSenderEmail?: boolean;
}

export const EMAIL_PROVIDERS: IEmailProviderInfo[] = [
    {
        id: 'gmail',
        name: 'Gmail',
        description: 'Send emails using your Google account',
        icon: 'fa-solid fa-envelope',
        helpUrl: 'https://myaccount.google.com/apppasswords',
        helpLabel: 'Generate an App Password',
        bestFor: 'Small sites sending fewer than 500 emails/day',
        freeLimit: 'Up to 500 emails per day (free with any Gmail account)',
        locksSenderEmail: true,
    },
    {
        id: 'smtp',
        name: 'SMTP',
        description: 'Connect to any email server (Outlook, Yahoo, etc.)',
        icon: 'fa-solid fa-server',
        helpUrl: '',
        helpLabel: '',
        bestFor: 'Users who already have an email hosting provider',
        freeLimit: 'Depends on your email provider',
    },
    {
        id: 'resend',
        name: 'Resend',
        description: 'Simple, reliable email API — easy setup',
        icon: 'fa-solid fa-paper-plane',
        helpUrl: 'https://resend.com/api-keys',
        helpLabel: 'Get your Resend API Key',
        bestFor: 'Developers who want a simple, modern email service',
        freeLimit: 'Up to 100 emails/day and 3,000/month on the free plan',
    },
    {
        id: 'debug_log',
        name: 'Debug Provider (Log Only)',
        description: 'Simulated provider — records every email in Email Logs but never actually sends.',
        icon: 'fa-solid fa-bug',
        helpUrl: '',
        helpLabel: '',
        bestFor: 'Testing the whole email pipeline without a real provider or inbox',
        freeLimit: 'Nothing is sent — every message is recorded in Email Logs only',
    },
];
