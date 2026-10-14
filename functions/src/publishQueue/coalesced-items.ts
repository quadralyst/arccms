import { Timestamp, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Queue items that coalesce: a whole-site republish ('redeploy-all') and a
 * rebuild of the pages showing one type's entries ('items-from'). Each is one
 * queue document with a fixed id, so however many changes ask for it at once,
 * at most one waits and at most one runs:
 *
 * - The first caller creates it (`create()`, so concurrent callers collapse
 *   into one document and one trigger).
 * - A caller that finds it waiting does nothing: the run reads the data when
 *   it starts, so it shows that caller's change too. A waiting continuation
 *   only builds what comes after its cursor, so it is marked `rerun` instead:
 *   one full run follows it.
 * - A caller that finds it running marks it `dirty`: the run may have read the
 *   data before the change, so it runs exactly once more when it finishes.
 * - The run removes it when it finishes, also when it failed, and creates it
 *   again when it was marked dirty (or has more to do, `continuation`).
 *
 * A run that fails (a release that did not go out, HOSTING_RELEASE_BUSY
 * included) is run again, from the same part, up to MAX_FAILED_RUNS runs in a
 * row (`failedRuns`, `lastError`); then it stops until a change asks again.
 *
 * A document left behind by a run that never finished (the function timed out
 * or crashed) would block every later one, so one older than STALE_MS is
 * treated as gone: a request that finds it queues a new run, and
 * recoverPublishQueue (every 10 minutes) runs it again as a failed run, so the
 * changes it was marked `dirty` for are not left waiting for one.
 */

const QUEUE = '_publish_queue';

/** Longer than the queue function's timeout (540s), so a live run is never taken for a dead one. */
export const STALE_MS = 15 * 60 * 1000;

/** How many times a step is tried again when another writer changed the document under it. */
const ATTEMPTS = 8;

/** How many runs in a row of one item may fail before it is not run again until a change asks for it. */
export const MAX_FAILED_RUNS = 3;

export type CoalescedAction = 'redeploy-all' | 'items-from';

/** The fixed id of the one whole-site republish. */
export const REDEPLOY_ALL_ID = 'redeploy-all';

/** The fixed id of the one rebuild of the pages showing entries of `slug`. */
export function itemsFromId(slug: string): string {
    return `items-from--${slug}`;
}

/** The fixed id an action's item has, or '' for an action that does not coalesce. */
export function coalescedIdFor(action: string, contentTypeSlug: string): string {
    if (action === 'redeploy-all') return REDEPLOY_ALL_ID;
    if (action === 'items-from' && contentTypeSlug) return itemsFromId(contentTypeSlug);
    return '';
}

interface CoalescedItem {
    action: CoalescedAction;
    contentTypeSlug: string;
    docId: string;
    timestamp: Timestamp;
    coalesced: true;
    state: 'waiting' | 'running';
    /** When it entered its state, in ms: to tell a dead run from a live one. */
    since: number;
    /** Set while it runs, by a change it may have missed: run once more. */
    dirty: boolean;
    /** Carried by a continuation whose earlier part was marked dirty: one full run after it. */
    rerun?: boolean;
    /** Where a continuation goes on from (the run's own cursor). */
    after?: unknown;
    /** How many runs of it in a row failed: it is run again while this is below MAX_FAILED_RUNS. */
    failedRuns?: number;
    /** Why the last failed run failed. */
    lastError?: string;
    [extra: string]: unknown;
}

/** Whether a Firestore error has this gRPC code (by number, name or message). */
function hasCode(error: unknown, code: number, name: string): boolean {
    const err = error as { code?: unknown; message?: unknown };
    return err?.code === code || err?.code === name
        || (typeof err?.message === 'string' && err.message.toUpperCase().includes(name.toUpperCase().replace('-', '_')));
}
const alreadyExists = (e: unknown) => hasCode(e, 6, 'already-exists');
const notFound = (e: unknown) => hasCode(e, 5, 'not-found');
const changedUnder = (e: unknown) => hasCode(e, 9, 'failed-precondition') || notFound(e);

/**
 * How far in the future an item's `since` may be, for a clock a little ahead
 * of this one. One further ahead was not written by a run (the functions write
 * `Date.now()`), so it is stale, not live forever.
 */
export const FUTURE_SINCE_MS = 60 * 1000;

function isStale(data: Partial<CoalescedItem> | undefined): boolean {
    if (typeof data?.since !== 'number') return true;
    const age = Date.now() - data.since;
    return age > STALE_MS || age < -FUTURE_SINCE_MS;
}

function ref(id: string): DocumentReference {
    return db.collection(QUEUE).doc(id);
}

function waitingItem(action: CoalescedAction, contentTypeSlug: string, extra: Record<string, unknown> = {}): CoalescedItem {
    return {
        action, contentTypeSlug, docId: '', timestamp: Timestamp.now(),
        coalesced: true, state: 'waiting', since: Date.now(), dirty: false, ...extra,
    };
}

/** What a request found: it created the item, one was already waiting, or one was running and runs again. */
export type QueueOutcome = 'queued' | 'waiting' | 'dirty';

/**
 * Asks for a run of `action` (for `contentTypeSlug`, for items-from). Resolves
 * once a run that starts after this call is certain: the outcome says how.
 */
export async function requestCoalesced(action: CoalescedAction, contentTypeSlug = ''): Promise<QueueOutcome> {
    const id = coalescedIdFor(action, contentTypeSlug);
    const item = ref(id);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
            await item.create(waitingItem(action, contentTypeSlug));
            return 'queued';
        } catch (error) {
            if (!alreadyExists(error)) throw error;
        }
        const snap = await item.get();
        if (!snap.exists) continue; // finished in between: create it again
        const data = snap.data() as Partial<CoalescedItem>;
        if (isStale(data)) {
            console.warn(`Queue item ${id} was left ${data.state ?? 'behind'} by a run that never finished; queuing a new one`);
            try {
                await item.delete({ lastUpdateTime: snap.updateTime });
            } catch (error) {
                if (!changedUnder(error)) throw error;
            }
            continue;
        }
        if (data.state !== 'running') {
            // A waiting continuation (`after`) builds only the pages after its cursor:
            // the ones an earlier part built would never show this change. Mark it
            // for one full run after it, unless it is already.
            if (data.after === undefined || data.rerun === true) return 'waiting';
            try {
                await item.update({ rerun: true }, { lastUpdateTime: snap.updateTime });
                return 'waiting';
            } catch (error) {
                if (!changedUnder(error)) throw error;
                continue; // claimed or finished in between: look again
            }
        }
        if (data.dirty === true) return 'dirty';
        try {
            await item.update({ dirty: true });
            return 'dirty';
        } catch (error) {
            if (!notFound(error)) throw error; // finished in between: create it again
        }
    }
    // Every attempt met another writer: someone else is queuing the same run.
    console.warn(`Queue item ${id}: gave up after ${ATTEMPTS} attempts, another change is queuing it`);
    return 'waiting';
}

