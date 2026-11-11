/** Admin: role, block and delete from Users, never leaving the site without an active admin (RF4, 4.7 and 4.8). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({
    accounts: new Map<string, Record<string, unknown>>(),
    requireAdmin: vi.fn(async () => undefined),
}));
const owner = vi.hoisted(() => ({
    getUser: vi.fn(async (uid: string) => {
        const account = m.accounts.get(uid);
        if (!account) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
        return account;
    }),
}));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('../sign-in-choice', () => ({ signInStrength: () => 'strict', fixedSignIn: () => ({ emailSignIn: null, newDeviceCode: null }) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string, public details?: unknown) { super(msg); } },
}));

import { db } from '../init.js';
import {
    adminDeleteUser, adminHoldsPassword, adminSetUserBlocked, adminSetUserRole, isActiveAdmin, requireAnotherActiveAdmin,
    DETACHED, LAST_ADMIN, NOT_ACTIVE_ADMIN, OWN_RECORD, UNVERIFIED_ROLE,
} from '../users/adminUserAccess.js';
import { APP_MANAGED } from '../users/lockedAppAccount.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
/**
 * Called as the admin whose sign-in is `uid` and whose token names `recordId`
 * (`arccms_uid`); by default Boss. `null` sends a token without the claim.
 */
const call = (fn: unknown, data: Record<string, unknown>, uid = 'uid-boss', recordId: string | null = 'boss') =>
    (fn as Handler)({ auth: { uid, token: recordId === null ? {} : { arccms_uid: recordId } }, data });
const asRavi = (fn: unknown, data: Record<string, unknown>) => call(fn, data, 'uid-ravi', 'ravi');
const record = (id: string) => mem.read('users', id);

/** A sign-in account: verified email unless said otherwise. */
const account = (uid: string, over: Record<string, unknown> = {}) => m.accounts.set(uid, {
    uid, email: `${uid}@example.com`, emailVerified: true, providerData: [{ providerId: 'password' }], customClaims: {},
    metadata: { creationTime: new Date(Date.now() - 30 * 86_400_000).toUTCString() }, ...over,
});

