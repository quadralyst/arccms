/**
 * Tests for functions/src/email-log/continueBroadcast.ts
 *
 * Covers:
 * - Trigger registration on '_broadcast_continue/{docId}' via onDocumentCreated
 * - Returns early (and deletes trigger doc) when broadcastId is missing
 * - Returns early (and deletes trigger doc) when broadcast document does not exist
 * - Skips (and deletes trigger doc) when broadcast status is not 'paused'
 * - Uses providerRateLimitsSnapshot from broadcast doc, falls back to legacy rateLimitSnapshot
 *   (via legacyToProviderLimits), then default { perSecond: 1 }
 * - Reads activeProvider from Settings/email doc for quota checking
 * - Passes quotaChecker callback to processRecipientBatch
 * - Marks document as 'processing' before starting
 * - On timeout: sets status to 'paused', creates another continuation doc (self-chaining)
 * - On quotaExhausted: pauses broadcast with quota message, chains continuation
 * - On completion: sets status to 'completed'
 * - On fatal error: sets status to 'failed' with error message
 * - Always deletes the trigger document at the end
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
    mockBroadcastGet,
    mockBroadcastUpdate,
    mockContinueAdd,
    mockTriggerDelete,
    mockRunTransaction,
    mockProcessRecipientBatch,
    mockLegacyToProviderLimits,
    mockCheckQuota,
    mockSettingsGet,
} = vi.hoisted(() => ({
    mockBroadcastGet: vi.fn(),
    mockBroadcastUpdate: vi.fn(),
    mockContinueAdd: vi.fn(),
    mockTriggerDelete: vi.fn(),
    mockRunTransaction: vi.fn(),
    mockProcessRecipientBatch: vi.fn(),
    mockLegacyToProviderLimits: vi.fn(),
    mockCheckQuota: vi.fn(),
    mockSettingsGet: vi.fn(),
}));

const broadcastDocRef = {
    get: mockBroadcastGet,
    update: mockBroadcastUpdate,
};

vi.mock('../init', () => ({
    db: {
        collection: vi.fn().mockImplementation((name: string) => {
            if (name === 'BroadcastEmails') {
                return { doc: vi.fn().mockReturnValue(broadcastDocRef) };
            }
            if (name === '_broadcast_continue') {
                return { add: mockContinueAdd };
            }
            if (name === 'Settings') {
                return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
            }
            return { doc: vi.fn() };
        }),
        runTransaction: mockRunTransaction,
    },
}));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: vi.fn(),
    Timestamp: {
        now: vi.fn(() => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })),
    },
    FieldValue: {
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((_path: string, handler: any) => handler),
}));

vi.mock('../email-log/broadcastHelper', () => ({
    processRecipientBatch: mockProcessRecipientBatch,
}));

vi.mock('../mail-config/emailCounter', () => ({
    legacyToProviderLimits: mockLegacyToProviderLimits,
    checkQuota: mockCheckQuota,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { continueBroadcast } from '../email-log/continueBroadcast.js';

// The mock of onDocumentCreated returns the handler directly
const handler = continueBroadcast as unknown as (event: any) => Promise<void>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(
    triggerData: Record<string, any> | null,
    options?: { noRef?: boolean },
) {
    const ref = options?.noRef ? undefined : { delete: mockTriggerDelete };
    return {
        data: triggerData === null
            ? undefined
            : {
                data: () => triggerData,
                ref,
            },
        params: { docId: 'trigger-1' },
    };
}

function setupBroadcastSnap(
    exists: boolean,
    data?: Record<string, any>,
) {
    mockBroadcastGet.mockResolvedValue({
        exists,
        data: () => data,
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('continueBroadcast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBroadcastUpdate.mockResolvedValue(undefined);
        mockContinueAdd.mockResolvedValue({ id: 'cont-2' });
        mockTriggerDelete.mockResolvedValue(undefined);
        // Default: legacyToProviderLimits returns a simple per-second limit
        mockLegacyToProviderLimits.mockReturnValue({ perSecond: 1 });
        // Default: checkQuota reports quota available
        mockCheckQuota.mockResolvedValue({ ok: true, dailyCount: 0, hourlyCount: 0 });
        // Default: Settings returns activeProvider 'smtp'
        mockSettingsGet.mockResolvedValue({
            exists: true,
            data: () => ({ activeProvider: 'smtp' }),
        });
        // Default: transaction succeeds (status is 'paused', so it acquires the lock)
        mockRunTransaction.mockImplementation(async (fn: any) => {
            const txn = {
                get: vi.fn().mockResolvedValue({ data: () => ({ status: 'paused' }) }),
                update: vi.fn(),
            };
            return fn(txn);
        });
    });

    describe('source code structure', () => {
        it('should use onDocumentCreated from firebase-functions/v2/firestore', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/continueBroadcast.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
            expect(fileContent).toContain('onDocumentCreated');
        });

        it('should register on _broadcast_continue/{docId} path', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/continueBroadcast.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("'_broadcast_continue/{docId}'");
        });

        it('should export continueBroadcast', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/continueBroadcast.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('export const continueBroadcast');
        });
    });

    describe('handler: early exits', () => {
        it('should return early and delete trigger doc when broadcastId is missing', async () => {
            const event = makeEvent({}); // no broadcastId
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should return early and delete trigger doc when broadcastId is null', async () => {
            const event = makeEvent({ broadcastId: null });
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should return early and delete trigger doc when broadcast document does not exist', async () => {
            setupBroadcastSnap(false);
            const event = makeEvent({ broadcastId: 'bc-missing' });
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should skip and delete trigger doc when broadcast status is not "paused"', async () => {
            setupBroadcastSnap(true, {
                status: 'completed',
                recipients: [],
                totalCount: 0,
            });
            const event = makeEvent({ broadcastId: 'bc-done' });
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should skip when status is "processing"', async () => {
            setupBroadcastSnap(true, {
                status: 'processing',
                recipients: [],
                totalCount: 0,
            });
            const event = makeEvent({ broadcastId: 'bc-running' });
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });

        it('should skip when status is "queued"', async () => {
            setupBroadcastSnap(true, {
                status: 'queued',
                recipients: [],
                totalCount: 0,
            });
            const event = makeEvent({ broadcastId: 'bc-queued' });
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });

        it('should handle event.data being undefined', async () => {
            const event = makeEvent(null);
            await handler(event);

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });
    });

    describe('handler: rate limit resolution', () => {
        it('should use providerRateLimitsSnapshot from broadcast doc', async () => {
            const snapshotLimits = { perSecond: 5, perDay: 1000 };
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                providerRateLimitsSnapshot: snapshotLimits,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: snapshotLimits,
                }),
            );
            // Should NOT call legacyToProviderLimits when providerRateLimitsSnapshot is present
            expect(mockLegacyToProviderLimits).not.toHaveBeenCalled();
        });

        it('should fall back to legacy rateLimitSnapshot via legacyToProviderLimits', async () => {
            const legacyRateLimit = { maxEmails: 20, interval: 'minute' };
            const convertedLimits = { perSecond: 1 };
            mockLegacyToProviderLimits.mockReturnValue(convertedLimits);

            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                rateLimitSnapshot: legacyRateLimit,
                // no providerRateLimitsSnapshot
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockLegacyToProviderLimits).toHaveBeenCalledWith(legacyRateLimit);
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: convertedLimits,
                }),
            );
        });

        it('should use default { perSecond: 1 } when neither snapshot is present', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                // no rateLimitSnapshot, no providerRateLimitsSnapshot
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: { perSecond: 1 },
                }),
            );
            // Should NOT call legacyToProviderLimits when there's no legacy snapshot either
            expect(mockLegacyToProviderLimits).not.toHaveBeenCalled();
        });

        it('should read activeProvider from Settings doc', async () => {
            mockSettingsGet.mockResolvedValue({
                exists: true,
                data: () => ({ activeProvider: 'resend' }),
            });

            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                providerRateLimitsSnapshot: { perSecond: 2 },
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            // Verify the quota checker is passed and uses the correct provider
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    quotaChecker: expect.any(Function),
                }),
            );

            // Exercise the quotaChecker callback to verify it uses 'resend'
            const callArgs = mockProcessRecipientBatch.mock.calls[0][0];
            await callArgs.quotaChecker();
            expect(mockCheckQuota).toHaveBeenCalledWith('resend', { perSecond: 2 });
        });

        it('should default activeProvider to smtp when Settings doc has no activeProvider', async () => {
            mockSettingsGet.mockResolvedValue({
                exists: true,
                data: () => ({}),
            });

            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                providerRateLimitsSnapshot: { perSecond: 1 },
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const callArgs = mockProcessRecipientBatch.mock.calls[0][0];
            await callArgs.quotaChecker();
            expect(mockCheckQuota).toHaveBeenCalledWith('smtp', expect.any(Object));
        });

        it('should default activeProvider to smtp when Settings read fails', async () => {
            mockSettingsGet.mockRejectedValue(new Error('Firestore error'));

            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                providerRateLimitsSnapshot: { perSecond: 1 },
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const callArgs = mockProcessRecipientBatch.mock.calls[0][0];
            await callArgs.quotaChecker();
            expect(mockCheckQuota).toHaveBeenCalledWith('smtp', expect.any(Object));
        });
    });

    describe('handler: processing flow', () => {
        it('should atomically claim broadcast via transaction before calling processRecipientBatch', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            let transactionCalledBeforeBatch = false;
            mockProcessRecipientBatch.mockImplementation(async () => {
                transactionCalledBeforeBatch = mockRunTransaction.mock.calls.length > 0;
                return { processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false };
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(transactionCalledBeforeBatch).toBe(true);
            expect(mockRunTransaction).toHaveBeenCalledTimes(1);
        });

        it('should skip processing when transaction returns false (already claimed)', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockRunTransaction.mockImplementation(async (fn: any) => {
                const txn = {
                    get: vi.fn().mockResolvedValue({ data: () => ({ status: 'processing' }) }),
                    update: vi.fn(),
                };
                return fn(txn);
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should pass correct params to processRecipientBatch', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [
                    { toName: 'A', toEmail: 'a@t.com' },
                    { toName: 'B', toEmail: 'b@t.com' },
                ],
                totalCount: 2,
                processedIndex: 1,
                sentCount: 1,
                failedCount: 0,
                providerRateLimitsSnapshot: { perSecond: 3 },
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 2, sentCount: 2, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-456' }));

            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    broadcastId: 'bc-456',
                    startIndex: 1,
                    initialSentCount: 1,
                    initialFailedCount: 0,
                    providerLimits: { perSecond: 3 },
                    quotaChecker: expect.any(Function),
                }),
            );
        });

        it('should default processedIndex, sentCount, failedCount to 0 when missing', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                // no processedIndex, sentCount, failedCount
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    startIndex: 0,
                    initialSentCount: 0,
                    initialFailedCount: 0,
                }),
            );
        });
    });

    describe('handler: completion', () => {
        it('should set status to "completed" when all recipients are processed', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 2,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            // Find the update call that sets status to completed (after the "processing" one)
            const updateCalls = mockBroadcastUpdate.mock.calls;
            const completedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'completed',
            );
            expect(completedCall).toBeDefined();
            expect(completedCall![0].processedIndex).toBe(1);
            expect(completedCall![0].sentCount).toBe(1);
            expect(completedCall![0].failedCount).toBe(0);
            expect(completedCall![0].chunkNumber).toBe(3);
        });

        it('should not create a continuation doc on completion', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockContinueAdd).not.toHaveBeenCalled();
        });

        it('should delete the trigger document on completion', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockTriggerDelete).toHaveBeenCalled();
        });
    });

    describe('handler: timeout and self-chaining', () => {
        it('should set status to "paused" when processRecipientBatch times out', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: Array.from({ length: 100 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 100,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 1,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 50, sentCount: 48, failedCount: 2, timedOut: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const updateCalls = mockBroadcastUpdate.mock.calls;
            const pausedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'paused',
            );
            expect(pausedCall).toBeDefined();
            expect(pausedCall![0].processedIndex).toBe(50);
            expect(pausedCall![0].sentCount).toBe(48);
            expect(pausedCall![0].failedCount).toBe(2);
            expect(pausedCall![0].chunkNumber).toBe(2);
        });

        it('should create another continuation document for self-chaining', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: Array.from({ length: 100 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 100,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 50, sentCount: 50, failedCount: 0, timedOut: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-789' }));

            expect(mockContinueAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    broadcastId: 'bc-789',
                }),
            );
        });

        it('should delete the trigger document even after timeout', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 0, sentCount: 0, failedCount: 0, timedOut: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockTriggerDelete).toHaveBeenCalled();
        });
    });

    describe('handler: quota exhausted', () => {
        it('should handle quotaExhausted result by pausing with quota message', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: Array.from({ length: 50 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 50,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 3,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 20, sentCount: 18, failedCount: 2, timedOut: false, quotaExhausted: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-quota' }));

            // Verify broadcast is paused with quota-specific error message
            const updateCalls = mockBroadcastUpdate.mock.calls;
            const pausedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'paused' && call[0].errorMessage,
            );
            expect(pausedCall).toBeDefined();
            expect(pausedCall![0].processedIndex).toBe(20);
            expect(pausedCall![0].sentCount).toBe(18);
            expect(pausedCall![0].failedCount).toBe(2);
            expect(pausedCall![0].chunkNumber).toBe(4);
            expect(pausedCall![0].errorMessage).toContain('quota');
        });

        it('should create continuation document when quota is exhausted', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: Array.from({ length: 50 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 50,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 20, sentCount: 20, failedCount: 0, timedOut: false, quotaExhausted: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-quota' }));

            expect(mockContinueAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    broadcastId: 'bc-quota',
                }),
            );
        });

        it('should delete the trigger document when quota is exhausted', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 0, sentCount: 0, failedCount: 0, timedOut: false, quotaExhausted: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should prioritize quotaExhausted over timedOut when both are true', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: Array.from({ length: 50 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 50,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 1,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 10, sentCount: 10, failedCount: 0, timedOut: true, quotaExhausted: true,
            });

            await handler(makeEvent({ broadcastId: 'bc-both' }));

            // The quotaExhausted branch is checked first in the source code
            const updateCalls = mockBroadcastUpdate.mock.calls;
            const pausedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'paused',
            );
            expect(pausedCall).toBeDefined();
            expect(pausedCall![0].errorMessage).toContain('quota');
        });
    });

    describe('handler: fatal error', () => {
        it('should set status to "failed" with error message', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockRejectedValue(new Error('Fatal processing error'));

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const updateCalls = mockBroadcastUpdate.mock.calls;
            const failedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'failed',
            );
            expect(failedCall).toBeDefined();
            expect(failedCall![0].errorMessage).toBe('Fatal processing error');
        });

        it('should handle non-Error thrown values', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockRejectedValue('string error');

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const updateCalls = mockBroadcastUpdate.mock.calls;
            const failedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'failed',
            );
            expect(failedCall).toBeDefined();
            expect(failedCall![0].errorMessage).toBe('string error');
        });

        it('should delete the trigger document even after fatal error', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
            });

            mockProcessRecipientBatch.mockRejectedValue(new Error('Kaboom'));

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockTriggerDelete).toHaveBeenCalled();
        });
    });

    describe('handler: max chunks circuit breaker', () => {
        it('should mark broadcast as failed when chunkNumber >= 200', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 200,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            const failedCall = mockBroadcastUpdate.mock.calls.find(
                (call: any[]) => call[0].status === 'failed',
            );
            expect(failedCall).toBeDefined();
            expect(failedCall![0].errorMessage).toContain('Exceeded maximum processing chunks');
            expect(mockTriggerDelete).toHaveBeenCalled();
        });

        it('should allow processing when chunkNumber < 200', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 199,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            expect(mockProcessRecipientBatch).toHaveBeenCalled();
        });
    });

    describe('handler: chunkNumber increments', () => {
        it('should default chunkNumber to 0 when not present and increment to 1', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                // no chunkNumber
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const updateCalls = mockBroadcastUpdate.mock.calls;
            const completedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'completed',
            );
            expect(completedCall![0].chunkNumber).toBe(1);
        });

        it('should increment existing chunkNumber', async () => {
            setupBroadcastSnap(true, {
                status: 'paused',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                processedIndex: 0,
                sentCount: 0,
                failedCount: 0,
                chunkNumber: 7,
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({ broadcastId: 'bc-1' }));

            const updateCalls = mockBroadcastUpdate.mock.calls;
            const completedCall = updateCalls.find(
                (call: any[]) => call[0].status === 'completed',
            );
            expect(completedCall![0].chunkNumber).toBe(8);
        });
    });
});
