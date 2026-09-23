/**
 * Tests for functions/src/users/syncUserRole.ts
 *
 * The role claim IS the admin gate (firestore.rules isAdmin()), so these cover:
 * - claims are merged, never replaced
 * - onUserRoleChange refuses (and reverts) an elevated role written by a non-admin
 * - it syncs roles written by admins and by the Admin SDK
 * - it applies Settings/users.defaultRole to self sign-ups
 * - claimFirstAdmin grants admin once, only while no admin exists
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();

// Firestore: a tiny in-memory model of just what these functions touch.
let settingsUsers: Record<string, unknown> | null = null;
let sentinel: Record<string, unknown> | null = null;
let userDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
const txSet = vi.fn();
const txUpdate = vi.fn();

function queryResult(filter: (d: Record<string, unknown>) => boolean) {
    const docs = userDocs
        .filter((u) => filter(u.data))
        .map((u) => ({ id: u.id, ref: { id: u.id }, data: () => u.data }));
    return { empty: docs.length === 0, docs };
}

function usersQuery(field: string, value: unknown) {
    return { __query: true, field, value, limit: () => usersQuery(field, value) };
}

const mockDb = {
    collection: vi.fn((name: string) => ({
        doc: (id: string) => ({
            __path: `${name}/${id}`,
            get: vi.fn(async () =>
                name === 'Settings' && id === 'users'
                    ? { exists: settingsUsers !== null, data: () => settingsUsers }
                    : { exists: false, data: () => undefined }),
        }),
        where: (field: string, _op: string, value: unknown) => usersQuery(field, value),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
            get: async (target: any) => {
                if (target.__query) return queryResult((d) => d[target.field] === target.value);
                return { exists: sentinel !== null, data: () => sentinel };
            },
            set: txSet,
            update: txUpdate,
        };
        return fn(tx);
    }),
};

vi.mock('../init', () => ({
    owner: { getUser: mockGetUser, setCustomUserClaims: mockSetCustomUserClaims },
    db: mockDb,
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWrittenWithAuthContext: vi.fn((_path: string, handler: Function) => handler),
}));

vi.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    }
    return { onCall: vi.fn((handler: Function) => handler), HttpsError };
});

const { onUserRoleChange, claimFirstAdmin, setRoleClaim } = await import('../users/syncUserRole.js');
const trigger = onUserRoleChange as unknown as (event: any) => Promise<void>;
const claim = claimFirstAdmin as unknown as (request: any) => Promise<unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    authType = 'app_user',
    authId?: string,
) {
    const refUpdate = vi.fn().mockResolvedValue(undefined);
    return {
        refUpdate,
        event: {
            authType,
            authId,
            data: {
                before: before ? { data: () => before } : { data: () => undefined },
                after: after ? { data: () => after, ref: { update: refUpdate } } : undefined,
            },
        },
    };
}

/** Claims each Auth user currently holds. */
let claimsByUid: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
    vi.clearAllMocks();
    settingsUsers = null;
    sentinel = null;
    userDocs = [];
    claimsByUid = { 'admin-uid': { role: 'admin' } };
    mockGetUser.mockImplementation(async (uid: string) => ({ uid, customClaims: claimsByUid[uid] }));
    mockSetCustomUserClaims.mockResolvedValue(undefined);
});

// ─── setRoleClaim ─────────────────────────────────────────────────────────────

describe('setRoleClaim', () => {
    it('merges the role into existing claims instead of replacing them', async () => {
        claimsByUid['u1'] = { hostApp: 'pro', role: 'user' };
        await setRoleClaim('u1', 'admin');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'pro', role: 'admin' });
    });

    it('removes the role key for an empty role and keeps the rest', async () => {
        claimsByUid['u1'] = { hostApp: 'pro', role: 'admin' };
        await setRoleClaim('u1', '');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'pro' });
    });
});

// ─── onUserRoleChange ─────────────────────────────────────────────────────────