/**
 * Called by the queue function on a coalesced item: marks it running and
 * returns what it asks for, or null when there is nothing to run (it is gone,
 * or another invocation of the same trigger is running it).
 */
export async function claimCoalesced(id: string): Promise<Record<string, unknown> | null> {
    const item = ref(id);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const snap: DocumentSnapshot = await item.get();
        if (!snap.exists) return null;
        const data = snap.data() as Partial<CoalescedItem>;
        if (data.state === 'running' && !isStale(data)) return null;
        try {
            // Clearing dirty is right: whatever asked for it happened before this run reads anything.
            await item.update({ state: 'running', since: Date.now(), dirty: false }, { lastUpdateTime: snap.updateTime });
            return { ...data, state: 'running', dirty: false };
        } catch (error) {
            if (!changedUnder(error)) throw error;
        }
    }
    return null;
}

/** How a run ended, for finishCoalesced: `failed` when it must run again (MAX_FAILED_RUNS). */
export interface RunOutcome {
    failed?: boolean;
    /** Why it failed, kept on the item as `lastError`. */
    error?: string;
}

/**
 * The fields of the run that follows one that ended (`data` is its item), or
 * null when none follows:
 *
 * - it failed: the same part again (`continuation` is where it started), up
 *   to MAX_FAILED_RUNS runs in a row; after that, only a full run when a change
 *   asked for one meanwhile;
 * - it has more to do (`continuation`): the rest, with `rerun` when a change
 *   asked meanwhile;
 * - a change asked meanwhile (`dirty`, `rerun`): one full run.
 */
