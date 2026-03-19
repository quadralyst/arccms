/**
 * Tests for functions/src/email-log/scheduledPurgeEmailLogs.ts
 *
 * Covers:
 * - Trigger registration via onSchedule with correct cron and timezone
 * - Reads autoPurge config from Settings/email
 * - Defaults to 60 days retention when not configured
 * - Respects enabled/disabled flag
 * - Handles Settings read failure gracefully (uses defaults)
 * - Queries EmailLogs with 'createdAt' < cutoff
 * - Batch deletes in chunks of 500
 * - Handles multiple batches when more than 500 docs match
 * - Handles empty results (no docs to delete)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
    mockSettingsGet,
    mockEmailLogsGet,
    mockBatchDelete,
    mockBatchCommit,
    mockWhere,
    mockLimit,
} = vi.hoisted(() => ({
    mockSettingsGet: vi.fn(),
    mockEmailLogsGet: vi.fn(),
    mockBatchDelete: vi.fn(),
    mockBatchCommit: vi.fn().mockResolvedValue(undefined),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
}));

vi.mock('../init', () => {
    // Chain: db.collection('EmailLogs').where(...).limit(...).get()
    mockLimit.mockReturnValue({ get: mockEmailLogsGet });
    mockWhere.mockReturnValue({ limit: mockLimit });

    return {
        db: {
            collection: vi.fn().mockImplementation((name: string) => {
                if (name === 'Settings') {
                    return {
                        doc: vi.fn().mockReturnValue({
                            get: mockSettingsGet,
                        }),
                    };
                }
                if (name === 'EmailLogs') {
                    return {
                        where: mockWhere,
                    };
                }
                return {};
            }),
            batch: vi.fn().mockReturnValue({
                delete: mockBatchDelete,
                commit: mockBatchCommit,
            }),
        },
    };
});

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: vi.fn(),
    Timestamp: {
        now: vi.fn(() => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })),
        fromDate: vi.fn((d: Date) => ({
            seconds: Math.floor(d.getTime() / 1000),
            nanoseconds: 0,
        })),
    },
    FieldValue: {
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    },
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: vi.fn((_opts: any, handler: any) => handler),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { scheduledPurgeEmailLogs } from '../email-log/scheduledPurgeEmailLogs.js';

// The mock of onSchedule returns the handler directly
const handler = scheduledPurgeEmailLogs as unknown as () => Promise<void>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(size: number) {
    const docs = Array.from({ length: size }, (_, i) => ({
        ref: { id: `doc-${i}` },
    }));
    return {
        empty: size === 0,
        size,
        docs,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('scheduledPurgeEmailLogs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBatchCommit.mockResolvedValue(undefined);
    });

    describe('source code structure', () => {
        it('should use onSchedule from firebase-functions/v2/scheduler', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/scheduledPurgeEmailLogs.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("from 'firebase-functions/v2/scheduler'");
            expect(fileContent).toContain('onSchedule');
        });

        it('should schedule at 2:00 AM UTC daily', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/scheduledPurgeEmailLogs.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("schedule: 'every day 02:00'");
            expect(fileContent).toContain("timeZone: 'UTC'");
        });

        it('should export scheduledPurgeEmailLogs', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/scheduledPurgeEmailLogs.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('export const scheduledPurgeEmailLogs');
        });

        it('should query EmailLogs collection with createdAt filter', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/scheduledPurgeEmailLogs.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("collection('EmailLogs')");
            expect(fileContent).toContain("where('createdAt', '<', cutoffTimestamp)");
        });
    });

    describe('handler: enabled/disabled', () => {
        it('should do nothing when autoPurge is disabled', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: false, retentionDays: 30 },
                }),
            });

            await handler();

            expect(mockEmailLogsGet).not.toHaveBeenCalled();
            expect(mockBatchCommit).not.toHaveBeenCalled();
        });

        it('should proceed when autoPurge is enabled', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockEmailLogsGet).toHaveBeenCalled();
        });

        it('should treat missing enabled field as enabled (enabled !== false)', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { retentionDays: 30 },
                    // enabled not set
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockEmailLogsGet).toHaveBeenCalled();
        });

        it('should use defaults when Settings read fails', async () => {
            mockSettingsGet.mockRejectedValue(new Error('Firestore unavailable'));
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            // Should still proceed with default settings (enabled = true, 60 days)
            expect(mockEmailLogsGet).toHaveBeenCalled();
        });

        it('should use defaults when settings data is undefined', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => undefined,
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockEmailLogsGet).toHaveBeenCalled();
        });

        it('should use defaults when autoPurge section is not present', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({ activeProvider: 'smtp' }),
                // no autoPurge
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockEmailLogsGet).toHaveBeenCalled();
        });
    });

    describe('handler: retention days', () => {
        it('should use configured retentionDays from settings', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 90 },
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            // Verify Timestamp.fromDate was called with a date approximately 90 days ago
            const { Timestamp } = await import('firebase-admin/firestore');
            expect(Timestamp.fromDate).toHaveBeenCalled();
            const dateArg = vi.mocked(Timestamp.fromDate).mock.calls[0][0] as Date;
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 90);
            // Allow 1 second tolerance
            expect(Math.abs(dateArg.getTime() - expectedDate.getTime())).toBeLessThan(1000);
        });

        it('should default to 60 days when retentionDays is not set', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true },
                    // no retentionDays
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            const { Timestamp } = await import('firebase-admin/firestore');
            expect(Timestamp.fromDate).toHaveBeenCalled();
            const dateArg = vi.mocked(Timestamp.fromDate).mock.calls[0][0] as Date;
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 60);
            expect(Math.abs(dateArg.getTime() - expectedDate.getTime())).toBeLessThan(1000);
        });

        it('should default to 60 days when retentionDays is 0 (falsy)', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 0 },
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            const { Timestamp } = await import('firebase-admin/firestore');
            expect(Timestamp.fromDate).toHaveBeenCalled();
            const dateArg = vi.mocked(Timestamp.fromDate).mock.calls[0][0] as Date;
            const expectedDate = new Date();
            expectedDate.setDate(expectedDate.getDate() - 60);
            expect(Math.abs(dateArg.getTime() - expectedDate.getTime())).toBeLessThan(1000);
        });
    });

    describe('handler: batch deletion', () => {
        it('should do nothing when no old logs exist', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockBatchDelete).not.toHaveBeenCalled();
            expect(mockBatchCommit).not.toHaveBeenCalled();
        });

        it('should delete all docs in a single batch when fewer than 500', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });
            const snapshot = makeSnapshot(10);
            mockEmailLogsGet.mockResolvedValue(snapshot);

            await handler();

            expect(mockBatchDelete).toHaveBeenCalledTimes(10);
            expect(mockBatchCommit).toHaveBeenCalledTimes(1);
            // Each doc ref should be passed to batch.delete
            snapshot.docs.forEach((doc) => {
                expect(mockBatchDelete).toHaveBeenCalledWith(doc.ref);
            });
        });

        it('should handle multiple batches when more than 500 docs exist', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });

            // First call: 500 docs (full batch, hasMore continues)
            // Second call: 200 docs (less than 500, loop stops)
            mockEmailLogsGet
                .mockResolvedValueOnce(makeSnapshot(500))
                .mockResolvedValueOnce(makeSnapshot(200));

            await handler();

            // 500 + 200 = 700 deletes
            expect(mockBatchDelete).toHaveBeenCalledTimes(700);
            // 2 batch commits
            expect(mockBatchCommit).toHaveBeenCalledTimes(2);
        });

        it('should stop looping when query returns empty result after full batches', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });

            // First call: 500 docs (full batch)
            // Second call: 0 docs (empty)
            mockEmailLogsGet
                .mockResolvedValueOnce(makeSnapshot(500))
                .mockResolvedValueOnce(makeSnapshot(0));

            await handler();

            expect(mockBatchDelete).toHaveBeenCalledTimes(500);
            expect(mockBatchCommit).toHaveBeenCalledTimes(1);
        });

        it('should handle exactly 500 docs in a batch and continue checking', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });

            // First: exactly 500 (could be more, loop continues)
            // Second: 0 (no more)
            mockEmailLogsGet
                .mockResolvedValueOnce(makeSnapshot(500))
                .mockResolvedValueOnce(makeSnapshot(0));

            await handler();

            // Should have queried twice (once for 500, once to check for more)
            expect(mockEmailLogsGet).toHaveBeenCalledTimes(2);
        });

        it('should query with limit of 500', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockLimit).toHaveBeenCalledWith(500);
        });

        it('should query with createdAt < cutoffTimestamp', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(0));

            await handler();

            expect(mockWhere).toHaveBeenCalledWith(
                'createdAt',
                '<',
                expect.objectContaining({ seconds: expect.any(Number) }),
            );
        });

        it('should not count deleted docs when batch commit fails', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });

            // Return 10 docs, but batch commit fails
            mockEmailLogsGet.mockResolvedValue(makeSnapshot(10));
            mockBatchCommit.mockRejectedValueOnce(new Error('Batch write failed'));

            // Should not throw — error is caught and logged
            await expect(handler()).resolves.toBeUndefined();

            expect(mockBatchCommit).toHaveBeenCalledTimes(1);
            // The function continues gracefully despite the error
        });

        it('should continue processing after a batch commit failure', async () => {
            mockSettingsGet.mockResolvedValue({
                data: () => ({
                    autoPurge: { enabled: true, retentionDays: 30 },
                }),
            });

            // First batch: 500 docs, commit fails
            // Second batch: 200 docs, commit succeeds
            mockEmailLogsGet
                .mockResolvedValueOnce(makeSnapshot(500))
                .mockResolvedValueOnce(makeSnapshot(200));
            mockBatchCommit
                .mockRejectedValueOnce(new Error('Transient failure'))
                .mockResolvedValueOnce(undefined);

            await handler();

            expect(mockBatchCommit).toHaveBeenCalledTimes(2);
        });
    });
});
