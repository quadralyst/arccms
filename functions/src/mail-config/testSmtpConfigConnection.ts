import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as nodemailer from "nodemailer";
import { EmailSettings } from '../types.js';

export const testSmtpConfigConnection = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { config, activeProvider, testEmail, subject, message } = request.data;

    if (!config || !activeProvider) {
        throw new HttpsError('invalid-argument', 'Provider configuration is required');
    }

    try {
        switch (activeProvider) {
            case 'smtp':
                return await testSmtpWithEmail(config, testEmail, subject, message);
            case 'gmail':
                return await testGmailWithEmail(config, testEmail, subject, message);
            case 'resend':
                return await testResendWithEmail(config, testEmail, subject, message);
            default:
                throw new HttpsError('invalid-argument', `Unsupported provider: ${activeProvider}`);
        }
    } catch (error: unknown) {
        if (error instanceof HttpsError) throw error;
        console.error(`${activeProvider} Connection Test Error:`, error);
        const message = error instanceof Error ? error.message : `Failed to establish ${activeProvider} connection`;
        return {
            success: false,
            message,
        };
    }
});

function buildTestEmailHtml(textContent: string): string {
    return `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #0d6efd;">You're All Set! 🎉</h2>
            <div style="white-space: pre-wrap; font-size: 14px; line-height: 1.5; margin: 20px 0;">
                ${textContent}
            </div>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #666;">
                Sent from Arc CMS<br>
                Time: ${new Date().toLocaleString()}
            </p>
        </div>
    `;
}

async function testSmtpWithEmail(config: EmailSettings, testEmail?: string, subject?: string, message?: string) {
    const smtp = config.smtp;
    if (!smtp) {
        throw new HttpsError('invalid-argument', 'SMTP settings are required');
    }

    const { host, port, user, password, secure } = smtp;
    if (!host || !user || !password) {
        throw new HttpsError('invalid-argument', 'Missing required SMTP configuration fields');
    }

    const transporter = nodemailer.createTransport({
        host, port: port || 587, secure: secure || false,
        auth: { user, pass: password },
    });

    await transporter.verify();

    if (testEmail) {
        const subj = subject || "SMTP Connection Test - Arc CMS";
        const textContent = message || "This email confirms that your SMTP configuration in Arc CMS is working correctly.";
        await transporter.sendMail({
            from: `"${config.senderName || 'Arc CMS System'}" <${config.senderEmail || user}>`,
            to: testEmail,
            subject: subj,
            text: textContent,
            html: buildTestEmailHtml(textContent),
        });
        return { success: true, message: `SMTP connection successful and test email sent to ${testEmail}` };
    }

    return { success: true, message: 'SMTP connection established successfully' };
}

async function testGmailWithEmail(config: EmailSettings, testEmail?: string, subject?: string, message?: string) {
    const gmail = config.gmail;
    if (!gmail) {
        throw new HttpsError('invalid-argument', 'Gmail settings are required');
    }

    const { user, password } = gmail;
    if (!user || !password) {
        throw new HttpsError('invalid-argument', 'Missing required Gmail credentials');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: password },
    });

    await transporter.verify();

    if (testEmail) {
        const subj = subject || "Gmail Connection Test - Arc CMS";
        const textContent = message || "This email confirms that your Gmail configuration in Arc CMS is working correctly.";
        await transporter.sendMail({
            from: `"${config.senderName || 'Arc CMS System'}" <${config.senderEmail || user}>`,
            to: testEmail,
            subject: subj,
            text: textContent,
            html: buildTestEmailHtml(textContent),
        });
        return { success: true, message: `Gmail connection successful and test email sent to ${testEmail}` };
    }

    return { success: true, message: 'Gmail connection established successfully' };
}

async function testResendWithEmail(config: EmailSettings, testEmail?: string, subject?: string, message?: string) {
    const resend = config.resend;
    if (!resend || !resend.apiKey) {
        throw new HttpsError('invalid-argument', 'Resend API Key is required');
    }

    // Validate the API key
    const response = await fetch('https://api.resend.com/emails/123456789', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${resend.apiKey}` },
        signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid Resend API Key');
    }

    if (testEmail) {
        const subj = subject || "Resend Connection Test - Arc CMS";
        const textContent = message || "This email confirms that your Resend configuration in Arc CMS is working correctly.";
        const sendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resend.apiKey}`,
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(15_000),
            body: JSON.stringify({
                from: config.senderEmail ? `${config.senderName || 'Arc CMS System'} <${config.senderEmail}>` : 'Arc CMS <onboarding@resend.dev>',
                to: [testEmail],
                subject: subj,
                text: textContent,
                html: buildTestEmailHtml(textContent),
            }),
        });

        if (!sendResponse.ok) {
            const errorData = await sendResponse.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to send test email via Resend');
        }

        return { success: true, message: `Resend API Key validated and test email sent to ${testEmail}` };
    }

    return { success: true, message: 'Resend API Key validated successfully' };
}
