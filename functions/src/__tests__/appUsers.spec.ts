/**
 * App users (docs/coexistence-spec.md, CO6a): ensureAppUser, importAppUsers,
 * and what the users triggers do differently for them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const state = {
        existing: [] as Array<{ id: string; data: Record<string, unknown> }>,
        knownUids: [] as string[],
        authPages: [] as Array<{ users: any[]; pageToken?: string }>,
    };
    const tx = { get: vi.fn(), update: vi.fn(), create: vi.fn() };
    const batch = { create: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
    let nextId = 0;
    const usersCollection = {
        where: vi.fn(() => ({ limit: vi.fn(() => 'uid-query') })),
        doc: vi.fn(() => ({ id: `new-${++nextId}` })),
        select: vi.fn(() => ({
            get: vi.fn(async () => ({ docs: state.knownUids.map((uid) => ({ get: () => uid })) })),
        })),
    };
    const db = {
        collection: vi.fn((name: string) => name === 'users'
            ? usersCollection
            : { doc: vi.fn(() => ({ set: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) })) }),
        runTransaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        batch: vi.fn(() => batch),
    };
    const owner = {
        deleteUser: vi.fn().mockResolvedValue(undefined),
        listUsers: vi.fn(async () => state.authPages.shift() ?? { users: [] }),
        getUser: vi.fn(),
        setCustomUserClaims: vi.fn(),
    };
    return {
        state, tx, batch, db, owner, usersCollection,
        resetIds: () => { nextId = 0; },
        upsertContact: vi.fn().mockResolvedValue({ emailHash: 'h', created: true }),
        setContactFields: vi.fn().mockResolvedValue({ written: [], skipped: [], unknown: [] }),
        notifyAdmins: vi.fn().mockResolvedValue(undefined),
        emitAppEvent: vi.fn().mockResolvedValue(undefined),
        requireAdmin: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('../init', () => ({ db: m.db, owner: m.owner }));
vi.mock('../email-core/contacts', () => ({ upsertContact: m.upsertContact }));
vi.mock('../email-core/contactFields', () => ({ setContactFields: m.setContactFields }));
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins: m.notifyAdmins }));
vi.mock('../email-core/appEvents', () => ({ emitAppEvent: m.emitAppEvent }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) { super(message); }
    },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
    onDocumentDeleted: (_opts: unknown, handler: unknown) => handler,
}));

import { ensureAppUser, importAppUsers, arccmsOwnsAuthAccount } from '../users/appUsers.js';
import { onUserDeleted } from '../users/onUserDelete.js';
import { onUserCreated } from '../users/onUserCreate.js';

const ensure = ensureAppUser as unknown as (req: any) => Promise<any>;
const importUsers = importAppUsers as unknown as (req: any) => Promise<any>;
const deleted = onUserDeleted as unknown as (e: any) => Promise<void>;
const created = onUserCreated as unknown as (e: any) => Promise<void>;

const auth = (overrides: Record<string, unknown> = {}) => ({
    uid: 'u1',
    token: { email: 'Asha@Example.com', email_verified: true, name: 'Asha Rao', ...overrides },
});

beforeEach(() => {
    vi.clearAllMocks();
    m.resetIds();
    m.state.existing = [];
    m.state.knownUids = [];
    m.state.authPages = [];
    m.tx.get.mockImplementation(async () => ({
        empty: m.state.existing.length === 0,
        docs: m.state.existing.map((d) => ({ id: d.id, ref: { id: d.id }, data: () => d.data })),
    }));
});

describe('ensureAppUser', () => {
    it('requires a signed-in caller with an email address', async () => {
        await expect(ensure({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(ensure({ auth: auth({ email: undefined }), data: {} })).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('creates a host-owned user from the token, never from the request', async () => {
        const res = await ensure({ auth: auth(), data: { name: 'Asha', language: 'hi', role: 'admin', email: 'someone@else.com' } });

        const doc = m.tx.create.mock.calls[0][1];
        expect(doc).toMatchObject({
            uid: 'u1', email: 'asha@example.com', emailVerified: true, name: 'Asha',
            role: 'user', authOwner: 'host', preferredLanguage: 'hi',
        });
        expect(res).toMatchObject({ created: true, isPro: false, premiumType: null });
    });

    it('refreshes an existing user without touching role or authOwner, and reports entitlement', async () => {
        m.state.existing = [{ id: 'd1', data: { uid: 'u1', email: 'old@example.com', name: 'Asha', role: 'admin', isPro: true, premiumType: 'gold' } }];

        const res = await ensure({ auth: auth(), data: { name: 'Someone Else' } });

        expect(m.tx.create).not.toHaveBeenCalled();
        const patch = m.tx.update.mock.calls[0][1];
        expect(patch).toMatchObject({ email: 'asha@example.com', emailVerified: true });
        expect(patch).not.toHaveProperty('role');
        expect(patch).not.toHaveProperty('authOwner');
        expect(patch).not.toHaveProperty('name'); // an existing name is kept
        expect(res).toMatchObject({ userId: 'd1', created: false, isPro: true, premiumType: 'gold' });
    });

    it('writes contact attributes, keeping only plain values', async () => {
        await ensure({ auth: auth(), data: { attributes: { plan: 'free', seats: 3, beta: true, nested: { x: 1 } } } });
        expect(m.upsertContact).toHaveBeenCalled();
        expect(m.setContactFields).toHaveBeenCalledWith(expect.any(String), { plan: 'free', seats: 3, beta: true });
    });
});

describe('importAppUsers', () => {
    const accounts = [
        { uid: 'known', email: 'k@example.com' },
        { uid: 'new1', email: 'N1@Example.com', displayName: 'New One', emailVerified: true },
        { uid: 'anon' },
        { uid: 'new2', email: 'n2@example.com' },
    ];

    it('dry run counts without writing', async () => {
        m.state.knownUids = ['known'];
        m.state.authPages = [{ users: accounts }];

        const res = await importUsers({ data: { dryRun: true } });

        expect(m.requireAdmin).toHaveBeenCalled();
        expect(res).toEqual({ dryRun: true, scanned: 4, imported: 2, alreadyPresent: 1, skippedNoEmail: 1, welcomeEmails: 0 });
        expect(m.batch.create).not.toHaveBeenCalled();
        expect(m.notifyAdmins).not.toHaveBeenCalled();
    });

    it('imports as host-owned users, welcome emails off by default, one summary notice', async () => {
        m.state.knownUids = ['known'];
        m.state.authPages = [{ users: accounts.slice(0, 2), pageToken: 'p2' }, { users: accounts.slice(2) }];

        const res = await importUsers({ data: {} });

        expect(res.imported).toBe(2);
        expect(res.welcomeEmails).toBe(0);
        const docs = m.batch.create.mock.calls.map((c) => c[1]);
        expect(docs.map((d) => d.uid)).toEqual(['new1', 'new2']);
        expect(docs[0]).toMatchObject({ email: 'n1@example.com', authOwner: 'host', role: 'user', sendWelcome: false, name: 'New One' });
        expect(docs[0].importedAt).toBeDefined();
        expect(m.notifyAdmins).toHaveBeenCalledTimes(1);
    });

    it('counts the welcome emails it will send when asked to', async () => {
        m.state.authPages = [{ users: [accounts[1]] }];
        const res = await importUsers({ data: { sendWelcome: true, dryRun: true } });
        expect(res.welcomeEmails).toBe(1);
    });
});

describe('users triggers for app users', () => {
    it("never deletes a host app's Auth account", async () => {
        await deleted({ data: { data: () => ({ uid: 'u1', email: 'a@b.com', authOwner: 'host' }) } });
        expect(m.owner.deleteUser).not.toHaveBeenCalled();
    });

    it('still deletes an Auth account ArcCMS owns', async () => {
        expect(arccmsOwnsAuthAccount({ uid: 'u1' })).toBe(true);
        await deleted({ data: { data: () => ({ uid: 'u1', email: 'a@b.com' }) } });
        expect(m.owner.deleteUser).toHaveBeenCalledWith('u1');
    });

    it('an imported user emits user.imported and no per-person admin notice', async () => {
        await created({ data: { data: () => ({ uid: 'u1', email: 'a@b.com', importedAt: new Date() }) } });
        expect(m.emitAppEvent).toHaveBeenCalledWith('user.imported', expect.anything());
        expect(m.emitAppEvent).not.toHaveBeenCalledWith('user.signed_up', expect.anything());
        expect(m.notifyAdmins).not.toHaveBeenCalled();
    });

    it('a normal signup still emits user.signed_up and notifies admins', async () => {
        await created({ data: { data: () => ({ uid: 'u1', email: 'a@b.com', name: 'A' }) } });
        expect(m.emitAppEvent).toHaveBeenCalledWith('user.signed_up', expect.anything());
        expect(m.notifyAdmins).toHaveBeenCalled();
    });
});
