import { Timestamp } from 'firebase-admin/firestore';
import { constant } from '../constant.js';
import { db } from '../init.js';
import nodemailer from 'nodemailer';
import { EmailLogData, EmailSettings, ProcessedTemplate } from '../types.js';
import { checkQuota, incrementSendCount, resolveProviderLimits } from './emailCounter.js';
import { getMiscSettings } from '../shared/site-settings.js';
import { POWERED_BY_EMAIL_HTML } from '../shared/html-document.js';
import { buildUnsubscribeUrl, buildPreferencesUrl } from '../email-core/unsubscribeToken.js';
import { getUnsubscribeSecret } from '../email-core/unsubscribeSecret.js';

/** Base retry backoff unit: 5 minutes. */
const RETRY_BASE_MS = 5 * 60 * 1000;
/** Delay before re-checking a quota-deferred send. */
const QUOTA_DEFER_MS = 15 * 60 * 1000;
/** Default max delivery attempts (mirrors queueEmail DEFAULT_MAX_ATTEMPTS). */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Custom contact-field merge tag (U4.5): `##FIELD:key##`, optionally with a
 * fallback — `##FIELD:company|your company##`.
 *
 * The fallback is why this exists: two forms feeding one list collect different
 * fields, so a template referencing a field only some recipients have would
 * otherwise render a blank gap for the rest.
 */
const FIELD_TAG_PATTERN = /##FIELD:([a-zA-Z0-9_]+)(?:\|([^#]*))?##/g;

/**
 * App user field merge tag (App audience, CO6.5a): `##APP.<path>##`, with an
 * optional fallback, `##APP.subscription.tier|free##`. Resolved from the host
 * fields copied onto the log when the email was queued (`appFields`).
 */
const APP_TAG_PATTERN = /##APP\.([A-Za-z0-9_.-]+)(?:\|([^#]*))?##/g;

/**
 * Every merge tag form in one pattern, so a template is resolved in a single
 * pass: `##FIELD:key|fb##` (groups 1, 2), `##APP.path|fb##` (3, 4) and
 * `##TAG##` (5). A resolved value is never scanned again, so a value that
 * itself looks like a tag (a host user named `##UNSUBSCRIBE_SECRET##`) stays
 * plain text.
 */
const MERGE_TAG_PATTERN = new RegExp(
    `${FIELD_TAG_PATTERN.source}|${APP_TAG_PATTERN.source}|##([A-Z_]+)##`,
    'g',
);

/**
 * The only `Settings/email` keys a `##TAG##` may read (`##SENDER_NAME##`,
 * `##LIVE_URL##`...). The rest of that document holds provider credentials
 * and the unsubscribe signing secret.
 */
const SETTINGS_TAG_KEYS = ['companyName', 'senderName', 'senderEmail', 'replyToEmail', 'liveUrl'] as const;

/** Log fields that are plumbing, not merge data: never read by a `##TAG##`. */
const LOG_KEYS_NEVER_MERGED = new Set(['bcc', 'template', 'text', 'emailHash', 'contactFields', 'appFields']);

/**
 * A merge value as HTML text. Values come from people (names, host app
 * fields, event data), so markup in them is shown, never rendered. Line
 * breaks become `<br>` so multi-line values keep their shape.
 */
export function mergeValueHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\r?\n/g, '<br>');
}

/** A merge value for the subject line: plain text on one line. */
function mergeValueSubject(value: string): string {
    return value.replace(/[\r\n]+/g, ' ');
}

/**
 * Build a 1x1 tracking-pixel <img> tag.
 * Returns an empty string when TRACKING_PIXEL_URL is not configured.
 */
function buildTrackingPixel(emailId: string, trackingUrl?: string): string {
    const url = trackingUrl || constant.TRACKING_PIXEL_URL;
    if (!url) return '';
    return `<img src="${url}?emailId=${emailId}" width="1" height="1" style="opacity:0; position:absolute; top:-9999px; left:-9999px;" alt=""/>`;
}

