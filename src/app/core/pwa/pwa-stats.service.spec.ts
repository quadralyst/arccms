import { describe, expect, it } from 'vitest';
import { periodStart, summarise } from './pwa-stats.service';

describe('summarise', () => {
    it('adds up the days, by platform, and works out the install rate', () => {
        const summary = summarise([
            { installed: { total: 3, android: 2, ios: 1 }, opened_installed: { total: 10 } },
            { installed: { total: 1, desktop: 1 } },
            {},
        ], 4, 16);
        expect(summary).toEqual({
            installs: 4,
            byPlatform: { android: 2, ios: 1, desktop: 1 },
            opened: 10,
            installedUsers: 4,
            totalUsers: 16,
            rate: 25,
        });
    });

    it('shows a rate of 0 with no users yet', () => {
        expect(summarise([], 0, 0).rate).toBe(0);
    });
});

describe('periodStart', () => {
    it('is the first of the last 30 days, today included', () => {
        expect(periodStart(new Date('2026-10-30T12:00:00Z'))).toBe('2026-10-01');
    });
});
