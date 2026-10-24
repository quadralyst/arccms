/**
 * The app's clock choices (specs/clock-and-zones-spec.md, T-D7), from
 * src/custom/clock.ts. Plain TypeScript, so vite.config.ts can check them when the
 * build starts.
 */

/** What an app puts in src/custom/clock.ts. */
export interface CustomClock {
    /**
     * How far, in seconds, the device clock may be from the server's before
     * `ArcClock.skewed()` turns true. Default 120 (2 minutes).
     */
    skewSeconds?: number;
}

export const DEFAULT_SKEW_SECONDS = 120;

/** The skew threshold in ms; a value that is not a positive number stops the build with what to write. */
export function resolveClock(choice: CustomClock | undefined): { skewMs: number } {
    const seconds = choice?.skewSeconds;
    if (seconds === undefined) return { skewMs: DEFAULT_SKEW_SECONDS * 1000 };
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) return { skewMs: seconds * 1000 };
    throw new Error(
        `src/custom/clock.ts: skewSeconds is ${JSON.stringify(seconds)}. Write a number of seconds above 0, ` +
            `such as skewSeconds: 30, or leave it out for ${DEFAULT_SKEW_SECONDS} seconds.`,
    );
}
