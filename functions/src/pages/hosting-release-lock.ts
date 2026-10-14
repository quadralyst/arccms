import * as crypto from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Hosting releases happen one at a time per site.
 *
 * Each release builds its new version from the live version's file list. Two
 * releases that run at once (an entry publish and an items-from rebuild, say,
 * which are separate queue items) both start from the same version, so the one
 * released last drops the files the other added. HostingBatch fixed that inside
 * one queue item; this lock fixes it between them:
 *
 * - A release creates `_hosting_releases/{siteId}~lock` with `create()`, so of
 *   two at once one gets it and the other waits, polling until it is gone.
 * - The holder removes it when it is done, also when the release failed, and
 *   only if it still holds it.
 * - A lock older than RELEASE_LOCK_STALE_MS was left by a function that died
 *   mid-release, so it is taken over.
 *
 * A release that waited must build on the version released while it waited,
 * but the Hosting release list can lag a release by seconds (specs/_todo.md
 * item 3c). So the holder also records the version it released in
 * `_hosting_releases/{siteId}`, and the next one builds on whichever of that
 * and the listed release is newer (newerVersion).
 */

const COLLECTION = '_hosting_releases';

/**
 * Longer than the longest timeout of a function that releases (540s), so a
 * live release is never taken for a dead one.
 */
export const RELEASE_LOCK_STALE_MS = 10 * 60 * 1000;

/** How long a release waits for another one before it gives up and fails. */
export const RELEASE_LOCK_WAIT_MS = 3 * 60 * 1000;

/**
 * The time a release takes once it holds the lock (reading the live file list,
 * creating, populating, uploading and releasing the version). A caller with a
 * deadline waits for the lock only while this much time is still left
 * (lockWaitBefore).
 */
export const RELEASE_TIME_MS = 90 * 1000;

/** The base pause between two looks at a held lock; each adds up to as much again at random. */
const POLL_MS = 500;

/** The version this code last released to a site, as `_hosting_releases/{siteId}` holds it. */
export interface RecordedRelease {
    version: string;
    /** The release's `releaseTime` from the Hosting API (RFC 3339). */
    releaseTime: string;
}

/** Whether a Firestore error has this gRPC code (by number, name or message). */
function hasCode(error: unknown, code: number, name: string): boolean {
    const err = error as { code?: unknown; message?: unknown };
    return err?.code === code || err?.code === name
        || (typeof err?.message === 'string' && err.message.toUpperCase().includes(name.toUpperCase().replace('-', '_')));
}
const alreadyExists = (e: unknown) => hasCode(e, 6, 'already-exists');
const changedUnder = (e: unknown) => hasCode(e, 9, 'failed-precondition') || hasCode(e, 5, 'not-found');

function lockRef(siteId: string): DocumentReference {
    return db.collection(COLLECTION).doc(`${siteId}~lock`);
}

function recordRef(siteId: string): DocumentReference {
    return db.collection(COLLECTION).doc(siteId);
}

/**
 * How far in the future a lock's `since` may be, for a clock a little ahead of
 * this one. One further ahead was not written by a release (it writes
 * `Date.now()`), so it is stale, not live forever.
 */
export const FUTURE_SINCE_MS = 60 * 1000;

function isStale(data: { since?: unknown } | undefined): boolean {
    if (typeof data?.since !== 'number') return true;
    const age = Date.now() - data.since;
    return age > RELEASE_LOCK_STALE_MS || age < -FUTURE_SINCE_MS;
}

/**
 * How long a release that must be done by `deadline` (ms) may wait for the
 * lock: RELEASE_LOCK_WAIT_MS, or less when the deadline leaves less than that
 * after RELEASE_TIME_MS for the release itself. Never below 0. Without a
 * deadline, RELEASE_LOCK_WAIT_MS.
 */