describe('onUserRoleChange', () => {
    it('refuses and reverts a self-written admin role on create', async () => {
        const { event, refUpdate } = makeEvent(null, { uid: 'eve', role: 'admin' }, 'app_user', 'eve');
        await trigger(event);
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(refUpdate).toHaveBeenCalledWith({ role: 'user' });
    });

    it('refuses and reverts a self-written promotion on update', async () => {
        const { event, refUpdate } = makeEvent(
            { uid: 'eve', role: 'user' }, { uid: 'eve', role: 'admin' }, 'app_user', 'eve');
        await trigger(event);
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(refUpdate).toHaveBeenCalledWith({ role: 'user' });
    });

    it('refuses an elevated role when the writer is unknown', async () => {
        const { event, refUpdate } = makeEvent(null, { uid: 'eve', role: 'admin' }, 'unknown', undefined);
        await trigger(event);
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(refUpdate).toHaveBeenCalled();
    });

    it('syncs a role an admin set', async () => {
        const { event, refUpdate } = makeEvent(
            { uid: 'bob', role: 'user' }, { uid: 'bob', role: 'admin' }, 'app_user', 'admin-uid');
        await trigger(event);
        expect(refUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('bob', { role: 'admin' });
    });

    it('syncs a role the Admin SDK set', async () => {
        const { event } = makeEvent(
            { uid: 'bob', role: 'user' }, { uid: 'bob', role: 'admin' }, 'service_account', 'sa@x.iam');
        await trigger(event);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('bob', { role: 'admin' });
    });

    it('syncs a plain user role on self sign-up', async () => {
        const { event } = makeEvent(null, { uid: 'amy', role: 'user' }, 'app_user', 'amy');
        await trigger(event);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('amy', { role: 'user' });
    });

    it('lets anyone demote (a demotion is never an escalation)', async () => {
        claimsByUid['amy'] = { role: 'admin' };
        const { event } = makeEvent(
            { uid: 'amy', role: 'admin' }, { uid: 'amy', role: 'user' }, 'app_user', 'amy');
        await trigger(event);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('amy', { role: 'user' });
    });

    it('applies Settings/users.defaultRole to a self sign-up with the Admin SDK', async () => {
        settingsUsers = { defaultRole: 'admin' };
        const { event, refUpdate } = makeEvent(null, { uid: 'amy', role: 'user' }, 'app_user', 'amy');
        await trigger(event);
        // The rewrite re-fires the trigger as the Admin SDK, which then sets the claim.
        expect(refUpdate).toHaveBeenCalledWith({ role: 'admin' });
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('ignores an unknown defaultRole value', async () => {
        settingsUsers = { defaultRole: 'superuser' };
        const { event, refUpdate } = makeEvent(null, { uid: 'amy', role: 'user' }, 'app_user', 'amy');
        await trigger(event);
        expect(refUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('amy', { role: 'user' });
    });

    it('does not apply defaultRole to a user an admin created', async () => {
        settingsUsers = { defaultRole: 'admin' };
        const { event, refUpdate } = makeEvent(null, { uid: 'amy', role: 'user' }, 'app_user', 'admin-uid');
        await trigger(event);
        expect(refUpdate).not.toHaveBeenCalled();
    });

    it('skips when the role did not change', async () => {
        const { event } = makeEvent({ uid: 'amy', role: 'user', name: 'a' }, { uid: 'amy', role: 'user', name: 'b' });
        await trigger(event);
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('skips deletes and docs without a uid', async () => {
        await trigger(makeEvent({ uid: 'amy', role: 'admin' }, null).event);
        await trigger(makeEvent(null, { role: 'user' }).event);
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });
});

// ─── claimFirstAdmin ──────────────────────────────────────────────────────────

describe('claimFirstAdmin', () => {
    it('rejects unauthenticated callers', async () => {
        await expect(claim({})).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('makes the caller admin on a fresh install and writes the sentinel', async () => {
        userDocs = [{ id: 'first-doc', data: { uid: 'first', role: 'user' } }];
        await expect(claim({ auth: { uid: 'first' } })).resolves.toEqual({ role: 'admin' });
        expect(txSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ uid: 'first' }));
        expect(txUpdate).toHaveBeenCalledWith({ id: 'first-doc' }, { role: 'admin' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('first', { role: 'admin' });
    });

    it('refuses once an admin exists, even without a sentinel (older installs)', async () => {
        userDocs = [
            { id: 'a', data: { uid: 'existing', role: 'admin' } },
            { id: 'b', data: { uid: 'eve', role: 'user' } },
        ];
        await expect(claim({ auth: { uid: 'eve' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(txUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('refuses once the sentinel exists, even if every admin was since removed', async () => {
        sentinel = { uid: 'gone' };
        userDocs = [{ id: 'b', data: { uid: 'eve', role: 'user' } }];
        await expect(claim({ auth: { uid: 'eve' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('is a no-op success for the admin it already created (wizard retry)', async () => {
        sentinel = { uid: 'first' };
        userDocs = [{ id: 'first-doc', data: { uid: 'first', role: 'admin' } }];
        await expect(claim({ auth: { uid: 'first' } })).resolves.toEqual({ role: 'admin' });
        expect(txUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('first', { role: 'admin' });
    });

    it('requires the caller to have a user document first', async () => {
        await expect(claim({ auth: { uid: 'nobody' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});