export async function sendMail(emailLogsData: EmailLogData, emailLogsId: string): Promise<void> {
    const settingsEmailRef = db.collection('Settings').doc('email');
    const settingsEmailDoc = await settingsEmailRef.get();

    const logRef = db.collection('EmailLogs').doc(emailLogsId);

    const currentAttempts = emailLogsData.attempts || 0;
    const maxAttempts = emailLogsData.maxAttempts || DEFAULT_MAX_ATTEMPTS;

    let updatedTemplate: ProcessedTemplate | undefined;
    let activeProvider = 'smtp';

    const settings = settingsEmailDoc.data() as EmailSettings | undefined;

    // Belt-and-braces kill-switch (chokepoint 2): if email was disabled after
    // this doc was queued, mark it skipped rather than sending. Re-checked on
    // every retry attempt too.
    if (!settings?.isEnabled || !settings?.activeProvider) {
        console.log('Email sending is disabled in settings.');
        await logRef.update({
            status: 'skipped',
            skipReason: 'email_disabled',
            sendingTime: Timestamp.now(),
        });
        return;
    }

    activeProvider = settings.activeProvider || 'smtp';

    // Debug Provider (Log Only): a SIMULATED provider — record the composed
    // email, never call a network provider, and never consume quota.
    const isDebugProvider = activeProvider === 'debug_log';

    // Universal quota/rate-limit enforcement for ALL real sends (spec §Phase-1.3).
    // Exhausted ⇒ defer and let retryPendingEmails pick it up when quota resets.
    if (!isDebugProvider) try {
        const limits = resolveProviderLimits(activeProvider, settings.providerRateLimits);
        const quota = await checkQuota(activeProvider, limits);
        if (!quota.ok) {
            console.warn(`sendMail: quota exhausted for ${activeProvider}; deferring ${emailLogsId}.`);
            await logRef.update({
                status: 'deferred',
                skipReason: 'quota',
                nextAttemptAt: Timestamp.fromMillis(Date.now() + QUOTA_DEFER_MS),
                activeProvider,
            });
            return;
        }
    } catch (quotaErr) {
        console.warn('sendMail: quota check failed, proceeding with send:', quotaErr);
    }

    // Unsubscribe and preference links need the site's secret; it is created
    // on first use rather than expected in Settings/email (see unsubscribeSecret.ts).
    settings.unsubscribeSecret = await getUnsubscribeSecret(settings.unsubscribeSecret);

    try {
        updatedTemplate = await processEmailTemplate(emailLogsData, settings);

        // Conditionally append "Powered by Arc CMS" branding
        try {
            const miscSettings = await getMiscSettings();
            if (miscSettings.showPoweredBy) {
                updatedTemplate.template += POWERED_BY_EMAIL_HTML;
            }
        } catch (brandingErr) {
            console.warn('Failed to check showPoweredBy setting, skipping branding:', brandingErr);
        }

        // Marketing sends carry List-Unsubscribe headers (RFC 2369 / 8058).
        const unsubHeaders = buildListUnsubscribeHeaders(emailLogsData, settings);

        // Debug Provider (Log Only): record the fully-composed email but never
        // call a provider. The stored processedTemplate/processedSubject is the
        // exact message that would have been sent — verifiable from EmailLogs alone.
        const logOnly = isDebugProvider;

        let result: { messageId?: string } | undefined;

        if (logOnly) {
            result = { messageId: `debug-log-provider:${emailLogsId}` };
            console.log(`sendMail: Debug Provider (Log Only) — recorded ${emailLogsId} without sending.`);
        } else {
            switch (activeProvider) {
                case 'resend':
                    result = await sendResendMail(emailLogsData, updatedTemplate, settings, unsubHeaders);
                    break;
                case 'gmail':
                    result = await sendGmailMail(emailLogsData, updatedTemplate, settings, unsubHeaders);
                    break;
                case 'smtp':
                default:
                    result = await sendSmtpMail(emailLogsData, updatedTemplate, settings, unsubHeaders);
                    break;
            }
        }

        const updateData: Record<string, any> = {
            status: 'success',
            attempts: currentAttempts + 1,
            sendingTime: Timestamp.now(),
            processedSubject: updatedTemplate.subject,
            processedTemplate: updatedTemplate.template,
            usedTags: updatedTemplate.usedTags,
            unmappedTags: updatedTemplate.unmappedTags,
            activeProvider,
        };
        if (logOnly) updateData.logOnly = true;

        if (result?.messageId) {
            updateData.messageId = result.messageId;
        }

        await logRef.update(updateData);

        // Increment daily/hourly send counters (skip in log-only — no real send).
        if (!logOnly) {
            try {
                await incrementSendCount(activeProvider);
            } catch (counterErr) {
                console.warn('Failed to increment email counter:', counterErr);
            }
        }
    } catch (err) {
        // Transient failure ⇒ retry with exponential backoff until maxAttempts.
        const newAttempts = currentAttempts + 1;
        const exhausted = newAttempts >= maxAttempts;

        const failData: Record<string, any> = {
            status: exhausted ? 'failed' : 'retrying',
            attempts: newAttempts,
            sendingTime: Timestamp.now(),
            activeProvider,
            errorMessage: err instanceof Error ? err.message : String(err),
        };
        if (!exhausted) {
            failData.nextAttemptAt = Timestamp.fromMillis(
                Date.now() + RETRY_BASE_MS * Math.pow(2, newAttempts),
            );
        }
        if (updatedTemplate) {
            failData.processedSubject = updatedTemplate.subject;
            failData.processedTemplate = updatedTemplate.template;
            failData.usedTags = updatedTemplate.usedTags;
            failData.unmappedTags = updatedTemplate.unmappedTags;
        }
        await logRef.update(failData);
        console.error(
            `Error sending email ${emailLogsId} (attempt ${newAttempts}/${maxAttempts}, ${exhausted ? 'failed' : 'will retry'}):`,
            err,
        );
    }
}

