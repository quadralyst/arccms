/**
 * onUserCreated, the parts added for phone and Google sign-in: phone-only
 * sign-ups still count as sign-ups, and Firebase Auth learns an email is
 * verified only from the server's own sign-up code record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn() }));
const mocks = vi.hoisted(() => ({ notifyAdmins: vi.fn(), emitAppEvent: vi.fn() }));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: vi.fn((_opts: unknown, handler: unknown) => handler) }));
vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock('../email-core/appEvents', () => ({ emitAppEvent: mocks.emitAppEvent }));

import { db } from '../init.js';
import { onUserCreated } from '../users/onUserCreate.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { FakeTimestamp, type MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const run = (data: Record<string, unknown>) => (onUserCreated as unknown as (e: unknown) => Promise<void>)({ data: { data: () => data } });

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    owner.getUser.mockResolvedValue({ uid: 'u1', email: 'a@example.com', emailVerified: false });
});

describe('onUserCreated', () => {
    it('announces a phone-only sign-up with the masked number', async () => {
        await run({ uid: 'u1', name: '', email: '', phone: '+919876543210' });
        expect(mem.all('email_lookup')).toHaveLength(0);
        expect(mocks.emitAppEvent).toHaveBeenCalledWith('user.signed_up', { userId: 'u1' });
        expect(mocks.notifyAdmins).toHaveBeenCalledWith('admin_new_signup', expect.objectContaining({ body: '+91 ••••• 43210 just signed up.' }));
    });

    it('marks the Auth email verified when a recent sign-up code proved it', async () => {
        mem.seed('signup_otps', computeEmailHash('a@example.com'), { purpose: 'signup', verified: true, verifiedAt: FakeTimestamp.now() });
        await run({ uid: 'u1', email: 'a@example.com', emailVerified: true });
        expect(owner.updateUser).toHaveBeenCalledWith('u1', { emailVerified: true });
    });

    it('ignores the client-written emailVerified flag without that proof', async () => {
        await run({ uid: 'u1', email: 'a@example.com', emailVerified: true });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it('ignores an old verification', async () => {
        mem.seed('signup_otps', computeEmailHash('a@example.com'), {
            purpose: 'signup', verified: true, verifiedAt: FakeTimestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
        });
        await run({ uid: 'u1', email: 'a@example.com' });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });

    it("never changes a sign-in another app owns", async () => {
        mem.seed('signup_otps', computeEmailHash('a@example.com'), { purpose: 'signup', verified: true, verifiedAt: FakeTimestamp.now() });
        await run({ uid: 'u1', email: 'a@example.com', authOwner: 'shared' });
        expect(owner.updateUser).not.toHaveBeenCalled();
    });
});
