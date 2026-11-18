/**
 * An app turns an app account's sign-in off and on (F50, setAppSignIn,
 * docs/app/app-accounts.html#sign-in-off): the account stays, Users says "Sign-in off".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
    updateUser: vi.fn(async () => undefined),
    revokeRefreshTokens: vi.fn(async () => undefined),
    getUser: vi.fn(async (uid: string) => ({ uid, customClaims: {} })),
    createUser: vi.fn(async (input: { uid: string }) => ({ uid: input.uid })),
    setCustomUserClaims: vi.fn(async () => undefined),
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
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string, public details?: unknown) { super(msg); } },
}));
vi.mock('../users/claimLock.js', () => ({ withClaimLock: (_uid: string, work: () => Promise<unknown>) => work() }));

import { db } from '../init.js';
import { restoreAppSignIn, setAppSignIn, SIGN_IN_OFF } from '../app-kit/accounts.js';
import { adminSetUserBlocked, SIGN_IN_OFF_BY_APP } from '../users/adminUserAccess.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const record = (id = 'till') => mem.read('users', id)!;

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    mem.seed('users', 'boss', { uid: 'uid-boss', role: 'admin', isActive: true, status: 'Active' });
    mem.seed('users', 'till', { uid: 'uid-till', name: 'Till One', role: 'user', isActive: true, status: 'Active', by: 'app' });
});

describe('setAppSignIn', () => {
    it('off: the record says Off with the reason, its sign-in is disabled and its sessions end; the account stays', async () => {
        await expect(setAppSignIn('uid-till', { on: false, reason: 'Removed by the owner' })).resolves.toEqual({ uid: 'uid-till', userDocId: 'till' });
        expect(record()).toMatchObject({ status: SIGN_IN_OFF, isActive: false, name: 'Till One', signInOff: { reason: 'Removed by the owner', wasBlocked: false } });
        expect(SIGN_IN_OFF).toBe('Off');
        expect(owner.updateUser).toHaveBeenCalledWith('uid-till', { disabled: true });
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-till');
    });

    it('on: Active again, its sign-in enabled, and the reason gone', async () => {
        await setAppSignIn('uid-till', { on: false, reason: 'Removed' });
        await setAppSignIn('uid-till', { on: true });
        expect(record()).toMatchObject({ status: 'Active', isActive: true });
        expect(record()['signInOff']).toBeUndefined();
        expect(owner.updateUser).toHaveBeenLastCalledWith('uid-till', { disabled: false });
        expect(owner.revokeRefreshTokens).toHaveBeenCalledTimes(1);
    });

    it('is safe to repeat, and a second off keeps what the first knew of an admin block', async () => {
        await setAppSignIn('uid-till', { on: true });
        expect(record()).toMatchObject({ status: 'Active', isActive: true });
        mem.seed('users', 'till', { ...record(), isActive: false });
        await setAppSignIn('uid-till', { on: false });
        await setAppSignIn('uid-till', { on: false, reason: 'Left' });
        expect(record()).toMatchObject({ status: 'Off', signInOff: { reason: 'Left', wasBlocked: true } });
    });

    it("leaves an admin's block as it was when sign-in comes back on", async () => {
        mem.seed('users', 'till', { ...record(), isActive: false });
        await setAppSignIn('uid-till', { on: false });
        await setAppSignIn('uid-till', { on: true });
        expect(record()).toMatchObject({ status: 'Active', isActive: false });
    });

    it('turns the record off even when the sign-in is already gone', async () => {
        owner.updateUser.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
        await setAppSignIn('uid-till', { on: false });
        expect(record()).toMatchObject({ status: 'Off', isActive: false });
    });

    it('refuses what is not an app account, an unknown uid, a missing choice, a long reason and a detached record', async () => {
        await expect(setAppSignIn('uid-boss', { on: false })).rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(setAppSignIn('nobody', { on: false })).rejects.toMatchObject({ code: 'not-found' });
        await expect(setAppSignIn('uid-till', {} as never)).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(setAppSignIn('uid-till', { on: false, reason: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid-argument' });
        mem.seed('users', 'till', { ...record(), status: 'Detached', isActive: false });
        await expect(setAppSignIn('uid-till', { on: true })).rejects.toMatchObject({ details: { reason: 'detached' } });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it("never turns off the site's last active admin", async () => {
        mem.seed('users', 'boss', { ...mem.read('users', 'boss')!, isActive: false });
        mem.seed('users', 'till', { ...record(), role: 'admin' });
        await expect(setAppSignIn('uid-till', { on: false })).rejects.toMatchObject({ details: { reason: 'last-admin' } });
        expect(record()).toMatchObject({ status: 'Active', isActive: true });
    });
});

describe('an admin and a sign-in its app turned off', () => {
    const call = (data: Record<string, unknown>) =>
        (adminSetUserBlocked as unknown as (r: unknown) => Promise<unknown>)({ data, auth: { uid: 'uid-boss', token: { arccms_role: 'admin', arccms_uid: 'boss' } } });

    it('cannot unblock it: the app turns it on', async () => {
        await setAppSignIn('uid-till', { on: false });
        await expect(call({ id: 'till', blocked: false })).rejects.toMatchObject({ message: SIGN_IN_OFF_BY_APP, details: { reason: 'sign-in-off' } });
        expect(record()).toMatchObject({ status: 'Off', isActive: false });
    });
});

describe('restoreAppSignIn', () => {
    it('gives a sign-in deleted while off back disabled', async () => {
        await setAppSignIn('uid-till', { on: false });
        owner.getUser.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
        await restoreAppSignIn('uid-till');
        expect(owner.createUser).toHaveBeenCalledWith({ uid: 'uid-till', displayName: 'Till One', disabled: true });
    });
});
