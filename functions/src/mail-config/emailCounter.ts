import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { ProviderRateLimits, RateLimitConfig } from '../types.js';

/** Default rate limits per provider (based on provider guidelines) */
export const PROVIDER_DEFAULT_LIMITS: Record<string, ProviderRateLimits> = {
    smtp: { perSecond: 1 },
    gmail: { perSecond: 1, perDay: 500 },
    resend: { perSecond: 2, perDay: 100 },
};

/**
 * Resolve effective rate limits for a provider.
 * Priority: user overrides > provider defaults > fallback { perSecond: 1 }
 */
export function resolveProviderLimits(
    provider: string,
    userOverrides?: Record<string, ProviderRateLimits>,
): ProviderRateLimits {
    const defaults = PROVIDER_DEFAULT_LIMITS[provider] || { perSecond: 1 };
    const overrides = userOverrides?.[provider];
    if (!overrides) return defaults;
    return {
        perSecond: overrides.perSecond || defaults.perSecond,
        perHour: overrides.perHour ?? defaults.perHour,
        perDay: overrides.perDay ?? defaults.perDay,
    };
}

/**
 * Convert a legacy RateLimitConfig to ProviderRateLimits.
 * Maps the flat maxEmails/interval model to a perSecond value.
 */
export function legacyToProviderLimits(legacy: RateLimitConfig): ProviderRateLimits {
    const intervalFactors: Record<string, number> = {
        second: 1,
        minute: 60,
        hour: 3600,
        day: 86400,
    };
    const factor = intervalFactors[legacy.interval] || 1;
    const perSecond =
        factor === 1 ? legacy.maxEmails : Math.max(1, Math.round(legacy.maxEmails / factor));
    return { perSecond };
}

/** Build the Firestore doc key for a daily counter */
export function getDailyKey(provider: string, now?: Date): string {
    const d = now || new Date();
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
    return `${provider}_daily_${dateStr}`;
}

/** Build the Firestore doc key for an hourly counter */
export function getHourlyKey(provider: string, now?: Date): string {
    const d = now || new Date();
    const hourStr = d.toISOString().slice(0, 13).replace('T', '_'); // YYYY-MM-DD_HH
    return `${provider}_hourly_${hourStr}`;
}

/**
 * Increment the daily and hourly send counters for a provider.
 * Called after each successful email send.
 */
export async function incrementSendCount(provider: string): Promise<void> {
    const batch = db.batch();

    const dailyRef = db.collection('_email_counters').doc(getDailyKey(provider));
    batch.set(
        dailyRef,
        { count: FieldValue.increment(1), provider, type: 'daily' },
        { merge: true },
    );

    const hourlyRef = db.collection('_email_counters').doc(getHourlyKey(provider));
    batch.set(
        hourlyRef,
        { count: FieldValue.increment(1), provider, type: 'hourly' },
        { merge: true },
    );

    await batch.commit();
}

/**
 * Check if a provider still has quota remaining.
 * Returns { ok: true } if under all limits, { ok: false } if any limit exceeded.
 */
export async function checkQuota(
    provider: string,
    limits: ProviderRateLimits,
): Promise<{ ok: boolean; dailyCount: number; hourlyCount: number }> {
    let dailyCount = 0;
    let hourlyCount = 0;

    if (limits.perDay) {
        const snap = await db.collection('_email_counters').doc(getDailyKey(provider)).get();
        dailyCount = snap.data()?.count || 0;
        if (dailyCount >= limits.perDay) {
            return { ok: false, dailyCount, hourlyCount };
        }
    }

    if (limits.perHour) {
        const snap = await db.collection('_email_counters').doc(getHourlyKey(provider)).get();
        hourlyCount = snap.data()?.count || 0;
        if (hourlyCount >= limits.perHour) {
            return { ok: false, dailyCount, hourlyCount };
        }
    }

    return { ok: true, dailyCount, hourlyCount };
}
