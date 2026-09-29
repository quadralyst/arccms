/** Activating a sequence: backfill from a contact list or an App users (live) list (CO6.5c). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    campaign: {} as Record<string, unknown>,
    list: undefined as Record<string, unknown> | undefined,
    backfillEnrollments: vi.fn(async () => 3),
    backfillAppCampaign: vi.fn(async () => ({ enrolled: 7, truncated: false })),
}));

vi.mock('../init', () => ({
    db: {
        collection: vi.fn((name: string) => ({
            doc: vi.fn(() => ({
                get: vi.fn(async () => (name === 'Lists'
                    ? { exists: !!m.list, data: () => m.list }
                    : { exists: true, id: 'camp1', data: () => m.campaign })),
                set: vi.fn(async () => undefined),
            })),
        })),
    },
}));
vi.mock('../email-core/dripEnrollment', () => ({ backfillEnrollments: m.backfillEnrollments, exitCampaignEnrollments: vi.fn() }));
vi.mock('../app-audience/appDrips', () => ({ backfillAppCampaign: m.backfillAppCampaign }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string) { super(msg); } },
}));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => 'now') } }));

import { activateDripCampaign } from '../email-core/dripCampaigns.js';

const activate = activateDripCampaign as unknown as (req: any) => Promise<any>;
const admin = { auth: { token: { arccms_role: 'admin' } }, data: { campaignId: 'camp1' } };

describe('activateDripCampaign', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.campaign = { listId: 'l1', status: 'draft', steps: [{ id: 's', templateId: 't', delayHours: 0 }], enrollExistingOnActivate: true };
    });

    it('backfills the members of a contact list, as before', async () => {
        m.list = { type: 'manual' };
        expect(await activate(admin)).toEqual({ enrolled: 3, appUsersCapped: false });
        expect(m.backfillAppCampaign).not.toHaveBeenCalled();
    });

    it('backfills whoever a live list matches now', async () => {
        m.list = { type: 'app', conditions: [{ field: 'isPro', op: 'is', value: 'true' }] };
        expect(await activate(admin)).toEqual({ enrolled: 7, appUsersCapped: false });
        expect(m.backfillAppCampaign).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }), [{ field: 'isPro', op: 'is', value: 'true' }]);
        expect(m.backfillEnrollments).not.toHaveBeenCalled();
    });

    it('says when the live list read only the first app users (review C2)', async () => {
        m.list = { type: 'app', conditions: [{ field: 'isPro', op: 'is', value: 'true' }] };
        m.backfillAppCampaign.mockResolvedValueOnce({ enrolled: 7, truncated: true });
        expect(await activate(admin)).toEqual({ enrolled: 7, appUsersCapped: true });
        expect(m.backfillEnrollments).not.toHaveBeenCalled();
    });

    it('enrolls nobody existing when the option is off', async () => {
        m.campaign = { ...m.campaign, enrollExistingOnActivate: false };
        m.list = { type: 'app', conditions: [] };
        expect(await activate(admin)).toEqual({ enrolled: 0, appUsersCapped: false });
    });
});
