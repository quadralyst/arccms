/** Audience, App users: the live list and detail callables (docs/coexistence-spec.md 5b, CO6.3). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const hostDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
    const states = new Map<string, Record<string, unknown>>();
    const settings = { value: undefined as unknown };
    const hostCollection = {
        limit: vi.fn((n: number) => ({
            get: vi.fn(async () => {
                const docs = hostDocs.slice(0, n);
                return { size: docs.length, docs: docs.map((d) => ({ id: d.id, exists: true, data: () => d.data })) };
            }),
        })),
        doc: vi.fn((id: string) => ({
            get: vi.fn(async () => {
                const d = hostDocs.find((x) => x.id === id);
                return d ? { id, exists: true, data: () => d.data } : { id, exists: false, data: () => undefined };
            }),
        })),
    };
    const events: Array<{ id: string; data: Record<string, unknown> }> = [];
    const db = {
        collection: vi.fn((name: string) => ({
            where: vi.fn((_f: string, _op: string, value: string) => ({
                limit: vi.fn(() => ({
                    get: vi.fn(async () => ({
                        docs: events.filter((e) => e.data['appUserId'] === value).map((e) => ({ id: e.id, data: () => e.data })),
                    })),
                })),
            })),
            doc: vi.fn((id: string) => ({
                name, id,
                get: vi.fn(async () => ({ exists: settings.value !== undefined, data: () => settings.value })),
            })),
        })),
        getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
            refs.map((r) => ({ exists: states.has(r.id), data: () => states.get(r.id) }))),
    };
    return {
        hostDocs, states, settings, hostCollection, db, events,
        firestoreFor: vi.fn(() => ({ collection: vi.fn(() => hostCollection) })),
        requireAdmin: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('../init', () => ({ db: m.db, firestoreFor: m.firestoreFor }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) { super(message); }
    },
}));

import { APP_USERS_UNCONFIGURED } from '../app-audience/config.js';
import { appUserStateId } from '../app-audience/state.js';
import { getAppUser, listAppUsers } from '../app-audience/listAppUsers.js';

const list = listAppUsers as unknown as (req: any) => Promise<any>;
const get = getAppUser as unknown as (req: any) => Promise<any>;

describe('App users list', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.hostDocs.length = 0;
        m.states.clear();
        m.settings.value = { key: { source: 'field', field: 'email' }, emailField: 'email', nameField: 'name' };
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
    });

    it('refuses to run until a host collection is configured', async () => {
        process.env.ARC_APP_USERS_PATH = APP_USERS_UNCONFIGURED;
        await expect(list({})).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('lists every person with a key, sorted by name, subscribed unless they opted out', async () => {
        m.hostDocs.push(
            { id: 'a', data: { email: 'Zed@x.com', name: 'Zed' } },
            { id: 'b', data: { email: 'amy@x.com', name: 'Amy' } },
            { id: 'c', data: { name: 'No email' } },
        );
        m.states.set(appUserStateId('zed@x.com'), { consent: 'unsubscribed' });
        const res = await list({});
        expect(m.requireAdmin).toHaveBeenCalled();
        expect(m.firestoreFor).toHaveBeenCalledWith('(default)');
        expect(res).toMatchObject({ scanned: 3, withoutKey: 1, truncated: false });
        expect(res.rows).toEqual([
            { docId: 'b', key: 'amy@x.com', email: 'amy@x.com', phone: '', name: 'Amy', consent: 'subscribed' },
            { docId: 'a', key: 'Zed@x.com', email: 'zed@x.com', phone: '', name: 'Zed', consent: 'subscribed' },
        ]);
    });

    it('looks consent up by the exact key', async () => {
        m.hostDocs.push({ id: 'a', data: { email: 'amy@x.com', name: 'Amy' } });
        m.states.set(appUserStateId('amy@x.com'), { consent: 'unsubscribed' });
        expect((await list({})).rows[0].consent).toBe('unsubscribed');
    });

    it('searches key, email, phone and name, case-insensitively', async () => {
        m.hostDocs.push(
            { id: 'a', data: { email: 'zed@x.com', name: 'Zed' } },
            { id: 'b', data: { email: 'amy@x.com', name: 'Amy' } },
        );
        expect((await list({ data: { search: 'AMY' } })).rows.map((r: any) => r.docId)).toEqual(['b']);
    });

    it('hides a credential field picked as a channel and never matches its value', async () => {
        m.settings.value = { key: { source: 'docId' }, nameField: 'password' };
        m.hostDocs.push({ id: 'a', data: { password: 'hunter2' } });
        const res = await list({});
        expect(res.rows[0].name).toBe('(hidden)');
        expect((await list({ data: { search: 'hunter' } })).rows).toEqual([]);
    });

    it('says when the collection was cut short', async () => {
        for (let i = 0; i < 2001; i++) m.hostDocs.push({ id: `u${i}`, data: { email: `u${i}@x.com` } });
        const res = await list({});
        expect(res.truncated).toBe(true);
        expect(res.scanned).toBe(2000);
    });
});

describe('App user detail', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.hostDocs.length = 0;
        m.states.clear();
        m.events.length = 0;
        m.settings.value = { key: { source: 'docId' }, emailField: 'email' };
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
    });

    it('returns every field, credentials hidden, with the state', async () => {
        m.hostDocs.push({ id: 'u1', data: { email: 'a@x.com', password: 'hunter2', plan: 'paid' } });
        const res = await get({ data: { docId: 'u1' } });
        expect(res.person).toEqual({ docId: 'u1', key: 'u1', email: 'a@x.com', phone: '', name: '' });
        expect(res.fields).toEqual({ email: 'a@x.com', password: '(hidden)', plan: 'paid' });
        expect(res.state).toEqual({ consent: 'subscribed' });
        expect(res.activity).toEqual([]);
        expect(JSON.stringify(res)).not.toContain('hunter2');
    });

    it('lists the person\'s latest events, newest first', async () => {
        m.hostDocs.push({ id: 'u1', data: { email: 'a@x.com' } });
        const at = (iso: string) => ({ toDate: () => new Date(iso) });
        m.events.push(
            { id: 'e1', data: { appUserId: appUserStateId('u1'), type: 'app_user.created', createdAt: at('2026-09-01T00:00:00Z'), results: { status: 'no_mapping' } } },
            { id: 'e2', data: { appUserId: appUserStateId('u1'), type: 'app_user.changed.isPro', createdAt: at('2026-09-02T00:00:00Z'), data: { field: 'isPro', from: 'false', to: 'true' } } },
            { id: 'e3', data: { appUserId: appUserStateId('someone-else'), type: 'app_user.created', createdAt: at('2026-09-03T00:00:00Z') } },
        );
        const res = await get({ data: { docId: 'u1' } });
        expect(res.activity).toEqual([
            { id: 'e2', type: 'app_user.changed.isPro', at: '2026-09-02T00:00:00.000Z', field: 'isPro', from: 'false', to: 'true', status: '' },
            { id: 'e1', type: 'app_user.created', at: '2026-09-01T00:00:00.000Z', status: 'no_mapping' },
        ]);
    });

    it('rejects a missing id and a deleted person', async () => {
        await expect(get({ data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(get({ data: { docId: 'gone' } })).rejects.toMatchObject({ code: 'not-found' });
    });
});
