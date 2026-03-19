/**
 * Tests for functions/src/email-log/broadcastHelper.ts
 *
 * Covers:
 * - getDelayMs: converts legacy rate limit configs to per-email delay in ms
 * - getDelayFromLimits: converts ProviderRateLimits to per-email delay in ms
 * - sleep: async delay utility
 * - processRecipientBatch: creates EmailLog docs with rate limiting, retries,
 *   periodic progress updates, time-budget enforcement, and quota checking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
    mockCollectionAdd,
    mockBroadcastRefUpdate,
} = vi.hoisted(() => ({
    mockCollectionAdd: vi.fn(),
    mockBroadcastRefUpdate: vi.fn(),
}));

vi.mock('../init', () => ({
    db: {
        collection: vi.fn().mockReturnValue({
            add: mockCollectionAdd,
        }),
    },
}));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: vi.fn(),
    Timestamp: {
        now: vi.fn(() => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })),
        fromDate: vi.fn((d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 })),
    },
    FieldValue: {
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
        increment: vi.fn((n: number) => ({ _increment: n })),
    },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { getDelayMs, getDelayFromLimits, sleep, processRecipientBatch } from '../email-log/broadcastHelper.js';
import type { BroadcastEmailDoc } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBroadcastData(overrides: Partial<BroadcastEmailDoc> = {}): BroadcastEmailDoc {
    return {
        waitlistId: 'wl-1',
        subject: 'Test Subject',
        senderName: 'Test Sender',
        senderEmail: 'sender@test.com',
        template: '<p>Hello</p>',
        previewText: 'Preview',
        recipients: [
            { toName: 'Alice', toEmail: 'alice@test.com' },
            { toName: 'Bob', toEmail: 'bob@test.com' },
            { toName: 'Charlie', toEmail: 'charlie@test.com' },
        ],
        totalCount: 3,
        sentCount: 0,
        failedCount: 0,
        processedIndex: 0,
        status: 'processing',
        chunkNumber: 0,
        createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
        ...overrides,
    };
}

function makeBroadcastRef() {
    return {
        update: mockBroadcastRefUpdate,
    } as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('broadcastHelper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollectionAdd.mockResolvedValue({ id: 'log-1' });
        mockBroadcastRefUpdate.mockResolvedValue(undefined);
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ─── getDelayMs ──────────────────────────────────────────────────────────

    describe('getDelayMs', () => {
        it('should calculate delay for "second" interval', () => {
            expect(getDelayMs({ maxEmails: 1, interval: 'second' })).toBe(1000);
            expect(getDelayMs({ maxEmails: 2, interval: 'second' })).toBe(500);
            expect(getDelayMs({ maxEmails: 10, interval: 'second' })).toBe(100);
        });

        it('should calculate delay for "minute" interval', () => {
            // 60_000 / 10 = 6000
            expect(getDelayMs({ maxEmails: 10, interval: 'minute' })).toBe(6000);
            // 60_000 / 1 = 60_000
            expect(getDelayMs({ maxEmails: 1, interval: 'minute' })).toBe(60000);
            // 60_000 / 60 = 1000
            expect(getDelayMs({ maxEmails: 60, interval: 'minute' })).toBe(1000);
        });

        it('should calculate delay for "hour" interval', () => {
            // 3_600_000 / 100 = 36_000
            expect(getDelayMs({ maxEmails: 100, interval: 'hour' })).toBe(36000);
            // 3_600_000 / 3600 = 1000
            expect(getDelayMs({ maxEmails: 3600, interval: 'hour' })).toBe(1000);
        });

        it('should calculate delay for "day" interval', () => {
            // 86_400_000 / 1000 = 86_400
            expect(getDelayMs({ maxEmails: 1000, interval: 'day' })).toBe(86400);
        });

        it('should use Math.ceil for non-integer results', () => {
            // 1000 / 3 = 333.33... -> 334
            expect(getDelayMs({ maxEmails: 3, interval: 'second' })).toBe(334);
        });

        it('should treat maxEmails <= 0 as 1 (Math.max guard)', () => {
            // Math.max(0, 1) = 1; 1000 / 1 = 1000
            expect(getDelayMs({ maxEmails: 0, interval: 'second' })).toBe(1000);
            expect(getDelayMs({ maxEmails: -5, interval: 'second' })).toBe(1000);
        });

        it('should default to 1000ms for unknown intervals', () => {
            // intervalMs[unknown] is undefined -> fallback 1000, then 1000 / maxEmails
            expect(getDelayMs({ maxEmails: 1, interval: 'unknown' as any })).toBe(1000);
            expect(getDelayMs({ maxEmails: 2, interval: 'unknown' as any })).toBe(500);
        });
    });

    // ─── getDelayFromLimits ─────────────────────────────────────────────────

    describe('getDelayFromLimits', () => {
        it('should convert perSecond=1 to 1000ms', () => {
            expect(getDelayFromLimits({ perSecond: 1 })).toBe(1000);
        });

        it('should convert perSecond=2 to 500ms', () => {
            expect(getDelayFromLimits({ perSecond: 2 })).toBe(500);
        });

        it('should clamp perSecond=0 to 1000ms (Math.max guard)', () => {
            // Math.max(0, 1) = 1; 1000 / 1 = 1000
            expect(getDelayFromLimits({ perSecond: 0 })).toBe(1000);
        });

        it('should clamp negative perSecond to 1000ms', () => {
            expect(getDelayFromLimits({ perSecond: -5 })).toBe(1000);
        });

        it('should use Math.ceil for non-integer results', () => {
            // 1000 / 3 = 333.33... -> 334
            expect(getDelayFromLimits({ perSecond: 3 })).toBe(334);
        });

        it('should handle high perSecond values', () => {
            // 1000 / 1000 = 1
            expect(getDelayFromLimits({ perSecond: 1000 })).toBe(1);
        });
    });

    // ─── sleep ───────────────────────────────────────────────────────────────

    describe('sleep', () => {
        it('should return a promise that resolves after the given ms', async () => {
            const p = sleep(100);
            vi.advanceTimersByTime(100);
            await expect(p).resolves.toBeUndefined();
        });

        it('should not resolve before the time has elapsed', async () => {
            let resolved = false;
            const p = sleep(500).then(() => { resolved = true; });
            vi.advanceTimersByTime(200);
            // Flush microtasks
            await Promise.resolve();
            expect(resolved).toBe(false);
            vi.advanceTimersByTime(300);
            await p;
            expect(resolved).toBe(true);
        });
    });

    // ─── processRecipientBatch ───────────────────────────────────────────────

    describe('processRecipientBatch', () => {
        it('should create an EmailLog for each recipient', async () => {
            const broadcastData = makeBroadcastData();
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 }, // fast rate
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            expect(mockCollectionAdd).toHaveBeenCalledTimes(3);
            expect(result.sentCount).toBe(3);
            expect(result.failedCount).toBe(0);
            expect(result.processedIndex).toBe(3);
            expect(result.timedOut).toBe(false);
            expect(result.quotaExhausted).toBe(false);
        });

        it('should include correct data in EmailLog documents', async () => {
            const broadcastData = makeBroadcastData({
                recipients: [{ toName: 'Alice', toEmail: 'alice@test.com' }],
                totalCount: 1,
            });
            const broadcastRef = makeBroadcastRef();

            await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            const addCall = mockCollectionAdd.mock.calls[0][0];
            expect(addCall.senderEmail).toBe('sender@test.com');
            expect(addCall.senderName).toBe('Test Sender');
            expect(addCall.toEmail).toBe('alice@test.com');
            expect(addCall.toName).toBe('Alice');
            expect(addCall.subject).toBe('Test Subject');
            expect(addCall.template).toBe('<p>Hello</p>');
            expect(addCall.text).toBe('Preview');
            expect(addCall.type).toBe('broadcast');
            expect(addCall.broadcastId).toBe('bc-1');
            expect(addCall.waitlistId).toBe('wl-1');
        });

        it('should use empty string for text when previewText is undefined', async () => {
            const broadcastData = makeBroadcastData({
                previewText: undefined,
                recipients: [{ toName: 'Alice', toEmail: 'alice@test.com' }],
                totalCount: 1,
            });
            const broadcastRef = makeBroadcastRef();

            await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            const addCall = mockCollectionAdd.mock.calls[0][0];
            expect(addCall.text).toBe('');
        });

        it('should start from the provided startIndex', async () => {
            const broadcastData = makeBroadcastData();
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 2, // skip first two
                initialSentCount: 2,
                initialFailedCount: 0,
            });

            // Only one recipient processed (index 2)
            expect(mockCollectionAdd).toHaveBeenCalledTimes(1);
            expect(result.sentCount).toBe(3); // 2 initial + 1
            expect(result.processedIndex).toBe(3);
        });

        it('should carry forward initial counts', async () => {
            const broadcastData = makeBroadcastData({
                recipients: [{ toName: 'Dave', toEmail: 'dave@test.com' }],
                totalCount: 1,
            });
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 10,
                initialFailedCount: 2,
            });

            expect(result.sentCount).toBe(11);
            expect(result.failedCount).toBe(2);
        });

        it('should retry up to 3 times on failure then increment failedCount', async () => {
            mockCollectionAdd.mockRejectedValue(new Error('Firestore write failed'));

            const broadcastData = makeBroadcastData({
                recipients: [{ toName: 'Alice', toEmail: 'alice@test.com' }],
                totalCount: 1,
            });
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            // 3 attempts
            expect(mockCollectionAdd).toHaveBeenCalledTimes(3);
            expect(result.sentCount).toBe(0);
            expect(result.failedCount).toBe(1);
        });

        it('should succeed on second retry attempt', async () => {
            mockCollectionAdd
                .mockRejectedValueOnce(new Error('Transient error'))
                .mockResolvedValueOnce({ id: 'log-1' });

            const broadcastData = makeBroadcastData({
                recipients: [{ toName: 'Alice', toEmail: 'alice@test.com' }],
                totalCount: 1,
            });
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            expect(mockCollectionAdd).toHaveBeenCalledTimes(2);
            expect(result.sentCount).toBe(1);
            expect(result.failedCount).toBe(0);
        });

        it('should time out and save progress when time budget is exceeded', async () => {
            vi.useRealTimers(); // need real timers for Date.now() advancement

            // Manually control Date.now
            let currentTime = 1000;
            const originalDateNow = Date.now;
            Date.now = vi.fn(() => currentTime);

            mockCollectionAdd.mockImplementation(async () => {
                // Each add takes 100ms of "time"
                currentTime += 100;
                return { id: 'log-1' };
            });

            const broadcastData = makeBroadcastData({
                recipients: Array.from({ length: 10 }, (_, i) => ({
                    toName: `User${i}`,
                    toEmail: `user${i}@test.com`,
                })),
                totalCount: 10,
            });
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 }, // 1ms delay (negligible)
                timeBudgetMs: 350, // will allow ~3 emails before timeout
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            expect(result.timedOut).toBe(true);
            expect(result.quotaExhausted).toBe(false);
            expect(result.processedIndex).toBeLessThan(10);
            expect(result.sentCount).toBeGreaterThan(0);

            // Should have saved progress to broadcastRef
            expect(mockBroadcastRefUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    processedIndex: result.processedIndex,
                    sentCount: result.sentCount,
                    failedCount: result.failedCount,
                }),
            );

            Date.now = originalDateNow;
            vi.useFakeTimers({ shouldAdvanceTime: true });
        });

        it('should update progress every 10 emails', async () => {
            const recipients = Array.from({ length: 30 }, (_, i) => ({
                toName: `User${i}`,
                toEmail: `user${i}@test.com`,
            }));
            const broadcastData = makeBroadcastData({
                recipients,
                totalCount: 30,
            });
            const broadcastRef = makeBroadcastRef();

            await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 999_999,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            // Progress updates at index 9 (i+1=10), 19 (i+1=20), 29 (i+1=30)
            expect(mockBroadcastRefUpdate).toHaveBeenCalledTimes(3);
            expect(mockBroadcastRefUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ processedIndex: 10, sentCount: 10 }),
            );
            expect(mockBroadcastRefUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ processedIndex: 20, sentCount: 20 }),
            );
            expect(mockBroadcastRefUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ processedIndex: 30, sentCount: 30 }),
            );
        });

        it('should handle empty recipients array', async () => {
            const broadcastData = makeBroadcastData({
                recipients: [],
                totalCount: 0,
            });
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            expect(mockCollectionAdd).not.toHaveBeenCalled();
            expect(result.processedIndex).toBe(0);
            expect(result.sentCount).toBe(0);
            expect(result.failedCount).toBe(0);
            expect(result.timedOut).toBe(false);
            expect(result.quotaExhausted).toBe(false);
        });

        it('should call db.collection("EmailLogs")', async () => {
            const { db } = await import('../init.js');
            const broadcastData = makeBroadcastData({
                recipients: [{ toName: 'Alice', toEmail: 'alice@test.com' }],
                totalCount: 1,
            });
            const broadcastRef = makeBroadcastRef();

            await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 60_000,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
            });

            expect(db.collection).toHaveBeenCalledWith('EmailLogs');
        });

        it('should set quotaExhausted=true when quotaChecker returns false', async () => {
            const recipients = Array.from({ length: 50 }, (_, i) => ({
                toName: `User${i}`,
                toEmail: `user${i}@test.com`,
            }));
            const broadcastData = makeBroadcastData({
                recipients,
                totalCount: 50,
            });
            const broadcastRef = makeBroadcastRef();

            // quotaChecker returns false (quota exhausted) on every call
            const quotaChecker = vi.fn().mockResolvedValue(false);

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 999_999,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
                quotaChecker,
            });

            // quotaChecker is called at i=25 (first multiple of 25 after start)
            expect(quotaChecker).toHaveBeenCalledTimes(1);
            expect(result.quotaExhausted).toBe(true);
            expect(result.timedOut).toBe(false);
            // Should have processed 25 emails before the quota check at i=25
            expect(result.processedIndex).toBe(25);
            expect(result.sentCount).toBe(25);

            // Should have saved progress to broadcastRef
            expect(mockBroadcastRefUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    processedIndex: 25,
                    sentCount: 25,
                    failedCount: 0,
                }),
            );
        });

        it('should not check quota when quotaChecker is not provided', async () => {
            const recipients = Array.from({ length: 30 }, (_, i) => ({
                toName: `User${i}`,
                toEmail: `user${i}@test.com`,
            }));
            const broadcastData = makeBroadcastData({
                recipients,
                totalCount: 30,
            });
            const broadcastRef = makeBroadcastRef();

            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId: 'bc-1',
                providerLimits: { perSecond: 1000 },
                timeBudgetMs: 999_999,
                startIndex: 0,
                initialSentCount: 0,
                initialFailedCount: 0,
                // no quotaChecker provided
            });

            // All emails processed, quota never exhausted
            expect(result.quotaExhausted).toBe(false);
            expect(result.sentCount).toBe(30);
            expect(result.processedIndex).toBe(30);
        });
    });
});