function nextRun(
    id: string,
    data: Partial<CoalescedItem>,
    continuation: Record<string, unknown> | undefined,
    outcome: RunOutcome,
): Record<string, unknown> | null {
    const again = data.dirty === true || data.rerun === true;
    if (outcome.failed) {
        const failedRuns = (typeof data.failedRuns === 'number' ? data.failedRuns : 0) + 1;
        const lastError = outcome.error || 'unknown error';
        if (failedRuns < MAX_FAILED_RUNS) {
            console.warn(`Queue item ${id} failed (${lastError}); running it again (${failedRuns} of ${MAX_FAILED_RUNS - 1} retries)`);
            return { ...(continuation ?? {}), rerun: continuation ? again : false, failedRuns, lastError };
        }
        console.error(`Queue item ${id} failed ${failedRuns} runs in a row (${lastError}); it is not run again`
            + (again ? ' but for the change that came in meanwhile, once' : ' until a change asks for it'));
        // Still counted, so a full run for that change that fails too is not run again either.
        return again ? { failedRuns, lastError } : null;
    }
    if (!continuation && !again) return null;
    return continuation ? { ...continuation, rerun: again } : {};
}

function actionAndSlug(id: string, data: Partial<CoalescedItem>): [CoalescedAction, string] {
    const action = (data.action ?? (id === REDEPLOY_ALL_ID ? 'redeploy-all' : 'items-from')) as CoalescedAction;
    const slug = data.contentTypeSlug ?? (id.startsWith('items-from--') ? id.slice('items-from--'.length) : '');
    return [action, slug];
}

/** Creates the run that follows, unless a request created one first (which covers it). */
async function queueNext(item: DocumentReference, action: CoalescedAction, slug: string, fields: Record<string, unknown>): Promise<void> {
    try {
        await item.create(waitingItem(action, slug, fields));
    } catch (error) {
        // A change queued a full run in between: that covers this one.
        if (!alreadyExists(error)) throw error;
    }
}

/**
 * Called by the queue function when a run of a coalesced item ends, whether it
 * worked or not: removes the item, and creates it again (a new trigger) when a
 * change came in while it ran, with `continuation` when it has more to do, or,
 * when it failed (`outcome.failed`), to run the same part again (`continuation`
 * is then where the failed part started).
 */
export async function finishCoalesced(id: string, continuation?: Record<string, unknown>, outcome: RunOutcome = {}): Promise<void> {
    const item = ref(id);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const snap = await item.get();
        const data = (snap.exists ? snap.data() : {}) as Partial<CoalescedItem>;
        // A waiting item is a new request (this run was taken for dead): it is not this
        // run's to remove, and it runs everything, the rest of this run included.
        if (snap.exists && data.state !== 'running') return;
        if (snap.exists) {
            try {
                // Only if nobody marked it dirty since it was read.
                await item.delete({ lastUpdateTime: snap.updateTime });
            } catch (error) {
                if (!changedUnder(error)) throw error;
                continue;
            }
        }
        const [action, slug] = actionAndSlug(id, data);
        const next = nextRun(id, data, continuation, outcome);
        if (next) await queueNext(item, action, slug, next);
        return;
    }
    console.error(`Queue item ${id}: could not be finished after ${ATTEMPTS} attempts; it is cleared once it is ${STALE_MS / 60000} minutes old`);
}

/**
 * Runs again every coalesced item left by a run that never finished or never
 * started (older than STALE_MS), as a failed run (nextRun): the part it was
 * on, with what it was marked for. Called by recoverPublishQueue. Resolves
 * with the ids it ran again.
 */
export async function recoverStaleCoalesced(): Promise<string[]> {
    const snap = await db.collection(QUEUE).where('coalesced', '==', true).get();
    const recovered: string[] = [];
    for (const doc of snap.docs) {
        const data = doc.data() as Partial<CoalescedItem>;
        if (!isStale(data)) continue;
        const item = ref(doc.id);
        try {
            // Only if it is still the one read: a request may have replaced it meanwhile.
            await item.delete({ lastUpdateTime: doc.updateTime });
        } catch (error) {
            if (!changedUnder(error)) throw error;
            continue;
        }
        const [action, slug] = actionAndSlug(doc.id, data);
        const error = data.state === 'running'
            ? 'the run never finished: the function timed out or crashed'
            : 'the run never started';
        console.warn(`Queue item ${doc.id} was left ${data.state ?? 'behind'}: ${error}`);
        const next = nextRun(doc.id, data, data.after !== undefined ? { after: data.after } : undefined, { failed: true, error });
        if (next) await queueNext(item, action, slug, next);
        recovered.push(doc.id);
    }
    return recovered;
}
