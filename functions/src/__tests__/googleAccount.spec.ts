import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) {
            super(message);
        }
    },
}));

import { db } from '../init.js';
import { authOwnerFor, ensureGoogleAccount } from '../auth/googleAccount.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const googleToken = { email: 'Ravi@Gmail.com', email_verified: true, name: 'Ravi K', picture: 'https://p/x.jpg', firebase: { sign_in_provider: 'google.com' } };
const call = (token: Record<string, unknown> = googleToken, uid = 'uid-g') =>
    (ensureGoogleAccount as unknown as (r: unknown) => Promise<any>)({ data: {}, auth: { uid, token } });

beforeEach(() => {
    mem.store.clear();
    owner.getUser.mockResolvedValue({ uid: 'uid-g', displayName: 'Ravi K', metadata: { creationTime: new Date().toUTCString() } });
    mem.seed('Settings', 'users', { isSignupEnabled: true, googleSignIn: true });
});

describe('ensureGoogleAccount', () => {
    it('creates a record from the Google profile, with no form', async () => {
        await expect(call()).resolves.toEqual({ created: true });
        const [user] = mem.all('users');
        expect(user.data).toMatchObject({
            uid: 'uid-g', name: 'Ravi K', email: 'ravi@gmail.com', emailVerified: true,
            photo: 'https://p/x.jpg', role: 'user', authOwner: 'arccms', by: 'google',
        });
    });

    it('does nothing for someone who already has a record', async () => {
        mem.seed('users', 'x', { uid: 'uid-g', email: 'ravi@gmail.com' });
        await expect(call()).resolves.toEqual({ created: false });
        expect(mem.all('users')).toHaveLength(1);
    });

    it('refuses when sign-ups are closed or Google is off', async () => {
        mem.seed('Settings', 'users', { isSignupEnabled: false, googleSignIn: true });
        await expect(call()).rejects.toMatchObject({ details: { reason: 'signup-closed' } });
        mem.seed('Settings', 'users', { isSignupEnabled: true });
        await expect(call()).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('refuses a token that is not a verified Google sign-in', async () => {
        await expect(call({ ...googleToken, firebase: { sign_in_provider: 'password' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(call({ ...googleToken, email_verified: false })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});

describe('authOwnerFor', () => {
    it('marks an older sign-in account as shared (another app made it)', () => {
        const now = Date.parse('2026-09-27T10:00:00Z');
        expect(authOwnerFor('Sun, 27 Sep 2026 09:55:00 GMT', now)).toBe('arccms');
        expect(authOwnerFor('Sat, 01 Aug 2026 09:00:00 GMT', now)).toBe('shared');
    });
});
