/** Sequences on App users (live) lists: joining and leaving (docs/coexistence-spec.md 5b, CO6.5c). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const campaigns: Array<{ id: string; data: Record<string, unknown> }> = [];
    const lists = new Map<string, Record<string, unknown>>();
    const enrollments = new Map<string, Record<string, unknown>>();
    const db = {
        getAll: vi.fn(async (...refs: Array<{ id: string }>) => refs.map((r) => ({ exists: lists.has(r.id), data: () => lists.get(r.id) }))),
        collection: vi.fn((name: string) => ({
            where: vi.fn(() => ({ get: vi.fn(async () => ({ docs: campaigns.map((c) => ({ id: c.id, data: () => c.data })) })) })),
            doc: vi.fn((id: string) => ({
                id,
                get: vi.fn(async () => (name === 'DripEnrollments'
                    ? { exists: enrollments.has(id), data: () => enrollments.get(id) }
                    : { exists: false, data: () => undefined })),
            })),
        })),
    };
    return {
        campaigns, lists, enrollments, db,
        enrollInCampaign: vi.fn(async () => true),
        exitEnrollment: vi.fn(async () => undefined),
        flushDueEnrollments: vi.fn(async () => []),
        resolveAppList: vi.fn(),
    };
});

vi.mock('../init', () => ({ db: m.db }));
vi.mock('../email-core/dripEnrollment', () => ({
    appContactId: (id: string) => `app_${id}`,
    enrollInCampaign: m.enrollInCampaign,
}));
vi.mock('../email-core/dripSend', () => ({ exitEnrollment: m.exitEnrollment, flushDueEnrollments: m.flushDueEnrollments }));
vi.mock('../app-audience/appLists', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../app-audience/appLists.js')>()),
    resolveAppList: m.resolveAppList,
}));

import { activeLiveCampaigns, backfillAppCampaign, planAppDrips, syncAppDrips } from '../app-audience/appDrips.js';
import { appUserStateId } from '../app-audience/state.js';

const settings = { key: { source: 'docId' as const }, emailField: 'email', watchedFields: [] };
const pros = { id: 'camp-pro', listId: 'pros', status: 'active', steps: [{ id: 's', templateId: 't', delayHours: 0 }] };
const proConditions = [{ field: 'isPro', op: 'is' as const, value: 'true' }];

describe('planAppDrips', () => {
    const live = [{ campaign: pros as any, conditions: proConditions }];

    it('joins when a write starts matching, including a new document', () => {
        expect(planAppDrips({ isPro: false }, { isPro: true }, live).enroll.map((c) => c.id)).toEqual(['camp-pro']);
        expect(planAppDrips(undefined, { isPro: true }, live).enroll.map((c) => c.id)).toEqual(['camp-pro']);
    });

    it('leaves when a write stops matching or deletes the document', () => {
        expect(planAppDrips({ isPro: true }, { isPro: false }, live).exit.map((c) => c.id)).toEqual(['camp-pro']);
        expect(planAppDrips({ isPro: true }, undefined, live).exit.map((c) => c.id)).toEqual(['camp-pro']);
    });

    it('does nothing while the match is unchanged', () => {
        expect(planAppDrips({ isPro: true, n: 1 }, { isPro: true, n: 2 }, live)).toEqual({ enroll: [], exit: [] });
        expect(planAppDrips({ isPro: false }, { isPro: false, n: 2 }, live)).toEqual({ enroll: [], exit: [] });
    });
});

describe('live sequences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.campaigns.length = 0;
        m.lists.clear();
        m.enrollments.clear();
        m.campaigns.push({ id: 'camp-pro', data: { ...pros } }, { id: 'camp-contacts', data: { listId: 'newsletter', status: 'active', steps: [] } });
        m.lists.set('pros', { type: 'app', conditions: proConditions });
        m.lists.set('newsletter', { type: 'manual' });
    });

    it('finds only active sequences on live lists, read fresh every time', async () => {
        expect((await activeLiveCampaigns()).map((l) => l.campaign.id)).toEqual(['camp-pro']);
        m.campaigns.length = 0;
        expect(await activeLiveCampaigns()).toEqual([]);
    });

    it('enrolls a person who starts matching, then sends day 0 right away', async () => {
        const n = await syncAppDrips('u1', { isPro: false }, { isPro: true, email: 'a@x.com' }, settings);
        const appUserId = appUserStateId('u1');
        expect(n).toBe(1);
        expect(m.enrollInCampaign).toHaveBeenCalledWith(expect.objectContaining({ id: 'camp-pro' }), `app_${appUserId}`, { appUserId, appDocId: 'u1' });
        expect(m.flushDueEnrollments).toHaveBeenCalledWith(`app_${appUserId}`);
    });

    it('exits a person who stops matching, or is deleted', async () => {
        const id = `camp-pro_app_${appUserStateId('u1')}`;
        m.enrollments.set(id, { status: 'active' });
        await syncAppDrips('u1', { isPro: true }, { isPro: false }, settings);
        expect(m.exitEnrollment).toHaveBeenLastCalledWith(expect.objectContaining({ id }), 'camp-pro', 'left_list');
        await syncAppDrips('u1', { isPro: true }, undefined, settings);
        expect(m.exitEnrollment).toHaveBeenLastCalledWith(expect.objectContaining({ id }), 'camp-pro', 'app_user_deleted');
    });

    it('leaves a finished enrollment alone', async () => {
        m.enrollments.set(`camp-pro_app_${appUserStateId('u1')}`, { status: 'completed' });
        await syncAppDrips('u1', { isPro: true }, { isPro: false }, settings);
        expect(m.exitEnrollment).not.toHaveBeenCalled();
    });

    it('costs nothing more for a write that changes no match', async () => {
        expect(await syncAppDrips('u1', { isPro: true, n: 1 }, { isPro: true, n: 2 }, settings)).toBe(0);
        expect(m.enrollInCampaign).not.toHaveBeenCalled();
        expect(m.exitEnrollment).not.toHaveBeenCalled();
    });

    it('backfills everyone the list matches on activation', async () => {
        m.resolveAppList.mockResolvedValue({ members: [{ docId: 'u1', appUserId: 'h1' }, { docId: 'u2', appUserId: 'h2' }], scanned: 2, truncated: false });
        expect(await backfillAppCampaign(pros as any, proConditions)).toEqual({ enrolled: 2, truncated: false });
        expect(m.enrollInCampaign).toHaveBeenCalledWith(pros, 'app_h2', { appUserId: 'h2', appDocId: 'u2' });
    });
});