/**
 * Build List-Unsubscribe / List-Unsubscribe-Post headers for marketing sends.
 * Returns an empty object for transactional email or when no unsubscribe URL
 * can be built (missing secret).
 */
function buildListUnsubscribeHeaders(
    emailLogsData: EmailLogData,
    settings: EmailSettings,
): Record<string, string> {
    if (emailLogsData.category !== 'marketing') return {};
    const url = buildUnsubscribeUrl(emailLogsData.toEmail, settings.unsubscribeSecret, settings.liveUrl);
    if (!url) return {};
    return {
        'List-Unsubscribe': `<${url}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
}

async function sendSmtpMail(emailLogsData: EmailLogData, updatedTemplate: ProcessedTemplate, settings: EmailSettings, extraHeaders: Record<string, string> = {}) {
    const smtpSettings = settings?.smtp || {} as Partial<import('../types.js').SmtpConfig>;

    const transporterMail = nodemailer.createTransport({
        host: smtpSettings.host,
        port: smtpSettings.port || 587,
        secure: smtpSettings.secure || false,
        auth: {
            user: smtpSettings.user || settings?.smtpUser,
            pass: smtpSettings.password || settings?.smtpPassword,
        },
    });

    return await transporterMail.sendMail({
        from: `"${emailLogsData.senderName}" <${emailLogsData.senderEmail}>`,
        to: `"${emailLogsData.toName}" <${emailLogsData.toEmail}>`,
        subject: updatedTemplate.subject,
        text: emailLogsData.text,
        replyTo: settings.replyToEmail,
        html: updatedTemplate.template + buildTrackingPixel(emailLogsData.id ?? '', settings.trackingPixelUrl),
        bcc: emailLogsData.bcc || undefined,
        headers: extraHeaders,
    });
}

async function sendResendMail(emailLogsData: EmailLogData, updatedTemplate: ProcessedTemplate, settings: EmailSettings, extraHeaders: Record<string, string> = {}) {
    const resendConfig = settings?.resend;
    if (!resendConfig?.apiKey) {
        throw new Error('Resend API Key is missing');
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendConfig.apiKey}`,
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
            from: `${emailLogsData.senderName} <${emailLogsData.senderEmail}>`,
            to: [emailLogsData.toEmail],
            subject: updatedTemplate.subject,
            html: updatedTemplate.template + buildTrackingPixel(emailLogsData.id ?? '', settings.trackingPixelUrl),
            text: emailLogsData.text,
            reply_to: settings.replyToEmail,
            ...(Object.keys(extraHeaders).length ? { headers: extraHeaders } : {}),
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Resend Error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    return { messageId: data.id };
}

async function sendGmailMail(emailLogsData: EmailLogData, updatedTemplate: ProcessedTemplate, settings: EmailSettings, extraHeaders: Record<string, string> = {}) {
    const gmailSettings = settings?.gmail || {} as Partial<import('../types.js').GmailConfig>;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        secure: true,
        auth: {
            user: gmailSettings.user,
            pass: gmailSettings.password,
        },
    });

    return await transporter.sendMail({
        from: `"${emailLogsData.senderName}" <${emailLogsData.senderEmail}>`,
        to: `"${emailLogsData.toName}" <${emailLogsData.toEmail}>`,
        subject: updatedTemplate.subject,
        text: emailLogsData.text,
        html: updatedTemplate.template + buildTrackingPixel(emailLogsData.id ?? '', settings.trackingPixelUrl),
        replyTo: settings.replyToEmail || undefined,
        bcc: emailLogsData.bcc || undefined,
        headers: extraHeaders,
    });
}


