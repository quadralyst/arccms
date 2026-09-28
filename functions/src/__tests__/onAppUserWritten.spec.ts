/** Reacting to the host app's users (docs/coexistence-spec.md 5b, CO6.4). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const states = new Map<string, Record<string, unknown>>();
    const ops: string[] = [];
    const stateRef = (id: string) => ({
        get: vi.fn(async () => ({ exists: states.has(id), data: () => states.get(id) })),
        set: vi.fn(async (data: Record<string, unknown>) => { ops.push(`set ${id}`); states.set(id, data); }),
        update: vi.fn(async (data: Record<string, unknown>) => { ops.push(`update ${id} ${Object.keys(data).join(',')}`); states.set(id, { ...states.get(id), ...data }); }),
        delete: vi.fn(async () => { ops.push(`delete ${id}`); states.delete(id); }),
    });
    return {
        states, ops,
        db: { collection: vi.fn(() => ({ doc: vi.fn((id: string) => stateRef(id)) })) },
        emitAppEvent: vi.fn().mockResolvedValue('id'),
        syncAppDrips: vi.fn().mockResolvedValue(0),
        settings: { value: { key: { source: 'docId' }, emailField: 'email', nameField: 'name', watchedFields: ['isPro'] } as any },
    };
});

vi.mock('../init', () => ({ db: m.db }));
vi.mock('../email-core/appEvents', () => ({ emitAppEvent: m.emitAppEvent }));
vi.mock('../app-audience/appDrips', () => ({ syncAppDrips: m.syncAppDrips }));
vi.mock('../app-audience/adminCallables', () => ({ readAppAudienceSettings: vi.fn(async () => m.settings.value) }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: vi.fn((_opts: unknown, h: unknown) => h) }));
vi.mock('firebase-admin/firestore', () => ({
    Timestamp: { now: vi.fn(() => 'now') },
    FieldValue: { delete: vi.fn(() => '<delete>') },
}));

import { onAppUserWritten, planAppUserWrite } from '../app-audience/onAppUserWritten.js';
import { appUserStateId } from '../app-audience/state.js';

const settings = { key: { source: 'docId' as const }, emailField: 'email', nameField: 'name', watchedFields: ['isPro', 'plan.tier'] };
const asha = { email: 'Asha@x.com', name: 'Asha', isPro: false, plan: { tier: 'free' }, credits: 5 };

describe('planAppUserWrite', () => {
    it('a new document is app_user.created, with template data', () => {
        const plan = planAppUserWrite('u1', undefined, asha, settings);
        expect(plan.events).toEqual([{
            type: 'app_user.created', suffix: 'created', appUserId: appUserStateId('u1'), email: 'asha@x.com',
            data: { docId: 'u1', name: 'Asha', email: 'asha@x.com', phone: '' },
        }]);
        expect(plan.clearDeleted).toBe(appUserStateId('u1'));
    });

    it('a deleted document is app_user.deleted, and marks the record deleted', () => {
        const plan = planAppUserWrite('u1', asha, undefined, settings);
        expect(plan.events.map((e) => e.type)).toEqual(['app_user.deleted']);
        expect(plan.markDeleted).toBe(appUserStateId('u1'));
    });

    it('a watched field changing is one event per field, with old and new values', () => {
        const plan = planAppUserWrite('u1', asha, { ...asha, isPro: true, plan: { tier: 'pro' } }, settings);
        expect(plan.events.map((e) => [e.type, e.data.from, e.data.to])).toEqual([
            ['app_user.changed.isPro', 'false', 'true'],
            ['app_user.changed.plan.tier', 'free', 'pro'],
        ]);
        expect(plan.events[0].data.field).toBe('isPro');
    });

    it('an unwatched change produces nothing', () => {
        expect(planAppUserWrite('u1', asha, { ...asha, credits: 4 }, settings)).toEqual({ events: [] });
    });

    it('a field appearing counts as a change from empty', () => {
        const before = { email: 'a@x.com' };
        const plan = planAppUserWrite('u1', before, { ...before, isPro: true }, settings);
        expect(plan.events.map((e) => [e.data.from, e.data.to])).toEqual([['', 'true']]);
    });

    it('hides the values of a credential-like watched field', () => {
        const s = { ...settings, watchedFields: ['apiKey'] };
        const plan = planAppUserWrite('u1', { apiKey: 'old' }, { apiKey: 'new' }, s);
        expect(plan.events[0].data).toMatchObject({ from: '(hidden)', to: '(hidden)' });
    });

    it('counts a change deep in a watched map or past the display length, showing credentials hidden (review S6)', () => {
        const s = { ...settings, watchedFields: ['profile'] };
        const long = 'x'.repeat(200);
        const before = { profile: { bio: long + 'a', auth: { token: 't-old' } } };
        const after = { profile: { bio: long + 'b', auth: { token: 't-new' } } };
        const plan = planAppUserWrite('u1', before, after, s);
        expect(plan.events).toHaveLength(1);
        expect(JSON.stringify(plan.events[0].data)).not.toMatch(/t-old|t-new/);
        const onlySecret = planAppUserWrite('u1', { profile: { token: 'a' } }, { profile: { token: 'b' } }, s);
        expect(onlySecret.events).toHaveLength(1);
        expect(onlySecret.events[0].data).toMatchObject({ from: '{"token":"(hidden)"}', to: '{"token":"(hidden)"}' });
    });

    it('ignores a person without a unique key', () => {
        const s = { ...settings, key: { source: 'field' as const, field: 'phone' } };
        expect(planAppUserWrite('u1', undefined, asha, s)).toEqual({ events: [] });
    });

    it('a changed unique key moves the record and is itself a change', () => {
        const s = { ...settings, key: { source: 'field' as const, field: 'email' }, watchedFields: [] };
        const plan = planAppUserWrite('u1', asha, { ...asha, email: 'new@x.com' }, s);
        expect(plan.events.map((e) => e.type)).toEqual(['app_user.changed.email']);
        expect(plan.moveState).toEqual({ from: appUserStateId('Asha@x.com'), to: appUserStateId('new@x.com') });
        expect(plan.events[0].appUserId).toBe(appUserStateId('new@x.com'));
    });
});

describe('onAppUserWritten', () => {
    const handler = onAppUserWritten as unknown as (e: any) => Promise<void>;
    const snap = (id: string, data?: Record<string, unknown>) => ({ id, exists: !!data, data: () => data });
    const write = (before?: Record<string, unknown>, after?: Record<string, unknown>) =>
        ({ id: 'evt-1', data: { before: snap('u1', before), after: snap('u1', after) } });

    beforeEach(() => {
        vi.clearAllMocks();
        m.states.clear();
        m.ops.length = 0;
        m.settings.value = { key: { source: 'docId' }, emailField: 'email', nameField: 'name', watchedFields: ['isPro'] };
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
    });

    it('does nothing on an install with no host app', async () => {
        process.env.ARC_APP_USERS_PATH = '_arccms_app_users_not_configured/{id}';
        await handler(write(undefined, asha));
        expect(m.emitAppEvent).not.toHaveBeenCalled();
    });

    it('emits each event under an id from the Firestore event, so a repeat delivery is one event', async () => {
        await handler(write(asha, { ...asha, isPro: true }));
        expect(m.emitAppEvent).toHaveBeenCalledWith(
            'app_user.changed.isPro',
            { appUserId: appUserStateId('u1'), contactEmail: 'asha@x.com', data: expect.objectContaining({ from: 'false', to: 'true' }) },
            { id: 'evt-1.changed.isPro' },
        );
    });

    it('emits nothing and writes no state for an unwatched change, but still checks live sequences', async () => {
        const after = { ...asha, credits: 1 };
        await handler(write(asha, after));
        expect(m.emitAppEvent).not.toHaveBeenCalled();
        expect(m.ops).toEqual([]);
        // A live list's conditions can use any field, watched or not (CO6.5c).
        expect(m.syncAppDrips).toHaveBeenCalledWith('u1', asha, after, m.settings.value);
    });

    it('keeps consent when a person is deleted, marking the record', async () => {
        m.states.set(appUserStateId('u1'), { consent: 'unsubscribed' });
        await handler(write(asha, undefined));
        expect(m.states.get(appUserStateId('u1'))).toEqual({ consent: 'unsubscribed', deleted: true, deletedAt: 'now' });
    });

    it('clears the deleted mark when the person comes back', async () => {
        m.states.set(appUserStateId('u1'), { consent: 'unsubscribed', deleted: true });
        await handler(write(undefined, asha));
        expect(m.ops).toEqual([`update ${appUserStateId('u1')} deleted,deletedAt`]);
    });

    it('carries consent to a new unique key, unless the new key has its own record', async () => {
        m.settings.value = { key: { source: 'field', field: 'email' }, emailField: 'email', watchedFields: [] };
        const oldId = appUserStateId('Asha@x.com');
        const newId = appUserStateId('new@x.com');
        m.states.set(oldId, { consent: 'unsubscribed' });
        await handler(write(asha, { ...asha, email: 'new@x.com' }));
        expect(m.states.get(newId)).toMatchObject({ consent: 'unsubscribed', movedFrom: oldId });
        expect(m.states.has(oldId)).toBe(false);

        m.states.set(oldId, { consent: 'subscribed' });
        m.states.set(newId, { consent: 'unsubscribed' });
        await handler(write(asha, { ...asha, email: 'new@x.com' }));
        expect(m.states.get(newId)).toEqual({ consent: 'unsubscribed' });
    });
});
