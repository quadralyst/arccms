import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CORE_SETUP_ITEMS, aiNeed, emailNeed, orderRows, paymentsNeed, setupItemsFor, smsNeed, unsplashNeed,
    type SetupItem, type SetupNeed,
} from './setup-items';
import { onceEach, pendingRows } from './setup-status.service';

const en = JSON.parse(readFileSync(resolve(__dirname, '../../../assets/i18n/en.json'), 'utf8'));
const hi = JSON.parse(readFileSync(resolve(__dirname, '../../../assets/i18n/hi.json'), 'utf8'));
const lookup = (tree: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], tree);

describe('email', () => {
    it('is needed when email is off or there is no status yet', () => {
        expect(emailNeed(undefined)).toMatchObject({ required: true, whyKey: 'admin.dashboard.setup.email_off' });
        expect(emailNeed({ isEnabled: false })?.warning).toBeUndefined();
    });
    it('warns on the test provider, which sends nothing', () => {
        expect(emailNeed({ isEnabled: true, debugMode: true })).toMatchObject({ required: true, warning: true, whyKey: 'admin.dashboard.setup.email_test' });
    });
    it('is done with a real provider', () => {
        expect(emailNeed({ isEnabled: true, debugMode: false })).toBeNull();
    });
});

describe('payments', () => {
    const live = { enabled: true, mode: 'live', liveApiKey: 'k', webhookSecret: 's' };
    it('is done when on, live, with the live key and webhook secret', () => {
        expect(paymentsNeed(live)).toBeNull();
    });
    it('is pending when off, or a key or the webhook secret is missing', () => {
        expect(paymentsNeed(undefined)?.whyKey).toBe('admin.dashboard.setup.payments_off');
        expect(paymentsNeed({ ...live, enabled: false })?.whyKey).toBe('admin.dashboard.setup.payments_off');
        expect(paymentsNeed({ ...live, liveApiKey: '' })?.whyKey).toBe('admin.dashboard.setup.payments_off');
        expect(paymentsNeed({ ...live, webhookSecret: '' })?.whyKey).toBe('admin.dashboard.setup.payments_off');
    });
    it('checks the key of the mode in use', () => {
        expect(paymentsNeed({ ...live, mode: 'test', liveApiKey: '', testApiKey: '' })?.whyKey).toBe('admin.dashboard.setup.payments_off');
    });
    it('warns in test mode once set up', () => {
        expect(paymentsNeed({ ...live, mode: 'test', testApiKey: 't' })).toMatchObject({ required: false, warning: true, whyKey: 'admin.dashboard.setup.payments_test' });
    });
});

describe('sms', () => {
    it('is done with MSG91 and its key', () => {
        expect(smsNeed({ provider: 'msg91', msg91AuthKey: 'k' }, { phoneSignIn: true })).toBeNull();
    });
    it('is optional on the test provider while phone sign-in is off', () => {
        expect(smsNeed({ provider: 'log' }, undefined)).toMatchObject({ required: false, whyKey: 'admin.dashboard.setup.sms_off' });
        expect(smsNeed({ provider: 'msg91' }, { phoneSignIn: false })?.required).toBe(false);
    });
    it('is needed once phone sign-in is on', () => {
        expect(smsNeed(undefined, { phoneSignIn: true })).toMatchObject({ required: true, warning: true, whyKey: 'admin.dashboard.setup.sms_signin' });
    });
});

describe('ai', () => {
    const key = { preset: 'openai', keyPreview: 'sk-…1234' };
    it('is pending with no connection that can answer', () => {
        expect(aiNeed(undefined)?.whyKey).toBe('admin.dashboard.setup.ai_off');
        expect(aiNeed({ mode: 'live', connections: { a: { preset: 'openai' } } })?.whyKey).toBe('admin.dashboard.setup.ai_off');
    });
    it('counts Vertex AI as ready without a key', () => {
        expect(aiNeed({ mode: 'live', connections: { v: { preset: 'vertex' } } })).toBeNull();
    });
    it('warns in test mode', () => {
        expect(aiNeed({ mode: 'test', connections: { a: key } })).toMatchObject({ warning: true, whyKey: 'admin.dashboard.setup.ai_test' });
    });
    it('warns when a key failed after its last success', () => {
        expect(aiNeed({ mode: 'live', connections: { a: { ...key, lastError: 'bad key' } } })?.whyKey).toBe('admin.dashboard.setup.ai_error');
        expect(aiNeed({ mode: 'live', connections: { a: { ...key, lastError: 'x', lastOkAt: '2026-11-01T00:00:00Z', lastErrorAt: '2026-11-02T00:00:00Z' } } })?.whyKey).toBe('admin.dashboard.setup.ai_error');
    });
    it('ignores an old error the key has worked since', () => {
        expect(aiNeed({ mode: 'live', connections: { a: { ...key, lastError: 'x', lastOkAt: '2026-11-02T00:00:00Z', lastErrorAt: '2026-11-01T00:00:00Z' } } })).toBeNull();
    });
});

