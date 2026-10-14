/**
 * Queue items that coalesce (publishQueue/coalesced-items.ts): a whole-site
 * republish and a rebuild of the pages showing one type's entries. However many
 * changes ask at once, one waits and one runs; a change while it runs makes it
 * run exactly once more.
 *
 * The queue here is an in-memory Firestore collection that keeps an update
 * time per document, honours create(), lastUpdateTime preconditions and
 * NOT_FOUND on update, and yields before every operation, so calls made
 * together really interleave.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Data = Record<string, any>;

const queue = vi.hoisted(() => {
    const docs = new Map<string, { data: Record<string, any>; version: number }>();
    let clock = 0;
    /** How many times each id was created: each create is one trigger, one run. */
    const creates = new Map<string, number>();
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
    const check = (id: string, pre?: { lastUpdateTime?: number }) => {
        if (pre?.lastUpdateTime !== undefined && docs.get(id)?.version !== pre.lastUpdateTime) {
            throw fail(9, `9 FAILED_PRECONDITION: ${id} changed`);
        }
    };
    const ref = (id: string) => ({
        id,
        get: async () => {
            await tick();
            const doc = docs.get(id);
            return { exists: !!doc, id, updateTime: doc?.version, data: () => (doc ? { ...doc.data } : undefined) };
        },
        create: async (data: Record<string, any>) => {
            await tick();
            if (docs.has(id)) throw fail(6, `6 ALREADY_EXISTS: ${id}`);
            docs.set(id, { data: { ...data }, version: ++clock });
            creates.set(id, (creates.get(id) ?? 0) + 1);
        },
        update: async (data: Record<string, any>, pre?: { lastUpdateTime?: number }) => {
            await tick();
            const doc = docs.get(id);
            if (!doc) throw fail(5, `5 NOT_FOUND: ${id}`);
            check(id, pre);
            docs.set(id, { data: { ...doc.data, ...data }, version: ++clock });
        },
        delete: async (pre?: { lastUpdateTime?: number }) => {
            await tick();
            if (docs.has(id)) check(id, pre);
            docs.delete(id);
        },
    });
    /** The documents whose `field` equals `value`, as a query snapshot. */
    const where = (field: string, value: unknown) => ({
        get: async () => {
            await tick();
            const matching = [...docs].filter(([, doc]) => doc.data[field] === value);
            return { docs: matching.map(([id, doc]) => ({ id, updateTime: doc.version, data: () => ({ ...doc.data }) })) };
        },
    });
    return { docs, creates, ref, where, reset: () => { docs.clear(); creates.clear(); } };
});

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => {
            if (name !== '_publish_queue') throw new Error(name);
            return { doc: (id: string) => queue.ref(id), where: (field: string, _op: string, value: unknown) => queue.where(field, value) };
        },
    },
}));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => ({ seconds: 1705334400, nanoseconds: 0 }) } }));

import {
    claimCoalesced, coalescedIdFor, finishCoalesced, itemsFromId, MAX_FAILED_RUNS, recoverStaleCoalesced, requestCoalesced,
    REDEPLOY_ALL_ID, STALE_MS,
} from '../publishQueue/coalesced-items.js';

const item = (id: string): Data | undefined => queue.docs.get(id)?.data;
const ask = (n: number, action: 'redeploy-all' | 'items-from' = 'redeploy-all', slug = '') =>
    Promise.all(Array.from({ length: n }, () => requestCoalesced(action, slug)));

