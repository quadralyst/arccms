/**
 * The account's own callables: the email sign-up record, the claim refresh and
 * deleting your own account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ getUser: vi.fn(), setCustomUserClaims: vi.fn() }));
const claims = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { mockErase } = vi.hoisted(() => ({ mockErase: vi.fn().mockResolvedValue({}) }));
vi.mock('../email-core/eraseContact', () => ({ eraseContact: mockErase }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) {
            super(message);
        }
    },
}));

import { db } from '../init.js';
import { createAccountRecord } from '../auth/emailAccount.js';
import { deleteMyAccount, refreshMyClaims, signedInRecently } from '../users/accountCallables.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { FakeTimestamp, type MemoryFirestore } from './helpers/memoryFirestore.js';
import { newOtpTicket } from '../auth/otpTicket.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const call = (fn: unknown, data: Record<string, unknown>, uid: string, token: Record<string, unknown> = {}) =>
    (fn as Handler)({ data, auth: { uid, token }, rawRequest: { ip: '10.0.0.1', headers: {} } });

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    for (const key of Object.keys(claims)) delete claims[key];
    owner.getUser.mockImplementation(async (uid: string) => ({ uid, customClaims: claims[uid], metadata: { creationTime: new Date().toUTCString() } }));
    owner.setCustomUserClaims.mockImplementation(async (uid: string, value: Record<string, unknown>) => { claims[uid] = value; });
});

describe('createAccountRecord (email sign-up)', () => {
    const password = { email: 'Asha@Example.com', firebase: { sign_in_provider: 'password' } };

    it('creates the record with the default role and puts both claims on the account', async () => {
        mem.seed('Settings', 'users', { isSignupEnabled: true, defaultRole: 'propertyOwner' });
        const { id, created } = await call(createAccountRecord, { name: 'Asha Rao' }, 'u1', password);
        expect(created).toBe(true);
        expect(mem.read('users', id)).toMatchObject({ uid: 'u1', email: 'asha@example.com', name: 'Asha Rao', role: 'propertyOwner', authOwner: 'arccms', by: 'email' });
        expect(claims['u1']).toEqual({ arccms_role: 'propertyOwner', arccms_uid: id });
    });

    it('takes emailVerified from the server\'s sign-up code, not the browser', async () => {
        const { id } = await call(createAccountRecord, { name: 'Asha', emailVerified: true }, 'u1', password);
        expect(mem.read('users', id)!['emailVerified']).toBe(false);

        // A verified code proves the email only to the browser holding its ticket (review F).
        const { ticket, ticketHash } = newOtpTicket();
        const verified = { purpose: 'signup', verified: true, verifiedAt: FakeTimestamp.now(), ticketHash };
        mem.store.get('users')!.clear();
        mem.seed('signup_otps', computeEmailHash('asha@example.com'), verified);
        const noTicket = await call(createAccountRecord, { name: 'Asha' }, 'u1', password);
        expect(mem.read('users', noTicket.id)!['emailVerified']).toBe(false);

        mem.store.get('users')!.clear();
        const second = await call(createAccountRecord, { name: 'Asha', ticket }, 'u1', password);
        expect(mem.read('users', second.id)!['emailVerified']).toBe(true);
        // Used up: the code cannot verify another account.
        expect(mem.read('signup_otps', computeEmailHash('asha@example.com'))).toBeUndefined();
    });

    it('changes nothing for someone who already has a record', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1', email: 'asha@example.com' });
        await expect(call(createAccountRecord, { name: 'Asha' }, 'u1', password)).resolves.toEqual({ id: 'rec-1', created: false });
        expect(mem.all('users')).toHaveLength(1);
    });

    it('finishes an unfinished sign-up only for a login made within a day (review F)', async () => {
        await expect(call(createAccountRecord, { name: 'Asha', finish: true }, 'u1', password)).resolves.toMatchObject({ created: true });
        mem.store.get('users')!.clear();
        owner.getUser.mockImplementation(async (uid: string) => ({ uid, customClaims: {}, metadata: { creationTime: new Date(Date.now() - 48 * 3_600_000).toUTCString() } }));
        await expect(call(createAccountRecord, { name: 'Host User', finish: true }, 'u1', password))
            .rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'no-access' } });
        expect(mem.all('users')).toHaveLength(0);
    });

    it('refuses when sign-ups are closed, and for non-password sign-ins', async () => {
        await expect(call(createAccountRecord, { name: 'Asha' }, 'u1', { ...password, firebase: { sign_in_provider: 'custom' } }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        mem.seed('Settings', 'users', { isSignupEnabled: false });
        await expect(call(createAccountRecord, { name: 'Asha' }, 'u1', password))
            .rejects.toMatchObject({ details: { reason: 'signup-closed' } });
    });
});

describe('refreshMyClaims', () => {
    it('puts the record id and role on an account that predates the claim', async () => {
        mem.seed('users', 'rec-7', { uid: 'u7', role: 'admin' });
        claims['u7'] = { hostApp: 'x' };
        await expect(call(refreshMyClaims, {}, 'u7')).resolves.toEqual({ arccms_uid: 'rec-7' });
        expect(claims['u7']).toEqual({ hostApp: 'x', arccms_role: 'admin', arccms_uid: 'rec-7' });
    });

    it('refuses a sign-in with no record here', async () => {
        await expect(call(refreshMyClaims, {}, 'nobody')).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('gives a blocked or detached record no claims, and takes any back (review F)', async () => {
        for (const blocked of [{ isActive: false }, { status: 'Detached' }]) {
            mem.seed('users', 'rec-7', { uid: 'u7', role: 'admin', ...blocked });
            claims['u7'] = { hostApp: 'x', arccms_role: 'admin', arccms_uid: 'rec-7' };
            await expect(call(refreshMyClaims, {}, 'u7')).rejects.toMatchObject({ code: 'permission-denied' });
            expect(claims['u7']).toEqual({ hostApp: 'x' });
        }
    });
});

describe('deleteMyAccount', () => {
    beforeEach(() => mem.seed('users', 'rec-1', { uid: 'u1', role: 'user' }));

    it('deletes the record (the trigger removes the rest) after a recent sign-in', async () => {
        await expect(call(deleteMyAccount, {}, 'u1', { auth_time: nowSeconds() - 60 })).resolves.toEqual({ deleted: true });
        expect(mem.read('users', 'rec-1')).toBeUndefined();
        expect(mockErase).not.toHaveBeenCalled();
    });

    it('erases the contact of the address too: its lists and consent (review F)', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1', role: 'user', email: ' Asha@Example.com' });
        await call(deleteMyAccount, {}, 'u1', { auth_time: nowSeconds() - 60 });
        expect(mockErase).toHaveBeenCalledWith(computeEmailHash('asha@example.com'), 'u1');
        expect(mem.read('users', 'rec-1')).toBeUndefined();
    });

    it('keeps the account when the contact cannot be erased, so the person can try again', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1', role: 'user', email: 'asha@example.com' });
        mockErase.mockRejectedValueOnce(new Error('down'));
        await expect(call(deleteMyAccount, {}, 'u1', { auth_time: nowSeconds() - 60 })).rejects.toThrow('down');
        expect(mem.read('users', 'rec-1')).toBeDefined();
    });

    it('asks for a fresh sign-in first', async () => {
        await expect(call(deleteMyAccount, {}, 'u1', { auth_time: nowSeconds() - 3600 }))
            .rejects.toMatchObject({ details: { reason: 'recent-sign-in' } });
        expect(mem.read('users', 'rec-1')).toBeDefined();
    });

    it('never lets an admin delete themselves', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1', role: 'admin' });
        await expect(call(deleteMyAccount, {}, 'u1', { auth_time: nowSeconds() })).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('signedInRecently reads the token auth_time in seconds', () => {
        const now = Date.parse('2026-09-27T10:00:00Z');
        expect(signedInRecently(now / 1000 - 300, now)).toBe(true);
        expect(signedInRecently(now / 1000 - 900, now)).toBe(false);
        expect(signedInRecently(undefined, now)).toBe(false);
    });
});
