import { Timestamp } from 'firebase-admin/firestore';
import { constant } from '../constant.js';
import { db } from '../init.js';
import nodemailer from 'nodemailer';
import { EmailLogData, EmailSettings, ProcessedTemplate } from '../types.js';
import { checkQuota, incrementSendCount, resolveProviderLimits } from './emailCounter.js';
import { getMiscSettings } from '../shared/site-settings.js';
import { POWERED_BY_EMAIL_HTML } from '../shared/html-document.js';
import { buildUnsubscribeUrl } from '../email-core/unsubscribeToken.js';

/** Base retry backoff unit: 5 minutes. */
const RETRY_BASE_MS = 5 * 60 * 1000;
/** Delay before re-checking a quota-deferred send. */
const QUOTA_DEFER_MS = 15 * 60 * 1000;
/** Default max delivery attempts (mirrors queueEmail DEFAULT_MAX_ATTEMPTS). */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Build a 1x1 tracking-pixel <img> tag.
 * Returns an empty string when TRACKING_PIXEL_URL is not configured.
 */
function buildTrackingPixel(emailId: string): string {
    if (!constant.TRACKING_PIXEL_URL) return '';
    return `<img src="${constant.TRACKING_PIXEL_URL}?emailId=${emailId}" width="1" height="1" style="opacity:0; position:absolute; top:-9999px; left:-9999px;" alt=""/>`;
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

    // Universal quota/rate-limit enforcement for ALL sends (spec §Phase-1.3).
    // Exhausted ⇒ defer and let retryPendingEmails pick it up when quota resets.
    try {
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

        let result;

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

        if (result?.messageId) {
            updateData.messageId = result.messageId;
        }

        await logRef.update(updateData);

        // Increment daily/hourly send counters (non-fatal if this fails)
        try {
            await incrementSendCount(activeProvider);
        } catch (counterErr) {
            console.warn('Failed to increment email counter:', counterErr);
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
    const url = buildUnsubscribeUrl(emailLogsData.toEmail, settings.unsubscribeSecret);
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
        html: updatedTemplate.template + buildTrackingPixel(emailLogsData.id ?? ''),
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
            html: updatedTemplate.template + buildTrackingPixel(emailLogsData.id ?? ''),
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
        html: updatedTemplate.template + buildTrackingPixel(emailLogsData.id ?? ''),
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
    const unsubscribe_link = buildUnsubscribeUrl(emailLogsData.toEmail, configData?.unsubscribeSecret);

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
    };

    // Auto-detect tags from template and subject
    const template = emailLogsData.template || '';
    const subject = emailLogsData.subject || '';
    const combinedText = `${template} ${subject}`;

    // Extract all unique tags (e.g., ##TAG_NAME##)
    const tagPattern = /##([A-Z_]+)##/g;
    const foundTags = new Set<string>();
    let match;

    while ((match = tagPattern.exec(combinedText)) !== null) {
        foundTags.add(match[1]);
    }

    // Build final replacements
    const finalReplacements: Record<string, () => string> = {};
    const unmappedTags: string[] = [];

    foundTags.forEach(tag => {
        // Priority: custom > default > auto-detect from data
        if (customReplacements?.[tag]) {
            // Handle both string and function custom replacements
            finalReplacements[tag] = typeof customReplacements[tag] === 'function'
                ? customReplacements[tag] as () => string
                : () => String(customReplacements[tag]);
        } else if (defaultMappings[tag]) {
            finalReplacements[tag] = defaultMappings[tag];
        } else {
            // Auto-detect: try to find value in emailLogsData or configData
            const autoValue = autoDetectValue(
                tag,
                emailLogsData as unknown as Record<string, unknown>,
                configData as unknown as Record<string, unknown> | undefined,
            );
            if (autoValue !== null) {
                finalReplacements[tag] = () => autoValue;
            } else {
                unmappedTags.push(tag);
                finalReplacements[tag] = () => ''; // Replace with empty string if not found
            }
        }
    });

    // Log unmapped tags for debugging
    if (unmappedTags.length > 0) {
        console.warn('Unmapped tags found:', unmappedTags);
        console.warn('Consider adding custom replacements for these tags');
    }

    // Process template and subject
    let processedTemplate = template;
    let processedSubject = subject;

    Object.entries(finalReplacements).forEach(([tag, replacementFn]) => {
        const regex = new RegExp(`##${tag}##`, 'g');
        const replacement = replacementFn();

        processedTemplate = processedTemplate.replace(regex, replacement);
        processedSubject = processedSubject.replace(regex, replacement);
    });

    return {
        template: processedTemplate,
        subject: processedSubject,
        usedTags: Array.from(foundTags),
        unmappedTags,
    };
}

// Auto-detect value from data objects
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
            if (source[key] !== undefined && source[key] !== null) {
                return String(source[key]);
            }
        }
    }

    return null;
}
