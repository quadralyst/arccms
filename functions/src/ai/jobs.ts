/**
 * Long jobs (specs/ai-media-spec.md, AM-D12, AM-D13, AM-D14): a model that takes longer than
 * a call can wait (every video model) answers `{ ok: 'pending', jobId, recordId }`, and Arc
 * keeps `AiJobs/{jobId}` until it ends. `checkAiJobs` asks each provider how its job is doing
 * every minute, streams a finished file into Storage, brings the call's record up to date,
 * adds it to the month the job started in (what the provider bills), and runs the purpose's
 * `onJobDone`. A job not done within its purpose's `jobTimeoutMinutes` fails with `timeout`.
 * A test-mode job finishes on the next check with the grey stand-in video.
 *
 * Admins read every job, a call's `readers` read their own, nobody writes one from a browser.
 * The job's id is its call's record id.
 */
import { randomUUID } from 'node:crypto';
import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { jobCheckerFor } from './connectors/index.js';
import type { AttemptUsage, JobFile, MadeFile } from './connectors/types.js';
import { attemptCost } from './cost.js';
import { filePaths, saveFiles, streamToStorage } from './files.js';
import { readKey } from './keys.js';
import { findPreset, presetNeedsKey } from './presets.js';
import { findPurpose } from './purposes.js';
import { AI_CALLS, type AiCallRecord } from './records.js';
import { modelInfo, readAiSettings } from './settings.js';
import { standInFiles } from './standins.js';
import { addToTotals, noteConnection } from './usage.js';
import { secondPrice } from './videos.js';
import type { AiFailureReason, AiFile, AiJob, AiJobResult, AiKind, AiPurpose, AiVideoSettings } from './types.js';

export const AI_JOBS = 'AiJobs';
export const DEFAULT_JOB_MINUTES = 30;
export const MAX_JOB_MINUTES = 120;
/** How many times onJobDone runs in all when it throws. */
export const MAX_HOOK_TRIES = 3;
/** The most jobs one check looks at; the rest wait a minute. */
export const JOBS_PER_CHECK = 25;
/** A check holds a job this long: more than the 540 seconds a check may run, so a hold never lapses mid-check. */
const CLAIM_MS = 10 * 60_000;
/** How long one provider check, and one file's fetch, may take. */
const CHECK_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 240_000;

export type AiJobStatus = 'pending' | 'done' | 'failed';

/** What `AiJobs/{id}` holds. */
export interface AiJobDoc {
    purpose: string;
    kind: AiKind;
    status: AiJobStatus;
    recordId: string;
    ref: string | null;
    limitKey: string | null;
    readers: string[];
    test: boolean;
    connection: string | null;
    model: string | null;
    /** The provider's id for the job. */
    operation: string | null;
    saveTo: string | null;
    saveAs: string | null;
    /** The settings it was started with. */
    video: AiVideoSettings | null;
    /** The allowance it counted, given back when it fails before the provider bills (AM-D14). */
    allowance: { path: string; units: number } | null;
    startedAt: Timestamp | Date;
    timeoutAt: Timestamp | Date;
    checks: number;
    checkingUntil: Timestamp | Date | null;
    /** The token of the check holding it. */
    claim: string | null;
    /** When a check last asked, so the longest waiting are asked first. */
    lastCheckedAt: Timestamp | Date | null;
    endedAt: Timestamp | Date | null;
    files: AiFile[];
    reason: AiFailureReason | null;
    detail: string | null;
    costUsd: number;
    /** onJobDone still to run (it threw), and how many times it has run. */
    hookPending: boolean;
    hookTries: number;
    hookRunningUntil?: Timestamp | Date | null;
}

/** A stored time as milliseconds: Firestore answers a Timestamp; a Date written is one too. */
export function millis(t: Timestamp | Date | null | undefined): number {
    if (!t) return 0;
    return t instanceof Date ? t.getTime() : typeof t.toMillis === 'function' ? t.toMillis() : 0;
}

