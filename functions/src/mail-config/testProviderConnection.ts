import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as nodemailer from "nodemailer";
import { SmtpConfig, GmailConfig, ResendConfig } from '../types.js';

export const testProviderConnection = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { activeProvider, config } = request.data;

    if (!activeProvider || !config) {
        throw new HttpsError('invalid-argument', 'Provider and configuration are required');
    }

    try {
        switch (activeProvider) {
            case 'smtp':
                return await testSmtpConnection(config.smtp || config);
            case 'gmail':
                return await testGmailConnection(config.gmail || config);
            case 'resend':
                return await testResendConnection(config.resend || config);
            default:
                throw new HttpsError('invalid-argument', `Unsupported provider: ${activeProvider}`);
        }
    } catch (error: unknown) {
        console.error(`${activeProvider} Connection Test Error:`, error);
        const message = error instanceof Error ? error.message : `Failed to establish ${activeProvider} connection`;
        return {
            success: false,
            message,
        };
    }
});

async function testSmtpConnection(config: SmtpConfig) {
    const { host, port, user, password, secure } = config;

    if (!host || !user || !password) {
        throw new HttpsError('invalid-argument', 'Missing required SMTP configuration fields');
    }

    const transporter = nodemailer.createTransport({
        host: host,
        port: port || 587,
        secure: secure || false,
        auth: {
            user: user,
            pass: password,
        },
    });

    await transporter.verify();

    return {
        success: true,
        message: 'SMTP connection established successfully'
    };
}

async function testGmailConnection(config: GmailConfig) {
    const { user, password } = config;

    if (!user || !password) {
        throw new HttpsError('invalid-argument', 'Missing required Gmail credentials');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: user,
            pass: password,
        },
    });

    await transporter.verify();

    return {
        success: true,
        message: 'Gmail connection established successfully'
    };
}

async function testResendConnection(config: ResendConfig) {
    const { apiKey } = config;

    if (!apiKey) {
        throw new HttpsError('invalid-argument', 'Resend API Key is required');
    }

    // Attempt to list domains or get a generic resource to validate the key
    const response = await fetch('https://api.resend.com/emails/123456789', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(15_000),
    });

    // If 401 Unauthorized, key is invalid. 
    // If 404 Not Found (or 400), it means Auth worked but resource missing/invalid request, which implies valid key.
    // If 200, obviously valid.

    if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid Resend API Key');
    }

    // We accept other errors as "Auth is valid, but resource not found" which is enough for config testing
    return {
        success: true,
        message: 'Resend API Key validated successfully'
    };
}
