/**
 * Tests for the onUserDeleted Cloud Function (functions/src/users/onUserDelete.ts)
 *
 * Covers:
 * - Handler is registered via onDocumentDeleted
 * - Skips all work when the deleted document has no data
 * - Calls owner.deleteUser(uid) when uid is present
 * - Calls db.collection('email_lookup').doc(hash).delete() when email is present
 * - Gracefully handles auth/user-not-found errors (does not rethrow)
 * - Ends access first (claims, sessions), and throws for a retry when a step
 *   fails while the delete is recent (review F)
 * - Does nothing when both uid and email are absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Mocks ────────────────────────────────────────────────────────────────────

/** The email_lookup doc id among every doc() call (the other calls are record and PIN ids). */
const hashArg = (calls: unknown[][]) => calls.map((c) => String(c[0])).find((id) => /^[0-9a-f]{64}$/.test(id));

const { mockRevoke, mockDeleteUser, mockGetUser, mockSetClaims, mockDocDelete, mockDoc, mockCollection, mockWhere, mockRecursiveDelete, mockDeleteFiles, mockBucket, mockEmitAppEvent } = vi.hoisted(() => {
    const mockDocDelete = vi.fn();
    const mockDoc = vi.fn((id?: string) => ({ id, delete: mockDocDelete, get: vi.fn().mockResolvedValue({ data: () => undefined }) }));
    const mockDeleteFiles = vi.fn().mockResolvedValue(undefined);
    const mockWhere = vi.fn(() => ({ get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) }));
    return {
        mockRevoke: vi.fn(),
        mockDeleteUser: vi.fn(),
        mockGetUser: vi.fn(),
        mockSetClaims: vi.fn(),
        mockDocDelete,
        mockDoc,
        mockWhere,
        mockCollection: vi.fn(() => ({ doc: mockDoc, where: mockWhere })),
        mockRecursiveDelete: vi.fn().mockResolvedValue(undefined),
        mockDeleteFiles,
        mockBucket: vi.fn(() => ({ deleteFiles: mockDeleteFiles })),
        mockEmitAppEvent: vi.fn().mockResolvedValue('event-1'),
    };
});

vi.mock('../init', () => ({
    owner: { deleteUser: mockDeleteUser, getUser: mockGetUser, setCustomUserClaims: mockSetClaims, revokeRefreshTokens: mockRevoke },
    db: { collection: mockCollection, recursiveDelete: mockRecursiveDelete },
    storage: { bucket: mockBucket },
}));

vi.mock('../email-core/appEvents', () => ({ emitAppEvent: mockEmitAppEvent }));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: vi.fn((path: string, handler: Function) => ({ path, handler })),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

/** A delete event; `ageMs` is how long ago the delete happened. */
function makeEvent(data: Record<string, any> | null, docId = 'doc-1', ageMs = 0) {
    return {
        params: { docId },
        time: new Date(Date.now() - ageMs).toISOString(),
        data: data === null ? null : { data: () => data },
    };
}
const OLD = 2 * 60 * 60 * 1000;

// The handler, taken once: beforeEach clears the mocks' call lists, so reading
// it from onDocumentDeleted's calls inside a test found nothing, and every test
// that guarded on it returned early without checking anything.
const { onDocumentDeleted: registered } = await import('firebase-functions/v2/firestore');
await import('../users/onUserDelete.js');
const HANDLER = vi.mocked(registered).mock.calls.at(-1)?.[1] as unknown as (event: any) => Promise<void>;

// ─── Tests ────────────────────────────────────────────────────────────────────

let storedClaims: Record<string, unknown> = {};

