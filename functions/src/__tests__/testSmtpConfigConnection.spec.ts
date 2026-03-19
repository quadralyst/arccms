/**
 * Behavioral tests for testSmtpConfigConnection cloud function.
 *
 * Verifies that the function correctly:
 * - Routes to the right provider handler based on activeProvider
 * - Validates required config fields per provider
 * - Returns success/failure for SMTP and Gmail (via nodemailer mock)
 * - Returns success/failure for Resend (via fetch mock)
 * - Sends test email when testEmail is provided
 * - Returns HttpsError for missing config or unsupported providers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Nodemailer mock ─────────────────────────────────────────────────────────
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const mockVerify = vi.fn().mockResolvedValue(true);
const mockCreateTransport = vi.fn().mockReturnValue({
    verify: mockVerify,
    sendMail: mockSendMail,
});

vi.mock('nodemailer', () => ({
    default: { createTransport: (...args: any[]) => mockCreateTransport(...args) },
    createTransport: (...args: any[]) => mockCreateTransport(...args),
}));

// ─── Firebase Functions mock ─────────────────────────────────────────────────
// onCall receives (handler) in v2 — we extract the handler directly
vi.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    }
    return {
        onCall: vi.fn((handler: any) => handler),
        HttpsError,
    };
});

// ─── Global fetch mock ───────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeRequest(data: any) {
    return { auth: { uid: 'test-user', token: {} }, data };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('testSmtpConfigConnection handler', () => {
    let handler: (request: any) => Promise<any>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockVerify.mockResolvedValue(true);
        mockSendMail.mockResolvedValue({ messageId: 'test-id' });
        // Re-import to get the handler (onCall mock returns the handler directly)
        const mod = await import('../mail-config/testSmtpConfigConnection.js');
        handler = mod.testSmtpConfigConnection as any;
    });

    // ─── Validation ──────────────────────────────────────────────────────────

    describe('input validation', () => {
        it('should throw when config is missing', async () => {
            await expect(
                handler(makeRequest({ activeProvider: 'smtp' }))
            ).rejects.toThrow('Provider configuration is required');
        });

        it('should throw when activeProvider is missing', async () => {
            await expect(
                handler(makeRequest({ config: { smtp: {} } }))
            ).rejects.toThrow('Provider configuration is required');
        });

        it('should throw for unsupported provider', async () => {
            await expect(
                handler(makeRequest({ config: {}, activeProvider: 'sendgrid' }))
            ).rejects.toThrow('Unsupported provider: sendgrid');
        });
    });

    // ─── SMTP provider ──────────────────────────────────────────────────────

    describe('SMTP provider', () => {
        const validSmtpConfig = {
            smtp: { host: 'smtp.example.com', port: 587, user: 'user@example.com', password: 'pass123', secure: false },
            senderEmail: 'sender@example.com',
            senderName: 'Test Sender',
        };

        it('should throw when smtp settings are missing from config', async () => {
            await expect(
                handler(makeRequest({ config: {}, activeProvider: 'smtp' }))
            ).rejects.toThrow('SMTP settings are required');
        });

        it('should throw when SMTP host is missing', async () => {
            const config = { smtp: { host: '', user: 'u', password: 'p' } };
            await expect(
                handler(makeRequest({ config, activeProvider: 'smtp' }))
            ).rejects.toThrow('Missing required SMTP configuration fields');
        });

        it('should throw when SMTP user is missing', async () => {
            const config = { smtp: { host: 'h', user: '', password: 'p' } };
            await expect(
                handler(makeRequest({ config, activeProvider: 'smtp' }))
            ).rejects.toThrow('Missing required SMTP configuration fields');
        });

        it('should throw when SMTP password is missing', async () => {
            const config = { smtp: { host: 'h', user: 'u', password: '' } };
            await expect(
                handler(makeRequest({ config, activeProvider: 'smtp' }))
            ).rejects.toThrow('Missing required SMTP configuration fields');
        });

        it('should verify SMTP connection and return success', async () => {
            const result = await handler(makeRequest({ config: validSmtpConfig, activeProvider: 'smtp' }));
            expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
                host: 'smtp.example.com',
                port: 587,
            }));
            expect(mockVerify).toHaveBeenCalled();
            expect(result).toEqual({ success: true, message: 'SMTP connection established successfully' });
        });

        it('should send test email when testEmail is provided', async () => {
            const result = await handler(makeRequest({
                config: validSmtpConfig,
                activeProvider: 'smtp',
                testEmail: 'test@example.com',
                subject: 'Test Subject',
                message: 'Test message body',
            }));

            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
                to: 'test@example.com',
                subject: 'Test Subject',
                text: 'Test message body',
            }));
            expect(result.success).toBe(true);
            expect(result.message).toContain('test@example.com');
        });

        it('should use default subject/message when not provided', async () => {
            await handler(makeRequest({
                config: validSmtpConfig,
                activeProvider: 'smtp',
                testEmail: 'test@example.com',
            }));

            expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
                subject: 'SMTP Connection Test - Arc CMS',
            }));
        });

        it('should return failure when transporter.verify() rejects', async () => {
            mockVerify.mockRejectedValue(new Error('Connection refused'));
            const result = await handler(makeRequest({ config: validSmtpConfig, activeProvider: 'smtp' }));
            expect(result).toEqual({ success: false, message: 'Connection refused' });
        });

        it('should use senderEmail from config in from field', async () => {
            await handler(makeRequest({
                config: validSmtpConfig,
                activeProvider: 'smtp',
                testEmail: 'test@example.com',
            }));

            const sendMailArg = mockSendMail.mock.calls[0][0];
            expect(sendMailArg.from).toContain('sender@example.com');
            expect(sendMailArg.from).toContain('Test Sender');
        });
    });

    // ─── Gmail provider ──────────────────────────────────────────────────────

    describe('Gmail provider', () => {
        const validGmailConfig = {
            gmail: { user: 'user@gmail.com', password: 'app-password' },
            senderEmail: 'user@gmail.com',
            senderName: 'Gmail Sender',
        };

        it('should throw when gmail settings are missing from config', async () => {
            await expect(
                handler(makeRequest({ config: {}, activeProvider: 'gmail' }))
            ).rejects.toThrow('Gmail settings are required');
        });

        it('should throw when Gmail user is missing', async () => {
            const config = { gmail: { user: '', password: 'p' } };
            await expect(
                handler(makeRequest({ config, activeProvider: 'gmail' }))
            ).rejects.toThrow('Missing required Gmail credentials');
        });

        it('should throw when Gmail password is missing', async () => {
            const config = { gmail: { user: 'u', password: '' } };
            await expect(
                handler(makeRequest({ config, activeProvider: 'gmail' }))
            ).rejects.toThrow('Missing required Gmail credentials');
        });

        it('should verify Gmail connection and return success', async () => {
            const result = await handler(makeRequest({ config: validGmailConfig, activeProvider: 'gmail' }));
            expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
                service: 'gmail',
            }));
            expect(mockVerify).toHaveBeenCalled();
            expect(result).toEqual({ success: true, message: 'Gmail connection established successfully' });
        });

        it('should send test email when testEmail is provided', async () => {
            const result = await handler(makeRequest({
                config: validGmailConfig,
                activeProvider: 'gmail',
                testEmail: 'test@example.com',
            }));

            expect(mockSendMail).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.message).toContain('test@example.com');
        });

        it('should return failure when Gmail verify rejects', async () => {
            mockVerify.mockRejectedValue(new Error('Invalid credentials'));
            const result = await handler(makeRequest({ config: validGmailConfig, activeProvider: 'gmail' }));
            expect(result).toEqual({ success: false, message: 'Invalid credentials' });
        });
    });

    // ─── Resend provider ─────────────────────────────────────────────────────

    describe('Resend provider', () => {
        const validResendConfig = {
            resend: { apiKey: 're_valid_key_123' },
            senderEmail: 'sender@example.com',
            senderName: 'Resend Sender',
        };

        it('should throw when resend settings are missing from config', async () => {
            await expect(
                handler(makeRequest({ config: {}, activeProvider: 'resend' }))
            ).rejects.toThrow('Resend API Key is required');
        });

        it('should throw when resend apiKey is missing', async () => {
            const config = { resend: { apiKey: '' } };
            await expect(
                handler(makeRequest({ config, activeProvider: 'resend' }))
            ).rejects.toThrow('Resend API Key is required');
        });

        it('should validate API key and return success', async () => {
            mockFetch.mockResolvedValueOnce({ status: 404 });
            const result = await handler(makeRequest({ config: validResendConfig, activeProvider: 'resend' }));
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.resend.com/emails/123456789',
                expect.objectContaining({ method: 'GET' })
            );
            expect(result).toEqual({ success: true, message: 'Resend API Key validated successfully' });
        });

        it('should return failure for invalid API key (401)', async () => {
            mockFetch.mockResolvedValueOnce({ status: 401 });
            const result = await handler(makeRequest({ config: validResendConfig, activeProvider: 'resend' }));
            expect(result).toEqual({ success: false, message: 'Invalid Resend API Key' });
        });

        it('should return failure for forbidden API key (403)', async () => {
            mockFetch.mockResolvedValueOnce({ status: 403 });
            const result = await handler(makeRequest({ config: validResendConfig, activeProvider: 'resend' }));
            expect(result).toEqual({ success: false, message: 'Invalid Resend API Key' });
        });

        it('should send test email via Resend API when testEmail is provided', async () => {
            mockFetch
                .mockResolvedValueOnce({ status: 404 })   // API key validation
                .mockResolvedValueOnce({ ok: true });      // send email

            const result = await handler(makeRequest({
                config: validResendConfig,
                activeProvider: 'resend',
                testEmail: 'test@example.com',
                subject: 'Resend Test',
                message: 'Hello from Resend',
            }));

            expect(mockFetch).toHaveBeenCalledTimes(2);
            const sendCall = mockFetch.mock.calls[1];
            expect(sendCall[0]).toBe('https://api.resend.com/emails');
            const body = JSON.parse(sendCall[1].body);
            expect(body.to).toEqual(['test@example.com']);
            expect(body.subject).toBe('Resend Test');
            expect(result.success).toBe(true);
            expect(result.message).toContain('test@example.com');
        });

        it('should return failure when Resend send email fails', async () => {
            mockFetch
                .mockResolvedValueOnce({ status: 404 })    // API key validation OK
                .mockResolvedValueOnce({                     // send email fails
                    ok: false,
                    json: () => Promise.resolve({ message: 'Rate limit exceeded' }),
                });

            const result = await handler(makeRequest({
                config: validResendConfig,
                activeProvider: 'resend',
                testEmail: 'test@example.com',
            }));

            expect(result).toEqual({ success: false, message: 'Rate limit exceeded' });
        });
    });

    // ─── Regression: frontend payload shape ──────────────────────────────────

    describe('regression: frontend payload compatibility', () => {
        it('should accept the exact payload shape the frontend sends', async () => {
            // This is the exact shape sent by email-setting.page.ts testConnection()
            const frontendPayload = {
                config: {
                    isEnabled: true,
                    activeProvider: 'smtp',
                    senderEmail: 'admin@example.com',
                    senderName: 'Arc CMS',
                    replyToEmail: '',
                    smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'user@example.com', password: 'pass' },
                    resend: { apiKey: '' },
                    gmail: { user: '', password: '' },
                    bccEmail: '',
                },
                activeProvider: 'smtp',
                testEmail: 'test@example.com',
                subject: 'SMTP Connection Test - Arc CMS',
                message: 'Test message',
            };

            const result = await handler(makeRequest(frontendPayload));
            expect(mockVerify).toHaveBeenCalled();
            expect(mockSendMail).toHaveBeenCalled();
            expect(result.success).toBe(true);
        });

        it('should work for Gmail with frontend payload shape', async () => {
            const frontendPayload = {
                config: {
                    activeProvider: 'gmail',
                    gmail: { user: 'user@gmail.com', password: 'app-pass' },
                    smtp: { host: '', port: 587, secure: false, user: '', password: '' },
                    senderEmail: 'user@gmail.com',
                    senderName: 'Test',
                },
                activeProvider: 'gmail',
                testEmail: 'recipient@example.com',
            };

            const result = await handler(makeRequest(frontendPayload));
            expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ service: 'gmail' }));
            expect(result.success).toBe(true);
        });

        it('should work for Resend with frontend payload shape', async () => {
            mockFetch
                .mockResolvedValueOnce({ status: 404 })
                .mockResolvedValueOnce({ ok: true });

            const frontendPayload = {
                config: {
                    activeProvider: 'resend',
                    resend: { apiKey: 're_test_key' },
                    smtp: { host: '', port: 587, secure: false, user: '', password: '' },
                    senderEmail: 'sender@example.com',
                    senderName: 'Arc CMS',
                },
                activeProvider: 'resend',
                testEmail: 'recipient@example.com',
            };

            const result = await handler(makeRequest(frontendPayload));
            expect(result.success).toBe(true);
        });

    });
});
