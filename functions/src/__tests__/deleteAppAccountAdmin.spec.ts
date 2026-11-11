/** An app deleting an account never removes the site's last active admin (RF4, M3). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../sign-in-choice', () => ({ signInStrength: () => 'strict', fixedSignIn: () => ({ emailSignIn: null, newDeviceCode: null }) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (...args: any[]) => args[args.length - 1],
    HttpsError: class HttpsError extends Error { constructor(public code: string, msg: string, public details?: unknown) { super(msg); } },
}));

import { db } from '../init.js';
import { deleteAppAccount } from '../app-kit/accounts.js';
import { LAST_ADMIN } from '../users/adminUserAccess.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;

describe('deleteAppAccount and the last admin', () => {
    beforeEach(() => {
        mem.store.clear();
        mem.seed('users', 'boss', { uid: 'uid-boss', role: 'admin', isActive: true, status: 'Active' });
        mem.seed('users', 'till', { uid: 'uid-till', role: 'user', isActive: true, by: 'app' });
    });

    it('deletes a member at once', async () => {
        await deleteAppAccount('uid-till');
        expect(mem.read('users', 'till')).toBeUndefined();
    });

    it("refuses the site's last active admin, and deletes an admin while another stays", async () => {
        await expect(deleteAppAccount('uid-boss')).rejects.toMatchObject({ message: LAST_ADMIN, details: { reason: 'last-admin' } });
        expect(mem.read('users', 'boss')).toBeDefined();
        mem.seed('users', 'ravi', { uid: 'uid-ravi', role: 'admin', isActive: true });
        await deleteAppAccount('uid-boss');
        expect(mem.read('users', 'boss')).toBeUndefined();
    });
});