/** A purpose's time for a job, in minutes. */
export function jobMinutes(purpose: AiPurpose): number {
    return Math.min(MAX_JOB_MINUTES, Math.max(5, purpose.jobTimeoutMinutes ?? DEFAULT_JOB_MINUTES));
}

/** A job as the app sees it. */
export function publicJob(id: string, d: AiJobDoc): AiJob {
    const date = (t: Timestamp | Date | null | undefined) => (t ? new Date(millis(t)) : null);
    return {
        id, purpose: d.purpose, kind: d.kind, status: d.status, recordId: d.recordId, ref: d.ref ?? null, limitKey: d.limitKey ?? null,
        readers: d.readers ?? [], startedAt: date(d.startedAt) ?? new Date(0), endedAt: date(d.endedAt), files: d.files ?? [],
        reason: d.reason ?? null, detail: d.detail ?? null, costUsd: d.costUsd ?? 0, test: d.test === true,
    };
}

/** One job by its id, for an app's function (AM-D13); null when there is none. */
export async function aiJob(jobId: string): Promise<AiJob | null> {
    if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new Error('aiJob: pass the jobId askAi answered.');
    const snap = await db.collection(AI_JOBS).doc(jobId).get();
    return snap.exists ? publicJob(snap.id, snap.data() as AiJobDoc) : null;
}

/** A value Firestore takes: no undefined anywhere (a setting left out is left out). */
function stored<T>(value: T): T {
    if (Array.isArray(value)) return value.map(stored) as T;
    if (value && typeof value === 'object' && !(value instanceof Date) && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stored(v)])) as T;
    }
    return value;
}

/** Keep a new job; its id is its call's record id. */
export async function createJob(id: string, job: Omit<AiJobDoc, 'status' | 'checks' | 'checkingUntil' | 'endedAt' | 'files' | 'reason' | 'detail' | 'costUsd' | 'hookPending' | 'hookTries' | 'startedAt' | 'timeoutAt' | 'lastCheckedAt' | 'claim'> & { startedAt: Date; timeoutAt: Date }): Promise<void> {
    await db.collection(AI_JOBS).doc(id).set(stored({
        ...job, status: 'pending', checks: 0, checkingUntil: null, claim: null, lastCheckedAt: job.startedAt, endedAt: null, files: [], reason: null, detail: null, costUsd: 0, hookPending: false, hookTries: 0,
    }));
}

/** A job started at the provider that Arc could not keep: its record says so (it may still be billed). */
export async function markJobLost(recordId: string, detail: string): Promise<void> {
    await db.collection(AI_CALLS).doc(recordId).set({ outcome: 'unavailable', detail: detail.slice(0, 500) }, { merge: true });
}

/**
 * Take a pending job for this check, with a token only this check holds, or null when another
 * check has it. The hold lasts longer than a check may run, so it never lapses mid-check.
 */
async function claim(id: string): Promise<{ d: AiJobDoc; token: string } | null> {
    const ref = db.collection(AI_JOBS).doc(id);
    const token = randomUUID();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.data() as AiJobDoc | undefined;
        const now = Date.now();
        if (!d || d.status !== 'pending') return null;
        if (d.checkingUntil && millis(d.checkingUntil) > now) return null;
        tx.update(ref, { checkingUntil: new Date(now + CLAIM_MS), claim: token, checks: FieldValue.increment(1) });
        return { d, token };
    });
}

/** Let go of a job still running, so the next check takes it. */
async function release(id: string, token: string): Promise<void> {
    const ref = db.collection(AI_JOBS).doc(id);
    await db.runTransaction(async (tx) => {
        const d = (await tx.get(ref)).data() as AiJobDoc | undefined;
        if (d?.status === 'pending' && d.claim === token) tx.update(ref, { checkingUntil: null, claim: null, lastCheckedAt: new Date() });
    });
}