describe('coalesced queue items', () => {
    beforeEach(() => {
        queue.reset();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('has one fixed id per kind: the whole site, and each type', () => {
        expect(coalescedIdFor('redeploy-all', '')).toBe(REDEPLOY_ALL_ID);
        expect(coalescedIdFor('items-from', 'events')).toBe(itemsFromId('events'));
        expect(itemsFromId('events')).not.toBe(itemsFromId('news'));
        expect(coalescedIdFor('publish', 'events')).toBe('');
        expect(coalescedIdFor('items-from', '')).toBe('');
    });

    it('turns 20 simultaneous requests for a whole-site republish into one queue item', async () => {
        const outcomes = await ask(20);
        expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(1);
        expect(outcomes.filter((o) => o === 'queued')).toHaveLength(1);
        expect(outcomes.filter((o) => o === 'waiting')).toHaveLength(19);
        expect(item(REDEPLOY_ALL_ID)).toMatchObject({ action: 'redeploy-all', contentTypeSlug: '', docId: '', state: 'waiting', dirty: false });
    });

    it('runs once more, exactly once, for requests made while it runs', async () => {
        await ask(1);
        expect(await claimCoalesced(REDEPLOY_ALL_ID)).toMatchObject({ action: 'redeploy-all', state: 'running' });
        // A bulk publish while it runs: twenty changes the run may have missed.
        const outcomes = await ask(20);
        expect(outcomes.every((o) => o === 'dirty')).toBe(true);
        expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(1);

        await finishCoalesced(REDEPLOY_ALL_ID);
        expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(2);
        expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting', dirty: false });

        // The follow-up runs and nothing came in meanwhile: nothing is left.
        expect(await claimCoalesced(REDEPLOY_ALL_ID)).not.toBeNull();
        await finishCoalesced(REDEPLOY_ALL_ID);
        expect(item(REDEPLOY_ALL_ID)).toBeUndefined();
        expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(2);
    });

    it('leaves nothing behind after a run nobody asked again for', async () => {
        await ask(3);
        await claimCoalesced(REDEPLOY_ALL_ID);
        await finishCoalesced(REDEPLOY_ALL_ID);
        expect(queue.docs.size).toBe(0);
        expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(1);
    });

    it('never loses a request that races the end of a run', async () => {
        const ticks = async (n: number) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
        for (let round = 0; round < 12; round++) {
            queue.reset();
            await ask(1);
            await claimCoalesced(REDEPLOY_ALL_ID);
            // Asking and finishing at nearly the same moment, the finish a step
            // or more behind, so every interleaving of their reads and writes comes up.
            const requests = Array.from({ length: (round % 3) + 1 }, () => requestCoalesced('redeploy-all'));
            await Promise.all([ticks(Math.floor(round / 3)).then(() => finishCoalesced(REDEPLOY_ALL_ID)), ...requests]);
            // Whatever the order, exactly one run follows: it is waiting, and was created once more.
            expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting' });
            expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(2);
        }
    });

    it('runs an item once when its trigger is delivered twice', async () => {
        await ask(1);
        const claims = await Promise.all([claimCoalesced(REDEPLOY_ALL_ID), claimCoalesced(REDEPLOY_ALL_ID)]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        // And again after it finished: there is nothing to run.
        await finishCoalesced(REDEPLOY_ALL_ID);
        expect(await claimCoalesced(REDEPLOY_ALL_ID)).toBeNull();
    });

    it('does not let a run that never finished block the next one', async () => {
        await ask(1);
        await claimCoalesced(REDEPLOY_ALL_ID);
        queue.docs.get(REDEPLOY_ALL_ID)!.data['since'] = Date.now() - STALE_MS - 1;
        expect(await requestCoalesced('redeploy-all')).toBe('queued');
        expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting' });
        expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(2);
    });

    it('does not take a run whose start is far in the future for a live one forever', async () => {
        await ask(1);
        await claimCoalesced(REDEPLOY_ALL_ID);
        queue.docs.get(REDEPLOY_ALL_ID)!.data['since'] = Date.now() + 60 * 60_000;
        expect(await requestCoalesced('redeploy-all')).toBe('queued');
        expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting' });
    });

    it('takes a run a few seconds ahead, as a clock a little ahead writes, for a live one', async () => {
        await ask(1);
        await claimCoalesced(REDEPLOY_ALL_ID);
        queue.docs.get(REDEPLOY_ALL_ID)!.data['since'] = Date.now() + 5_000;
        expect(await requestCoalesced('redeploy-all')).toBe('dirty');
    });

    it('keeps one item per type for the pages showing its entries', async () => {
        await Promise.all([ask(20, 'items-from', 'events'), ask(5, 'items-from', 'news')]);
        expect(queue.creates.get(itemsFromId('events'))).toBe(1);
        expect(queue.creates.get(itemsFromId('news'))).toBe(1);
        expect(item(itemsFromId('events'))).toMatchObject({ action: 'items-from', contentTypeSlug: 'events', docId: '' });

        await claimCoalesced(itemsFromId('events'));
        expect(await requestCoalesced('items-from', 'events')).toBe('dirty');
        expect(await requestCoalesced('items-from', 'news')).toBe('waiting');
        await finishCoalesced(itemsFromId('events'));
        expect(queue.creates.get(itemsFromId('events'))).toBe(2);
    });

    it('queues the rest of a run that ran out of time, then one full run for a change it may have missed', async () => {
        const id = itemsFromId('events');
        await ask(1, 'items-from', 'events');
        await claimCoalesced(id);
        await finishCoalesced(id, { after: { type: 'guides', id: 'g7' } });
        expect(item(id)).toMatchObject({ state: 'waiting', after: { type: 'guides', id: 'g7' }, rerun: false });

        // The continuation runs; a change comes in meanwhile, and it finishes the rest.
        expect(await claimCoalesced(id)).toMatchObject({ after: { type: 'guides', id: 'g7' } });
        await requestCoalesced('items-from', 'events');
        await finishCoalesced(id, { after: { type: 'guides', id: 'g9' } });
        expect(item(id)).toMatchObject({ after: { type: 'guides', id: 'g9' }, rerun: true });

        // The last part, then a full run from the start for the change.
        await claimCoalesced(id);
        await finishCoalesced(id);
        expect(item(id)).toMatchObject({ state: 'waiting', contentTypeSlug: 'events' });
        expect(item(id)!['after']).toBeUndefined();
        await claimCoalesced(id);
        await finishCoalesced(id);
        expect(item(id)).toBeUndefined();
    });

    it('marks a waiting continuation for a full run after it, as the pages before its cursor miss the change', async () => {
        const id = itemsFromId('events');
        await ask(1, 'items-from', 'events');
        await claimCoalesced(id);
        await finishCoalesced(id, { after: { type: 'guides', id: 'g7' } });
        expect(item(id)).toMatchObject({ state: 'waiting', rerun: false });

        // A change while the rest waits: the pages up to g7 are already built without it.
        expect(await ask(3, 'items-from', 'events')).toEqual(['waiting', 'waiting', 'waiting']);
        expect(item(id)).toMatchObject({ state: 'waiting', after: { type: 'guides', id: 'g7' }, rerun: true });
        expect(queue.creates.get(id)).toBe(2);

        // The rest runs, then one full run from the start.
        await claimCoalesced(id);
        await finishCoalesced(id);
        expect(item(id)).toMatchObject({ state: 'waiting' });
        expect(item(id)!['after']).toBeUndefined();
        await claimCoalesced(id);
        await finishCoalesced(id);
        expect(item(id)).toBeUndefined();
    });

    it('leaves a waiting full run as it is: it reads the change when it starts', async () => {
        await ask(1, 'items-from', 'events');
        const before = queue.docs.get(itemsFromId('events'))!.version;
        expect(await requestCoalesced('items-from', 'events')).toBe('waiting');
        expect(queue.docs.get(itemsFromId('events'))!.version).toBe(before);
        expect(item(itemsFromId('events'))!['rerun']).toBeUndefined();
    });

    describe('a run that fails', () => {
        const failed = { failed: true, error: 'HOSTING_RELEASE_BUSY: busy' };

        it('runs again, the same part, and keeps why it failed', async () => {
            const id = itemsFromId('events');
            await ask(1, 'items-from', 'events');
            await claimCoalesced(id);
            await finishCoalesced(id, { after: { type: 'guides', id: 'g7' } }, failed);
            expect(item(id)).toMatchObject({ state: 'waiting', after: { type: 'guides', id: 'g7' }, failedRuns: 1, lastError: 'HOSTING_RELEASE_BUSY: busy' });
            expect(queue.creates.get(id)).toBe(2);
        });

        it('stops after MAX_FAILED_RUNS runs in a row, so a run that always fails does not loop', async () => {
            await ask(1);
            for (let run = 1; run <= MAX_FAILED_RUNS; run++) {
                expect(await claimCoalesced(REDEPLOY_ALL_ID)).not.toBeNull();
                await finishCoalesced(REDEPLOY_ALL_ID, undefined, failed);
            }
            expect(item(REDEPLOY_ALL_ID)).toBeUndefined();
            expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(MAX_FAILED_RUNS);
            // A new change asks again: a fresh run, with no failures counted.
            expect(await requestCoalesced('redeploy-all')).toBe('queued');
            expect(item(REDEPLOY_ALL_ID)!['failedRuns']).toBeUndefined();
        });

        it('counts from 0 again after a run that worked', async () => {
            await ask(1);
            await claimCoalesced(REDEPLOY_ALL_ID);
            await finishCoalesced(REDEPLOY_ALL_ID, undefined, failed);
            await claimCoalesced(REDEPLOY_ALL_ID);
            await requestCoalesced('redeploy-all'); // a change while the retry runs
            await finishCoalesced(REDEPLOY_ALL_ID);
            expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting', dirty: false });
            expect(item(REDEPLOY_ALL_ID)!['failedRuns']).toBeUndefined();
        });

        it('still runs once for a change that came in meanwhile after the last failure, and no more', async () => {
            await ask(1);
            for (let run = 1; run < MAX_FAILED_RUNS; run++) {
                await claimCoalesced(REDEPLOY_ALL_ID);
                await finishCoalesced(REDEPLOY_ALL_ID, undefined, failed);
            }
            await claimCoalesced(REDEPLOY_ALL_ID);
            await requestCoalesced('redeploy-all');
            await finishCoalesced(REDEPLOY_ALL_ID, undefined, failed);
            expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting', failedRuns: MAX_FAILED_RUNS });
            await claimCoalesced(REDEPLOY_ALL_ID);
            await finishCoalesced(REDEPLOY_ALL_ID, undefined, failed);
            expect(item(REDEPLOY_ALL_ID)).toBeUndefined();
        });
    });

    describe('recovering a run that never finished (recoverPublishQueue)', () => {
        const age = (id: string, ms: number) => { queue.docs.get(id)!.data['since'] = Date.now() - ms; };

        it('runs again a run the function died in, with the change it was marked dirty for, from the part it was on', async () => {
            const id = itemsFromId('events');
            await ask(1, 'items-from', 'events');
            await claimCoalesced(id);
            await finishCoalesced(id, { after: { type: 'guides', id: 'g7' } });
            await claimCoalesced(id);
            // A change while it runs, then the function is killed: nothing finishes it.
            expect(await requestCoalesced('items-from', 'events')).toBe('dirty');
            age(id, STALE_MS + 1);

            expect(await recoverStaleCoalesced()).toEqual([id]);
            expect(item(id)).toMatchObject({ state: 'waiting', after: { type: 'guides', id: 'g7' }, rerun: true, failedRuns: 1 });
            expect(item(id)!['lastError']).toContain('never finished');
            expect(queue.creates.get(id)).toBe(3);
        });

        it('runs again an item whose run never started', async () => {
            await ask(1);
            age(REDEPLOY_ALL_ID, STALE_MS + 1);
            expect(await recoverStaleCoalesced()).toEqual([REDEPLOY_ALL_ID]);
            expect(item(REDEPLOY_ALL_ID)).toMatchObject({ state: 'waiting', failedRuns: 1 });
            expect(item(REDEPLOY_ALL_ID)!['lastError']).toContain('never started');
        });

        it('leaves live runs and waiting items alone', async () => {
            await ask(1);
            await ask(1, 'items-from', 'events');
            await claimCoalesced(itemsFromId('events'));
            age(REDEPLOY_ALL_ID, STALE_MS - 60_000);

            expect(await recoverStaleCoalesced()).toEqual([]);
            expect(queue.creates.get(REDEPLOY_ALL_ID)).toBe(1);
            expect(item(itemsFromId('events'))).toMatchObject({ state: 'running' });
        });

        it('gives up on an item that keeps dying after MAX_FAILED_RUNS', async () => {
            await ask(1);
            queue.docs.get(REDEPLOY_ALL_ID)!.data['failedRuns'] = MAX_FAILED_RUNS - 1;
            await claimCoalesced(REDEPLOY_ALL_ID);
            age(REDEPLOY_ALL_ID, STALE_MS + 1);
            expect(await recoverStaleCoalesced()).toEqual([REDEPLOY_ALL_ID]);
            expect(item(REDEPLOY_ALL_ID)).toBeUndefined();
        });
    });
});
