/**
 * Tests for onWaitlistUserCreate cloud function trigger
 *
 * Responsibility: send the welcome email ONLY for direct-joined (already-verified) users.
 * OTP email is handled exclusively by onWaitlistedUsersCreate (global collection trigger)
 * to prevent duplicate sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onWaitlistUserCreate } from './onWaitlistUserCreate.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../init', () => ({
    db: {
        collection: vi.fn().mockReturnValue({
            doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ name: 'Test Waitlist' }),
                }),
            }),
        }),
    },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((opts, handler) => handler),
}));

vi.mock('../../utils/emailTemplateHelper', () => ({
    getEmailTemplate: vi.fn().mockResolvedValue({
        subject: 'Test Subject',
        template: '<p>Test</p>',
        senderName: 'Test Sender',
        senderEmail: 'sender@test.com',
    }),
    createOtpEmailLog: vi.fn().mockResolvedValue(undefined),
    createWelcomeEmailLog: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import * as emailHelper from '../../utils/emailTemplateHelper.js';

function makeEvent(data: Partial<any>) {
    return {
        data: {
            data: () => ({
                waitlistId: 'wl-test',
                email: 'user@example.com',
                firstName: 'Alice',
                emailVerified: false,
                verificationCode: '',
                isDirectJoined: false,
                ...data,
            }),
        },
        params: { WaitlistsId: 'wl-test', usersId: 'u-1' },
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('onWaitlistUserCreate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // OTP email — this function must NEVER send OTP (handled by onWaitlistedUsersCreate)
    // -----------------------------------------------------------------------

    describe('OTP email — must not be sent here (regression guard)', () => {
        it('should NEVER send OTP email, even when user is unverified with a verificationCode', async () => {
            // OTP sending was moved to onWaitlistedUsersCreate to prevent double-send
            const event = makeEvent({ emailVerified: false, verificationCode: '123456' });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createOtpEmailLog).not.toHaveBeenCalled();
        });

        it('should NEVER send OTP email when user is already verified', async () => {
            const event = makeEvent({ emailVerified: true, verificationCode: '123456' });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createOtpEmailLog).not.toHaveBeenCalled();
        });

        it('should NEVER send OTP email when verificationCode is empty', async () => {
            const event = makeEvent({ emailVerified: false, verificationCode: '' });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createOtpEmailLog).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Welcome email
    // -----------------------------------------------------------------------

    describe('Welcome email routing', () => {
        it('should send welcome email when isDirectJoined and emailVerified', async () => {
            const event = makeEvent({ isDirectJoined: true, emailVerified: true, verificationCode: '' });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createWelcomeEmailLog).toHaveBeenCalledTimes(1);
        });

        it('should NOT send welcome email when isDirectJoined but NOT verified', async () => {
            const event = makeEvent({ isDirectJoined: true, emailVerified: false, verificationCode: '123456' });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createWelcomeEmailLog).not.toHaveBeenCalled();
        });

        it('should NOT send welcome email when verified but isDirectJoined is false', async () => {
            const event = makeEvent({ isDirectJoined: false, emailVerified: true });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createWelcomeEmailLog).not.toHaveBeenCalled();
        });

        it('should request the welcome email template type', async () => {
            const event = makeEvent({ isDirectJoined: true, emailVerified: true, verificationCode: '' });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.getEmailTemplate).toHaveBeenCalledWith(
                'wl-test',
                'waitlist_welcome_email'
            );
        });
    });

    // -----------------------------------------------------------------------
    // No-op cases
    // -----------------------------------------------------------------------

    describe('No-op cases', () => {
        it('should send no emails when no conditions are met', async () => {
            const event = makeEvent({ emailVerified: false, verificationCode: '', isDirectJoined: false });
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createOtpEmailLog).not.toHaveBeenCalled();
            expect(emailHelper.createWelcomeEmailLog).not.toHaveBeenCalled();
        });

        it('should return early when event data is missing', async () => {
            const event = { data: undefined, params: {} };
            await (onWaitlistUserCreate as any)(event);
            expect(emailHelper.createOtpEmailLog).not.toHaveBeenCalled();
            expect(emailHelper.createWelcomeEmailLog).not.toHaveBeenCalled();
        });
    });
});
