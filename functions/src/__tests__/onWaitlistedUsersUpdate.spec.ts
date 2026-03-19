/**
 * Tests for onWaitlistedUserUpdate Cloud Function
 *
 * Ensures OTP email is sent when:
 *  - verificationCode changes (new code generated on expired resend)
 *  - verificationExpires changes but code stays the same (same code resent)
 *
 * Ensures OTP email is NOT sent when:
 *  - Neither verificationCode nor verificationExpires changed
 *  - verificationCode is empty/missing
 *  - Event data is missing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetEmailTemplate = vi.fn();
const mockCreateOtpEmailLog = vi.fn();

vi.mock('../utils/emailTemplateHelper', () => ({
    getEmailTemplate: mockGetEmailTemplate,
    createOtpEmailLog: mockCreateOtpEmailLog,
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentUpdated: vi.fn((_path: string, handler: Function) => handler),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTimestamp(ms: number) {
    return { toMillis: () => ms };
}

function makeEvent(
    before: Record<string, any> | null,
    after: Record<string, any> | null,
) {
    return {
        data: {
            before: { data: () => before },
            after: { data: () => after },
        },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('onWaitlistedUserUpdate Cloud Function', () => {
    let handler: Function;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGetEmailTemplate.mockResolvedValue({ subject: 'OTP', body: '{{otp}}' });
        mockCreateOtpEmailLog.mockResolvedValue(undefined);

        // Import the module — the vi.mock for onDocumentUpdated returns the
        // handler directly, so the export IS the handler.
        const mod = await import(
            '../waitlists/waitlistedUsers/onWaitlistedUsersUpdate.js'
        );
        handler = mod.onWaitlistedUserUpdate as unknown as Function;
    });

    it('should send OTP email when verificationCode changes (expired code resend)', async () => {
        const event = makeEvent(
            {
                verificationCode: 'OLD_CODE',
                verificationExpires: makeTimestamp(1000),
                waitlistId: 'wl-1',
            },
            {
                verificationCode: 'NEW_CODE',
                verificationExpires: makeTimestamp(2000),
                waitlistId: 'wl-1',
            },
        );

        await handler(event);

        expect(mockGetEmailTemplate).toHaveBeenCalledWith('wl-1', 'waitlist_verify_otp_email');
        expect(mockCreateOtpEmailLog).toHaveBeenCalledTimes(1);
    });

    it('should send OTP email when only verificationExpires changes — same code resent (regression)', async () => {
        const event = makeEvent(
            {
                verificationCode: 'SAME_CODE',
                verificationExpires: makeTimestamp(1000),
                waitlistId: 'wl-1',
            },
            {
                verificationCode: 'SAME_CODE',
                verificationExpires: makeTimestamp(2000),
                waitlistId: 'wl-1',
            },
        );

        await handler(event);

        expect(mockGetEmailTemplate).toHaveBeenCalledWith('wl-1', 'waitlist_verify_otp_email');
        expect(mockCreateOtpEmailLog).toHaveBeenCalledTimes(1);
    });

    it('should NOT send OTP email when neither code nor expiry changed', async () => {
        const event = makeEvent(
            {
                verificationCode: 'SAME_CODE',
                verificationExpires: makeTimestamp(1000),
                waitlistId: 'wl-1',
            },
            {
                verificationCode: 'SAME_CODE',
                verificationExpires: makeTimestamp(1000),
                waitlistId: 'wl-1',
            },
        );

        await handler(event);

        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
    });

    it('should NOT send OTP email when verificationCode is empty', async () => {
        const event = makeEvent(
            {
                verificationCode: '',
                verificationExpires: makeTimestamp(1000),
                waitlistId: 'wl-1',
            },
            {
                verificationCode: '',
                verificationExpires: makeTimestamp(2000),
                waitlistId: 'wl-1',
            },
        );

        await handler(event);

        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
    });

    it('should NOT send OTP email when event data is missing', async () => {
        const event = { data: { before: { data: () => null }, after: { data: () => null } } };

        await handler(event);

        expect(mockCreateOtpEmailLog).not.toHaveBeenCalled();
    });
});
