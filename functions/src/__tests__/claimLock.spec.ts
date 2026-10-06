/**
 * Claims merges on one account run one at a time (specs/app-claims-lock-spec.md).
 *
 * The fake Auth makes two merges interleave the way that loses a write without the
 * lock: both read the same claims, then one writes and reads back before the other's
 * slower write lands, so the read-back check alone passes for both and the first
 * writer's claims are gone. With the lease, the second merge waits and starts from
 * the first one's claims.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fb = vi.hoisted(() => {
    const state = {
        claims: {} as Record<string, Record<string, unknown>>,
        locks: new Map<string, Record<string, unknown>>(),
        /** How long each claims write takes to land, by the claim it adds. */
        writeDelay: {} as Record<string, number>,
        /** When true the lock never holds: every read finds it free (a lock that does nothing). */
        lockOff: false,
        log: [] as string[],
    };
    const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    const owner = {
        getUser: vi.fn(async (uid: string) => {
            await wait(1);
            return { uid, customClaims: state.claims[uid] ? { ...state.claims[uid] } : undefined };
        }),
        setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, unknown>) => {
            const slowest = Math.max(1, ...Object.keys(claims).map((key) => state.writeDelay[key] ?? 0));
            await wait(slowest);
            state.claims[uid] = claims;
            state.log.push(`set ${Object.keys(claims).sort().join(',')}`);
        }),
    };
    // Transactions run one at a time, as Firestore isolates them on one document.
    let queue: Promise<unknown> = Promise.resolve();
    const ref = (path: string) => ({ path });
    const db = {
        collection: vi.fn((name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) })),
        runTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
            const run = queue.then(() => fn({
                get: async (target: { path: string }) => {
                    const data = state.lockOff ? undefined : state.locks.get(target.path);
                    return { exists: data !== undefined, data: () => data };
                },
                set: (target: { path: string }, data: Record<string, unknown>) => { state.locks.set(target.path, data); },
                delete: (target: { path: string }) => { state.locks.delete(target.path); },
            }));
            queue = run.catch(() => undefined);
            return run;
        }),
    };
    return { state, owner, db };
});

vi.mock('../init.js', () => ({ owner: fb.owner, db: fb.db }));

import { mergeAppClaims, mergeClaims, mergeUserClaims } from '../users/claims.js';
import { CLAIM_LOCK_LEASE_MS, CLAIM_LOCKS, withClaimLock } from '../users/claimLock.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    fb.state.claims = {};
    fb.state.locks = new Map();
    fb.state.writeDelay = {};
    fb.state.lockOff = false;
    fb.state.log = [];
});

/** Arc's claims land fast, the app's slowly: the app's write lands after Arc has read back. */
function interleave() {
    fb.state.claims['u'] = { kiosk: 'k-1' };
    fb.state.writeDelay = { arccms_role: 3, deskRole: 40 };
    return Promise.all([
        mergeUserClaims('u', { arccms_role: 'editor' }),
        mergeAppClaims('u', { deskRole: 'lead' }),
    ]);
}

describe('two merges on one account at once', () => {
    it('lose a write when the lock does nothing: the fake Auth really interleaves them', async () => {
        fb.state.lockOff = true;
        await interleave();
        // Both read { kiosk }, Arc wrote and read back its own, then the app's write replaced it.
        expect(fb.state.claims['u']).toEqual({ kiosk: 'k-1', deskRole: 'lead' });
    });

    it('keep both sets of claims with the lock', async () => {
        await interleave();
        expect(fb.state.claims['u']).toEqual({ kiosk: 'k-1', arccms_role: 'editor', deskRole: 'lead' });
        // One after the other, each from the claims the other left: no redo was needed.
        expect(fb.owner.setCustomUserClaims).toHaveBeenCalledTimes(2);
        expect(fb.state.locks.size).toBe(0);
    });

    it('keep every write when many merges race on one account', async () => {
        fb.state.writeDelay = { a: 9, b: 1, c: 5, d: 2 };
        await Promise.all(['a', 'b', 'c', 'd'].map((key) => mergeClaims('u', { [key]: key })));
        expect(fb.state.claims['u']).toEqual({ a: 'a', b: 'b', c: 'c', d: 'd' });
    });

    it('take no lease when the claims already say so', async () => {
        fb.state.claims['u'] = { arccms_role: 'editor' };
        await mergeUserClaims('u', { arccms_role: 'editor' });
        expect(fb.db.runTransaction).not.toHaveBeenCalled();
        expect(fb.owner.setCustomUserClaims).not.toHaveBeenCalled();
    });
});

describe('withClaimLock', () => {
    it('gives the lease back when the work fails', async () => {
        await expect(withClaimLock('u', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(fb.state.locks.size).toBe(0);
    });

    it('takes over a lease a crashed writer left past its expiry', async () => {
        fb.state.locks.set(`${CLAIM_LOCKS}/u`, { token: 'crashed', expiresAt: Date.now() - 1 });
        await expect(withClaimLock('u', async () => 'done')).resolves.toBe('done');
        expect(fb.state.locks.size).toBe(0);
    });

    it('waits for a live lease, and gives up with an error after the wait', async () => {
        vi.useFakeTimers();
        fb.state.locks.set(`${CLAIM_LOCKS}/u`, { token: 'other', expiresAt: Date.now() + 10 * CLAIM_LOCK_LEASE_MS });
        const work = vi.fn(async () => 'done');
        const outcome = withClaimLock('u', work).catch((error: Error) => error.message);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(outcome).resolves.toMatch('held the account for too long');
        expect(work).not.toHaveBeenCalled();
        // Someone else's lease is never removed.
        expect(fb.state.locks.get(`${CLAIM_LOCKS}/u`)).toMatchObject({ token: 'other' });
    });

    it('does not give back a lease that expired and went to another writer', async () => {
        await withClaimLock('u', async () => {
            fb.state.locks.set(`${CLAIM_LOCKS}/u`, { token: 'next-writer', expiresAt: Date.now() + CLAIM_LOCK_LEASE_MS });
        });
        expect(fb.state.locks.get(`${CLAIM_LOCKS}/u`)).toMatchObject({ token: 'next-writer' });
    });
});

describe('the _claim_locks collection', () => {
    it('is closed to every client in firestore.rules', () => {
        const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');
        expect(rules).toMatch(/match \/_claim_locks\/\{uid\} \{\s*allow read, write: if false;\s*\}/);
    });
});
