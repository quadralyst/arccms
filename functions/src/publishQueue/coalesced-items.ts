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
 *   it starts, so it shows that caller's change too.
 * - A caller that finds it running marks it `dirty`: the run may have read the
 *   data before the change, so it runs exactly once more when it finishes.
 * - The run removes it when it finishes, also when it failed, and creates it
 *   again when it was marked dirty (or has more to do, `continuation`).
 *
 * A document left behind by a run that never finished (the function timed out
 * or crashed) would block every later one, so one older than STALE_MS is
 * treated as gone.
 */

const QUEUE = '_publish_queue';

/** Longer than the queue function's timeout (540s), so a live run is never taken for a dead one. */
export const STALE_MS = 15 * 60 * 1000;

/** How many times a step is tried again when another writer changed the document under it. */
const ATTEMPTS = 8;

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

function isStale(data: Partial<CoalescedItem> | undefined): boolean {
    return typeof data?.since !== 'number' || Date.now() - data.since > STALE_MS;
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
        if (data.state !== 'running') return 'waiting';
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

/**
 * Called by the queue function when a run of a coalesced item ends, whether it
 * worked or not: removes the item, and creates it again (a new trigger) when a
 * change came in while it ran, or with `continuation` when it has more to do.
 */
export async function finishCoalesced(id: string, continuation?: Record<string, unknown>): Promise<void> {
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
        const action = (data.action ?? (id === REDEPLOY_ALL_ID ? 'redeploy-all' : 'items-from')) as CoalescedAction;
        const slug = data.contentTypeSlug ?? (id.startsWith('items-from--') ? id.slice('items-from--'.length) : '');
        const again = data.dirty === true || data.rerun === true;
        if (!continuation && !again) return;
        try {
            await item.create(waitingItem(action, slug, continuation ? { ...continuation, rerun: again } : {}));
        } catch (error) {
            // A change queued a full run in between: that covers this one.
            if (!alreadyExists(error)) throw error;
        }
        return;
    }
    console.error(`Queue item ${id}: could not be finished after ${ATTEMPTS} attempts; it is cleared once it is ${STALE_MS / 60000} minutes old`);
}
