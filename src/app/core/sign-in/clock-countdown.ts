/**
 * A countdown in whole seconds that runs by the clock, not by counting ticks (RF6, 6.11):
 * Resend on the sign-in page, the profile's add-an-email-or-number step and the fresh
 * code dialog, and the sign-in page's first-step wait.
 *
 * A browser slows the timers of a page in the background, so counting ticks falls behind
 * after a visit to the SMS app or another tab. This works the seconds out from the time
 * the countdown ends, and reads them again as soon as the page is back in front. It never
 * shows more than it started with, and a clock moved back moves the end back with it, so
 * a changed clock never holds Resend back.
 */
import { signal } from '@angular/core';

/** The whole seconds left until `endsAt` (a Date.now() time), never below 0 nor above `most`. */
export function secondsUntil(endsAt: number, now = Date.now(), most = Infinity): number {
    return Math.min(most, Math.max(0, Math.ceil((endsAt - now) / 1000)));
}

export class ClockCountdown {
    /** The seconds left; 0 when it is not running. */
    readonly left = signal(0);
    private endsAt = 0;
    private most = 0;
    private lastNow = 0;
    private timer: ReturnType<typeof setInterval> | undefined;
    private readonly shown = () => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') this.tick();
    };

    constructor(private readonly now: () => number = () => Date.now()) {}

    /** Count down from this many seconds, starting now. */
    start(seconds: number): void {
        this.stop();
        this.most = Math.max(0, Math.ceil(seconds));
        this.lastNow = this.now();
        this.endsAt = this.lastNow + Math.max(0, seconds) * 1000;
        this.left.set(secondsUntil(this.endsAt, this.lastNow, this.most));
        if (this.left() === 0) {
            this.stop();
            return;
        }
        this.timer = setInterval(() => this.tick(), 1000);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.shown);
    }

    /** Read the seconds from the clock now. */
    tick(): void {
        if (!this.endsAt) return;
        const now = this.now();
        // The clock went back: the end goes back with it, so the seconds left stay right.
        if (now < this.lastNow) this.endsAt -= this.lastNow - now;
        this.lastNow = now;
        const left = secondsUntil(this.endsAt, now, this.most);
        this.left.set(left);
        if (left === 0) this.stop();
    }

    /** Stop, at 0. Also what a page calls when it goes. */
    stop(): void {
        clearInterval(this.timer);
        this.timer = undefined;
        this.endsAt = 0;
        this.left.set(0);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.shown);
    }
}
