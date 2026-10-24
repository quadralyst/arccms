import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ARC_CLOCK_SKEW_MS, ARC_CLOCK_SOURCES, ArcClock, CLOCK_CACHE_KEY, RESYNC_EVERY_MS } from './arc-clock';

const SERVER = Date.parse('2026-10-24T20:00:00.000Z');

/**
 * A device whose clock is `skew` ms off the server's, and a server that answers with
 * its time, or fails when `online` is false.
 */
function world(skew: number) {
    const state = { online: true, skew, calls: 0 };
    const deviceNow = () => Date.now() + state.skew;
    const fetch = vi.fn(async () => {
        state.calls++;
        if (!state.online) throw new TypeError('Failed to fetch');
        return { status: 200, headers: new Headers({ date: new Date(Date.now()).toUTCString() }) } as Response;
    });
    // The fake timers' clock stands in for the monotonic one: it never jumps.
    return { state, sources: { fetch, deviceNow, monotonicNow: () => Date.now() }, fetch };
}

function start(w: ReturnType<typeof world>, extra: unknown[] = []): ArcClock {
    TestBed.configureTestingModule({ providers: [{ provide: ARC_CLOCK_SOURCES, useValue: w.sources }, ...(extra as never[])] });
    return TestBed.inject(ArcClock);
}

/** Let the measurement's promises settle under fake timers. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('ArcClock (specs/clock-and-zones-spec.md, T-D4 to T-D6)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(SERVER); // the fake timers' clock is the server's
        localStorage.clear();
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        vi.useRealTimers();
        localStorage.clear();
    });

    it('measures when first used and corrects a device that is 7 minutes fast', async () => {
        const w = world(7 * 60_000);
        const clock = start(w);
        expect(clock.synced()).toBe(false);
        await settle();
        expect(w.fetch).toHaveBeenCalledTimes(1);
        expect(clock.synced()).toBe(true);
        expect(Math.abs(clock.offset() + 7 * 60_000)).toBeLessThan(1000);
        expect(Math.abs(clock.exact() - Date.now())).toBeLessThan(1000);
        expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
        expect(clock.skewed()).toBe(true);
        expect(clock.lastSyncedAt()).not.toBeNull();
        expect(JSON.parse(localStorage.getItem(CLOCK_CACHE_KEY)!).offset).toBe(clock.offset());
    });

    it('is not skewed within the threshold, and an app can set its own', async () => {
        const w = world(90_000);
        const clock = start(w);
        await settle();
        expect(clock.skewThresholdMs).toBe(120_000);
        expect(clock.skewed()).toBe(false);
        TestBed.resetTestingModule();
        const strict = start(world(90_000), [{ provide: ARC_CLOCK_SKEW_MS, useValue: 30_000 }]);
        await settle();
        expect(strict.skewed()).toBe(true);
    });

    it('keeps the last offset when a measurement fails', async () => {
        const w = world(-5 * 60_000);
        const clock = start(w);
        await settle();
        const offset = clock.offset();
        w.state.online = false;
        expect(await clock.sync()).toBe(false);
        expect(clock.offset()).toBe(offset);
        expect(clock.synced()).toBe(true);
    });

    it('opens offline with the offset kept on the device, not yet synced', async () => {
        localStorage.setItem(CLOCK_CACHE_KEY, JSON.stringify({ offset: -420_000, at: SERVER - 3_600_000 }));
        const w = world(420_000);
        w.state.online = false;
        const clock = start(w);
        await settle();
        expect(clock.offset()).toBe(-420_000);
        expect(clock.synced()).toBe(false);
        expect(clock.lastSyncedAt()).toBe(SERVER - 3_600_000);
        expect(Math.abs(clock.exact() - Date.now())).toBeLessThan(10);
        expect(clock.skewed()).toBe(true);
    });

    it('ignores a broken value kept on the device', () => {
        localStorage.setItem(CLOCK_CACHE_KEY, '{"offset":"x"}');
        expect(start(world(0)).offset()).toBe(0);
    });

    it('measures again when back online, every 30 minutes, and when shown again at most once a minute', async () => {
        const w = world(0);
        const clock = start(w);
        await settle();
        expect(w.state.calls).toBe(1);

        window.dispatchEvent(new Event('online'));
        await settle();
        expect(w.state.calls).toBe(2);

        // Shown again within the minute: no new measurement.
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        expect(w.state.calls).toBe(2);
        vi.advanceTimersByTime(61_000);
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        expect(w.state.calls).toBe(3);

        vi.advanceTimersByTime(RESYNC_EVERY_MS);
        await settle();
        expect(w.state.calls).toBe(4);
        expect(clock.synced()).toBe(true);
    });

    it('measures again as soon as the page is shown after the person fixed a fast device clock', async () => {
        const w = world(10 * 60_000);
        const clock = start(w);
        await settle();
        expect(clock.skewed()).toBe(true);
        vi.advanceTimersByTime(61_000);
        w.state.skew = 0; // set back 10 minutes in the device's settings
        document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        expect(w.state.calls).toBe(2);
        expect(clock.offset()).toBe(0);
        expect(clock.skewed()).toBe(false);
    });

    it('shares one measurement between callers at the same time', async () => {
        const w = world(0);
        const clock = start(w);
        const a = clock.sync();
        const b = clock.sync();
        expect(a).toBe(b);
        await settle();
        expect(w.state.calls).toBe(1);
    });

    it('moves now() on every second', async () => {
        const clock = start(world(0));
        await settle();
        const first = clock.now();
        vi.advanceTimersByTime(3000);
        expect(clock.now() - first).toBeGreaterThanOrEqual(2000);
        expect(clock.now() - first).toBeLessThanOrEqual(4000);
    });

    it('does nothing on the server render', () => {
        const w = world(600_000);
        const clock = start(w, [{ provide: PLATFORM_ID, useValue: 'server' }]);
        expect(w.fetch).not.toHaveBeenCalled();
        expect(clock.offset()).toBe(0);
    });

    it('stops its timers and listeners when the app is destroyed', async () => {
        const w = world(0);
        start(w);
        await settle();
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('online'));
        vi.advanceTimersByTime(RESYNC_EVERY_MS * 2);
        await settle();
        expect(w.state.calls).toBe(1);
    });
});