export async function processEmailTemplate(
    emailLogsData: EmailLogData,
    configData: EmailSettings | undefined,
    customReplacements?: Record<string, string | (() => string)>
): Promise<ProcessedTemplate> {
    // HMAC-token unsubscribe link keyed by the recipient's emailHash — fixes the
    // historical empty-userId bug. Empty when no unsubscribeSecret is configured.
    const unsubscribe_link = buildUnsubscribeUrl(emailLogsData.toEmail, configData?.unsubscribeSecret, configData?.liveUrl);
    const preferences_link = buildPreferencesUrl(emailLogsData.toEmail, configData?.unsubscribeSecret, configData?.liveUrl);

    // Default tag mappings - automatically maps tags to data paths
    const defaultMappings: Record<string, () => string> = {
        OTP: () => emailLogsData.otp || '',
        RECEIVER_NAME: () =>
            emailLogsData?.toName ||
            emailLogsData?.toEmail?.split('@')[0] || '',
        // ##NAME## is an alias for ##RECEIVER_NAME## — both resolve the same way
        NAME: () =>
            emailLogsData?.toName ||
            emailLogsData?.toEmail?.split('@')[0] || '',
        COMPANY_NAME: () => configData?.companyName || '',
        PAYMENT_AMOUNT: () => {
            const currency = emailLogsData?.currency || 'INR';
            const price = emailLogsData?.price || '';
            return price ? `${currency} ${price}` : '';
        },
        REFERRAL_LINK: () => emailLogsData?.referralLink || '',
        LEADERBOARD_LINK: () => emailLogsData?.leaderboardLink || '',
        WAITLIST: () => emailLogsData?.waitlistName || '',
        UNSUBSCRIBE_LINK: () => unsubscribe_link || '',
        PREFERENCES_LINK: () => preferences_link || '',
    };

    const template = emailLogsData.template || '';
    const subject = emailLogsData.subject || '';

    // Custom contact fields (U4.5): ##FIELD:key## or ##FIELD:key|fallback##. An
    // explicit FIELD: prefix keeps custom fields from colliding with built-in
    // tags (a field named `company` vs ##COMPANY_NAME##).
    const fieldValues = (emailLogsData as unknown as { contactFields?: Record<string, unknown> }).contactFields || {};
    // App user fields (CO6.5a): ##APP.<path>##, from the host fields on the log.
    const appValues = (emailLogsData as unknown as { appFields?: Record<string, unknown> }).appFields || {};
    const orFallback = (raw: unknown, fallback?: string): string =>
        raw === undefined || raw === null || raw === '' ? fallback ?? '' : String(raw);

    const logData = emailLogsData as unknown as Record<string, unknown>;
    const settingsData = pickSettingsTagData(configData);
    const foundTags = new Set<string>();
    const unmappedTags: string[] = [];
    const tagValues = new Map<string, string>();

    // Priority: custom > default > auto-detect from the log, then settings.
    const tagValue = (tag: string): string => {
        const known = tagValues.get(tag);
        if (known !== undefined) return known;
        let value: string;
        const custom = customReplacements?.[tag];
        if (custom) {
            value = typeof custom === 'function' ? custom() : String(custom);
        } else if (defaultMappings[tag]) {
            value = defaultMappings[tag]();
        } else {
            const autoValue = autoDetectValue(tag, logData, settingsData);
            if (autoValue === null) unmappedTags.push(tag);
            value = autoValue ?? ''; // Replace with empty string if not found
        }
        tagValues.set(tag, value);
        return value;
    };

    const valueOf = (
        fieldKey: string | undefined, fieldFallback: string | undefined,
        appPath: string | undefined, appFallback: string | undefined,
        tag: string | undefined,
    ): string => {
        if (fieldKey !== undefined) return orFallback(fieldValues[fieldKey], fieldFallback);
        if (appPath !== undefined) return orFallback(appValues[appPath], appFallback);
        foundTags.add(tag as string);
        return tagValue(tag as string);
    };

    const processedTemplate = template.replace(MERGE_TAG_PATTERN, (_m, f, ff, a, af, t) =>
        mergeValueHtml(valueOf(f, ff, a, af, t)));
    const processedSubject = subject.replace(MERGE_TAG_PATTERN, (_m, f, ff, a, af, t) =>
        mergeValueSubject(valueOf(f, ff, a, af, t)));

    // Log unmapped tags for debugging
    if (unmappedTags.length > 0) {
        console.warn('Unmapped tags found:', unmappedTags);
        console.warn('Consider adding custom replacements for these tags');
    }

    return {
        template: processedTemplate,
        subject: processedSubject,
        usedTags: Array.from(foundTags),
        unmappedTags,
    };
}

