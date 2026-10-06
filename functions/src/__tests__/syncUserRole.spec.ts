/**
 * Tests for functions/src/users/syncUserRole.ts
 *
 * The role claim IS the admin gate (firestore.rules isAdmin()), so these cover:
 * - claims are merged, never replaced
 * - onUserRoleChange refuses (and reverts) an elevated role written by a non-admin
 * - it syncs roles written by admins and by the Admin SDK
 * - it applies Settings/users.defaultRole to self sign-ups
 * - it trusts this project's own service accounts whatever authType Eventarc reports
 * - claimFirstAdmin grants admin once, only while no admin exists
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockRevoke = vi.fn();

// Firestore: a tiny in-memory model of just what these functions touch.
let settingsUsers: Record<string, unknown> | null = null;
let sentinel: Record<string, unknown> | null = null;
let onboarding: Record<string, unknown> | null = null;
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
                const value = target.__path === 'Settings/onboarding_status' ? onboarding : sentinel;
                return { exists: value !== null, data: () => value };
            },
            set: txSet,
            update: txUpdate,
        };
        return fn(tx);
    }),
};

vi.mock('../init', () => ({
    owner: { getUser: mockGetUser, setCustomUserClaims: mockSetCustomUserClaims, revokeRefreshTokens: mockRevoke },
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

const { onUserRoleChange, claimFirstAdmin, setRoleClaim, isTrustedRoleWriter, serviceAccountProject } =
    await import('../users/syncUserRole.js');
const { resetRuntimeIdentityForTests } = await import('../utils/runtimeIdentity.js');
const trigger = onUserRoleChange as unknown as (event: any) => Promise<void>;
const claim = claimFirstAdmin as unknown as (request: any) => Promise<unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    authType = 'app_user',
    authId?: string,
    project = 'my-project',
) {
    const refUpdate = vi.fn().mockResolvedValue(undefined);
    return {
        refUpdate,
        event: {
            authType,
            authId,
            project,
            data: {
                before: before ? { data: () => before } : { data: () => undefined },
                after: after ? { data: () => after, ref: { update: refUpdate } } : undefined,
            },
        },
    };
}

/** Claims each Auth user currently holds. */
let claimsByUid: Record<string, Record<string, unknown>> = {};

/** The metadata server: this project's id and number. */
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
function metadataAnswers(id: string, number: string) {
    mockFetch.mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () => (url.endsWith('numeric-project-id') ? number : id),
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    settingsUsers = null;
    sentinel = null;
    onboarding = null;
    userDocs = [];
    resetRuntimeIdentityForTests();
    metadataAnswers('my-project', '449144539409');
    claimsByUid = { 'admin-uid': { arccms_role: 'admin' } };
    mockGetUser.mockImplementation(async (uid: string) => ({ uid, customClaims: claimsByUid[uid] }));
    // Firebase keeps what is written: mergeUserClaims reads its write back (specs/app-accounts-spec.md C-D6).
    mockSetCustomUserClaims.mockImplementation(async (uid: string, claims: Record<string, unknown>) => { claimsByUid[uid] = claims; });
});

// ─── setRoleClaim ─────────────────────────────────────────────────────────────