/** What the record and the job say once the files are saved, priced as the model bills. */
async function priced(d: AiJobDoc, usage: AttemptUsage, files: AiFile[]): Promise<Partial<AiCallRecord>> {
    if (d.test || !d.connection || !d.model) return { costUsd: 0, costFrom: 'none', amount: 0, unit: 'seconds' };
    const settings = await readAiSettings();
    const info = modelInfo(settings, { connection: d.connection, model: d.model });
    const seconds = files.reduce((n, f) => n + (f.seconds ?? 0), 0) || d.video?.seconds || 0;
    const video = d.video ?? {};
    const cost = attemptCost(info.unit === 'seconds' ? { ...info, price: secondPrice(info.video, info.price, video) } : info, usage, seconds);
    return {
        tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, tokensThinking: usage.tokensThinking,
        costUsd: cost.usd, costFrom: cost.from, amount: cost.amount, unit: cost.unit,
    };
}

type JobOutcome = { ok: true; files: AiFile[]; usage: AttemptUsage } | { ok: false; reason: AiFailureReason; detail: string; usage?: AttemptUsage; maybeBilled?: boolean };

/**
 * End a job, at most once: a transaction moves it from pending to ended only while this check
 * still holds it, and only then are its record, its month's totals and its allowance touched.
 * A check stopped part-way after that leaves the totals short rather than counted twice.
 * Answers whether this check ended it.
 */
async function end(id: string, token: string, d: AiJobDoc, outcome: JobOutcome): Promise<boolean> {
    const usage = outcome.usage ?? { tokensIn: 0, tokensOut: 0, tokensThinking: 0 };
    const billed = outcome.ok || outcome.maybeBilled === true || usage.tokensIn + usage.tokensOut > 0 || (usage.amount ?? 0) > 0 || usage.costUsd !== undefined;
    const money = billed ? await priced(d, usage, outcome.ok ? outcome.files : []) : { costUsd: 0, costFrom: 'none' as const };
    const ref = db.collection(AI_JOBS).doc(id);
    const won = await db.runTransaction(async (tx) => {
        const now = (await tx.get(ref)).data() as AiJobDoc | undefined;
        if (!now || now.status !== 'pending' || now.claim !== token) return false;
        tx.update(ref, stored({
            status: outcome.ok ? 'done' : 'failed',
            endedAt: new Date(),
            checkingUntil: null,
            claim: null,
            files: outcome.ok ? outcome.files : [],
            reason: outcome.ok ? null : outcome.reason,
            detail: outcome.ok ? null : outcome.detail.slice(0, 500),
            costUsd: Number(money.costUsd ?? 0),
            hookPending: true,
        }));
        return true;
    });
    if (!won) return false;
    const recordRef = db.collection(AI_CALLS).doc(d.recordId);
    const change: Partial<AiCallRecord> & Record<string, unknown> = stored({
        ...money,
        outcome: outcome.ok ? 'ok' : outcome.reason,
        ...(outcome.ok ? { files: outcome.files, filePaths: outcome.files.map((f) => f.path) } : { detail: outcome.detail.slice(0, 500) }),
        jobEndedAt: new Date(),
    });
    try {
        const snap = await recordRef.get();
        await recordRef.set(change, { merge: true });
        // A failure the provider did not bill gives its allowance back (AM-D14).
        if (!billed && d.allowance) await db.doc(d.allowance.path).update({ units: FieldValue.increment(-d.allowance.units) });
        if (snap.exists) await addToTotals({ ...(snap.data() as AiCallRecord), ...change } as AiCallRecord, new Date(millis(d.startedAt)));
    } catch (err) {
        console.error(`checkAiJobs: the record or totals of job ${id} were not brought up to date`, err);
    }
    await runHook(id);
    return true;
}

/**
 * Run the purpose's onJobDone for an ended job, held by one check at a time; a throw is tried
 * again on the next checks, 3 times in all (AM-D13). A hook should cope with running twice for
 * one job, such as after a check was stopped part-way.
 */
