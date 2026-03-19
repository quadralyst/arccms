/**
 * Tests for functions/src/email-log/processBroadcast.ts
 *
 * Covers:
 * - Trigger registration on 'BroadcastEmails/{broadcastId}' via onDocumentCreated
 * - Skips processing when event data is null
 * - Skips processing when status is not 'queued'
 * - Resolves provider rate limits from Settings/email via resolveProviderLimits
 * - Uses providerRateLimitsSnapshot from broadcast doc (takes priority)
 * - Falls back to legacy rateLimitSnapshot via legacyToProviderLimits
 * - Marks document as 'processing' before starting
 * - On timeout: sets status to 'paused', creates continuation doc
 * - On quotaExhausted: sets status to 'paused' with quota message, creates continuation doc
 * - On completion: sets status to 'completed'
 * - On fatal error: sets status to 'failed' with error message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
    mockCollectionDoc,
    mockCollectionAdd,
    mockDocGet,
    mockDocUpdate,
    mockRunTransaction,
    mockProcessRecipientBatch,
    mockResolveProviderLimits,
    mockLegacyToProviderLimits,
    mockCheckQuota,
} = vi.hoisted(() => ({
    mockCollectionDoc: vi.fn(),
    mockCollectionAdd: vi.fn(),
    mockDocGet: vi.fn(),
    mockDocUpdate: vi.fn(),
    mockRunTransaction: vi.fn(),
    mockProcessRecipientBatch: vi.fn(),
    mockResolveProviderLimits: vi.fn(),
    mockLegacyToProviderLimits: vi.fn(),
    mockCheckQuota: vi.fn(),
}));

vi.mock('../init', () => {
    const docRef = {
        get: mockDocGet,
        update: mockDocUpdate,
    };
    mockCollectionDoc.mockReturnValue(docRef);
    return {
        db: {
            collection: vi.fn().mockImplementation((name: string) => ({
                doc: mockCollectionDoc,
                add: mockCollectionAdd,
            })),
            runTransaction: mockRunTransaction,
        },
    };
});

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
    resolveProviderLimits: mockResolveProviderLimits,
    legacyToProviderLimits: mockLegacyToProviderLimits,
    checkQuota: mockCheckQuota,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { processBroadcast } from '../email-log/processBroadcast.js';

// The mock of onDocumentCreated returns the handler directly
const handler = processBroadcast as unknown as (event: any) => Promise<void>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(data: Record<string, any> | null, broadcastId = 'bc-123') {
    return {
        data: data === null
            ? undefined
            : { data: () => data },
        params: { broadcastId },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processBroadcast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDocUpdate.mockResolvedValue(undefined);
        mockCollectionAdd.mockResolvedValue({ id: 'cont-1' });
        mockDocGet.mockResolvedValue({
            data: () => undefined,
        });
        // Default: resolveProviderLimits returns a simple per-second limit
        mockResolveProviderLimits.mockReturnValue({ perSecond: 1 });
        // Default: legacyToProviderLimits converts legacy config
        mockLegacyToProviderLimits.mockReturnValue({ perSecond: 1 });
        // Default: checkQuota returns ok (under quota)
        mockCheckQuota.mockResolvedValue({ ok: true, dailyCount: 0, hourlyCount: 0 });
        // Default: transaction succeeds (status is 'queued', so it acquires the lock)
        mockRunTransaction.mockImplementation(async (fn: any) => {
            const txn = {
                get: vi.fn().mockResolvedValue({ data: () => ({ status: 'queued' }) }),
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
                path.resolve(__dirname, '../email-log/processBroadcast.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("from 'firebase-functions/v2/firestore'");
            expect(fileContent).toContain('onDocumentCreated');
        });

        it('should register on BroadcastEmails/{broadcastId} path', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/processBroadcast.ts'),
                'utf-8',
            );
            expect(fileContent).toContain("'BroadcastEmails/{broadcastId}'");
        });

        it('should export processBroadcast', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('node:url');
            const { dirname } = await import('node:path');
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const fileContent = fs.readFileSync(
                path.resolve(__dirname, '../email-log/processBroadcast.ts'),
                'utf-8',
            );
            expect(fileContent).toContain('export const processBroadcast');
        });
    });

    describe('handler: early exits', () => {
        it('should return early when event data is undefined', async () => {
            await handler(makeEvent(null));

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            expect(mockDocUpdate).not.toHaveBeenCalled();
        });

        it('should skip processing when status is not "queued"', async () => {
            await handler(makeEvent({ status: 'completed', recipients: [] }));

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
            // Should not call update to set status to 'processing'
            expect(mockDocUpdate).not.toHaveBeenCalled();
        });

        it('should skip when status is "processing"', async () => {
            await handler(makeEvent({ status: 'processing', recipients: [] }));
            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });

        it('should skip when status is "paused"', async () => {
            await handler(makeEvent({ status: 'paused', recipients: [] }));
            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });

        it('should skip when status is "failed"', async () => {
            await handler(makeEvent({ status: 'failed', recipients: [] }));
            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });
    });

    describe('handler: rate limit resolution', () => {
        it('should call resolveProviderLimits with activeProvider and providerRateLimits from Settings', async () => {
            const providerRateLimits = { smtp: { perSecond: 5 } };
            mockDocGet.mockResolvedValue({
                data: () => ({ activeProvider: 'ses', providerRateLimits }),
            });
            mockResolveProviderLimits.mockReturnValue({ perSecond: 5 });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            expect(mockResolveProviderLimits).toHaveBeenCalledWith('ses', providerRateLimits);
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: { perSecond: 5 },
                }),
            );
        });

        it('should use default providerLimits when Settings read fails', async () => {
            mockDocGet.mockRejectedValue(new Error('Firestore read error'));

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            // resolveProviderLimits should NOT be called because the try block failed
            expect(mockResolveProviderLimits).not.toHaveBeenCalled();
            // Falls back to the default { perSecond: 1 }
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: { perSecond: 1 },
                }),
            );
        });

        it('should call resolveProviderLimits with default "smtp" when activeProvider is missing', async () => {
            mockDocGet.mockResolvedValue({
                data: () => ({}),
            });
            mockResolveProviderLimits.mockReturnValue({ perSecond: 1 });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            expect(mockResolveProviderLimits).toHaveBeenCalledWith('smtp', undefined);
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: { perSecond: 1 },
                }),
            );
        });

        it('should use providerRateLimitsSnapshot from doc when available', async () => {
            mockDocGet.mockResolvedValue({
                data: () => ({ activeProvider: 'smtp' }),
            });
            mockResolveProviderLimits.mockReturnValue({ perSecond: 1 });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                providerRateLimitsSnapshot: { perSecond: 5 },
            }));

            // The snapshot from the doc should override what resolveProviderLimits returned
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: { perSecond: 5 },
                }),
            );
        });

        it('should fall back to legacy rateLimitSnapshot via legacyToProviderLimits', async () => {
            const legacyRateLimit = { maxEmails: 3, interval: 'second' };
            mockDocGet.mockResolvedValue({
                data: () => ({ activeProvider: 'smtp' }),
            });
            mockResolveProviderLimits.mockReturnValue({ perSecond: 1 });
            mockLegacyToProviderLimits.mockReturnValue({ perSecond: 3 });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                rateLimitSnapshot: legacyRateLimit,
                // no providerRateLimitsSnapshot
            }));

            expect(mockLegacyToProviderLimits).toHaveBeenCalledWith(legacyRateLimit);
            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerLimits: { perSecond: 3 },
                }),
            );
        });
    });

    describe('handler: processing flow', () => {
        it('should atomically claim broadcast via transaction before calling processRecipientBatch', async () => {
            let transactionCalledBeforeBatch = false;

            mockProcessRecipientBatch.mockImplementation(async () => {
                // Verify transaction was called before processRecipientBatch
                transactionCalledBeforeBatch = mockRunTransaction.mock.calls.length > 0;
                return { processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false };
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            expect(transactionCalledBeforeBatch).toBe(true);
            expect(mockRunTransaction).toHaveBeenCalledTimes(1);
        });

        it('should write providerRateLimitsSnapshot in the transaction update', async () => {
            mockResolveProviderLimits.mockReturnValue({ perSecond: 10 });
            mockDocGet.mockResolvedValue({
                data: () => ({ activeProvider: 'ses', providerRateLimits: { ses: { perSecond: 10 } } }),
            });

            let txnUpdateArgs: any = null;
            mockRunTransaction.mockImplementation(async (fn: any) => {
                const txn = {
                    get: vi.fn().mockResolvedValue({ data: () => ({ status: 'queued' }) }),
                    update: vi.fn((_ref: any, data: any) => { txnUpdateArgs = data; }),
                };
                return fn(txn);
            });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            expect(txnUpdateArgs).toBeDefined();
            expect(txnUpdateArgs.providerRateLimitsSnapshot).toEqual({ perSecond: 10 });
            expect(txnUpdateArgs.status).toBe('processing');
        });

        it('should skip processing when transaction returns false (already claimed)', async () => {
            mockRunTransaction.mockImplementation(async (fn: any) => {
                const txn = {
                    get: vi.fn().mockResolvedValue({ data: () => ({ status: 'processing' }) }),
                    update: vi.fn(),
                };
                return fn(txn);
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            expect(mockProcessRecipientBatch).not.toHaveBeenCalled();
        });

        it('should pass correct params to processRecipientBatch', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 3, sentCount: 3, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [
                    { toName: 'A', toEmail: 'a@t.com' },
                    { toName: 'B', toEmail: 'b@t.com' },
                    { toName: 'C', toEmail: 'c@t.com' },
                ],
                totalCount: 3,
                processedIndex: 1,
                sentCount: 1,
                failedCount: 0,
            }, 'bc-456'));

            expect(mockProcessRecipientBatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    broadcastId: 'bc-456',
                    providerLimits: { perSecond: 1 },
                    startIndex: 1,
                    initialSentCount: 1,
                    initialFailedCount: 0,
                    quotaChecker: expect.any(Function),
                }),
            );
        });

        it('should default processedIndex, sentCount, failedCount to 0 when missing', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                // no processedIndex, sentCount, failedCount
            }));

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
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 3, sentCount: 3, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [
                    { toName: 'A', toEmail: 'a@t.com' },
                    { toName: 'B', toEmail: 'b@t.com' },
                    { toName: 'C', toEmail: 'c@t.com' },
                ],
                totalCount: 3,
                chunkNumber: 0,
            }));

            // Last update call should set status to completed
            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.status).toBe('completed');
            expect(lastUpdate.processedIndex).toBe(3);
            expect(lastUpdate.sentCount).toBe(3);
            expect(lastUpdate.failedCount).toBe(0);
            expect(lastUpdate.chunkNumber).toBe(1);
        });

        it('should not create a continuation doc on completion', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            expect(mockCollectionAdd).not.toHaveBeenCalled();
        });
    });

    describe('handler: timeout and continuation', () => {
        it('should set status to "paused" when processRecipientBatch times out', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 50, sentCount: 48, failedCount: 2, timedOut: true,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: Array.from({ length: 100 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 100,
                chunkNumber: 2,
            }));

            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.status).toBe('paused');
            expect(lastUpdate.processedIndex).toBe(50);
            expect(lastUpdate.sentCount).toBe(48);
            expect(lastUpdate.failedCount).toBe(2);
            expect(lastUpdate.chunkNumber).toBe(3);
        });

        it('should create a continuation document in _broadcast_continue collection', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 50, sentCount: 50, failedCount: 0, timedOut: true,
            });

            const { db } = await import('../init.js');

            await handler(makeEvent({
                status: 'queued',
                recipients: Array.from({ length: 100 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 100,
            }, 'bc-789'));

            expect(db.collection).toHaveBeenCalledWith('_broadcast_continue');
            expect(mockCollectionAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    broadcastId: 'bc-789',
                }),
            );
        });
    });

    describe('handler: quota exhausted', () => {
        it('should set status to "paused" with quota error message when quotaExhausted', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 5, sentCount: 5, failedCount: 0, timedOut: false, quotaExhausted: true,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: Array.from({ length: 20 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 20,
                chunkNumber: 1,
            }));

            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.status).toBe('paused');
            expect(lastUpdate.processedIndex).toBe(5);
            expect(lastUpdate.sentCount).toBe(5);
            expect(lastUpdate.failedCount).toBe(0);
            expect(lastUpdate.chunkNumber).toBe(2);
            expect(lastUpdate.errorMessage).toContain('quota');
        });

        it('should create a continuation doc when quotaExhausted', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 5, sentCount: 5, failedCount: 0, timedOut: false, quotaExhausted: true,
            });

            const { db } = await import('../init.js');

            await handler(makeEvent({
                status: 'queued',
                recipients: Array.from({ length: 20 }, (_, i) => ({
                    toName: `User${i}`, toEmail: `user${i}@t.com`,
                })),
                totalCount: 20,
            }, 'bc-quota'));

            expect(db.collection).toHaveBeenCalledWith('_broadcast_continue');
            expect(mockCollectionAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    broadcastId: 'bc-quota',
                }),
            );
        });

        it('should pass a quotaChecker callback to processRecipientBatch', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            const callArgs = mockProcessRecipientBatch.mock.calls[0][0];
            expect(callArgs.quotaChecker).toBeDefined();
            expect(typeof callArgs.quotaChecker).toBe('function');
        });

        it('quotaChecker should delegate to checkQuota and return ok value', async () => {
            mockCheckQuota.mockResolvedValue({ ok: false, dailyCount: 500, hourlyCount: 100 });

            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false, quotaExhausted: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            const callArgs = mockProcessRecipientBatch.mock.calls[0][0];
            const quotaOk = await callArgs.quotaChecker();
            expect(mockCheckQuota).toHaveBeenCalled();
            expect(quotaOk).toBe(false);
        });
    });

    describe('handler: fatal error', () => {
        it('should set status to "failed" with error message on fatal error', async () => {
            mockProcessRecipientBatch.mockRejectedValue(new Error('Something broke'));

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.status).toBe('failed');
            expect(lastUpdate.errorMessage).toBe('Something broke');
        });

        it('should handle non-Error thrown values', async () => {
            mockProcessRecipientBatch.mockRejectedValue('string error');

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
            }));

            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.status).toBe('failed');
            expect(lastUpdate.errorMessage).toBe('string error');
        });
    });

    describe('handler: chunkNumber increments', () => {
        it('should default chunkNumber to 0 when not present and increment to 1', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                // no chunkNumber
            }));

            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.chunkNumber).toBe(1);
        });

        it('should increment existing chunkNumber', async () => {
            mockProcessRecipientBatch.mockResolvedValue({
                processedIndex: 1, sentCount: 1, failedCount: 0, timedOut: false,
            });

            await handler(makeEvent({
                status: 'queued',
                recipients: [{ toName: 'A', toEmail: 'a@t.com' }],
                totalCount: 1,
                chunkNumber: 5,
            }));

            const lastUpdate = mockDocUpdate.mock.calls[mockDocUpdate.mock.calls.length - 1][0];
            expect(lastUpdate.chunkNumber).toBe(6);
        });
    });
});
