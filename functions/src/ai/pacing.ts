/**
 * Pacing per connection (specs/ai-media-spec.md, AM-D15): at most `perMinute` requests in a
 * minute and `atOnce` running together, across every function instance. A request over a
 * limit waits for a place while its call's time allows, rather than failing.
 *
 * `AiPacing/{connection}` holds this minute's count and a lease for each running request,
 * which ends when the request ends or its time runs out, so an instance that crashed cannot
 * hold a place. One transaction a request, only for connections with a limit; one document
 * a connection suits the tens to few hundreds a minute providers publish.
 */
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';

export const AI_PACING = 'AiPacing';
/** How long to wait between tries for a place: 1, 2, then 4 seconds. */
const WAITS_MS = [1000, 2000, 4000];

export interface PaceLimits {
    perMinute: number | null;
    atOnce: number | null;
}

export type PlaceResult = { ok: true; release: () => Promise<void> } | { ok: false; wait: number };

/** The minute a moment is in, as text: `202611021504`. */
export function minuteOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

/** One try for a place; the milliseconds until one may free up when there is none. */
export async function tryPlace(connectionId: string, limits: PaceLimits, leaseUntilMs: number, now = Date.now()): Promise<{ ok: true; lease: string } | { ok: false; waitMs: number }> {
    const ref = db.collection(AI_PACING).doc(connectionId);
    const lease = randomUUID();
    return db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data() ?? {};
        const minute = minuteOf(now);
        const count = data['minute'] === minute ? Number(data['count'] ?? 0) : 0;
        const leases = Object.fromEntries(Object.entries((data['leases'] ?? {}) as Record<string, number>).filter(([, until]) => Number(until) > now));
        if (limits.perMinute && count >= limits.perMinute) {
            return { ok: false as const, waitMs: 60_000 - (now % 60_000) };
        }
        if (limits.atOnce && Object.keys(leases).length >= limits.atOnce) {
            const soonest = Math.min(...Object.values(leases).map(Number));
            return { ok: false as const, waitMs: Math.max(250, soonest - now) };
        }
        tx.set(ref, { minute, count: count + 1, leases: { ...leases, [lease]: leaseUntilMs } });
        return { ok: true as const, lease };
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A place for one request to a connection, held until `deadlineMs` at the latest, waiting for
 * one while at least `leaveMs` of the time would be left for the request. No limits: a
 * place at once, with nothing written.
 */
export async function waitForPlace(connectionId: string, limits: PaceLimits, deadlineMs: number, options: { sleep?: (ms: number) => Promise<void>; now?: () => number; leaveMs?: number } = {}): Promise<PlaceResult> {
    if (!limits.perMinute && !limits.atOnce) return { ok: true, release: async () => undefined };
    const wait = options.sleep ?? sleep;
    const clock = options.now ?? Date.now;
    for (let i = 0; ; i++) {
        const now = clock();
        let result: Awaited<ReturnType<typeof tryPlace>>;
        try {
            result = await tryPlace(connectionId, limits, deadlineMs, now);
        } catch (err) {
            // Pacing must never stop a call: a counter that cannot be read lets it through.
            console.error(`askAi: the pace of connection ${connectionId} could not be read`, err);
            return { ok: true, release: async () => undefined };
        }
        if (result.ok) {
            const lease = result.lease;
            return {
                ok: true,
                release: async () => {
                    try {
                        await db.collection(AI_PACING).doc(connectionId).update({ [`leases.${lease}`]: FieldValue.delete() });
                    } catch (err) {
                        console.error(`askAi: a place on connection ${connectionId} was not given back; it ends with its time`, err);
                    }
                },
            };
        }
        const delay = Math.min(WAITS_MS[Math.min(i, WAITS_MS.length - 1)], Math.max(250, result.waitMs));
        if (clock() + delay + (options.leaveMs ?? 0) >= deadlineMs) return { ok: false, wait: Math.max(1, Math.ceil(result.waitMs / 1000)) };
        await wait(delay);
    }
}
