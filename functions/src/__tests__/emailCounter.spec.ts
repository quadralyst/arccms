/**
 * Tests for functions/src/mail-config/emailCounter.ts
 *
 * Covers:
 * - resolveProviderLimits: merges defaults, user overrides, and fallback
 * - legacyToProviderLimits: converts legacy RateLimitConfig to ProviderRateLimits
 * - getDailyKey / getHourlyKey: Firestore doc key formatting
 * - incrementSendCount: batch writes for daily and hourly counters
 * - checkQuota: quota enforcement against Firestore counters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
    mockBatchSet,
    mockBatchCommit,
    mockDocGet,
} = vi.hoisted(() => ({
    mockBatchSet: vi.fn(),
    mockBatchCommit: vi.fn().mockResolvedValue(undefined),
    mockDocGet: vi.fn(),
}));

vi.mock('../init', () => ({
    db: {
        collection: vi.fn().mockImplementation(() => ({
            doc: vi.fn().mockImplementation(() => ({
                get: mockDocGet,
            })),
        })),
        batch: vi.fn().mockReturnValue({
            set: mockBatchSet,
            commit: mockBatchCommit,
        }),
    },
}));

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        increment: vi.fn((n: number) => ({ _increment: n })),
    },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
    PROVIDER_DEFAULT_LIMITS,
    resolveProviderLimits,
    legacyToProviderLimits,
    getDailyKey,
    getHourlyKey,
    incrementSendCount,
    checkQuota,
} from '../mail-config/emailCounter.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('emailCounter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── resolveProviderLimits ────────────────────────────────────────────

    describe('resolveProviderLimits', () => {
        it('returns defaults for a known provider when no overrides given', () => {
            const result = resolveProviderLimits('gmail');
            expect(result).toEqual(PROVIDER_DEFAULT_LIMITS['gmail']);
        });

        it('returns fallback { perSecond: 1 } for an unknown provider', () => {
            const result = resolveProviderLimits('unknown-provider');
            expect(result).toEqual({ perSecond: 1 });
        });

        it('merges user overrides with defaults (perSecond overridden, perDay from defaults preserved)', () => {
            const overrides = {
                gmail: { perSecond: 5 } as any,
            };
            const result = resolveProviderLimits('gmail', overrides);
            expect(result.perSecond).toBe(5);
            // perDay should come from PROVIDER_DEFAULT_LIMITS.gmail
            expect(result.perDay).toBe(PROVIDER_DEFAULT_LIMITS['gmail'].perDay);
        });

        it('applies user override with perHour and perDay over defaults', () => {
            const overrides = {
                resend: { perSecond: 10, perHour: 200, perDay: 1000 },
            };
            const result = resolveProviderLimits('resend', overrides);
            expect(result.perSecond).toBe(10);
            expect(result.perHour).toBe(200);
            expect(result.perDay).toBe(1000);
        });
    });

    // ── legacyToProviderLimits ───────────────────────────────────────────

    describe('legacyToProviderLimits', () => {
        it('converts { maxEmails: 5, interval: "second" } to { perSecond: 5 }', () => {
            const result = legacyToProviderLimits({ maxEmails: 5, interval: 'second' });
            expect(result).toEqual({ perSecond: 5 });
        });

        it('converts { maxEmails: 120, interval: "minute" } to { perSecond: 2 }', () => {
            const result = legacyToProviderLimits({ maxEmails: 120, interval: 'minute' });
            expect(result).toEqual({ perSecond: 2 });
        });

        it('converts { maxEmails: 1, interval: "day" } to { perSecond: 1 } (minimum)', () => {
            const result = legacyToProviderLimits({ maxEmails: 1, interval: 'day' });
            expect(result).toEqual({ perSecond: 1 });
        });
    });

    // ── getDailyKey / getHourlyKey ───────────────────────────────────────

    describe('getDailyKey', () => {
        it('produces correct format with given date', () => {
            const date = new Date('2026-03-01T14:30:00.000Z');
            const key = getDailyKey('gmail', date);
            expect(key).toBe('gmail_daily_2026-03-01');
        });
    });

    describe('getHourlyKey', () => {
        it('produces correct format with given date', () => {
            const date = new Date('2026-03-01T14:30:00.000Z');
            const key = getHourlyKey('gmail', date);
            expect(key).toBe('gmail_hourly_2026-03-01_14');
        });
    });

    // ── incrementSendCount ───────────────────────────────────────────────

    describe('incrementSendCount', () => {
        it('calls batch.set for daily and hourly docs', async () => {
            await incrementSendCount('resend');

            expect(mockBatchSet).toHaveBeenCalledTimes(2);

            // First call is for the daily doc
            const dailyCall = mockBatchSet.mock.calls[0];
            expect(dailyCall[1]).toMatchObject({ provider: 'resend', type: 'daily' });
            expect(dailyCall[2]).toEqual({ merge: true });

            // Second call is for the hourly doc
            const hourlyCall = mockBatchSet.mock.calls[1];
            expect(hourlyCall[1]).toMatchObject({ provider: 'resend', type: 'hourly' });
            expect(hourlyCall[2]).toEqual({ merge: true });
        });

        it('calls batch.commit', async () => {
            await incrementSendCount('smtp');
            expect(mockBatchCommit).toHaveBeenCalledTimes(1);
        });
    });

    // ── checkQuota ───────────────────────────────────────────────────────

    describe('checkQuota', () => {
        it('returns ok:true when no perDay/perHour limits are set', async () => {
            const result = await checkQuota('smtp', { perSecond: 1 });
            expect(result).toEqual({ ok: true, dailyCount: 0, hourlyCount: 0 });
            // Should not have queried Firestore at all
            expect(mockDocGet).not.toHaveBeenCalled();
        });

        it('returns ok:false when daily count >= perDay', async () => {
            mockDocGet.mockResolvedValueOnce({
                data: () => ({ count: 500 }),
            });

            const result = await checkQuota('gmail', { perSecond: 1, perDay: 500 });
            expect(result).toEqual({ ok: false, dailyCount: 500, hourlyCount: 0 });
        });

        it('returns ok:false when hourly count >= perHour', async () => {
            // Daily check passes first
            mockDocGet.mockResolvedValueOnce({
                data: () => ({ count: 10 }),
            });
            // Hourly check fails
            mockDocGet.mockResolvedValueOnce({
                data: () => ({ count: 60 }),
            });

            const result = await checkQuota('resend', { perSecond: 2, perDay: 100, perHour: 60 });
            expect(result).toEqual({ ok: false, dailyCount: 10, hourlyCount: 60 });
        });

        it('returns ok:true when under both limits', async () => {
            // Daily check
            mockDocGet.mockResolvedValueOnce({
                data: () => ({ count: 40 }),
            });
            // Hourly check
            mockDocGet.mockResolvedValueOnce({
                data: () => ({ count: 10 }),
            });

            const result = await checkQuota('resend', { perSecond: 2, perDay: 100, perHour: 60 });
            expect(result).toEqual({ ok: true, dailyCount: 40, hourlyCount: 10 });
        });
    });
});
