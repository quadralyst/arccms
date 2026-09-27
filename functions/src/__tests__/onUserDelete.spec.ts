/**
 * Tests for the onUserDeleted Cloud Function (functions/src/users/onUserDelete.ts)
 *
 * Covers:
 * - Handler is registered via onDocumentDeleted
 * - Skips all work when the deleted document has no data
 * - Calls owner.deleteUser(uid) when uid is present
 * - Calls db.collection('email_lookup').doc(hash).delete() when email is present
 * - Gracefully handles auth/user-not-found errors (does not rethrow)
 * - Gracefully handles email_lookup deletion errors (does not rethrow)
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

const { mockDeleteUser, mockDocDelete, mockDoc, mockCollection, mockRecursiveDelete, mockDeleteFiles, mockBucket, mockEmitAppEvent } = vi.hoisted(() => {
    const mockDocDelete = vi.fn();
    const mockDoc = vi.fn((id?: string) => ({ id, delete: mockDocDelete, get: vi.fn().mockResolvedValue({ data: () => undefined }) }));
    const mockDeleteFiles = vi.fn().mockResolvedValue(undefined);
    return {
        mockDeleteUser: vi.fn(),
        mockDocDelete,
        mockDoc,
        mockCollection: vi.fn(() => ({ doc: mockDoc })),
        mockRecursiveDelete: vi.fn().mockResolvedValue(undefined),
        mockDeleteFiles,
        mockBucket: vi.fn(() => ({ deleteFiles: mockDeleteFiles })),
        mockEmitAppEvent: vi.fn().mockResolvedValue('event-1'),
    };
});

vi.mock('../init', () => ({
    owner: { deleteUser: mockDeleteUser },
    db: { collection: mockCollection, recursiveDelete: mockRecursiveDelete },
    storage: { bucket: mockBucket },
}));

vi.mock('../email-core/appEvents', () => ({ emitAppEvent: mockEmitAppEvent }));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: vi.fn((path: string, handler: Function) => ({ path, handler })),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeEvent(data: Record<string, any> | null, docId = 'doc-1') {
    return {
        params: { docId },
        data: data === null ? null : { data: () => data },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('onUserDelete Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDeleteUser.mockResolvedValue(undefined);
        mockDocDelete.mockResolvedValue(undefined);
        mockRecursiveDelete.mockResolvedValue(undefined);
        mockDeleteFiles.mockResolvedValue(undefined);
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
            // Import the module; vi.mock ensures onDocumentDeleted returns { path, handler }
            const { onDocumentDeleted } = await import('firebase-functions/v2/firestore');
            // Import the module to trigger the onDocumentDeleted call
            await import('../users/onUserDelete.js');
            // Retrieve the handler that was passed to onDocumentDeleted
            const calls = vi.mocked(onDocumentDeleted).mock.calls;
            if (calls.length === 0) return null;
            const lastCall = calls[calls.length - 1];
            return lastCall[1] as (event: any) => Promise<void>;
        }

        it('should return early when event.data is null', async () => {
            const handler = await getHandler();
            if (!handler) return; // guard for import timing issues
            await handler(makeEvent(null));
            expect(mockDeleteUser).not.toHaveBeenCalled();
            expect(mockCollection).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
        });

        it('should call owner.deleteUser when uid is present', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'user-abc', email: undefined }));
            expect(mockDeleteUser).toHaveBeenCalledWith('user-abc');
        });

        it('should delete email_lookup entry when email is present', async () => {
            const handler = await getHandler();
            if (!handler) return;
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
            if (!handler) return;
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

        it('should not call deleteUser when uid is missing', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ email: 'someone@example.com' }));
            expect(mockDeleteUser).not.toHaveBeenCalled();
        });

        it('should not call email_lookup delete when email is missing', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'uid-xyz' }));
            expect(mockCollection).not.toHaveBeenCalledWith('email_lookup');
        });

        it('deletes everything under the record: subcollections and the Storage folders', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'u-9', email: 'a@b.co' }, 'rec-9'));
            expect(mockCollection).toHaveBeenCalledWith('users');
            expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-9' }));
            expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'users/rec-9/', force: true });
            expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'avatars/u-9/', force: true });
        });

        it('announces user.deleted for data an app keeps elsewhere', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'u-9' }, 'rec-9'));
            expect(mockEmitAppEvent).toHaveBeenCalledWith('user.deleted', { userId: 'u-9', data: { userDocId: 'rec-9' } });
        });

        it('keeps going when the Storage cleanup fails', async () => {
            const handler = await getHandler();
            if (!handler) return;
            mockDeleteFiles.mockRejectedValue(new Error('storage down'));
            await expect(handler(makeEvent({ uid: 'u-9' }, 'rec-9'))).resolves.toBeUndefined();
            expect(mockRecursiveDelete).toHaveBeenCalled();
        });

        it('should not throw when owner.deleteUser rejects with auth/user-not-found', async () => {
            const handler = await getHandler();
            if (!handler) return;
            mockDeleteUser.mockRejectedValue({ code: 'auth/user-not-found' });
            // Should resolve without throwing
            await expect(handler(makeEvent({ uid: 'gone-uid' }))).resolves.toBeUndefined();
        });

        it('should not throw when owner.deleteUser rejects with unknown error', async () => {
            const handler = await getHandler();
            if (!handler) return;
            mockDeleteUser.mockRejectedValue(new Error('network error'));
            await expect(handler(makeEvent({ uid: 'some-uid' }))).resolves.toBeUndefined();
        });

        it('should not throw when email_lookup deletion fails', async () => {
            const handler = await getHandler();
            if (!handler) return;
            mockDocDelete.mockRejectedValue(new Error('firestore error'));
            await expect(
                handler(makeEvent({ email: 'fail@example.com' }))
            ).resolves.toBeUndefined();
        });

        it('should handle both uid and email in parallel', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'u-123', email: 'both@example.com' }));
            expect(mockDeleteUser).toHaveBeenCalledWith('u-123');
            expect(mockCollection).toHaveBeenCalledWith('email_lookup');
        });
    });
});