describe('setRoleClaim', () => {
    it('merges arccms_role into existing claims, leaving a host app\'s own `role` alone (CO-D7)', async () => {
        claimsByUid['u1'] = { hostApp: 'pro', role: 'user' };
        await setRoleClaim('u1', 'admin');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'pro', role: 'user', arccms_role: 'admin' });
    });

    it('removes arccms_role for an empty role and keeps the rest', async () => {
        claimsByUid['u1'] = { hostApp: 'pro', role: 'admin', arccms_role: 'admin' };
        await setRoleClaim('u1', '');
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'pro', role: 'admin' });
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
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('bob', { arccms_role: 'admin' });
    });

    it('syncs a role the Admin SDK set', async () => {
        const { event } = makeEvent(
            { uid: 'bob', role: 'user' }, { uid: 'bob', role: 'admin' }, 'service_account', 'sa@x.iam');
        await trigger(event);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('bob', { arccms_role: 'admin' });
    });

    it('syncs a role written by a 2nd gen function as the default compute account (authType unknown)', async () => {
        // What Eventarc reported for claimFirstAdmin on a fresh install (sanskrit-app-live).
        const { event, refUpdate } = makeEvent(
            { uid: 'first', role: 'user' }, { uid: 'first', role: 'admin' },
            'unknown', '449144539409-compute@developer.gserviceaccount.com');
        await trigger(event);
        expect(refUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('first', { arccms_role: 'admin' });
    });

    it('refuses an elevated role written by another project\'s service account', async () => {
        const { event, refUpdate } = makeEvent(
            { uid: 'bob', role: 'user' }, { uid: 'bob', role: 'admin' },
            'unknown', '111111111111-compute@developer.gserviceaccount.com');
        await trigger(event);
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(refUpdate).toHaveBeenCalledWith({ role: 'user' });
    });

    it('syncs a plain user role on self sign-up', async () => {
        const { event } = makeEvent(null, { uid: 'amy', role: 'user' }, 'app_user', 'amy');
        await trigger(event);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('amy', { arccms_role: 'user' });
    });

    it('lets anyone demote (a demotion is never an escalation)', async () => {
        claimsByUid['amy'] = { arccms_role: 'admin' };
        const { event } = makeEvent(
            { uid: 'amy', role: 'admin' }, { uid: 'amy', role: 'user' }, 'app_user', 'amy');
        await trigger(event);
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('amy', { arccms_role: 'user' });
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
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('amy', { arccms_role: 'user' });
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

// ─── isTrustedRoleWriter ──────────────────────────────────────────────────────

describe('isTrustedRoleWriter: this project\'s own service accounts', () => {
    it('reads the project from each kind of service account email', () => {
        expect(serviceAccountProject('449144539409-compute@developer.gserviceaccount.com')).toBe('449144539409');
        expect(serviceAccountProject('my-project@appspot.gserviceaccount.com')).toBe('my-project');
        expect(serviceAccountProject('deployer@my-project.iam.gserviceaccount.com')).toBe('my-project');
        expect(serviceAccountProject('zYfL8LP0jON2Al5C3Q7jL2QGIPq2')).toBeNull();
        expect(serviceAccountProject('someone@example.com')).toBeNull();
    });

    it('trusts the compute, App Engine and project-made accounts of this project, whatever the authType', async () => {
        for (const id of [
            '449144539409-compute@developer.gserviceaccount.com',
            'my-project@appspot.gserviceaccount.com',
            'arccms-runner@my-project.iam.gserviceaccount.com',
        ]) {
            expect(await isTrustedRoleWriter('unknown', id, 'my-project')).toBe(true);
        }
    });

    it('does not trust another project\'s accounts', async () => {
        expect(await isTrustedRoleWriter('unknown', 'other@appspot.gserviceaccount.com', 'my-project')).toBe(false);
        expect(await isTrustedRoleWriter('unknown', 'x@other.iam.gserviceaccount.com', 'my-project')).toBe(false);
    });

    it('matches the event\'s own project without asking the metadata server', async () => {
        await isTrustedRoleWriter('unknown', 'my-project@appspot.gserviceaccount.com', 'my-project');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('asks the metadata server once and caches the answer', async () => {
        const compute = '449144539409-compute@developer.gserviceaccount.com';
        await isTrustedRoleWriter('unknown', compute, 'my-project');
        await isTrustedRoleWriter('unknown', compute, 'my-project');
        expect(mockFetch).toHaveBeenCalledTimes(2); // id and number, once
        expect(mockFetch.mock.calls[0][1]).toMatchObject({ headers: { 'Metadata-Flavor': 'Google' } });
    });

    it('trusts nothing new when the metadata server cannot be reached, and asks again next time', async () => {
        mockFetch.mockRejectedValue(new Error('offline'));
        const compute = '449144539409-compute@developer.gserviceaccount.com';
        expect(await isTrustedRoleWriter('unknown', compute, 'my-project')).toBe(false);
        metadataAnswers('my-project', '449144539409');
        expect(await isTrustedRoleWriter('unknown', compute, 'my-project')).toBe(true);
    });

    it('never asks the metadata server about a Firebase Auth uid', async () => {
        expect(await isTrustedRoleWriter('unknown', 'eve', 'my-project')).toBe(false);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ─── claimFirstAdmin ──────────────────────────────────────────────────────────

describe('arccms_uid claim (the users record id)', () => {
    function eventFor(before: Record<string, unknown> | null, after: Record<string, unknown>, docId = 'rec-1') {
        const made = makeEvent(before, after, 'service_account');
        (made.event as any).params = { docId };
        return made.event;
    }

    it('is set with the role when a record is created', async () => {
        claimsByUid['u1'] = { hostApp: 'pro' };
        await trigger(eventFor(null, { uid: 'u1', role: 'user' }));
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'pro', arccms_role: 'user', arccms_uid: 'rec-1' });
    });

    it('follows the record to a new sign-in account, and leaves the old one without claims (review F)', async () => {
        claimsByUid['old'] = { hostApp: 'x', arccms_role: 'admin', arccms_uid: 'rec-2' };
        await trigger(eventFor({ uid: 'old', role: 'admin' }, { uid: 'u2', role: 'admin' }, 'rec-2'));
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u2', { arccms_role: 'admin', arccms_uid: 'rec-2' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('old', { hostApp: 'x' });
    });

    it('takes the claims off a blocked or detached record and ends its sessions (review F)', async () => {
        for (const blocked of [{ isActive: false }, { status: 'Detached', isActive: false }]) {
            vi.clearAllMocks();
            claimsByUid['u1'] = { hostApp: 'x', arccms_role: 'admin', arccms_uid: 'rec-1' };
            await trigger(eventFor({ uid: 'u1', role: 'admin', isActive: true }, { uid: 'u1', role: 'admin', ...blocked }));
            expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'x' });
            expect(mockRevoke).toHaveBeenCalledWith('u1');
        }
    });

    it('puts the claims back when the record is unblocked', async () => {
        claimsByUid['u1'] = { hostApp: 'x' };
        await trigger(eventFor({ uid: 'u1', role: 'user', isActive: false }, { uid: 'u1', role: 'user', isActive: true }));
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('u1', { hostApp: 'x', arccms_role: 'user', arccms_uid: 'rec-1' });
        expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('gives a record created blocked no claims', async () => {
        await trigger(eventFor(null, { uid: 'u3', role: 'user', isActive: false }));
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
        expect(mockRevoke).toHaveBeenCalledWith('u3');
    });

    it('writes nothing when the claims already hold these values', async () => {
        claimsByUid['u1'] = { arccms_role: 'user', arccms_uid: 'rec-1' };
        await trigger(eventFor(null, { uid: 'u1', role: 'user' }));
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });
});

describe('claimFirstAdmin', () => {
    it('rejects unauthenticated callers', async () => {
        await expect(claim({})).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('makes the caller admin on a fresh install and writes the sentinel', async () => {
        userDocs = [{ id: 'first-doc', data: { uid: 'first', role: 'user' } }];
        await expect(claim({ auth: { uid: 'first' } })).resolves.toEqual({ role: 'admin' });
        expect(txSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ uid: 'first' }));
        expect(txUpdate).toHaveBeenCalledWith({ id: 'first-doc' }, { role: 'admin' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('first', { arccms_role: 'admin' });
    });

    it('marks setup as started by the new admin, which the browser may not write yet (review S5)', async () => {
        userDocs = [{ id: 'first-doc', data: { uid: 'first', role: 'user' } }];
        await claim({ auth: { uid: 'first' } });
        expect(txSet).toHaveBeenCalledWith(
            expect.objectContaining({ __path: 'Settings/onboarding_status' }),
            expect.objectContaining({ completed: false, startedBy: 'first' }),
        );
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
        expect(txSet).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('first', { arccms_role: 'admin' });
    });

    it('restores the first admin\'s reverted role on a retry while setup is unfinished', async () => {
        // The state a fresh install was left in when the role trigger reverted the grant.
        sentinel = { uid: 'first' };
        onboarding = { completed: false, startedBy: 'first' };
        userDocs = [{ id: 'first-doc', data: { uid: 'first', role: 'user' } }];
        await expect(claim({ auth: { uid: 'first' } })).resolves.toEqual({ role: 'admin' });
        expect(txUpdate).toHaveBeenCalledWith({ id: 'first-doc' }, { role: 'admin' });
        expect(txSet).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('first', { arccms_role: 'admin' });
    });

    it('does not restore a first admin who was demoted after setup finished', async () => {
        sentinel = { uid: 'first' };
        onboarding = { completed: true };
        userDocs = [{ id: 'first-doc', data: { uid: 'first', role: 'user' } }];
        await expect(claim({ auth: { uid: 'first' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(txUpdate).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('does not restore the first admin when someone else is already an admin', async () => {
        sentinel = { uid: 'first' };
        onboarding = { completed: false, startedBy: 'first' };
        userDocs = [
            { id: 'first-doc', data: { uid: 'first', role: 'user' } },
            { id: 'other-doc', data: { uid: 'other', role: 'admin' } },
        ];
        await expect(claim({ auth: { uid: 'first' } })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(txUpdate).not.toHaveBeenCalled();
    });

    it('requires the caller to have a user document first', async () => {
        await expect(claim({ auth: { uid: 'nobody' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});
