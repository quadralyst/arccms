/**
 * Forgot password by an emailed code (specs/password-reset-page-spec.md), end to
 * end through the callables: requestPasswordReset, verifySignupOtp with purpose
 * `reset`, resetPassword.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
    getUserByEmail: vi.fn(),
    updateUser: vi.fn(),
    revokeRefreshTokens: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ queueEmail: vi.fn(), ensureDefaultTemplates: vi.fn() }));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) {
            super(message);
        }
    },
}));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mocks.queueEmail }));
vi.mock('../email-core/defaultTemplates', () => ({ ensureDefaultTemplates: mocks.ensureDefaultTemplates }));

import { db } from '../init.js';
import { requestPasswordReset, resetPassword } from '../auth/passwordReset.js';
import { requestSignupOtp, verifySignupOtp } from '../auth/signupOtp.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const call = (fn: unknown, data: Record<string, unknown>) =>
    (fn as Handler)({ data, rawRequest: { ip: '10.0.0.1', headers: {} } });

const EMAIL = 'asha@example.com';
const GOOD = 'river-lamp-2024';

function lastEmail(): { type: string; data: { otp: string } } {
    const calls = mocks.queueEmail.mock.calls;
    return calls[calls.length - 1][0];
}

/** Ask for a code, check it, and hand back the ticket, as the page does. */
async function verifiedTicket(email = EMAIL): Promise<string> {
    await call(requestPasswordReset, { email });
    const { ticket } = await call(verifySignupOtp, { email, code: lastEmail().data.otp, purpose: 'reset' });
    return ticket;
}

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    owner.getUserByEmail.mockRejectedValue(Object.assign(new Error('not found'), { code: 'auth/user-not-found' }));
    mocks.queueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
    mem.seed('EmailTemplate', 'reset', { type: 'password_reset_otp_email', senderEmail: 's@x.com', senderName: 'S', subject: 'Reset', template: '##OTP##' });
    mem.seed('EmailTemplate', 'signup', { type: 'signup_otp_email', senderEmail: 's@x.com', senderName: 'S', subject: 'Code', template: '##OTP##' });
    mem.seed('Settings', 'users', { isSignupEnabled: true });
    mem.seed('users', 'a-doc', { uid: 'uid-a', name: 'Asha Rao', email: EMAIL, role: 'user', isActive: true, status: 'Active' });
});

describe('requestPasswordReset', () => {
    it('emails a reset code with its own template, to the name on the record', async () => {
        await expect(call(requestPasswordReset, { email: ' Asha@Example.com ' })).resolves.toMatchObject({ sent: true });
        const sent = mocks.queueEmail.mock.calls[0][0];
        expect(sent).toMatchObject({ type: 'password_reset_otp_email', toEmail: EMAIL, toName: 'Asha Rao', source: 'auth', category: 'transactional' });
        expect(sent.data.otp).toMatch(/^\d{6}$/);
        expect(mem.read('signup_otps', computeEmailHash(EMAIL))).toMatchObject({ purpose: 'reset' });
    });

    it('seeds the reset template on an install made before it existed', async () => {
        mem.store.get('EmailTemplate')!.delete('reset');
        mocks.ensureDefaultTemplates.mockImplementation(async () => {
            mem.seed('EmailTemplate', 'password_reset_otp_email', { type: 'password_reset_otp_email', senderEmail: 's@x.com', senderName: 'S', subject: 'Reset', template: '##OTP##' });
        });
        await expect(call(requestPasswordReset, { email: EMAIL })).resolves.toMatchObject({ sent: true });
        expect(mocks.ensureDefaultTemplates).toHaveBeenCalled();
    });

    it('says not sent when the email engine sent nothing, so the page asks Firebase instead', async () => {
        mocks.queueEmail.mockResolvedValue({ id: 'log', status: 'skipped' });
        await expect(call(requestPasswordReset, { email: EMAIL })).resolves.toMatchObject({ sent: false, status: 'skipped' });
        // The code that never went is not kept.
        expect(mem.read('signup_otps', computeEmailHash(EMAIL))).toBeUndefined();
    });

    it('shows the code on the page only with the Simulated provider and the switch on', async () => {
        mem.seed('Settings', 'email', { isEnabled: true, activeProvider: 'debug_log', showResetLinks: true });
        const shown = await call(requestPasswordReset, { email: EMAIL });
        expect(shown).toMatchObject({ testMode: true, testCode: lastEmail().data.otp });

        mem.store.get('signup_otps')!.clear();
        mem.seed('Settings', 'email', { isEnabled: true, activeProvider: 'debug_log', showResetLinks: false });
        const hidden = await call(requestPasswordReset, { email: EMAIL });
        expect(hidden).toMatchObject({ testMode: true, testCodeInLogs: true });
        expect(hidden.testCode).toBeUndefined();
    });

    it('sends nothing new when asked again within the minute', async () => {
        await call(requestPasswordReset, { email: EMAIL });
        const again = await call(requestPasswordReset, { email: EMAIL });
        expect(again).toMatchObject({ sent: true, alreadySent: true });
        expect(again.wait).toBeGreaterThan(0);
        expect(again.testCode).toBeUndefined();
        expect(mocks.queueEmail).toHaveBeenCalledTimes(1);
    });

    it('replaces a sign-up code for the same address rather than waiting on it', async () => {
        await call(requestSignupOtp, { email: EMAIL });
        await expect(call(requestPasswordReset, { email: EMAIL })).resolves.toMatchObject({ sent: true });
        expect(lastEmail().type).toBe('password_reset_otp_email');
        expect(mem.read('signup_otps', computeEmailHash(EMAIL))).toMatchObject({ purpose: 'reset' });
    });

    it('resets a shared login (one login for Arc CMS and the host app)', async () => {
        mem.seed('users', 'a-doc', { uid: 'uid-a', name: 'Asha Rao', email: EMAIL, isActive: true, status: 'Active', authOwner: 'shared' });
        await expect(call(requestPasswordReset, { email: EMAIL })).resolves.toMatchObject({ sent: true });
    });

    it.each([
        ['a login the host app owns', { authOwner: 'host' }, 'host-account'],
        ['a locked app account', { by: 'app' }, 'app-managed'],
        ['a blocked account', { isActive: false }, 'account-blocked'],
    ])('refuses %s, and sends nothing', async (_, fields, reason) => {
        mem.seed('users', 'a-doc', { uid: 'uid-a', name: 'Asha Rao', email: EMAIL, isActive: true, status: 'Active', ...fields });
        await expect(call(requestPasswordReset, { email: EMAIL })).rejects.toMatchObject({ details: { reason } });
        expect(mocks.queueEmail).not.toHaveBeenCalled();
    });

    it('counts a refused address against the caller, so addresses cannot be tried without end', async () => {
        await expect(call(requestPasswordReset, { email: 'nobody@example.com' })).rejects.toMatchObject({ details: { reason: 'no-email-account' } });
        const counter = mem.all('_rate_limits').find((d) => d.id.startsWith('reset-otp-ip-'));
        expect(counter, 'the caller count was kept').toBeTruthy();
    });

    it("sends a host app's user with no record here to the host app", async () => {
        owner.getUserByEmail.mockResolvedValue({ uid: 'h1', providerData: [{ providerId: 'password' }], metadata: { creationTime: new Date(Date.now() - 48 * 3_600_000).toUTCString() } });
        await expect(call(requestPasswordReset, { email: 'host@example.com' })).rejects.toMatchObject({ details: { reason: 'host-account' } });
    });

    it('resets a sign-up made today whose record was never written', async () => {
        owner.getUserByEmail.mockResolvedValue({ uid: 'u-new', displayName: 'New', providerData: [{ providerId: 'password' }], metadata: { creationTime: new Date().toUTCString() } });
        await expect(call(requestPasswordReset, { email: 'new@example.com' })).resolves.toMatchObject({ sent: true });
    });

    it('refuses an address with no account at all, and something that is not an email', async () => {
        await expect(call(requestPasswordReset, { email: 'nobody@example.com' })).rejects.toMatchObject({ details: { reason: 'no-email-account' } });
        await expect(call(requestPasswordReset, { email: 'not-an-email' })).rejects.toMatchObject({ details: { reason: 'invalid-email' } });
    });
});

