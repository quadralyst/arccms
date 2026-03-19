/**
 * Email Provider Types
 */
export type EmailProvider = 'smtp' | 'resend' | 'gmail';

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
}

/**
 * Default rate limits per provider (based on provider guidelines)
 */
export const PROVIDER_DEFAULT_LIMITS: Record<EmailProvider, IProviderRateLimits> = {
    smtp:   { perSecond: 1 },
    gmail:  { perSecond: 1, perDay: 500 },
    resend: { perSecond: 2, perDay: 100 },
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
    },
    autoPurge: {
        enabled: true,
        retentionDays: 60,
    },
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
];
