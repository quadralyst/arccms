/**
 * Measuring how far the device clock is from the server (specs/clock-and-zones-spec.md,
 * T-D1 to T-D3; docs/app/clock-and-zones.html).
 *
 * The server's time is the `Date` header of a tiny file on the site's own Hosting,
 * /_arc/clock.json: no Firestore read, no function, nothing to pay. The answer must come
 * from the network, never a cache, or the header is old: the URL is new every time, the
 * request asks for no cache, firebase.json sends `Cache-Control: no-store` for /_arc/,
 * no service worker rule matches it (scripts/pwa-workbox.ts, tested), and an answer that
 * still looks cached is ignored here.
 */

/** The file whose `Date` header is the server's time. */
export const CLOCK_URL = '/_arc/clock.json';

/** A round trip longer than this says too little about when the server answered. */
export const MAX_ROUND_TRIP_MS = 5000;

/**
 * The `Date` header has whole seconds only: the true time is anywhere in that second, so
 * its middle is the best guess, and an offset under a second is within the error.
 */
const HALF_SECOND = 500;
const DEAD_BAND_MS = 1000;

/** What a measurement found. `offset` is server minus device, in ms: positive when the device is behind. */
export interface ClockSample {
    offset: number;
    serverTime: number;
    roundTrip: number;
}

/** The parts of an answer that matter, so the reading is pure and testable. */
export interface ClockAnswer {
    status: number;
    date: string | null;
    age: string | null;
}

/** The clock file's URL with a query no cache has seen. */
export function clockRequestUrl(random: () => number = Math.random): string {
    return `${CLOCK_URL}?t=${Date.now().toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
}

/**
 * The offset an answer gives, or null when it cannot be trusted: not a 200, no `Date`
 * header, an `Age` header above 0 (a cache answered), or a round trip over 5 seconds.
 *
 * @param sentAt     device time (ms) when the request left
 * @param roundTrip  ms from sending to the answer, from a monotonic clock
 */
export function readClockAnswer(answer: ClockAnswer, sentAt: number, roundTrip: number): ClockSample | null {
    if (answer.status !== 200 || !answer.date) return null;
    if (answer.age !== null && answer.age.trim() !== '' && Number(answer.age) !== 0) return null;
    if (!Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return null;
    const headerTime = Date.parse(answer.date);
    if (!Number.isFinite(headerTime)) return null;
    const serverTime = headerTime + HALF_SECOND;
    const raw = Math.round(serverTime - (sentAt + roundTrip / 2));
    return { offset: Math.abs(raw) < DEAD_BAND_MS ? 0 : raw, serverTime, roundTrip };
}

/** The clocks a measurement reads, replaceable in tests. */
export interface ClockSources {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    deviceNow: () => number;
    monotonicNow: () => number;
}

/** Ask the server for its time once. Null when offline, or when the answer cannot be trusted. */
export async function measureClock(sources: ClockSources): Promise<ClockSample | null> {
    const url = clockRequestUrl();
    const sentAt = sources.deviceNow();
    const started = sources.monotonicNow();
    let response: Response;
    try {
        response = await sources.fetch(url, { cache: 'no-store', credentials: 'omit' });
    } catch {
        return null;
    }
    const roundTrip = sources.monotonicNow() - started;
    return readClockAnswer(
        { status: response.status, date: response.headers.get('date'), age: response.headers.get('age') },
        sentAt,
        roundTrip,
    );
}