export async function runHook(id: string): Promise<void> {
    const ref = db.collection(AI_JOBS).doc(id);
    const d = await db.runTransaction(async (tx) => {
        const job = (await tx.get(ref)).data() as AiJobDoc | undefined;
        if (!job || !job.hookPending || job.status === 'pending') return null;
        if (job.hookRunningUntil && millis(job.hookRunningUntil) > Date.now()) return null;
        tx.update(ref, { hookRunningUntil: new Date(Date.now() + CLAIM_MS) });
        return job;
    });
    if (!d) return;
    const hook = findPurpose(d.purpose, { arc: true })?.onJobDone;
    if (!hook) {
        await ref.update({ hookPending: false, hookRunningUntil: null });
        return;
    }
    const job = publicJob(id, { ...d, endedAt: d.endedAt ?? new Date() });
    const result: AiJobResult = d.status === 'done' ? { ok: true, files: d.files, costUsd: d.costUsd } : { ok: false, reason: d.reason ?? 'unavailable', detail: d.detail };
    try {
        await hook(result, job);
        await ref.update({ hookPending: false, hookRunningUntil: null, hookTries: FieldValue.increment(1) });
    } catch (err) {
        const tries = (d.hookTries ?? 0) + 1;
        console.error(`checkAiJobs: ${d.purpose}'s onJobDone threw for job ${id} (try ${tries} of ${MAX_HOOK_TRIES})`, err);
        await ref.update({ hookTries: tries, hookPending: tries < MAX_HOOK_TRIES, hookRunningUntil: null, hookError: String((err as Error).message ?? err).slice(0, 300) });
    }
}

/** Save a finished job's files: bytes as they are, addresses streamed from the provider's hosts. */
async function saveJobFiles(id: string, d: AiJobDoc, made: JobFile[], hosts: readonly string[]): Promise<AiFile[] | { reason: AiFailureReason; detail: string }> {
    const month = new Date(millis(d.startedAt)).toISOString().slice(0, 7);
    const paths = filePaths({ recordId: d.recordId, purpose: d.purpose, month, test: d.test, saveTo: d.saveTo ?? undefined, saveAs: d.saveAs ?? undefined, files: made });
    const files: AiFile[] = [];
    for (let i = 0; i < made.length; i++) {
        const f = made[i];
        if ('bytes' in f) {
            files.push(...(await saveFiles([paths[i]], [f], { recordId: d.recordId, purpose: d.purpose, test: d.test })));
            continue;
        }
        const r = await streamToStorage(f.url, hosts, paths[i], { contentType: f.mimeType, recordId: d.recordId, purpose: d.purpose }, FETCH_TIMEOUT_MS);
        if (!r.ok) return { reason: r.failure === 'too-large' ? 'too-large' : 'unavailable', detail: `job ${id}: ${r.detail}` };
        const file: AiFile = { path: paths[i], mimeType: r.contentType || f.mimeType, bytes: r.bytes };
        if (f.width) file.width = f.width;
        if (f.height) file.height = f.height;
        if (f.seconds) file.seconds = f.seconds;
        files.push(file);
    }
    return files;
}

