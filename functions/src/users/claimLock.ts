/**
 * One claims write at a time per account (specs/app-claims-lock-spec.md).
 *
 * Firebase Auth has no atomic merge of custom claims: a merge reads the claims, then
 * replaces them all. Two merges on the same account at once can therefore lose one,
 * even with a read-back check, when one writer reads back before the other's write
 * lands. So every merge holds a short lease on `_claim_locks/{uid}` while it reads,
 * writes and reads back. A Firestore transaction cannot contain the Auth calls, so the
 * transaction only takes and gives back the lease; the Auth work happens between.
 *
 * The lease expires, so a writer that crashed cannot block the account for good. A
 * writer that outlives its lease (Auth slower than CLAIM_LOCK_LEASE_MS) can still race
 * the next one; the read-back check in mergeClaims is the second line for that case.
 * The collection is closed to every client in firestore.rules.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../init.js';

export const CLAIM_LOCKS = '_claim_locks';

/** How long a lease lasts. The work it covers is three Auth calls, about a second. */
export const CLAIM_LOCK_LEASE_MS = 15_000;

/** How long a writer waits for the lease: past a crashed holder's lease, inside a function's 60 seconds. */
export const CLAIM_LOCK_WAIT_MS = 20_000;

const FIRST_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Take the lease if it is free or expired. Returns whether this writer holds it. */
async function acquire(uid: string, token: string): Promise<boolean> {
    const ref = db.collection(CLAIM_LOCKS).doc(uid);
    return db.runTransaction(async (tx) => {
        const now = Date.now();
        const held = await tx.get(ref);
        const expiresAt = Number(held.exists ? held.data()?.['expiresAt'] : 0);
        if (held.exists && expiresAt > now) return false;
        tx.set(ref, { token, expiresAt: now + CLAIM_LOCK_LEASE_MS });
        return true;
    });
}

/** Give the lease back, unless it expired and another writer now holds it. */
async function release(uid: string, token: string): Promise<void> {
    const ref = db.collection(CLAIM_LOCKS).doc(uid);
    await db.runTransaction(async (tx) => {
        const held = await tx.get(ref);
        if (held.exists && held.data()?.['token'] === token) tx.delete(ref);
    });
}

/**
 * Run `work` while holding the account's claims lease. Waits, with growing pauses,
 * while another writer holds it, and gives up with an error after CLAIM_LOCK_WAIT_MS.
 * The lease is given back however `work` ends.
 */
export async function withClaimLock<T>(uid: string, work: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + CLAIM_LOCK_WAIT_MS;
    let pause = FIRST_BACKOFF_MS;
    while (!(await acquire(uid, token))) {
        if (Date.now() >= deadline) {
            throw new Error(`Could not set the claims on ${uid}: another claims write held the account for too long.`);
        }
        await sleep(pause / 2 + Math.random() * pause);
        pause = Math.min(pause * 2, MAX_BACKOFF_MS);
    }
    try {
        return await work();
    } finally {
        await release(uid, token).catch(() => undefined);
    }
}
