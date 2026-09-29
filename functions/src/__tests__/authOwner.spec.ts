/** CO-D16: ArcCMS never deletes a login a host app owns or shares. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    deleteUser: vi.fn().mockResolvedValue(undefined),
    docDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../init', () => ({
    owner: { deleteUser: m.deleteUser },
    db: {
        collection: vi.fn(() => ({ doc: vi.fn(() => ({ delete: m.docDelete, get: vi.fn(async () => ({ data: () => undefined })) })) })),
        recursiveDelete: vi.fn(async () => undefined),
    },
    storage: { bucket: vi.fn(() => ({ deleteFiles: vi.fn(async () => undefined) })) },
}));
vi.mock('../email-core/appEvents', () => ({ emitAppEvent: vi.fn(async () => 'e1') }));
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: (_opts: unknown, handler: unknown) => handler,
}));

import { onUserDeleted } from '../users/onUserDelete.js';
import { arccmsOwnsAuthAccount } from '../users/authOwner.js';

const deleted = onUserDeleted as unknown as (e: any) => Promise<void>;
const event = (data: Record<string, unknown>) => ({ params: { docId: 'rec-1' }, data: { data: () => data } });

describe('authOwner guard', () => {
    beforeEach(() => vi.clearAllMocks());

    it('deletes the login of a user ArcCMS owns (no field, or arccms)', async () => {
        expect(arccmsOwnsAuthAccount({})).toBe(true);
        expect(arccmsOwnsAuthAccount({ authOwner: 'arccms' })).toBe(true);
        await deleted(event({ uid: 'u1', email: 'a@b.com' }));
        expect(m.deleteUser).toHaveBeenCalledWith('u1');
    });

    it.each(['host', 'shared'])('keeps a %s login', async (authOwner) => {
        await deleted(event({ uid: 'u1', email: 'a@b.com', authOwner }));
        expect(m.deleteUser).not.toHaveBeenCalled();
        // The ArcCMS side is still cleaned up.
        expect(m.docDelete).toHaveBeenCalled();
    });
});
