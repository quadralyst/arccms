/** Admin: set a person's password from Users > Edit user, never in Firestore. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const records = new Map<string, Record<string, unknown>>();
    const accounts = new Map<string, { uid: string; email?: string }>();
    return {
        records, accounts,
        owner: {
            getUser: vi.fn(async (uid: string) => {
                const account = accounts.get(uid);
                if (!account) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
                return account;
            }),
            updateUser: vi.fn(async () => undefined),
        },
        db: {
            collection: vi.fn(() => ({
                doc: vi.fn((id: string) => ({
                    get: async () => ({ exists: records.has(id), data: () => records.get(id) }),
                    set: vi.fn(),
                    update: vi.fn(),
                })),
            })),
        },
        requireAdmin: vi.fn(async () => undefined),
    };
});

vi.mock('../init', () => ({ db: m.db, owner: m.owner }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, msg: string, public details?: unknown) { super(msg); }
    },
}));

import { adminSetPassword, SHARED_ACCOUNT, NO_EMAIL, NO_ACCOUNT } from '../users/adminSetPassword.js';
import { PASSWORD_PROBLEM_TEXT } from '../shared/password-rule.js';
import { APP_MANAGED } from '../users/lockedAppAccount.js';

const handler = adminSetPassword as unknown as (req: any) => Promise<any>;
const call = (data: Record<string, unknown>) => handler({ auth: { uid: 'admin-uid' }, data });
const GOOD = 'Monsoon-Train-42';

describe('adminSetPassword', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.records.clear();
        m.accounts.clear();
        m.records.set('doc-1', { uid: 'uid-1', name: 'Asha Rao', email: 'asha@example.com' });
        m.accounts.set('uid-1', { uid: 'uid-1', email: 'asha@example.com' });
    });

    it('sets the password on the sign-in account, and writes nothing to Firestore', async () => {
        expect(await call({ id: 'doc-1', password: GOOD })).toEqual({ updated: true });
        expect(m.owner.updateUser).toHaveBeenCalledWith('uid-1', { password: GOOD });
        const doc = vi.mocked(m.db.collection).mock.results[0].value.doc.mock.results[0].value;
        expect(doc.set).not.toHaveBeenCalled();
        expect(doc.update).not.toHaveBeenCalled();
    });

    it('is for admins only', async () => {
        m.requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Admin access required.'), { code: 'permission-denied' }));
        await expect(call({ id: 'doc-1', password: GOOD })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(m.owner.updateUser).not.toHaveBeenCalled();
    });

    it('refuses a password the rule refuses, saying why', async () => {
        for (const [password, problem] of [['short', 'short'], ['12345678', 'sequence'], ['password123', 'common'], ['Asha@2024', 'personal']] as const) {
            await expect(call({ id: 'doc-1', password })).rejects.toMatchObject({
                code: 'invalid-argument',
                message: PASSWORD_PROBLEM_TEXT[problem],
                details: { reason: 'weak-password', problem },
            });
        }
        await expect(call({ id: 'doc-1' })).rejects.toMatchObject({ details: { reason: 'weak-password', problem: 'short' } });
        expect(m.owner.updateUser).not.toHaveBeenCalled();
    });

    it('refuses a sign-in shared with another app', async () => {
        for (const authOwner of ['shared', 'host']) {
            m.records.set('doc-1', { uid: 'uid-1', name: 'Asha Rao', email: 'asha@example.com', authOwner });
            await expect(call({ id: 'doc-1', password: GOOD })).rejects.toMatchObject({
                code: 'failed-precondition', message: SHARED_ACCOUNT, details: { reason: 'shared-account' },
            });
        }
        expect(m.owner.updateUser).not.toHaveBeenCalled();
    });

    it('refuses a locked app account, but not one its app opened to self-service', async () => {
        m.records.set('doc-1', { uid: 'uid-1', name: 'Till 1', by: 'app' });
        await expect(call({ id: 'doc-1', password: GOOD })).rejects.toMatchObject({
            code: 'permission-denied', message: APP_MANAGED, details: { reason: 'app-managed' },
        });
        m.records.set('doc-1', { uid: 'uid-1', name: 'Till 1', by: 'app', selfService: true });
        await expect(call({ id: 'doc-1', password: GOOD })).resolves.toEqual({ updated: true });
    });

    it('refuses an account with no email, a sign-in that is gone, no sign-in, or no record', async () => {
        m.accounts.set('uid-1', { uid: 'uid-1' });
        await expect(call({ id: 'doc-1', password: GOOD })).rejects.toMatchObject({ message: NO_EMAIL, details: { reason: 'no-email' } });
        m.accounts.delete('uid-1');
        await expect(call({ id: 'doc-1', password: GOOD })).rejects.toMatchObject({
            code: 'failed-precondition', message: NO_ACCOUNT, details: { reason: 'no-account' },
        });
        m.records.set('doc-1', { name: 'Asha Rao' });
        await expect(call({ id: 'doc-1', password: GOOD })).rejects.toMatchObject({ details: { reason: 'no-account' } });
        await expect(call({ id: 'gone', password: GOOD })).rejects.toMatchObject({ code: 'not-found' });
        await expect(call({ id: '', password: GOOD })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ id: 'a/b', password: GOOD })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(m.owner.updateUser).not.toHaveBeenCalled();
    });
});
