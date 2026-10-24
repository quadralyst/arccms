/**
 * One true "now" for the browser (specs/clock-and-zones-spec.md, T-D4 to T-D7;
 * docs/app/clock-and-zones.html).
 *
 * A device's clock can be minutes off. ArcClock measures how far it is from the server
 * (clock-sync.ts) when it is first used, when the browser comes back online, when the
 * page is shown again (at most once a minute) and every 30 minutes, and corrects the
 * device's time by that much. The last offset is kept on the device, so a page opened
 * offline still shows the corrected time.
 *
 * Stored moments should still be stamped by the server (`serverTimestamp()`): ArcClock
 * is for showing time, counting "2 minutes ago", and stamping on the device only when the
 * server cannot (`exact()`).
 */
import { DestroyRef, Injectable, InjectionToken, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CUSTOM_CLOCK } from '../../../custom/clock';
import { resolveClock } from './clock-config';
import { measureClock, type ClockSources } from './clock-sync';

/** Where the last offset is kept on the device. */
export const CLOCK_CACHE_KEY = 'arc-clock';
export const RESYNC_EVERY_MS = 30 * 60 * 1000;
/** Showing the page again measures at most this often. */
export const VISIBLE_RESYNC_MIN_MS = 60 * 1000;

/** The skew threshold in ms, from src/custom/clock.ts. */
export const ARC_CLOCK_SKEW_MS = new InjectionToken<number>('ARC_CLOCK_SKEW_MS', {
    providedIn: 'root',
    factory: () => resolveClock(CUSTOM_CLOCK).skewMs,
});

/** The network and the clocks ArcClock reads; tests replace them. */
export const ARC_CLOCK_SOURCES = new InjectionToken<ClockSources>('ARC_CLOCK_SOURCES', {
    providedIn: 'root',
    factory: () => ({
        fetch: (url, init) => fetch(url, init),
        deviceNow: () => Date.now(),
        monotonicNow: () => performance.now(),
    }),
});

interface StoredOffset {
    offset: number;
    at: number;
}

function readStored(): StoredOffset | null {
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CLOCK_CACHE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<StoredOffset>) : null;
        return parsed && Number.isFinite(parsed.offset) && Number.isFinite(parsed.at) ? { offset: parsed.offset!, at: parsed.at! } : null;
    } catch {
        return null;
    }
}

function store(value: StoredOffset): void {
    try {
        localStorage.setItem(CLOCK_CACHE_KEY, JSON.stringify(value));
    } catch {
        // Storage off: the next visit measures again before it corrects.
    }
}

@Injectable({ providedIn: 'root' })
export class ArcClock {
    private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
    private readonly sources = inject(ARC_CLOCK_SOURCES);
    private readonly destroyRef = inject(DestroyRef);

    private readonly stored = this.browser ? readStored() : null;
    private readonly offsetMs = signal(this.stored?.offset ?? 0);
    private readonly deviceTick = signal(this.sources.deviceNow());
    private readonly syncedSignal = signal(false);
    private readonly lastSynced = signal<number | null>(this.stored?.at ?? null);

    /** How far the device may be off before `skewed()` turns true, in ms. */
    readonly skewThresholdMs = inject(ARC_CLOCK_SKEW_MS);
    /** Server time minus device time, in ms: positive when the device is behind. */
    readonly offset = this.offsetMs.asReadonly();
    /** True once a measurement has succeeded since this page opened. */
    readonly synced = this.syncedSignal.asReadonly();
    /** The corrected time (epoch ms) of the last good measurement, on this page or kept from an earlier one; null if never. */
    readonly lastSyncedAt = this.lastSynced.asReadonly();
    /** True when the device clock is off by more than the threshold. */
    readonly skewed = computed(() => Math.abs(this.offsetMs()) > this.skewThresholdMs);
    /** The corrected time in epoch ms, moving on every second: for templates and effects. */
    readonly now = computed(() => this.deviceTick() + this.offsetMs());

    private inFlight: Promise<boolean> | null = null;
    /** Monotonic time of the last measurement started. */
    private lastAttempt = Number.NEGATIVE_INFINITY;
    private tickTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        if (!this.browser) return;
        this.scheduleTick();
        const every = setInterval(() => void this.sync(), RESYNC_EVERY_MS);
        const online = () => void this.sync();
        const visible = () => {
            // Timed on the monotonic clock: a person who just set their device clock back must not wait.
            if (document.visibilityState === 'visible' && this.sources.monotonicNow() - this.lastAttempt >= VISIBLE_RESYNC_MIN_MS) void this.sync();
        };
        window.addEventListener('online', online);
        document.addEventListener('visibilitychange', visible);
        this.destroyRef.onDestroy(() => {
            clearInterval(every);
            clearTimeout(this.tickTimer);
            window.removeEventListener('online', online);
            document.removeEventListener('visibilitychange', visible);
        });
        void this.sync();
    }

    /** The corrected time at this instant, in epoch ms: use it in place of `Date.now()` to stamp a record on the device. */
    exact(): number {
        return this.sources.deviceNow() + this.offsetMs();
    }

    /** Measure now. True when the measurement succeeded; a failed one keeps the last offset. */
    sync(): Promise<boolean> {
        if (!this.browser) return Promise.resolve(false);
        if (this.inFlight) return this.inFlight;
        this.lastAttempt = this.sources.monotonicNow();
        this.inFlight = measureClock(this.sources)
            .then((sample) => {
                if (!sample) return false;
                this.offsetMs.set(sample.offset);
                this.syncedSignal.set(true);
                this.lastSynced.set(sample.serverTime);
                this.deviceTick.set(this.sources.deviceNow());
                store({ offset: sample.offset, at: sample.serverTime });
                return true;
            })
            .finally(() => {
                this.inFlight = null;
            });
        return this.inFlight;
    }

    /** Move `now()` on at each corrected second, so a clock on screen turns over on time. */
    private scheduleTick(): void {
        const wait = 1000 - (((this.exact() % 1000) + 1000) % 1000);
        this.tickTimer = setTimeout(() => {
            this.deviceTick.set(this.sources.deviceNow());
            this.scheduleTick();
        }, wait || 1000);
    }
}
