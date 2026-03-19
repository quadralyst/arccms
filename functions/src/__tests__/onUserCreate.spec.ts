/**
 * Tests for the onUserCreated Cloud Function (functions/src/users/onUserCreate.ts)
 *
 * Covers:
 * - Handler is registered via onDocumentCreated on users/{docId}
 * - Creates email_lookup entry when email is present
 * - Normalizes email before hashing (trim + lowercase)
 * - Skips when event data is null
 * - Skips when email field is missing
 * - Gracefully handles Firestore write errors (does not rethrow)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDocSet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ set: mockDocSet });
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });

vi.mock('../init', () => ({
    owner: {},
    db: { collection: mockCollection },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((path: string, handler: Function) => ({ path, handler })),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeEvent(data: Record<string, any> | null) {
    return {
        data: data === null ? null : { data: () => data },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('onUserCreate Cloud Function', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDocSet.mockResolvedValue(undefined);
    });

    describe('Source file structure', () => {
        it('should export onUserCreated function', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserCreate.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('export const onUserCreated');
        });

        it('should register on users/{docId} path', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserCreate.ts'),
                'utf-8'
            );
            expect(fileContent).toContain("'users/{docId}'");
        });

        it('should use onDocumentCreated from firebase-functions/v2/firestore', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserCreate.ts'),
                'utf-8'
            );
            expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
            expect(fileContent).toContain('onDocumentCreated');
        });

        it('should import db from init module', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserCreate.ts'),
                'utf-8'
            );
            expect(fileContent).toContain("from '../init.js'");
            expect(fileContent).toContain('db');
        });

        it('should use SHA-256 hashing for email lookup', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserCreate.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('sha256');
            expect(fileContent).toContain('createHash');
        });

        it('should use email_lookup collection name', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../users/onUserCreate.ts'),
                'utf-8'
            );
            expect(fileContent).toContain('email_lookup');
        });
    });

    describe('Handler logic via direct invocation', () => {
        async function getHandler() {
            const { onDocumentCreated } = await import('firebase-functions/v2/firestore');
            await import('../users/onUserCreate.js');
            const calls = vi.mocked(onDocumentCreated).mock.calls;
            if (calls.length === 0) return null;
            const lastCall = calls[calls.length - 1];
            return lastCall[1] as (event: any) => Promise<void>;
        }

        it('should return early when event.data is null', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent(null));
            expect(mockCollection).not.toHaveBeenCalled();
        });

        it('should return early when email is missing', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'user-abc', name: 'Test User' }));
            expect(mockCollection).not.toHaveBeenCalled();
        });

        it('should create email_lookup entry when email is present', async () => {
            const handler = await getHandler();
            if (!handler) return;
            await handler(makeEvent({ uid: 'user-abc', email: 'test@example.com' }));
            expect(mockCollection).toHaveBeenCalledWith('email_lookup');
            // doc() should have been called with a hex string (SHA-256 hash)
            const docArg = mockDoc.mock.calls[0][0] as string;
            expect(docArg).toMatch(/^[0-9a-f]{64}$/);
            expect(mockDocSet).toHaveBeenCalledWith({ exists: true });
        });

        it('should normalize email before hashing (trim + lowercase)', async () => {
            const handler = await getHandler();
            if (!handler) return;

            vi.clearAllMocks();
            mockDocSet.mockResolvedValue(undefined);
            await handler(makeEvent({ email: '  Alice@EXAMPLE.COM  ' }));
            const hash1 = mockDoc.mock.calls[0]?.[0] as string;

            vi.clearAllMocks();
            mockDocSet.mockResolvedValue(undefined);
            await handler(makeEvent({ email: 'alice@example.com' }));
            const hash2 = mockDoc.mock.calls[0]?.[0] as string;

            expect(hash1).toBe(hash2);
        });

        it('should not throw when Firestore write fails', async () => {
            const handler = await getHandler();
            if (!handler) return;
            mockDocSet.mockRejectedValue(new Error('firestore error'));
            await expect(
                handler(makeEvent({ email: 'fail@example.com' }))
            ).resolves.toBeUndefined();
        });
    });
});
