/**
 * checkEmailAccount: the sign-in page's "sign in, sign up or no access" for an
 * email, read from the user records rather than email_lookup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ getUserByEmail: vi.fn() }));
// The sign-up code send itself is signupOtp.spec.ts's: here, only whether the check asks for it.
const sendSignupCode = vi.hoisted(() => vi.fn());
vi.mock('../auth/signupOtp', async (importOriginal) => ({ ...(await importOriginal<object>()), sendSignupCode }));

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

import { db } from '../init.js';
import { checkEmailAccount } from '../auth/emailAccount.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const call = (email: string, extra: Record<string, unknown> = {}) =>
    (checkEmailAccount as unknown as (r: unknown) => Promise<any>)({ data: { email, ...extra }, rawRequest: { ip: '10.0.0.1', headers: {} } });

beforeEach(() => {
    mem.store.clear();
    sendSignupCode.mockReset().mockResolvedValue({ sent: true, status: 'pending', testMode: true, testCode: '123456' });
    owner.getUserByEmail.mockRejectedValue(Object.assign(new Error('nope'), { code: 'auth/user-not-found' }));
});

describe('checkEmailAccount', () => {
    it('finds a record whose lookup entry was never written, and writes it', async () => {
        mem.seed('users', 'u1', { uid: 'u1', email: 'admin@example.com' });
        await expect(call(' Admin@Example.com ')).resolves.toEqual({ status: 'registered', signupOpen: true, signInWith: 'password' });
        expect(mem.read('email_lookup', computeEmailHash('admin@example.com'))).toEqual({ exists: true });
    });

    it('says no access for a login with no record here (another app sharing the sign-in pool)', async () => {
        owner.getUserByEmail.mockResolvedValue({ uid: 'host' });
        await expect(call('host@example.com')).resolves.toMatchObject({ status: 'no-access' });
    });

    it('says unfinished for a password login made today with no record, while sign-ups are open (review F)', async () => {
        const login = (hoursAgo: number, providerId = 'password') => ({
            uid: 'u1', providerData: [{ providerId }], metadata: { creationTime: new Date(Date.now() - hoursAgo * 3_600_000).toUTCString() },
        });
        owner.getUserByEmail.mockResolvedValue(login(1));
        await expect(call('asha@example.com')).resolves.toMatchObject({ status: 'unfinished' });
        owner.getUserByEmail.mockResolvedValue(login(48));
        await expect(call('asha@example.com')).resolves.toMatchObject({ status: 'no-access' });
        owner.getUserByEmail.mockResolvedValue(login(1, 'google.com'));
        await expect(call('asha@example.com')).resolves.toMatchObject({ status: 'no-access' });
        mem.seed('Settings', 'users', { isSignupEnabled: false });
        owner.getUserByEmail.mockResolvedValue(login(1));
        await expect(call('asha@example.com')).resolves.toMatchObject({ status: 'no-access' });
    });

    it('says new for an unknown address, with the sign-up switch', async () => {
        mem.seed('Settings', 'users', { isSignupEnabled: false });
        await expect(call('new@example.com')).resolves.toEqual({ status: 'new', signupOpen: false });
    });

    it('refuses something that is not an email', async () => {
        await expect(call('not-an-email')).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});

describe('checkEmailAccount with sendCode (specs/sign-in-speed-spec.md, SP-D6)', () => {
    it('emails a new address its sign-up code and answers both, with the name and language the page sent', async () => {
        const reply = await call('New@Example.com', { sendCode: true, name: 'Asha', language: 'hi' });
        expect(reply).toEqual({ status: 'new', signupOpen: true, code: { sent: true, status: 'pending', testMode: true, testCode: '123456' } });
        expect(sendSignupCode).toHaveBeenCalledWith(expect.anything(), 'new@example.com', { name: 'Asha', language: 'hi' });
    });

    it('sends nothing without sendCode, for a registered address, or while signups are closed', async () => {
        await expect(call('new@example.com')).resolves.toEqual({ status: 'new', signupOpen: true });
        mem.seed('users', 'u1', { uid: 'u1', email: 'admin@example.com' });
        await expect(call('admin@example.com', { sendCode: true })).resolves.toEqual({ status: 'registered', signupOpen: true, signInWith: 'password' });
        mem.seed('Settings', 'users', { isSignupEnabled: false });
        await expect(call('other@example.com', { sendCode: true })).resolves.toEqual({ status: 'new', signupOpen: false });
        expect(sendSignupCode).not.toHaveBeenCalled();
    });

    it('a refused send still answers the check, with the refusal as data (SP-D7)', async () => {
        const { HttpsError } = await import('firebase-functions/v2/https');
        sendSignupCode.mockRejectedValue(new HttpsError('resource-exhausted', 'Too many codes for this address.', { reason: 'too-many-codes', retryAfter: 600 }));
        await expect(call('new@example.com', { sendCode: true })).resolves.toEqual({
            status: 'new', signupOpen: true,
            codeRefused: { code: 'resource-exhausted', message: 'Too many codes for this address.', details: { reason: 'too-many-codes', retryAfter: 600 } },
        });
    });

    it('a caller over the check\'s own limit learns nothing and is sent nothing (SP-D4)', async () => {
        await call('new@example.com');
        const limit = mem.all('_rate_limits').find((l) => l.id.startsWith('check-ip-'))!;
        mem.seed('_rate_limits', limit.id, { ...limit.data, count: 100 });
        await expect(call('new@example.com', { sendCode: true })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(sendSignupCode).not.toHaveBeenCalled();
    });

    it('an error that is not a refusal comes back as internal, so the page shows its own text', async () => {
        sendSignupCode.mockRejectedValue(new Error('boom'));
        await expect(call('new@example.com', { sendCode: true })).resolves.toMatchObject({ codeRefused: { code: 'internal' } });
    });
});