describe('resetPassword', () => {
    it('sets the new password, signs out every other session and uses the code up', async () => {
        const ticket = await verifiedTicket();
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket })).resolves.toEqual({ reset: true });
        expect(owner.updateUser).toHaveBeenCalledWith('uid-a', { password: GOOD });
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-a');
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
    });

    it.each([
        ['short', 'abc123'],
        ['sequence', '12345678'],
        ['common', 'Password1!'],
        ['personal', 'AshaRao2024'],
    ])('refuses a %s password with its problem, and keeps the code usable', async (problem, password) => {
        const ticket = await verifiedTicket();
        await expect(call(resetPassword, { email: EMAIL, password, ticket })).rejects.toMatchObject({ details: { reason: 'weak-password', problem } });
        expect(owner.updateUser).not.toHaveBeenCalled();
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket })).resolves.toEqual({ reset: true });
    });

    it('needs the ticket from this browser\'s own code check', async () => {
        await verifiedTicket();
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket: 'someone-else' })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
        await expect(call(resetPassword, { email: EMAIL, password: GOOD })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it('never takes a verified sign-up code for a reset', async () => {
        await call(requestSignupOtp, { email: EMAIL });
        const { ticket } = await call(verifySignupOtp, { email: EMAIL, code: lastEmail().data.otp });
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
    });

    it('and a reset code never checks as a sign-up code', async () => {
        await call(requestPasswordReset, { email: EMAIL });
        await expect(call(verifySignupOtp, { email: EMAIL, code: lastEmail().data.otp })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
    });

    it('refuses a host login even with a code', async () => {
        const ticket = await verifiedTicket();
        mem.seed('users', 'a-doc', { uid: 'uid-a', name: 'Asha Rao', email: EMAIL, isActive: true, status: 'Active', authOwner: 'host' });
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket })).rejects.toMatchObject({ details: { reason: 'host-account' } });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it('says nothing about the account without a ticket', async () => {
        mem.seed('users', 'a-doc', { uid: 'uid-a', name: 'Asha Rao', email: EMAIL, isActive: true, status: 'Active', authOwner: 'host' });
        await expect(call(resetPassword, { email: EMAIL, password: GOOD, ticket: 'guess' })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
        await expect(call(resetPassword, { email: 'nobody@example.com', password: GOOD, ticket: 'guess' })).rejects.toMatchObject({ details: { reason: 'code-expired' } });
    });

    it('asks for a password when there is none', async () => {
        await expect(call(resetPassword, { email: EMAIL, password: '' })).rejects.toMatchObject({ details: { reason: 'password-required' } });
    });
});
