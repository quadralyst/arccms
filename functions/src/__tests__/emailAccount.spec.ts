/**
 * checkEmailAccount: the sign-in page's "sign in, sign up or no access" for an
 * email, read from the user records rather than email_lookup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ getUserByEmail: vi.fn(), generatePasswordResetLink: vi.fn(async (email: string) => `https://example.firebaseapp.com/__/auth/action?mode=resetPassword&for=${email}`) }));

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
import { checkEmailAccount, requestPasswordResetLink } from '../auth/emailAccount.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const call = (email: string) =>
    (checkEmailAccount as unknown as (r: unknown) => Promise<any>)({ data: { email }, rawRequest: { ip: '10.0.0.1', headers: {} } });

beforeEach(() => {
    mem.store.clear();
    owner.getUserByEmail.mockRejectedValue(Object.assign(new Error('nope'), { code: 'auth/user-not-found' }));
});

describe('checkEmailAccount', () => {
    it('finds a record whose lookup entry was never written, and writes it', async () => {
        mem.seed('users', 'u1', { uid: 'u1', email: 'admin@example.com' });
        await expect(call(' Admin@Example.com ')).resolves.toEqual({ status: 'registered', signupOpen: true });
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

describe('requestPasswordResetLink (F22)', () => {
    const ask = (email: string) =>
        (requestPasswordResetLink as unknown as (r: unknown) => Promise<any>)({ data: { email }, rawRequest: { ip: '10.0.0.1', headers: {} } });
    const simulated = (fields: Record<string, unknown> = {}) =>
        mem.seed('Settings', 'email', { isEnabled: true, activeProvider: 'debug_log', showResetLinks: true, ...fields });

    beforeEach(() => {
        owner.generatePasswordResetLink.mockClear();
        mem.seed('users', 'u1', { uid: 'u1', email: 'asha@example.com', authOwner: 'arccms' });
    });

    it('hands the link back with the Simulated provider and the switch on', async () => {
        simulated();
        const reply = await ask(' Asha@Example.com ');
        expect(reply).toEqual({ shown: true, link: expect.stringContaining('mode=resetPassword') });
        expect(owner.generatePasswordResetLink).toHaveBeenCalledWith('asha@example.com');
    });

    it.each([
        ['the switch off', { showResetLinks: false }],
        ['a real provider', { activeProvider: 'resend' }],
        ['email switched off', { isEnabled: false }],
    ])('says not shown with %s, so Firebase emails it as always', async (_, fields) => {
        simulated(fields);
        await expect(ask('asha@example.com')).resolves.toEqual({ shown: false });
        expect(owner.generatePasswordResetLink).not.toHaveBeenCalled();
    });

    it('says not shown when there are no email settings at all', async () => {
        await expect(ask('asha@example.com')).resolves.toEqual({ shown: false });
    });

    it('refuses an address with no account here, and a host app\'s user in a shared sign-in pool', async () => {
        simulated();
        await expect(ask('nobody@example.com')).rejects.toMatchObject({ details: { reason: 'no-email-account' } });
        mem.seed('users', 'u2', { uid: 'u2', email: 'host@example.com', authOwner: 'shared' });
        await expect(ask('host@example.com')).rejects.toMatchObject({ details: { reason: 'no-email-account' } });
        expect(owner.generatePasswordResetLink).not.toHaveBeenCalled();
    });

    it('refuses something that is not an email', async () => {
        simulated();
        await expect(ask('not-an-email')).rejects.toMatchObject({ code: 'invalid-argument' });
    });
});
