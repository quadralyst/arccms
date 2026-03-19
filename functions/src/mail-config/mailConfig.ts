import { Timestamp } from 'firebase-admin/firestore';
import { constant } from '../constant.js';
import { db } from '../init.js';
import nodemailer from 'nodemailer';
import { EmailLogData, EmailSettings, ProcessedTemplate } from '../types.js';
import { incrementSendCount } from './emailCounter.js';
import { getMiscSettings } from '../shared/site-settings.js';
import { POWERED_BY_EMAIL_HTML } from '../shared/html-document.js';

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

    let updatedTemplate: ProcessedTemplate | undefined;
    let activeProvider = 'smtp';

    try {
        const settings = settingsEmailDoc.data();
        const isEnabled = settings?.isEnabled;

        if (!isEnabled) {
            console.log('Email sending is disabled in settings.');
            return;
        }

        activeProvider = settings?.activeProvider || 'smtp';
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

        let result;

        switch (activeProvider) {
            case 'resend':
                result = await sendResendMail(emailLogsData, updatedTemplate, settings);
                break;
            case 'gmail':
                result = await sendGmailMail(emailLogsData, updatedTemplate, settings);
                break;
            case 'smtp':
            default:
                result = await sendSmtpMail(emailLogsData, updatedTemplate, settings);
                break;
        }

        const updateData: Record<string, any> = {
            status: 'success',
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
        const failData: Record<string, any> = {
            status: 'failed',
            sendingTime: Timestamp.now(),
            activeProvider,
            errorMessage: err instanceof Error ? err.message : String(err),
        };
        if (updatedTemplate) {
            failData.processedSubject = updatedTemplate.subject;
            failData.processedTemplate = updatedTemplate.template;
            failData.usedTags = updatedTemplate.usedTags;
            failData.unmappedTags = updatedTemplate.unmappedTags;
        }
        await logRef.update(failData);
        console.error('Error sending email:', err);
    }
}

async function sendSmtpMail(emailLogsData: EmailLogData, updatedTemplate: ProcessedTemplate, settings: EmailSettings) {
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
    });
}

async function sendResendMail(emailLogsData: EmailLogData, updatedTemplate: ProcessedTemplate, settings: EmailSettings) {
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
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Resend Error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    return { messageId: data.id };
}

async function sendGmailMail(emailLogsData: EmailLogData, updatedTemplate: ProcessedTemplate, settings: EmailSettings) {
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
    });
}


export async function processEmailTemplate(
    emailLogsData: EmailLogData,
    configData: EmailSettings | undefined,
    customReplacements?: Record<string, string | (() => string)>
): Promise<ProcessedTemplate> {
    const unsubscribe_link = constant.isProduction
        ? `${constant.live_url}unsubscribe?userId=${''}`
        : `${constant.local_url}unsubscribe?userId=${''}`;

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
