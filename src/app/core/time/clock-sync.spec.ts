import { describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLOCK_URL, MAX_ROUND_TRIP_MS, clockRequestUrl, measureClock, readClockAnswer } from './clock-sync';
import { DEFAULT_SKEW_SECONDS, resolveClock } from './clock-config';
import { pwaWorkbox } from '../../../../scripts/pwa-workbox';

const ROOT = resolve(__dirname, '../../../..');
const SERVER = Date.parse('2026-10-24T20:00:00Z');
const header = (ms: number) => new Date(ms).toUTCString();
const answer = (date: string | null, extra: { status?: number; age?: string | null } = {}) =>
    ({ status: extra.status ?? 200, date, age: extra.age ?? null });

describe('measuring the device clock (specs/clock-and-zones-spec.md, T-D1 to T-D3)', () => {
    it('gives server minus device: positive when the device is behind, negative when ahead', () => {
        // The request leaves at device time sentAt and takes 200 ms; the server stamps the middle.
        const slow = readClockAnswer(answer(header(SERVER)), SERVER - 10 * 60_000 - 100, 200)!;
        expect(slow.offset).toBeGreaterThan(10 * 60_000 - 1000);
        expect(slow.offset).toBeLessThan(10 * 60_000 + 1000);
        const fast = readClockAnswer(answer(header(SERVER)), SERVER + 7 * 60_000 - 100, 200)!;
        expect(fast.offset).toBeGreaterThan(-7 * 60_000 - 1000);
        expect(fast.offset).toBeLessThan(-7 * 60_000 + 1000);
        expect(fast.roundTrip).toBe(200);
    });

    it('counts an offset under a second as none: the header has whole seconds only', () => {
        expect(readClockAnswer(answer(header(SERVER)), SERVER - 100, 200)!.offset).toBe(0);
        expect(readClockAnswer(answer(header(SERVER)), SERVER + 300, 200)!.offset).toBe(0);
    });

    it('ignores an answer a cache gave: an Age above 0, no Date, not a 200, a slow round trip', () => {
        const sentAt = SERVER - 100;
        expect(readClockAnswer(answer(header(SERVER - 3_600_000), { age: '3600' }), sentAt, 200)).toBeNull();
        expect(readClockAnswer(answer(null), sentAt, 200)).toBeNull();
        expect(readClockAnswer(answer('not a date'), sentAt, 200)).toBeNull();
        expect(readClockAnswer(answer(header(SERVER), { status: 304 }), sentAt, 200)).toBeNull();
        expect(readClockAnswer(answer(header(SERVER), { status: 503 }), sentAt, 200)).toBeNull();
        expect(readClockAnswer(answer(header(SERVER)), sentAt, MAX_ROUND_TRIP_MS + 1)).toBeNull();
        expect(readClockAnswer(answer(header(SERVER)), sentAt, -5)).toBeNull();
        // Age 0 is a fresh answer.
        expect(readClockAnswer(answer(header(SERVER), { age: '0' }), sentAt, 200)).not.toBeNull();
    });

    it('asks a new URL every time, with no cache, and gives null when offline', async () => {
        expect(clockRequestUrl()).not.toBe(clockRequestUrl());
        expect(clockRequestUrl().startsWith(`${CLOCK_URL}?t=`)).toBe(true);
        let t = 0;
        const fetch = vi.fn(async () => ({ status: 200, headers: new Headers({ date: header(SERVER) }) }) as Response);
        const sample = await measureClock({ fetch, deviceNow: () => SERVER - 60_000, monotonicNow: () => (t += 100) });
        expect(sample!.offset).toBeGreaterThan(59_000);
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/^\/_arc\/clock\.json\?t=/);
        expect(init.cache).toBe('no-store');
        const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        expect(await measureClock({ fetch: offline, deviceNow: () => SERVER, monotonicNow: () => 0 })).toBeNull();
    });

    it('ignores a stale Date that a cache sent with an Age header', async () => {
        const fetch = vi.fn(async () => ({ status: 200, headers: new Headers({ date: header(SERVER - 86_400_000), age: '86400' }) }) as Response);
        expect(await measureClock({ fetch, deviceNow: () => SERVER, monotonicNow: () => 0 })).toBeNull();
    });

    it('is a file on Hosting that no cache keeps: no-store in firebase.json, and no service worker rule', () => {
        expect(existsSync(resolve(ROOT, 'public', CLOCK_URL.slice(1)))).toBe(true);
        const hosting = JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')).hosting;
        const rule = hosting.headers.find((h: { source: string }) => h.source === '/_arc/**');
        expect(rule?.headers).toEqual([{ key: 'Cache-Control', value: 'no-store' }]);

        const workbox = pwaWorkbox({ navigationTimeoutSeconds: 4 });
        const url = new URL(`https://example.com${clockRequestUrl()}`);
        for (const entry of workbox.runtimeCaching ?? []) {
            const match = entry.urlPattern as (o: unknown) => boolean;
            expect(match({ url, sameOrigin: true, request: { mode: 'cors', destination: '' } }), String(entry.handler)).toBe(false);
        }
        expect((workbox.globPatterns ?? []).some((p) => p.includes('json'))).toBe(false);
    });
});

describe('the skew threshold (src/custom/clock.ts, T-D7)', () => {
    it('is 2 minutes unless the app sets a positive number of seconds', () => {
        expect(resolveClock({}).skewMs).toBe(DEFAULT_SKEW_SECONDS * 1000);
        expect(resolveClock(undefined).skewMs).toBe(120_000);
        expect(resolveClock({ skewSeconds: 30 }).skewMs).toBe(30_000);
    });

    it('stops the build with what to write when the value is wrong', () => {
        for (const bad of [0, -5, NaN, Infinity, '30' as unknown as number]) {
            expect(() => resolveClock({ skewSeconds: bad }), String(bad)).toThrow(/src\/custom\/clock\.ts: skewSeconds is .* Write a number of seconds above 0/);
        }
        expect(readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')).toContain('resolveClock(CUSTOM_CLOCK);');
    });
});