export function lockWaitBefore(deadline?: number): number {
    if (deadline === undefined) return RELEASE_LOCK_WAIT_MS;
    return Math.max(0, Math.min(RELEASE_LOCK_WAIT_MS, deadline - Date.now() - RELEASE_TIME_MS));
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Takes the site's release lock, waiting while another release holds it, for up
 * to `maxWaitMs`. Resolves with how long it waited, in ms.
 */
async function acquire(siteId: string, holder: string, maxWaitMs: number): Promise<number> {
    const lock = lockRef(siteId);
    const started = Date.now();
    for (;;) {
        try {
            await lock.create({ holder, since: Date.now() });
            return Date.now() - started;
        } catch (error) {
            if (!alreadyExists(error)) throw error;
        }
        const snap = await lock.get();
        if (!snap.exists) continue; // released in between: try again
        if (isStale(snap.data())) {
            console.warn(`Hosting release lock for ${siteId} was left by a release that never finished; taking it over`);
            try {
                await lock.delete({ lastUpdateTime: snap.updateTime });
            } catch (error) {
                if (!changedUnder(error)) throw error;
            }
            continue;
        }
        if (Date.now() - started >= maxWaitMs) {
            const err = new Error(`Another release to ${siteId} was still running after ${Math.round(maxWaitMs / 1000)} seconds; nothing was released. Publish again.`);
            (err as any).code = 'HOSTING_RELEASE_BUSY';
            throw err;
        }
        await sleep(POLL_MS + Math.random() * POLL_MS);
    }
}

/** Removes the lock if `holder` still holds it: one taken over as stale belongs to the new holder. */
async function unlock(siteId: string, holder: string): Promise<void> {
    const lock = lockRef(siteId);
    try {
        const snap = await lock.get();
        if (!snap.exists || snap.data()?.holder !== holder) return;
        await lock.delete({ lastUpdateTime: snap.updateTime });
    } catch (error: any) {
        // The release itself is done; a lock left behind only delays the next one until it is stale.
        console.error(`Could not remove the Hosting release lock for ${siteId}: ${error?.message}`);
    }
}

export interface ReleaseLockOptions {
    /** The longest wait for the lock, in ms: RELEASE_LOCK_WAIT_MS when not given, and never more. */
    maxWaitMs?: number;
}

/**
 * Runs `work` (one Hosting release: read the live version, build on it,
 * release) while no other release to `siteId` runs. `work` gets how long it
 * waited for the lock, in ms. Throws HOSTING_RELEASE_BUSY when another release
 * holds it for longer than RELEASE_LOCK_WAIT_MS (or `maxWaitMs`, when shorter).
 */
export async function withReleaseLock<T>(
    siteId: string,
    work: (waitedMs: number) => Promise<T>,
    options: ReleaseLockOptions = {},
): Promise<T> {
    const holder = crypto.randomUUID();
    const maxWaitMs = Math.max(0, Math.min(RELEASE_LOCK_WAIT_MS, options.maxWaitMs ?? RELEASE_LOCK_WAIT_MS));
    const waitedMs = await acquire(siteId, holder, maxWaitMs);
    try {
        return await work(waitedMs);
    } finally {
        await unlock(siteId, holder);
    }
}

/** The version this code last released to `siteId`, or null when none is recorded or it cannot be read. */
export async function readRecordedRelease(siteId: string): Promise<RecordedRelease | null> {
    try {
        const snap = await recordRef(siteId).get();
        const data = snap.exists ? snap.data() : undefined;
        return typeof data?.version === 'string' && data.version
            ? { version: data.version, releaseTime: typeof data.releaseTime === 'string' ? data.releaseTime : '' }
            : null;
    } catch (error: any) {
        console.warn(`Could not read the last recorded release of ${siteId}: ${error?.message}`);
        return null;
    }
}

/** Records the version just released, for the next release to build on. Called while holding the lock. */
export async function recordRelease(siteId: string, release: RecordedRelease): Promise<void> {
    try {
        await recordRef(siteId).set(release);
    } catch (error: any) {
        // The release is live; without the record, the next one falls back to the release list.
        console.warn(`Could not record release ${release.version} of ${siteId}: ${error?.message}`);
    }
}

/**
 * The version a release builds on: the release list's latest, unless the
 * version this code recorded is newer (the list has not caught up with it yet).
 * A newer listed release, such as one from `firebase deploy`, wins.
 */
export function newerVersion(
    listed: { version?: { name?: string }; releaseTime?: string } | undefined,
    recorded: RecordedRelease | null,
): string | undefined {
    const listedName = listed?.version?.name;
    if (!recorded) return listedName;
    if (!listedName) return recorded.version;
    if (listedName === recorded.version) return listedName;
    const listedAt = Date.parse(listed?.releaseTime ?? '');
    const recordedAt = Date.parse(recorded.releaseTime);
    return Number.isFinite(listedAt) && Number.isFinite(recordedAt) && recordedAt > listedAt
        ? recorded.version
        : listedName;
}
