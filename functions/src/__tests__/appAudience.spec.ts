/** App audience config, field reading and the Settings callables (docs/coexistence-spec.md 5b, CO6.2). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const hostDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
    const snapOf = (docs: typeof hostDocs) => ({
        size: docs.length,
        docs: docs.map((d) => ({ id: d.id, exists: true, data: () => d.data })),
    });
    const hostCollection = {
        limit: vi.fn((n: number) => ({ get: vi.fn(async () => snapOf(hostDocs.slice(0, n))) })),
        doc: vi.fn((id: string) => ({
            get: vi.fn(async () => {
                const d = hostDocs.find((x) => x.id === id);
                return d ? { id: d.id, exists: true, data: () => d.data } : { id, exists: false, data: () => undefined };
            }),
        })),
    };
    return {
        hostDocs,
        hostCollection,
        firestoreFor: vi.fn(() => ({ collection: vi.fn(() => hostCollection) })),
        settingsDoc: { exists: false, data: () => undefined as unknown },
        requireAdmin: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('../init', () => ({
    db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn(async () => m.settingsDoc) })) })) },
    firestoreFor: m.firestoreFor,
}));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) { super(message); }
    },
}));

import { appUsersLocation, normalizeAppAudienceSettings, APP_USERS_UNCONFIGURED } from '../app-audience/config.js';
import { flattenFields, resolveAppUser, valueAt } from '../app-audience/fields.js';
import { sampleAppUsers, testAppUser } from '../app-audience/adminCallables.js';

const sample = sampleAppUsers as unknown as (req: any) => Promise<any>;
const test = testAppUser as unknown as (req: any) => Promise<any>;
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('App audience location', () => {
    it('is unconfigured by default, with a path nothing writes to', () => {
        expect(appUsersLocation({})).toEqual({ configured: false, database: '(default)', path: APP_USERS_UNCONFIGURED, collection: '', own: false });
    });

    it('reads the deployed database and collection', () => {
        expect(appUsersLocation({ ARC_DATABASE_ID: 'arccms', ARC_APP_USERS_DATABASE: '(default)', ARC_APP_USERS_PATH: 'users/{uid}' }))
            .toEqual({ configured: true, database: '(default)', path: 'users/{uid}', collection: 'users', own: false });
    });

    it('knows when the audience is the install\'s own users (CO6.8)', () => {
        expect(appUsersLocation({ ARC_DATABASE_ID: 'arccms', ARC_APP_USERS_DATABASE: 'arccms', ARC_APP_USERS_PATH: 'users/{id}' }).own).toBe(true);
        expect(appUsersLocation({ ARC_APP_USERS_PATH: 'users/{id}' }).own).toBe(true);
        expect(appUsersLocation({ ARC_APP_USERS_PATH: 'members/{id}' }).own).toBe(false);
    });

    it('treats a malformed path as unconfigured', () => {
        expect(appUsersLocation({ ARC_APP_USERS_PATH: 'users' }).configured).toBe(false);
    });
});

describe('App audience settings', () => {
    it('defaults to the document id as the key and nothing watched', () => {
        expect(normalizeAppAudienceSettings(undefined)).toEqual({ key: { source: 'docId' }, watchedFields: [] });
    });

    it('keeps a field key and drops junk', () => {
        expect(normalizeAppAudienceSettings({
            key: { source: 'field', field: ' phoneNumber ' },
            emailField: 'email', nameField: '', watchedFields: ['plan', 'plan', '', 3],
        })).toEqual({ key: { source: 'field', field: 'phoneNumber' }, emailField: 'email', phoneField: undefined, nameField: undefined, watchedFields: ['plan'] });
    });
});

describe('reading host documents', () => {
    const doc = {
        email: 'Asha@Example.com',
        profile: { name: 'Asha', phone: '+91 98' },
        subscription: { tier: 'paid', renewsAt: ts('2026-10-01T00:00:00.000Z') },
        tags: ['a', 'b'],
    };

    it('reads dot paths', () => {
        expect(valueAt(doc, 'subscription.tier')).toBe('paid');
        expect(valueAt(doc, 'missing.path')).toBeUndefined();
    });

    it('flattens a document into field paths with readable values', () => {
        expect(flattenFields(doc)).toEqual({
            email: 'Asha@Example.com',
            'profile.name': 'Asha',
            'profile.phone': '+91 98',
            'subscription.tier': 'paid',
            'subscription.renewsAt': '2026-10-01T00:00:00.000Z',
            tags: '["a","b"]',
        });
    });

    it('never exposes credential-like values, at any depth, but keeps the field listed', () => {
        const flat = flattenFields({ email: 'a@x.com', password: 'hunter2', auth: { apiKey: 'k', otp: '1234', refreshToken: 't' }, passwordless: true });
        expect(flat).toEqual({
            email: 'a@x.com',
            password: '(hidden)',
            'auth.apiKey': '(hidden)',
            'auth.otp': '(hidden)',
            'auth.refreshToken': '(hidden)',
            passwordless: 'true',
        });
    });

    it('resolves the key from the document id or any field, email lower-cased', () => {
        const base = { emailField: 'email', nameField: 'profile.name', phoneField: 'profile.phone', watchedFields: [] };
        expect(resolveAppUser('uid-1', doc, { ...base, key: { source: 'docId' } }))
            .toEqual({ docId: 'uid-1', key: 'uid-1', email: 'asha@example.com', phone: '+91 98', name: 'Asha' });
        expect(resolveAppUser('uid-1', doc, { ...base, key: { source: 'field', field: 'profile.phone' } }).key).toBe('+91 98');
    });
});

describe('Settings callables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.hostDocs.length = 0;
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        process.env.ARC_APP_USERS_PATH = 'users/{uid}';
    });

    it('refuse to run until a host collection is configured', async () => {
        process.env.ARC_APP_USERS_PATH = APP_USERS_UNCONFIGURED;
        await expect(sample({})).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('sample every field across documents, most common first, from the configured database', async () => {
        m.hostDocs.push(
            { id: 'u1', data: { email: 'a@x.com', plan: 'free' } },
            { id: 'u2', data: { email: 'b@x.com', plan: 'paid', phone: '1' } },
        );
        const res = await sample({});
        expect(m.requireAdmin).toHaveBeenCalled();
        expect(m.firestoreFor).toHaveBeenCalledWith('(default)');
        expect(res.sampleSize).toBe(2);
        expect(res.fields.map((f: any) => f.path)).toEqual(['email', 'plan', 'phone']);
        expect(res.fields[1]).toEqual({ path: 'plan', examples: ['free', 'paid'], seenIn: 2 });
    });

    it('test one document with unsaved settings', async () => {
        m.hostDocs.push({ id: 'u1', data: { contact: { mobile: '+1 555' }, email: 'A@x.com' } });
        const res = await test({ data: { settings: { key: { source: 'field', field: 'contact.mobile' }, emailField: 'email' } } });
        expect(res.resolved).toEqual({ docId: 'u1', key: '+1 555', email: 'a@x.com', phone: '', name: '' });
        expect(res.fields).toEqual({ 'contact.mobile': '+1 555', email: 'A@x.com' });
    });

    it('masks a credential field in the test result even when it is picked as a channel', async () => {
        m.hostDocs.push({ id: 'u1', data: { password: 'hunter2', email: 'a@x.com' } });
        const res = await test({ data: { settings: { key: { source: 'docId' }, nameField: 'password' } } });
        expect(res.resolved.name).toBe('(hidden)');
        expect(JSON.stringify(res)).not.toContain('hunter2');
    });

    it('say so when the document does not exist', async () => {
        expect(await test({ data: { docId: 'nope' } })).toEqual({ resolved: null, fields: {} });
    });
});
