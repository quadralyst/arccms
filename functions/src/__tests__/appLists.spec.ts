/** App users (live) lists (docs/coexistence-spec.md 5b, CO6.5b). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const hostDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
    const lists = new Map<string, Record<string, unknown>>();
    const states = new Map<string, Record<string, unknown>>();
    const db = {
        getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
            refs.map((r) => ({ exists: states.has(r.id), data: () => states.get(r.id) }))),
        collection: vi.fn((name: string) => ({
            doc: vi.fn((id: string) => ({
                id,
                get: vi.fn(async () => (name === 'Lists'
                    ? { exists: lists.has(id), data: () => lists.get(id) }
                    : { exists: false, data: () => undefined })),
            })),
        })),
    };
    return {
        hostDocs, lists, states, db,
        firestoreFor: vi.fn(() => ({ collection: vi.fn(() => ({
            limit: vi.fn((n: number) => ({ get: vi.fn(async () => {
                const docs = hostDocs.slice(0, n);
                return { size: docs.length, docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
            }) })),
        })) })),
        requireAdmin: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('../init', () => ({ db: m.db, firestoreFor: m.firestoreFor }));
vi.mock('../search/auth', () => ({ requireAdmin: m.requireAdmin }));
vi.mock('../app-audience/adminCallables', () => ({
    readAppAudienceSettings: vi.fn(async () => ({ key: { source: 'docId' }, emailField: 'email', nameField: 'name', watchedFields: [] })),
}));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) { super(message); }
    },
}));

import { matchesAppConditions, normalizeAppListConditions, previewAppList, resolveAppList } from '../app-audience/appLists.js';
import { appUserStateId } from '../app-audience/state.js';

const preview = previewAppList as unknown as (req: any) => Promise<any>;
const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('matchesAppConditions', () => {
    const doc = { isPro: true, plan: { tier: 'Pro' }, credits: 12, status: '', joinedAt: ts('2026-03-01T00:00:00Z'), tags: ['a'] };
    const one = (field: string, op: any, value?: any) => matchesAppConditions(doc, [{ field, op, value }]);

    it('is and is not compare as shown in the admin, ignoring case', () => {
        expect(one('isPro', 'is', 'true')).toBe(true);
        expect(one('plan.tier', 'is', 'pro')).toBe(true);
        expect(one('plan.tier', 'is_not', 'free')).toBe(true);
        expect(one('isPro', 'is', 'false')).toBe(false);
    });

    it('any of, contains, empty and not empty', () => {
        expect(one('plan.tier', 'any_of', ['free', 'PRO'])).toBe(true);
        expect(one('plan.tier', 'any_of', ['free'])).toBe(false);
        expect(one('plan.tier', 'contains', 'r')).toBe(true);
        expect(one('plan.tier', 'contains', '')).toBe(false);
        expect(one('status', 'empty')).toBe(true);
        expect(one('missing', 'empty')).toBe(true);
        expect(one('credits', 'not_empty')).toBe(true);
    });

    it('greater and less than compare numbers and dates, and never text', () => {
        expect(one('credits', 'gt', '10')).toBe(true);
        expect(one('credits', 'lt', '10')).toBe(false);
        expect(one('joinedAt', 'gt', '2026-01-01')).toBe(true);
        expect(one('joinedAt', 'lt', '2026-01-01')).toBe(false);
        expect(one('plan.tier', 'gt', 'a')).toBe(false);
        expect(one('missing', 'lt', '5')).toBe(false);
    });

    it('never reads text as a date, and compares only like with like (review C7)', () => {
        const plan = (name: string, op: any, value: string) => matchesAppConditions({ plan: name }, [{ field: 'plan', op, value }]);
        // Date.parse reads "Plan 2" as 2001-02-01, so this used to match.
        expect(plan('Plan 2', 'gt', '1')).toBe(false);
        expect(plan('Plan 2', 'lt', '2030-01-01')).toBe(false);
        // A number never compares with a date.
        expect(one('credits', 'gt', '2026-01-01')).toBe(false);
        expect(one('joinedAt', 'gt', '5')).toBe(false);
        // Dates written as dates still work, with or without a time.
        expect(one('joinedAt', 'lt', '2026-03-01T12:00')).toBe(true);
        expect(one('joinedAt', 'gt', ' 2026-02-28 ')).toBe(true);
    });

    it('needs every condition (AND), and no conditions match everyone', () => {
        expect(matchesAppConditions(doc, [{ field: 'isPro', op: 'is', value: 'true' }, { field: 'credits', op: 'gt', value: '100' }])).toBe(false);
        expect(matchesAppConditions(doc, [])).toBe(true);
    });
});

describe('normalizeAppListConditions', () => {
    it('keeps valid conditions in their canonical shape and drops the rest', () => {
        expect(normalizeAppListConditions([
            { field: ' isPro ', op: 'is', value: true },
            { field: 'tier', op: 'any_of', value: ['pro', ' free '] },
            { field: 'x', op: 'empty', value: 'ignored' },
            { field: '', op: 'is', value: 'a' },
            { field: 'y', op: 'regex', value: '.*' },
        ])).toEqual([
            { field: 'isPro', op: 'is', value: 'true' },
            { field: 'tier', op: 'any_of', value: ['pro', 'free'] },
            { field: 'x', op: 'empty' },
        ]);
        expect(normalizeAppListConditions('nope')).toEqual([]);
    });
});

describe('resolving a live list', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.hostDocs.length = 0;
        m.lists.clear();
        m.states.clear();
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
        m.hostDocs.push(
            { id: 'b', data: { email: 'Bob@x.com', name: 'Bob', isPro: true, password: 'p' } },
            { id: 'a', data: { email: 'ann@x.com', name: 'Ann', isPro: true } },
            { id: 'c', data: { email: 'cat@x.com', name: 'Cat', isPro: false } },
            { id: 'd', data: { name: 'No email', isPro: true } },
        );
    });

    it('keeps the matching people sorted by document, with consent and merge fields', async () => {
        m.states.set(appUserStateId('b'), { consent: 'unsubscribed' });
        const { members } = await resolveAppList([{ field: 'isPro', op: 'is', value: 'true' }]);
        expect(members.map((x) => [x.docId, x.email, x.consent])).toEqual([
            ['a', 'ann@x.com', 'subscribed'], ['b', 'bob@x.com', 'unsubscribed'], ['d', '', 'subscribed'],
        ]);
        expect(members[1].fields).toEqual({ email: 'Bob@x.com', name: 'Bob', isPro: 'true' });
    });

    it('previews unsaved conditions with counts', async () => {
        m.states.set(appUserStateId('b'), { consent: 'unsubscribed' });
        const res = await preview({ data: { conditions: [{ field: 'isPro', op: 'is', value: 'true' }] } });
        expect(m.requireAdmin).toHaveBeenCalled();
        expect(res).toMatchObject({ matched: 3, withEmail: 2, subscribed: 1, scanned: 4, truncated: false });
        expect(res.rows.map((r: any) => r.docId)).toEqual(['a', 'b', 'd']);
    });

    it('counts one email per address when two people share one (review C5)', async () => {
        m.hostDocs.push({ id: 'e', data: { email: 'ANN@x.com', name: 'Ann again', isPro: true } });
        const res = await preview({ data: { conditions: [{ field: 'isPro', op: 'is', value: 'true' }] } });
        expect(res).toMatchObject({ matched: 4, withEmail: 3, sharedEmail: 1, subscribed: 2 });
    });

    it('previews a saved list, and refuses a list that is not live', async () => {
        m.lists.set('pros', { type: 'app', conditions: [{ field: 'isPro', op: 'is', value: 'false' }] });
        m.lists.set('manual', { type: 'manual' });
        expect((await preview({ data: { listId: 'pros' } })).rows.map((r: any) => r.docId)).toEqual(['c']);
        await expect(preview({ data: { listId: 'manual' } })).rejects.toMatchObject({ code: 'not-found' });
    });

    it('refuses to run until a host collection is configured', async () => {
        process.env.ARC_APP_USERS_PATH = '_arccms_app_users_not_configured/{id}';
        await expect(preview({ data: { conditions: [] } })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
});

describe('oneMemberPerAddress (review C5)', () => {
    const member = (docId: string, email: string, consent: 'subscribed' | 'unsubscribed' = 'subscribed') =>
        ({ docId, key: docId, email, name: docId, appUserId: `h-${docId}`, consent, fields: {} });

    it('keeps the first person per address, in order, and drops those without one', async () => {
        const { oneMemberPerAddress } = await import('../app-audience/appLists.js');
        const kept = oneMemberPerAddress([member('a', 'x@y.com'), member('b', ''), member('c', 'X@Y.com'), member('d', 'z@y.com')]);
        expect(kept.map((m) => m.docId)).toEqual(['a', 'd']);
    });

    it('treats the address as unsubscribed if any of its people opted out', async () => {
        const { oneMemberPerAddress } = await import('../app-audience/appLists.js');
        const input = [member('a', 'x@y.com'), member('b', 'x@y.com', 'unsubscribed')];
        expect(oneMemberPerAddress(input)).toEqual([expect.objectContaining({ docId: 'a', consent: 'unsubscribed' })]);
        expect(input[0].consent).toBe('subscribed');
    });
});