describe('unsplash', () => {
    it('is pending without an access key and optional', () => {
        expect(unsplashNeed(undefined)).toMatchObject({ required: false });
        expect(unsplashNeed({ unsplash: { accessKey: '' } })).not.toBeNull();
        expect(unsplashNeed({ unsplash: { accessKey: 'k' } })).toBeNull();
    });
});

describe('the items', () => {
    const needs: SetupNeed[] = [
        emailNeed(undefined)!, emailNeed({ isEnabled: true, debugMode: true })!,
        paymentsNeed(undefined)!, paymentsNeed({ enabled: true, testApiKey: 't', webhookSecret: 's' })!,
        smsNeed(undefined, undefined)!, smsNeed(undefined, { phoneSignIn: true })!,
        aiNeed(undefined)!, aiNeed({ connections: { v: { preset: 'vertex' } } })!, aiNeed({ mode: 'live', connections: { a: { keyPreview: 'k', lastError: 'x' } } })!,
        unsplashNeed(undefined)!,
    ];

    it('use keys that exist in every language, with the English as written', () => {
        for (const need of needs) {
            for (const [key, text] of [[need.titleKey!, need.title], [need.whyKey!, need.why]]) {
                expect(lookup(en, key), key).toBe(text);
                expect(typeof lookup(hi, key), key).toBe('string');
            }
        }
    });

    it('point at settings pages and are unique', () => {
        const ids = CORE_SETUP_ITEMS.map((i) => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of CORE_SETUP_ITEMS) expect(item.route).toMatch(/^\/admin\/settings\//);
    });

    it('leave out an item whose feature is off', () => {
        const ids = setupItemsFor([], (id) => id !== 'ai' && id !== 'sms').map((i) => i.id);
        expect(ids).toEqual(['email', 'payments', 'unsplash']);
    });

    it('add the app items after Arc CMS items, and drop a repeated id', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const app: SetupItem = { id: 'maps', icon: 'fa-solid fa-map', route: '/admin/maps', pending: async () => null };
        const ids = setupItemsFor([app, { ...app, id: 'email' }], () => true).map((i) => i.id);
        expect(ids).toEqual(['email', 'sms', 'payments', 'ai', 'unsplash', 'maps']);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('"email" is listed twice'));
        error.mockRestore();
    });
});

describe('pendingRows', () => {
    const item = (id: string, need: SetupNeed | null | Error): SetupItem => ({
        id, icon: '', route: '/', pending: async () => { if (need instanceof Error) throw need; return need; },
    });
    const optional: SetupNeed = { required: false, title: 'O', why: 'o' };
    const needed: SetupNeed = { required: true, title: 'N', why: 'n' };

    it('keeps only pending items, needed first, in order within each group', async () => {
        const rows = await pendingRows([item('a', optional), item('b', null), item('c', needed), item('d', optional)], async () => undefined);
        expect(rows.map((r) => r.item.id)).toEqual(['c', 'a', 'd']);
    });

    it('leaves out an item whose check fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const rows = await pendingRows([item('a', new Error('denied')), item('b', optional)], async () => undefined);
        expect(rows.map((r) => r.item.id)).toEqual(['b']);
        error.mockRestore();
    });

    it('reads each settings document once', async () => {
        const fetch = vi.fn(async (id: string) => ({ id }));
        const read = onceEach(fetch);
        await pendingRows(CORE_SETUP_ITEMS, read);
        await read('ai');
        expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(['ai', 'dodo-payments', 'email_status', 'integrations', 'sms', 'users']);
    });

    it('orderRows keeps the order within each group', () => {
        const rows = [item('a', optional), item('b', needed)].map((i, n) => ({ item: i, need: n ? needed : optional }));
        expect(orderRows(rows).map((r) => r.item.id)).toEqual(['b', 'a']);
    });
});

describe('the folded panel', () => {
    it('is remembered in this browser, and open by default', async () => {
        const { TestBed } = await import('@angular/core/testing');
        const { Firestore } = await import('@angular/fire/firestore');
        const { SetupStatusService, COLLAPSED_KEY } = await import('./setup-status.service');
        localStorage.removeItem(COLLAPSED_KEY);
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
        const first = TestBed.inject(SetupStatusService);
        expect(first.collapsed()).toBe(false);
        first.setCollapsed(true);
        expect(localStorage.getItem(COLLAPSED_KEY)).toBe('1');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
        expect(TestBed.inject(SetupStatusService).collapsed()).toBe(true);
        TestBed.inject(SetupStatusService).setCollapsed(false);
        expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
        TestBed.resetTestingModule();
    });
});