/** Look at one claimed job: finished, failed, timed out, or still running. Answers whether it ended. */
async function checkOne(id: string, token: string, d: AiJobDoc, now: number): Promise<boolean> {
    if (d.test) {
        const made: MadeFile[] = standInFiles(d.kind === 'video' ? 'video' : 'audio', { audioSeconds: 1, chars: 0 });
        const saved = await saveJobFiles(id, d, made, []);
        return end(id, token, d, Array.isArray(saved) ? { ok: true, files: saved, usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } } : { ok: false, ...saved });
    }
    const pastTime = millis(d.timeoutAt) < now;
    // The provider may still bill a job Arc stopped waiting for: it keeps its allowance.
    const timedOut = () => end(id, token, d, { ok: false, reason: 'timeout', detail: 'the job did not finish within the purpose\'s jobTimeoutMinutes; the provider may still bill it', maybeBilled: true });
    const settings = await readAiSettings();
    const connection = d.connection ? settings.connections[d.connection] : undefined;
    const preset = connection ? findPreset(connection.preset) : undefined;
    const check = preset ? await jobCheckerFor(preset) : undefined;
    if (!connection || !preset || !check || !d.operation || !d.model) {
        return end(id, token, d, { ok: false, reason: 'unavailable', detail: `the connection ${d.connection ?? ''} of this job is gone from Settings, AI`, maybeBilled: true });
    }
    const key = presetNeedsKey(preset) ? await readKey(connection).catch(() => ({ ok: false as const, detail: 'the key could not be read' })) : { ok: true as const, key: null };
    if (!key.ok) return pastTime ? timedOut() : false;
    // A job past its time is asked once more, so one that finished late is not lost.
    const result = await check({ connection, key: key.key }, { kind: d.kind === 'video' ? 'video' : 'audio', model: d.model, operation: d.operation, video: d.video ?? undefined, timeoutMs: CHECK_TIMEOUT_MS });
    if (result.state === 'running') return pastTime ? timedOut() : false;
    if (result.state === 'failed') {
        if (result.failure === 'key-refused' || result.outOfCredit) await noteConnection(settings, connection.id, result.detail);
        // A key refused on a check (one rotated while the job runs) says nothing of the job: wait for its time.
        if (result.failure === 'key-refused' && !pastTime) return false;
        const reason: AiFailureReason = result.failure === 'retired' || result.failure === 'key-refused' ? 'unavailable' : result.failure;
        return end(id, token, d, { ok: false, reason, detail: result.detail, usage: result.usage });
    }
    const saved = await saveJobFiles(id, d, result.files, preset.downloadHosts ?? []);
    if (!Array.isArray(saved)) {
        // Made and billed but not fetched: a later check fetches it again while the job's time allows.
        if (millis(d.timeoutAt) > now + 120_000) return false;
        return end(id, token, d, { ok: false, ...saved, usage: result.usage, maybeBilled: true });
    }
    return end(id, token, d, { ok: true, files: saved, usage: result.usage });
}

/**
 * One background check of pending jobs, the longest waiting first, and of hooks still to run.
 * Answers how many it looked at and ended.
 */
export async function checkJobs(now = Date.now()): Promise<{ looked: number; ended: number }> {
    // Every pending job is read and the longest waiting taken first, so none starves behind
    // others that run long (pending jobs are few: each is a video being made).
    const pending = await db.collection(AI_JOBS).where('status', '==', 'pending').limit(500).get();
    const order = [...pending.docs].sort((a, b) => millis((a.data() as AiJobDoc).lastCheckedAt) - millis((b.data() as AiJobDoc).lastCheckedAt)).slice(0, JOBS_PER_CHECK);
    let ended = 0;
    const endedNow = new Set<string>();
    for (const doc of order) {
        const held = await claim(doc.id).catch(() => null);
        if (!held) continue;
        try {
            if (await checkOne(doc.id, held.token, held.d, now)) {
                ended++;
                endedNow.add(doc.id);
            } else await release(doc.id, held.token);
        } catch (err) {
            console.error(`checkAiJobs: job ${doc.id} could not be checked`, err);
            await release(doc.id, held.token).catch(() => undefined);
        }
    }
    const hooks = await db.collection(AI_JOBS).where('hookPending', '==', true).limit(10).get();
    // A hook that threw just now runs again on the next check, not twice in this one.
    for (const doc of hooks.docs.filter((x) => !endedNow.has(x.id))) await runHook(doc.id).catch((err: unknown) => console.error(`checkAiJobs: onJobDone for ${doc.id}`, err));
    return { looked: order.length, ended };
}
