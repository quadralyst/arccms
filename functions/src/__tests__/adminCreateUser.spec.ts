/** Admin: add an ArcCMS user (specs/coexistence-spec.md, CO6.6). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => {
    const users: Array<Record<string, unknown>> = [];
    const written: Array<{ id: string; data: Record<string, unknown> }> = [];
    const accounts = new Map<string, Record<string, unknown>>();
    const failWrite = { value: false };
    return {
        users, written, accounts, failWrite,
        owner: {
            getUserByEmail: vi.fn(async (email: string) => {
                const a = accounts.get(email);
                if (!a) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
                return a;
            }),
            createUser: vi.fn(async ({ email }: { email: string }) => ({ uid: `new-${email}`, emailVerified: false })),
            deleteUser: vi.fn(async () => undefined),
            updateUser: vi.fn(async () => undefined),
            revokeRefreshTokens: vi.fn(async () => undefined),
        },
        db: {
            collection: vi.fn(() => ({
                where: vi.fn((field: string, _o: string, value: string) => ({ limit: () => ({
                    get: async () => ({ empty: !users.some((u) => u[field] === value) }),
                }) })),
                doc: vi.fn(() => ({
                    id: 'doc-1',
                    set: vi.fn(async (data: Record<string, unknown>) => {
                        if (failWrite.value) throw new Error('write failed');
                        written.push({ id: 'doc-1', data });
                    }),
                })),
            })),
        },
        requireAdmin: vi.fn(async () => undefined),
        setRecordClaims: vi.fn(async () => undefined),
    };
});

vi.mock('../init', () => ({ db: m.db, owner: m.owner }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('../users/syncUserRole', () => ({ KNOWN_ROLES: ['admin', 'user', 'propertyOwner', 'facilityManager'] }));
vi.mock('../users/claims', () => ({ setRecordClaims: m.setRecordClaims }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => 'now') } }));
// The app's password and PIN strength (src/custom/sign-in.ts): strict unless a test says simple.
const strength = vi.hoisted(() => ({ value: 'strict' as 'strict' | 'simple' }));
vi.mock('../sign-in-choice', () => ({ signInStrength: () => strength.value, fixedSignIn: () => ({ emailSignIn: null, newDeviceCode: null }) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string, public details?: unknown) { super(msg); } },
}));

import { adminCreateUser, validateAdminCreateUser } from '../users/adminCreateUser.js';

const create = adminCreateUser as unknown as (req: any) => Promise<any>;
const call = (data: Record<string, unknown>) => create({ auth: { uid: 'admin-uid' }, data });
const valid = { name: 'Asha', email: ' Asha@X.com ', password: 'temp-pass', role: 'user' };

/** An unverified password sign-in with no other app's marks, made `minutes` ago. */
const squat = (over: Record<string, unknown> = {}, minutes = 60 * 24 * 30) => ({
    uid: 'squat-uid', emailVerified: false, providerData: [{ providerId: 'password' }], customClaims: {},
    metadata: { creationTime: new Date(Date.now() - minutes * 60_000).toUTCString() }, ...over,
});

