/** Sending a sequence step to an app user (docs/coexistence-spec.md 5b, CO6.5c). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    const host = new Map<string, Record<string, unknown>>();
    const states = new Map<string, Record<string, unknown>>();
    const get = (store: Map<string, Record<string, unknown>> | null, id: string, fallback?: Record<string, unknown>) => async () => {
        const data = store ? store.get(id) : fallback;
        return { id, exists: !!data, data: () => data };
    };
    const db = {
        collection: vi.fn((name: string) => ({
            doc: vi.fn((id: string) => {
                if (name === 'DripCampaigns') return { get: get(null, id, { name: 'Pro welcome', listId: 'pros', status: 'active', steps: [{ id: 's0', templateId: 't0', delayHours: 0 }, { id: 's1', templateId: 't1', delayHours: 24 }] }), set: vi.fn() };
                if (name === 'Lists') return { get: get(null, id, { type: 'app', conditions: [{ field: 'isPro', op: 'is', value: 'true' }] }) };
                if (name === 'EmailTemplate') return { get: get(null, id, { subject: 'Hi ##APP.plan##', template: 'x', senderEmail: '', senderName: '', type: 'drip' }) };
                if (name === 'Settings') return { get: get(null, id, { isEnabled: true }) };
                if (name === 'AppAudience') return { get: get(states, id) };
                return { get: get(null, id) };
            }),
        })),
    };
    return {
        host, states, db,
        firestoreFor: vi.fn(() => ({ collection: vi.fn(() => ({ doc: vi.fn((id: string) => ({ get: get(host, id) })) })) })),
        queueEmail: vi.fn(),
    };
});

vi.mock('../init', () => ({ db: m.db, firestoreFor: m.firestoreFor }));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: m.queueEmail }));
vi.mock('../app-audience/adminCallables', () => ({
    readAppAudienceSettings: vi.fn(async () => ({ key: { source: 'docId' }, emailField: 'email', nameField: 'name', watchedFields: [] })),
}));
vi.mock('firebase-admin/firestore', () => ({
    Timestamp: { now: vi.fn(() => 'now'), fromMillis: vi.fn((ms: number) => ({ ms })) },
    FieldValue: { delete: () => '<delete>', increment: (n: number) => ({ inc: n }) },
}));

import { sendDueEnrollment } from '../email-core/dripSend.js';
import { appUserStateId } from '../app-audience/state.js';

const enrollment = () => ({ campaignId: 'camp-pro', contactId: 'app_h', appUserId: appUserStateId('u1'), appDocId: 'u1', currentStep: 0, status: 'active' });

describe('a sequence step to an app user', () => {
    let ref: { update: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        m.host.clear();
        m.states.clear();
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
        ref = { update: vi.fn(async () => undefined) };
        m.host.set('u1', { email: 'Asha@x.com', name: 'Asha', isPro: true, plan: 'pro', password: 'p' });
        m.queueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
    });

    it('sends with the current address and app fields, then schedules the next step', async () => {
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('sent');
        expect(m.queueEmail).toHaveBeenCalledWith(expect.objectContaining({
            source: 'drip', category: 'marketing', toEmail: 'asha@x.com', toName: 'Asha', isSubscribed: true,
            appUser: { id: appUserStateId('u1'), docId: 'u1', fields: { email: 'Asha@x.com', name: 'Asha', isPro: 'true', plan: 'pro' } },
        }));
        expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ currentStep: 1 }));
    });

    it('exits when the person no longer matches the list', async () => {
        m.host.set('u1', { email: 'a@x.com', isPro: false });
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('exited');
        expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'exited', exitedReason: 'left_list' }));
        expect(m.queueEmail).not.toHaveBeenCalled();
    });

    it('exits when the person was deleted in the app', async () => {
        m.host.clear();
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('exited');
        expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ exitedReason: 'app_user_deleted' }));
    });

    it('exits when the person unsubscribed', async () => {
        m.states.set(appUserStateId('u1'), { consent: 'unsubscribed' });
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('exited');
        expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ exitedReason: 'unsubscribed' }));
    });

    it('waits, without losing the step, while the person has no email address', async () => {
        m.host.set('u1', { isPro: true });
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('held');
        expect(m.queueEmail).not.toHaveBeenCalled();
        expect(ref.update).not.toHaveBeenCalledWith(expect.objectContaining({ currentStep: 1 }));
    });

    it('exits on suppression, and holds when sending is switched off', async () => {
        m.queueEmail.mockResolvedValueOnce({ id: 'log', status: 'suppressed', skipReason: 'suppressed' });
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('exited');
        m.queueEmail.mockResolvedValueOnce({ id: 'log', status: 'skipped', skipReason: 'email_disabled' });
        expect(await sendDueEnrollment(ref as any, enrollment())).toBe('held');
    });
});