describe('onUserDelete Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDeleteUser.mockResolvedValue(undefined);
        mockDocDelete.mockResolvedValue(undefined);
        mockRecursiveDelete.mockResolvedValue(undefined);
        mockDeleteFiles.mockResolvedValue(undefined);
        // Claims as Firebase keeps them: written by setCustomUserClaims, read back by getUser
        // (mergeUserClaims reads its write back, specs/app-accounts-spec.md C-D6).
        storedClaims = {};
        mockGetUser.mockImplementation(async () => ({ customClaims: storedClaims }));
        mockSetClaims.mockImplementation(async (_uid: string, claims: Record<string, unknown>) => { storedClaims = claims; });
        mockRevoke.mockResolvedValue(undefined);
        mockEmitAppEvent.mockResolvedValue('event-1');
    });

    describe('Source file structure', () => {
        it('should export onUserDeleted function', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('export const onUserDeleted');
        });

        it('should register on users/{docId} path', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain("'users/{docId}'");
        });

        it('should use onDocumentDeleted from firebase-functions/v2/firestore', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
            expect(fileContent).toContain('onDocumentDeleted');
        });

        it('should import owner and db from init module', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain("from '../init.js'");
            expect(fileContent).toContain('owner');
            expect(fileContent).toContain('db');
        });

        it('should use SHA-256 hashing for email lookup', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('sha256');
            expect(fileContent).toContain('createHash');
        });

        it('should handle auth/user-not-found error gracefully', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('auth/user-not-found');
        });

        it('should use email_lookup collection name', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserDelete.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('email_lookup');
        });
    });

    describe('Handler logic via direct invocation', () => {
        async function getHandler() {
            expect(HANDLER).toBeTypeOf('function');
            return HANDLER;
        }

        it('ends access first: claims off and every session revoked, then the sign-in deleted (review F)', async () => {
            const handler = await getHandler();
            storedClaims = { arccms_role: 'admin', arccms_uid: 'rec-9', plan: 'pro' };
            const order: string[] = [];
            mockSetClaims.mockImplementation(async (_uid: string, claims: Record<string, unknown>) => { order.push('claims'); storedClaims = claims; });
            mockRevoke.mockImplementation(async () => void order.push('revoke'));
            mockDeleteUser.mockImplementation(async () => void order.push('delete'));
            await handler(makeEvent({ uid: 'u-9' }, 'rec-9'));
            expect(mockSetClaims).toHaveBeenCalledWith('u-9', { plan: 'pro' });
            expect(order).toEqual(['claims', 'revoke', 'delete']);
        });

        it('throws for a retry when a step fails soon after the delete, and announces nothing yet (review F)', async () => {
            const handler = await getHandler();
            mockDeleteUser.mockRejectedValue(new Error('quota'));
            await expect(handler(makeEvent({ uid: 'u-9' }, 'rec-9'))).rejects.toThrow(/deleting the sign-in failed; will retry/);
            expect(mockEmitAppEvent).not.toHaveBeenCalled();
            // The claims were already gone before the failing step.
            expect(mockRevoke).toHaveBeenCalledWith('u-9');
        });

        it('gives up after an hour, with the failure logged', async () => {
            const handler = await getHandler();
            mockDeleteFiles.mockRejectedValue(new Error('storage down'));
            await expect(handler(makeEvent({ uid: 'u-9' }, 'rec-9', OLD))).resolves.toBeUndefined();
            expect(mockEmitAppEvent).not.toHaveBeenCalled();
        });

        it("deletes the person's in-app notifications", async () => {
            const handler = await getHandler();
            const del = vi.fn().mockResolvedValue(undefined);
            mockWhere.mockImplementation(((field: string) => ({
                get: vi.fn().mockResolvedValue(field === 'userId' ? { size: 1, docs: [{ ref: { delete: del } }] } : { size: 0, docs: [] }),
            })) as never);
            await handler(makeEvent({ uid: 'u-9' }, 'rec-9'));
            expect(mockCollection).toHaveBeenCalledWith('Notifications');
            expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'u-9');
            expect(del).toHaveBeenCalled();
        });

        it('should return early when event.data is null', async () => {
            const handler = await getHandler();
            await handler(makeEvent(null));
            expect(mockDeleteUser).not.toHaveBeenCalled();
            expect(mockCollection).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
        });

        it('should call owner.deleteUser when uid is present', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ uid: 'user-abc', email: undefined }));
            expect(mockDeleteUser).toHaveBeenCalledWith('user-abc');
        });

        it('should delete email_lookup entry when email is present', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ uid: undefined, email: 'Test@Example.com' }));
            // The collection should have been called with 'email_lookup'
            expect(mockCollection).toHaveBeenCalledWith('email_lookup');
            // doc() should have been called with a hex string (SHA-256 hash)
            const docArg = hashArg(mockDoc.mock.calls) as string;
            expect(docArg).toMatch(/^[0-9a-f]{64}$/);
            expect(mockDocDelete).toHaveBeenCalled();
        });

        it('should normalize email before hashing (trim + lowercase)', async () => {
            const handler = await getHandler();
            // Two calls with the same email in different casings should produce the same hash
            vi.clearAllMocks();
            mockDeleteUser.mockResolvedValue(undefined);
            mockDocDelete.mockResolvedValue(undefined);

            await handler(makeEvent({ email: '  Alice@EXAMPLE.COM  ' }));
            const hash1 = hashArg(mockDoc.mock.calls) as string;

            vi.clearAllMocks();
            mockDocDelete.mockResolvedValue(undefined);
            await handler(makeEvent({ email: 'alice@example.com' }));
            const hash2 = hashArg(mockDoc.mock.calls) as string;

            expect(hash1).toBe(hash2);
        });

        it('keeps a shared or host-owned account but removes its ArcCMS claims (review S2)', async () => {
            const handler = await getHandler();
            for (const authOwner of ['shared', 'host']) {
                vi.clearAllMocks();
                storedClaims = { role: 'admin', plan: 'pro', arccms_role: 'admin', arccms_uid: 'doc-1' };
                mockGetUser.mockImplementation(async () => ({ customClaims: storedClaims }));
                mockSetClaims.mockImplementation(async (_uid: string, claims: Record<string, unknown>) => { storedClaims = claims; });
                await handler(makeEvent({ uid: 'kept-uid', authOwner }));
                expect(mockDeleteUser).not.toHaveBeenCalled();
                // The host app's own claims, `role` included, stay.
                expect(mockSetClaims).toHaveBeenCalledWith('kept-uid', { role: 'admin', plan: 'pro' });
            }
        });

        it('keeps going when the kept account has gone', async () => {
            const handler = await getHandler();
            mockGetUser.mockRejectedValue({ code: 'auth/user-not-found' });
            await expect(handler(makeEvent({ uid: 'gone-uid', authOwner: 'shared' }))).resolves.toBeUndefined();
        });

        it('should not call deleteUser when uid is missing', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ email: 'someone@example.com' }));
            expect(mockDeleteUser).not.toHaveBeenCalled();
        });

        it('should not call email_lookup delete when email is missing', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ uid: 'uid-xyz' }));
            expect(mockCollection).not.toHaveBeenCalledWith('email_lookup');
        });

        it('deletes everything under the record: subcollections and the Storage folders', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ uid: 'u-9', email: 'a@b.co' }, 'rec-9'));
            expect(mockCollection).toHaveBeenCalledWith('users');
            expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-9' }));
            expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'users/rec-9/', force: true });
            expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'avatars/u-9/', force: true });
        });

        it('deletes the person\'s feedback', async () => {
            const handler = await getHandler();
            const feedbackDelete = vi.fn().mockResolvedValue(undefined);
            mockWhere.mockReturnValueOnce({
                get: vi.fn().mockResolvedValue({ size: 2, docs: [{ ref: { delete: feedbackDelete } }, { ref: { delete: feedbackDelete } }] }),
            });
            await handler(makeEvent({ uid: 'u-9' }, 'rec-9'));
            expect(mockCollection).toHaveBeenCalledWith('Feedback');
            expect(mockWhere).toHaveBeenCalledWith('userDocId', '==', 'rec-9');
            expect(feedbackDelete).toHaveBeenCalledTimes(2);
        });

        it('deletes an app account (no email, no phone) cleanly, and announces both ids (docs/app/app-accounts.html)', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ id: 'rec-7', uid: 'u-7', name: 'Anna', email: '', phone: '', by: 'app', role: 'user', isActive: true }, 'rec-7'));
            expect(mockCollection).not.toHaveBeenCalledWith('email_lookup');
            expect(mockCollection).not.toHaveBeenCalledWith('phone_index');
            expect(mockDeleteUser).toHaveBeenCalledWith('u-7');
            expect(mockEmitAppEvent).toHaveBeenCalledWith('user.deleted', { userId: 'u-7', data: { userDocId: 'rec-7' } });
            const payload = JSON.stringify(mockEmitAppEvent.mock.calls);
            expect(payload).not.toContain('contactEmail');
        });

        it('announces user.deleted for data an app keeps elsewhere', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ uid: 'u-9' }, 'rec-9'));
            expect(mockEmitAppEvent).toHaveBeenCalledWith('user.deleted', { userId: 'u-9', data: { userDocId: 'rec-9' } });
        });

        it('keeps going when the Storage cleanup fails', async () => {
            const handler = await getHandler();
            mockDeleteFiles.mockRejectedValue(new Error('storage down'));
            // Every other step still runs before the retry.
            await expect(handler(makeEvent({ uid: 'u-9' }, 'rec-9'))).rejects.toThrow(/Storage files/);
            expect(mockRecursiveDelete).toHaveBeenCalled();
        });

        it('should not throw when owner.deleteUser rejects with auth/user-not-found', async () => {
            const handler = await getHandler();
            mockDeleteUser.mockRejectedValue({ code: 'auth/user-not-found' });
            // Should resolve without throwing
            await expect(handler(makeEvent({ uid: 'gone-uid' }))).resolves.toBeUndefined();
        });

        it('should not throw when owner.deleteUser rejects with unknown error', async () => {
            const handler = await getHandler();
            mockDeleteUser.mockRejectedValue(new Error('network error'));
            await expect(handler(makeEvent({ uid: 'some-uid' }, 'doc-1', OLD))).resolves.toBeUndefined();
        });

        it('should not throw when email_lookup deletion fails', async () => {
            const handler = await getHandler();
            mockDocDelete.mockRejectedValue(new Error('firestore error'));
            await expect(
                handler(makeEvent({ email: 'fail@example.com' }, 'doc-1', OLD))
            ).resolves.toBeUndefined();
        });

        it('should handle both uid and email in parallel', async () => {
            const handler = await getHandler();
            await handler(makeEvent({ uid: 'u-123', email: 'both@example.com' }));
            expect(mockDeleteUser).toHaveBeenCalledWith('u-123');
            expect(mockCollection).toHaveBeenCalledWith('email_lookup');
        });
    });
});