describe('adminCreateUser', () => {
    afterEach(() => {
        delete process.env['ARC_DATABASE_ID'];
    });

    beforeEach(() => {
        vi.clearAllMocks();
        m.users.length = 0;
        m.written.length = 0;
        m.accounts.clear();
        m.failWrite.value = false;
        strength.value = 'strict';
    });

    it('follows the app\'s simple passwords for the temporary password', async () => {
        strength.value = 'simple';
        await expect(call({ ...valid, password: 'temp1' })).rejects.toMatchObject({ details: { reason: 'weak-password', problem: 'short', min: 6 } });
        await expect(call({ ...valid, password: '123456' })).resolves.toMatchObject({ reusedAccount: false });
        expect(m.owner.createUser).toHaveBeenCalledWith(expect.objectContaining({ password: '123456' }));
    });

    it('validates the input and normalises the email', () => {
        expect(validateAdminCreateUser(valid)).toEqual({ name: 'Asha', email: 'asha@x.com', password: 'temp-pass', role: 'user' });
        expect(validateAdminCreateUser({ ...valid, role: '' }).role).toBe('user');
        expect(() => validateAdminCreateUser({ ...valid, name: ' ' })).toThrow('name');
        expect(() => validateAdminCreateUser({ ...valid, email: 'nope' })).toThrow('email');
        expect(() => validateAdminCreateUser({ ...valid, role: 'superuser' })).toThrow('Unknown role');
    });

    it('is for admins only', async () => {
        m.requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Admin access required.'), { code: 'permission-denied' }));
        await expect(call(valid)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(m.owner.createUser).not.toHaveBeenCalled();
    });

    it('creates the sign-in account and the record, owned by ArcCMS, with no password stored', async () => {
        expect(await call({ ...valid, role: 'admin' })).toEqual({ id: 'doc-1', uid: 'new-asha@x.com', reusedAccount: false, passwordSet: true, keepsOwnPassword: false });
        expect(m.owner.createUser).toHaveBeenCalledWith({ email: 'asha@x.com', password: 'temp-pass', displayName: 'Asha' });
        expect(m.written[0].data).toMatchObject({
            id: 'doc-1', uid: 'new-asha@x.com', email: 'asha@x.com', name: 'Asha', role: 'admin',
            isActive: true, status: 'Active', emailVerified: false, authOwner: 'arccms', by: 'admin', createdBy: 'admin-uid',
        });
        expect(m.written[0].data).not.toHaveProperty('password');
        // Claims in their first ID token: the role and the record id.
        expect(m.setRecordClaims).toHaveBeenCalledWith('new-asha@x.com', 'admin', 'doc-1');
    });

    it('reuses an existing verified sign-in account untouched and marks it shared', async () => {
        m.accounts.set('asha@x.com', { uid: 'host-uid', emailVerified: true });
        expect(await call(valid)).toEqual({ id: 'doc-1', uid: 'host-uid', reusedAccount: true, passwordSet: false, keepsOwnPassword: true });
        expect(m.owner.createUser).not.toHaveBeenCalled();
        expect(m.owner.updateUser).not.toHaveBeenCalled();
        expect(m.owner.revokeRefreshTokens).not.toHaveBeenCalled();
        expect(m.written[0].data).toMatchObject({ uid: 'host-uid', authOwner: 'shared', emailVerified: true });
    });

    it('takes over an unverified account: the admin\'s password, every session ended', async () => {
        m.accounts.set('asha@x.com', squat());
        expect(await call(valid)).toEqual({ id: 'doc-1', uid: 'squat-uid', reusedAccount: false, passwordSet: true, keepsOwnPassword: false });
        expect(m.owner.createUser).not.toHaveBeenCalled();
        expect(m.owner.updateUser).toHaveBeenCalledWith('squat-uid', { password: 'temp-pass' });
        expect(m.owner.revokeRefreshTokens).toHaveBeenCalledWith('squat-uid');
        // Still never deleted with the record: it may be another app's account.
        expect(m.written[0].data).toMatchObject({ uid: 'squat-uid', authOwner: 'shared', emailVerified: false });
    });

    describe('in a sign-in pool shared with another app (its own database)', () => {
        beforeEach(() => {
            process.env['ARC_DATABASE_ID'] = 'arccms';
        });

        it('reuses another app\'s unverified user untouched: no new password, no sessions ended, and says so', async () => {
            m.accounts.set('asha@x.com', squat({ uid: 'host-uid' }));
            expect(await call(valid)).toEqual({ id: 'doc-1', uid: 'host-uid', reusedAccount: true, passwordSet: false, keepsOwnPassword: true });
            expect(m.owner.updateUser).not.toHaveBeenCalled();
            expect(m.owner.revokeRefreshTokens).not.toHaveBeenCalled();
            expect(m.written[0].data).toMatchObject({ uid: 'host-uid', authOwner: 'shared', emailVerified: false });
        });

        it('never gives more than a member\'s role to an unverified account it leaves untouched', async () => {
            for (const role of ['admin', 'propertyOwner']) {
                m.accounts.set('asha@x.com', squat({ uid: 'host-uid' }));
                await expect(call({ ...valid, role })).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'unverified-account' } });
            }
            expect(m.written).toHaveLength(0);
            expect(m.setRecordClaims).not.toHaveBeenCalled();
            // Verified, the account is the person's own: any role.
            m.accounts.set('asha@x.com', squat({ uid: 'host-uid', emailVerified: true }));
            await expect(call({ ...valid, role: 'admin' })).resolves.toMatchObject({ keepsOwnPassword: true });
        });

        it('takes over one Arc CMS just made (minutes old), as in a project of its own', async () => {
            m.accounts.set('asha@x.com', squat({}, 2));
            await expect(call(valid)).resolves.toMatchObject({ passwordSet: true, keepsOwnPassword: false });
            expect(m.owner.updateUser).toHaveBeenCalledWith('squat-uid', { password: 'temp-pass' });
        });
    });

    it('never takes over an account with another way in or another app\'s claims, even in a project of its own', async () => {
        for (const over of [
            { providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] },
            { providerData: [{ providerId: 'phone' }] },
            { customClaims: { hostRole: 'staff' } },
        ]) {
            m.accounts.set('asha@x.com', squat(over));
            await expect(call(valid)).resolves.toMatchObject({ reusedAccount: true, passwordSet: false, keepsOwnPassword: true });
        }
        expect(m.owner.updateUser).not.toHaveBeenCalled();
        expect(m.owner.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('refuses a sign-in account that already has an ArcCMS record (an app account), touching nothing', async () => {
        m.accounts.set('asha@x.com', squat());
        m.users.push({ uid: 'squat-uid', by: 'app' });
        await expect(call(valid)).rejects.toMatchObject({ code: 'already-exists' });
        expect(m.owner.updateUser).not.toHaveBeenCalled();
        expect(m.written).toHaveLength(0);
    });

    it('checks the temporary password before it touches an unverified account', async () => {
        m.accounts.set('asha@x.com', squat());
        await expect(call({ ...valid, password: '' })).rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'weak-password' } });
        await expect(call({ ...valid, password: '12345678' })).rejects.toMatchObject({ details: { problem: 'sequence' } });
        expect(m.owner.updateUser).not.toHaveBeenCalled();
        expect(m.owner.revokeRefreshTokens).not.toHaveBeenCalled();
        expect(m.written).toHaveLength(0);
    });

    it('needs a temporary password only when it sets one', async () => {
        await expect(call({ ...valid, password: '123' })).rejects.toMatchObject({ code: 'invalid-argument' });
        m.accounts.set('asha@x.com', { uid: 'host-uid', emailVerified: true });
        await expect(call({ ...valid, password: '' })).resolves.toMatchObject({ reusedAccount: true });
    });

    it('refuses a temporary password that is too easy to guess, saying why (F22)', async () => {
        for (const [password, problem] of [['temp1', 'short'], ['12345678', 'sequence'], ['password1', 'common'], ['Asha2024!', 'personal']]) {
            await expect(call({ ...valid, password })).rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'weak-password', problem } });
        }
        expect(m.owner.createUser).not.toHaveBeenCalled();
    });

    it('refuses an address that already has an ArcCMS user', async () => {
        m.users.push({ email: 'asha@x.com' });
        await expect(call(valid)).rejects.toMatchObject({ code: 'already-exists' });
        expect(m.owner.createUser).not.toHaveBeenCalled();
    });

    it('removes an account it just created when the record cannot be written, but never a reused one', async () => {
        m.failWrite.value = true;
        await expect(call(valid)).rejects.toThrow('write failed');
        expect(m.owner.deleteUser).toHaveBeenCalledWith('new-asha@x.com');

        m.owner.deleteUser.mockClear();
        m.accounts.set('asha@x.com', { uid: 'host-uid', emailVerified: false });
        await expect(call(valid)).rejects.toThrow('write failed');
        expect(m.owner.deleteUser).not.toHaveBeenCalled();
    });
});