/** The `Settings/email` values a `##TAG##` may read (see SETTINGS_TAG_KEYS). */
function pickSettingsTagData(configData: EmailSettings | undefined): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const key of SETTINGS_TAG_KEYS) {
        if (configData?.[key] !== undefined) picked[key] = configData[key];
    }
    return picked;
}

// Auto-detect value from data objects. Only plain values merge: an object
// would print as "[object Object]", and plumbing fields stay out.
function autoDetectValue(
    tag: string,
    emailLogsData: Record<string, unknown>,
    configData: Record<string, unknown> | undefined
): string | null {
    // Convert TAG_NAME to camelCase (e.g., USER_EMAIL -> userEmail)
    const camelCase = tag
        .toLowerCase()
        .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

    // Convert TAG_NAME to snake_case (e.g., USER_EMAIL -> user_email)
    const snakeCase = tag.toLowerCase();

    // Try different key formats in emailLogsData first, then configData
    const sources = [emailLogsData, configData];
    const keyVariations = [
        camelCase,
        snakeCase,
        tag.toLowerCase(),
        tag,
    ];

    for (const source of sources) {
        if (!source) continue;

        for (const key of keyVariations) {
            if (source === emailLogsData && LOG_KEYS_NEVER_MERGED.has(key)) continue;
            const value = source[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                return String(value);
            }
        }
    }

    return null;
}
