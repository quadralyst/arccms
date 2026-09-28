/** Admin: add an ArcCMS user (docs/coexistence-spec.md, CO6.6). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const users: Array<Record<string, unknown>> = [];
    const written: Array<{ id: string; data: Record<string, unknown> }> = [];
    const accounts = new Map<string, { uid: string; emailVerified: boolean }>();
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
        },
        db: {
            collection: vi.fn(() => ({
                where: vi.fn((_f: string, _o: string, email: string) => ({ limit: () => ({
                    get: async () => ({ empty: !users.some((u) => u['email'] === email) }),
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
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string) { super(msg); } },
}));

import { adminCreateUser, validateAdminCreateUser } from '../users/adminCreateUser.js';

const create = adminCreateUser as unknown as (req: any) => Promise<any>;
const call = (data: Record<string, unknown>) => create({ auth: { uid: 'admin-uid' }, data });
const valid = { name: 'Asha', email: ' Asha@X.com ', password: 'temp-pass', role: 'user' };

describe('adminCreateUser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.users.length = 0;
        m.written.length = 0;
        m.accounts.clear();
        m.failWrite.value = false;
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
        expect(await call({ ...valid, role: 'admin' })).toEqual({ id: 'doc-1', uid: 'new-asha@x.com', reusedAccount: false });
        expect(m.owner.createUser).toHaveBeenCalledWith({ email: 'asha@x.com', password: 'temp-pass', displayName: 'Asha' });
        expect(m.written[0].data).toMatchObject({
            id: 'doc-1', uid: 'new-asha@x.com', email: 'asha@x.com', name: 'Asha', role: 'admin',
            isActive: true, status: 'Active', emailVerified: false, authOwner: 'arccms', by: 'admin', createdBy: 'admin-uid',
        });
        expect(m.written[0].data).not.toHaveProperty('password');
        // Claims in their first ID token: the role and the record id.
        expect(m.setRecordClaims).toHaveBeenCalledWith('new-asha@x.com', 'admin', 'doc-1');
    });

    it('reuses an existing sign-in account untouched and marks it shared', async () => {
        m.accounts.set('asha@x.com', { uid: 'host-uid', emailVerified: true });
        expect(await call(valid)).toEqual({ id: 'doc-1', uid: 'host-uid', reusedAccount: true });
        expect(m.owner.createUser).not.toHaveBeenCalled();
        expect(m.written[0].data).toMatchObject({ uid: 'host-uid', authOwner: 'shared', emailVerified: true });
    });

    it('needs a temporary password only when it creates the account', async () => {
        await expect(call({ ...valid, password: '123' })).rejects.toMatchObject({ code: 'invalid-argument' });
        m.accounts.set('asha@x.com', { uid: 'host-uid', emailVerified: false });
        await expect(call({ ...valid, password: '' })).resolves.toMatchObject({ reusedAccount: true });
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
