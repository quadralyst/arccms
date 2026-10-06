/**
 * An account an app created (by: 'app', docs/app/app-accounts.html) did not sign up:
 * no "just signed up" alert for the admins, but the user.signed_up event still goes out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ emitAppEvent: vi.fn(async () => 'event-1'), notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../init', () => ({ owner: {}, db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ set: vi.fn() })) })) } }));
vi.mock('../email-core/appEvents.js', () => ({ emitAppEvent: mocks.emitAppEvent }));
vi.mock('../email-core/adminAlerts.js', () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_path: string, handler: unknown) => handler) }));

import { onUserCreated } from '../users/onUserCreate.js';

const handler = onUserCreated as unknown as (event: unknown) => Promise<void>;
const created = (data: Record<string, unknown>) => ({ data: { data: () => data } });

describe('onUserCreated with an app account', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends the admins no sign-up alert, and still emits user.signed_up', async () => {
        await handler(created({ uid: 'u-7', name: 'Anna', email: '', phone: '', by: 'app' }));
        expect(mocks.notifyAdmins).not.toHaveBeenCalled();
        expect(mocks.emitAppEvent).toHaveBeenCalledWith('user.signed_up', { userId: 'u-7' });
    });

    it('still alerts the admins for a person who signed up', async () => {
        await handler(created({ uid: 'u-8', name: 'Ravi', email: '', phone: '+910000000000', by: 'phone' }));
        expect(mocks.notifyAdmins).toHaveBeenCalledWith('admin_new_signup', expect.objectContaining({ body: 'Ravi just signed up.' }));
    });
});