describe('admin user access', () => {
    beforeEach(() => {
        mem.store.clear();
        m.accounts.clear();
        vi.clearAllMocks();
        mem.seed('users', 'boss', { uid: 'uid-boss', name: 'Boss', role: 'admin', isActive: true, status: 'Active', by: 'admin' });
        mem.seed('users', 'ravi', { uid: 'uid-ravi', name: 'Ravi', role: 'admin', isActive: true, status: 'Active', by: 'admin' });
        mem.seed('users', 'asha', { uid: 'uid-asha', name: 'Asha', role: 'user', isActive: true, status: 'Active', by: 'email' });
        account('uid-boss');
        account('uid-ravi');
        account('uid-asha');
    });
    afterEach(() => {
        delete process.env['ARC_DATABASE_ID'];
    });

    it('counts an admin as active only while not blocked or detached', () => {
        expect(isActiveAdmin({ role: 'admin', isActive: true })).toBe(true);
        expect(isActiveAdmin({ role: 'admin', isActive: false })).toBe(false);
        expect(isActiveAdmin({ role: 'admin', status: 'Detached' })).toBe(false);
        expect(isActiveAdmin({ role: 'user' })).toBe(false);
    });

    it('is for admins only, every one of them', async () => {
        for (const fn of [adminSetUserRole, adminSetUserBlocked, adminDeleteUser]) {
            m.requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Admin access required.'), { code: 'permission-denied' }));
            await expect(call(fn, { id: 'asha', role: 'admin', blocked: true })).rejects.toMatchObject({ code: 'permission-denied' });
        }
        expect(record('asha')).toMatchObject({ role: 'user', isActive: true });
    });

    describe('the caller must still be an active admin by their record (H1)', () => {
        it('refuses a blocked admin whose token still says admin: no unblocking themselves, no blocking others', async () => {
            mem.seed('users', 'boss', { ...record('boss'), isActive: false });
            await expect(call(adminSetUserBlocked, { id: 'boss', blocked: false })).rejects.toMatchObject({
                code: 'permission-denied', message: NOT_ACTIVE_ADMIN, details: { reason: 'not-active-admin' },
            });
            await expect(call(adminSetUserBlocked, { id: 'ravi', blocked: true })).rejects.toMatchObject({ details: { reason: 'not-active-admin' } });
            await expect(call(adminDeleteUser, { id: 'ravi' })).rejects.toMatchObject({ details: { reason: 'not-active-admin' } });
            expect(record('boss')!['isActive']).toBe(false);
            expect(record('ravi')!['isActive']).toBe(true);
        });

        it('refuses a demoted admin promoting themselves back with a stale token', async () => {
            mem.seed('users', 'boss', { ...record('boss'), role: 'user' });
            await expect(call(adminSetUserRole, { id: 'boss', role: 'admin' })).rejects.toMatchObject({ details: { reason: 'not-active-admin' } });
            expect(record('boss')!['role']).toBe('user');
        });

        it("never trusts a claim naming someone else's record, and finds the record by uid when the claim is missing", async () => {
            await expect(call(adminSetUserBlocked, { id: 'asha', blocked: true }, 'uid-boss', 'ravi')).rejects.toMatchObject({ details: { reason: 'not-active-admin' } });
            await expect(call(adminSetUserBlocked, { id: 'asha', blocked: true }, 'uid-boss', null)).resolves.toEqual({ blocked: true });
        });

        it('leaves your own role, block and record to another admin', async () => {
            const own: Array<[unknown, Record<string, unknown>]> = [
                [adminSetUserRole, { id: 'boss', role: 'user' }],
                [adminSetUserBlocked, { id: 'boss', blocked: true }],
                [adminDeleteUser, { id: 'boss' }],
            ];
            for (const [fn, data] of own) {
                await expect(call(fn, data)).rejects.toMatchObject({ code: 'failed-precondition', message: OWN_RECORD, details: { reason: 'own-account' } });
            }
            // Another record on your own sign-in is yours too.
            mem.seed('users', 'boss-twin', { uid: 'uid-boss', role: 'admin', isActive: true });
            await expect(call(adminSetUserBlocked, { id: 'boss-twin', blocked: true })).rejects.toMatchObject({ details: { reason: 'own-account' } });
            expect(record('boss')).toMatchObject({ role: 'admin', isActive: true });
        });
    });

    describe('the last active admin (L3)', () => {
        it('needs another active admin with a sign-in of its own', async () => {
            await expect(requireAnotherActiveAdmin(null, 'boss', 'uid-boss')).resolves.toBeUndefined();
            mem.seed('users', 'ravi', { ...record('ravi'), isActive: false });
            await expect(requireAnotherActiveAdmin(null, 'boss', 'uid-boss')).rejects.toMatchObject({ message: LAST_ADMIN, details: { reason: 'last-admin' } });
            // An admin record with no sign-in, or on the same sign-in, is no other admin.
            mem.seed('users', 'nobody', { uid: '', role: 'admin', isActive: true });
            mem.seed('users', 'twin', { uid: 'uid-boss', role: 'admin', isActive: true });
            await expect(requireAnotherActiveAdmin(null, 'boss', 'uid-boss')).rejects.toMatchObject({ details: { reason: 'last-admin' } });
            await expect(requireAnotherActiveAdmin(null, 'boss', 'uid-boss', 'Custom.')).rejects.toMatchObject({ message: 'Custom.' });
        });

        it('lets one admin demote, block or delete another while one stays', async () => {
            await expect(asRavi(adminSetUserRole, { id: 'boss', role: 'user' })).resolves.toMatchObject({ changed: true });
            expect(record('boss')!['role']).toBe('user');
        });
    });

    describe('adminSetUserRole', () => {
        it('makes a second admin, and says who did it', async () => {
            await expect(call(adminSetUserRole, { id: 'asha', role: 'admin' })).resolves.toEqual({ role: 'admin', changed: true });
            expect(record('asha')).toMatchObject({ role: 'admin', modifiedBy: 'uid-boss' });
        });

        it('changes nothing for the role a record already has, or an unknown one', async () => {
            await expect(call(adminSetUserRole, { id: 'asha', role: 'user' })).resolves.toEqual({ role: 'user', changed: false });
            await expect(call(adminSetUserRole, { id: 'asha', role: 'owner' })).rejects.toMatchObject({ code: 'invalid-argument' });
            await expect(call(adminSetUserRole, { id: 'asha' })).rejects.toMatchObject({ code: 'invalid-argument' });
            await expect(call(adminSetUserRole, { id: 'gone', role: 'admin' })).rejects.toMatchObject({ code: 'not-found' });
            await expect(call(adminSetUserRole, { id: 'a/b', role: 'admin' })).rejects.toMatchObject({ code: 'invalid-argument' });
        });

        it('refuses a raise for a self sign-up whose email was never verified, even on a project of its own (H2)', async () => {
            // The (default) database: canTakeOver would call the sign-in Arc CMS's own.
            account('uid-asha', { emailVerified: false });
            await expect(call(adminSetUserRole, { id: 'asha', role: 'admin' })).rejects.toMatchObject({
                code: 'failed-precondition', message: UNVERIFIED_ROLE, details: { reason: 'unverified-account' },
            });
            expect(record('asha')!['role']).toBe('user');
            expect(UNVERIFIED_ROLE).toContain('set a new password for them first in Edit user');
        });

        it('allows the raise once the admins hold the password: Add user made it, or Edit user set one since', async () => {
            account('uid-asha', { emailVerified: false });
            mem.seed('users', 'asha', { ...record('asha'), adminPasswordAt: { seconds: 1 } });
            await expect(call(adminSetUserRole, { id: 'asha', role: 'admin' })).resolves.toMatchObject({ changed: true });

            mem.seed('users', 'mira', { uid: 'uid-mira', role: 'user', isActive: true, by: 'admin', authOwner: 'arccms' });
            account('uid-mira', { emailVerified: false });
            await expect(call(adminSetUserRole, { id: 'mira', role: 'admin' })).resolves.toMatchObject({ changed: true });
            // Add user reusing another app's sign-in: that app's user keeps their own password.
            mem.seed('users', 'host', { uid: 'uid-host', role: 'user', isActive: true, by: 'admin', authOwner: 'shared' });
            account('uid-host', { emailVerified: false });
            await expect(call(adminSetUserRole, { id: 'host', role: 'admin' })).rejects.toMatchObject({ details: { reason: 'unverified-account' } });
        });

        it('knows who holds a password', () => {
            expect(adminHoldsPassword({ by: 'admin' })).toBe(true);
            expect(adminHoldsPassword({ by: 'admin', authOwner: 'arccms' })).toBe(true);
            expect(adminHoldsPassword({ by: 'admin', authOwner: 'shared' })).toBe(false);
            expect(adminHoldsPassword({ by: 'email' })).toBe(false);
            expect(adminHoldsPassword({ by: 'email', adminPasswordAt: { seconds: 1 } })).toBe(true);
        });

        it('allows a raise for a verified email, or a phone account with no email', async () => {
            await expect(call(adminSetUserRole, { id: 'asha', role: 'admin' })).resolves.toMatchObject({ changed: true });
            mem.seed('users', 'kiran', { uid: 'uid-kiran', role: 'user', isActive: true, phone: '+919876543210', by: 'phone' });
            account('uid-kiran', { email: undefined, emailVerified: false, providerData: [] });
            await expect(call(adminSetUserRole, { id: 'kiran', role: 'admin' })).resolves.toMatchObject({ changed: true });
        });

        it("leaves a locked app account's role to its app", async () => {
            mem.seed('users', 'till', { uid: 'uid-till', role: 'user', by: 'app' });
            await expect(call(adminSetUserRole, { id: 'till', role: 'admin' })).rejects.toMatchObject({
                code: 'permission-denied', message: APP_MANAGED, details: { reason: 'app-managed' },
            });
        });
    });

    describe('adminSetUserBlocked', () => {
        it('blocks and unblocks a member', async () => {
            await expect(call(adminSetUserBlocked, { id: 'asha', blocked: true })).resolves.toEqual({ blocked: true });
            expect(record('asha')).toMatchObject({ isActive: false, modifiedBy: 'uid-boss' });
            await call(adminSetUserBlocked, { id: 'asha', blocked: false });
            expect(record('asha')!['isActive']).toBe(true);
        });

        it('refuses to unblock a detached record, which could not sign in anyway (L6)', async () => {
            mem.seed('users', 'moved', { uid: 'uid-moved', role: 'user', isActive: false, status: 'Detached' });
            await expect(call(adminSetUserBlocked, { id: 'moved', blocked: false })).rejects.toMatchObject({
                message: DETACHED, details: { reason: 'detached' },
            });
            expect(record('moved')!['isActive']).toBe(false);
        });

        it('wants a yes or no', async () => {
            await expect(call(adminSetUserBlocked, { id: 'asha', blocked: 'yes' })).rejects.toMatchObject({ code: 'invalid-argument' });
        });
    });

    describe('adminDeleteUser', () => {
        it('deletes a member, leaving the clean-up to onUserDeleted', async () => {
            await expect(call(adminDeleteUser, { id: 'asha' })).resolves.toEqual({ deleted: true });
            expect(record('asha')).toBeUndefined();
        });

        it('deletes another admin while one stays, and a blocked admin', async () => {
            mem.seed('users', 'old', { uid: 'uid-old', role: 'admin', isActive: false });
            await expect(call(adminDeleteUser, { id: 'old' })).resolves.toEqual({ deleted: true });
            await expect(call(adminDeleteUser, { id: 'ravi' })).resolves.toEqual({ deleted: true });
        });

        it('leaves a locked app account to its app (L7)', async () => {
            mem.seed('users', 'till', { uid: 'uid-till', role: 'user', by: 'app' });
            await expect(call(adminDeleteUser, { id: 'till' })).rejects.toMatchObject({ message: APP_MANAGED, details: { reason: 'app-managed' } });
            mem.seed('users', 'open', { uid: 'uid-open', role: 'user', by: 'app', selfService: true });
            await expect(call(adminDeleteUser, { id: 'open' })).resolves.toEqual({ deleted: true });
        });

        it('says when the user is already gone', async () => {
            await expect(call(adminDeleteUser, { id: 'gone' })).rejects.toMatchObject({ code: 'not-found' });
        });
    });
});
