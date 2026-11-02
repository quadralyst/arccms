/**
 * Long jobs (specs/ai-media-spec.md, AM-D11 to AM-D14, AM-D33): a video call answers pending
 * and keeps AiJobs/{id}; the background check finishes it (a test job with the grey stand-in,
 * a live one by asking its provider), fails it on time, gives back an unbilled allowance,
 * records the cost in the month it started, and runs onJobDone, again on a throw, at most 3
 * times. Presenter purposes pick their avatar by name. Firestore is an in-memory fake; the
 * providers, Storage, keys and totals are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Data = Record<string, unknown>;
const h = vi.hoisted(() => ({
    docs: new Map<string, Record<string, unknown>>(),
    settings: {} as Record<string, unknown>,
    totals: [] as Array<{ record: Record<string, unknown>; at: Date }>,
    saved: [] as string[],
    streamed: [] as Array<{ url: string; path: string }>,
    hook: vi.fn(),
    noted: [] as Array<[string, string | null]>,
    order: [] as string[],
}));

vi.mock('firebase-admin/firestore', () => {
    class Timestamp {
        constructor(private ms: number) {}
        static fromMillis(ms: number) { return new Timestamp(ms); }
        static now() { return new Timestamp(Date.now()); }
        toMillis() { return this.ms; }
        toDate() { return new Date(this.ms); }
    }
    return { Timestamp, FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => ({ __now: true }) } };
});
vi.mock('../init', () => {
    const apply = (path: string, data: Record<string, unknown>, merge: boolean) => {
        const base = merge ? { ...(h.docs.get(path) ?? {}) } : {};
        for (const [k, v] of Object.entries(data)) {
            const inc = (v as { __inc?: number })?.__inc;
            if (inc !== undefined) base[k] = Number(base[k] ?? 0) + inc;
            else if ((v as { __now?: boolean })?.__now) base[k] = { now: true };
            else base[k] = v;
        }
        h.docs.set(path, base);
    };
    const docRef = (path: string) => ({
        id: path.split('/').pop(),
        path,
        get: async () => ({ id: path.split('/').pop(), exists: h.docs.has(path), data: () => h.docs.get(path) }),
        set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => {
            if (Object.values(d).some((v) => v === undefined)) throw new Error('Cannot use "undefined" as a Firestore value');
            h.order.push(path.split('/')[0]);
            apply(path, d, o?.merge === true);
        },
        update: async (d: Record<string, unknown>) => {
            if (!h.docs.has(path)) throw new Error(`no ${path}`);
            apply(path, d, true);
        },
    });
    const query = (name: string, filters: Array<[string, unknown]>, max = 1000) => ({
        where: (f: string, _op: string, v: unknown) => query(name, [...filters, [f, v]], max),
        limit: (n: number) => query(name, filters, n),
        get: async () => {
            const docs = [...h.docs.entries()]
                .filter(([p, d]) => p.startsWith(`${name}/`) && p.split('/').length === 2 && filters.every(([f, v]) => d[f] === v))
                .slice(0, max)
                .map(([p, d]) => ({ id: p.split('/')[1], data: () => d, ref: docRef(p) }));
            return { docs, size: docs.length, empty: !docs.length };
        },
    });
    const db = {
        collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`), ...query(name, []) }),
        doc: (path: string) => docRef(path),
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
            get: (ref: { get: () => Promise<unknown> }) => ref.get(),
            update: (ref: { path: string }, d: Record<string, unknown>) => apply(ref.path, d, true),
            set: (ref: { path: string }, d: Record<string, unknown>) => apply(ref.path, d, true),
        }),
    };
    return { db, storage: {}, owner: {} };
});
vi.mock('../feature-flags.js', () => ({ isFeatureOn: () => true }));
vi.mock('../custom/ai.js', () => ({
    AI_PURPOSES: {
        clip: { label: 'Clip', makes: 'video', video: { seconds: 5, aspect: '16:9' }, jobTimeoutMinutes: 10, perKeyPerDay: 5, onJobDone: (...a: unknown[]) => h.hook(...a) },
        host: { label: 'Host', makes: 'video', video: { presenter: true }, avatars: { anna: { heygen: 'look-anna' }, ravi: { heygen: 'look-ravi' } } },
    },
}));
vi.mock('../ai/settings.js', async (actual) => {
    const real = await actual<typeof import('../ai/settings.js')>();
    return { ...real, readAiSettings: async () => real.resolveAiSettings(h.settings) };
});
vi.mock('../ai/records.js', async (actual) => ({
    ...(await actual<typeof import('../ai/records.js')>()),
    newAiCallId: () => 'rec1',
    writeAiCall: async (record: Data, _c: unknown, _n: Date, id: string) => (h.order.push('AiCalls'), h.docs.set(`AiCalls/${id}`, { ...record }), id),
}));
vi.mock('../ai/usage.js', () => ({
    addToTotals: async (record: Data, at: Date) => void h.totals.push({ record, at }),
    noteConnection: async (_s: unknown, id: string, e: string | null) => void h.noted.push([id, e]),
    alertOutOfCredit: async () => undefined,
}));
vi.mock('../ai/limits.js', () => ({
    consumeAllowance: async (_p: string, _k: string, units: number) => (h.docs.set('AiUsage/2026-11/days/02__clip__k', { units }), { ok: true, units, path: 'AiUsage/2026-11/days/02__clip__k', release: async () => undefined }),
    checkBudget: async () => ({ ok: true, spent: 0 }),
}));
vi.mock('../ai/keys.js', () => ({ readKey: async () => ({ ok: true, key: 'sk-test-1234' }) }));
vi.mock('../ai/pacing.js', () => ({ waitForPlace: async () => ({ ok: true, release: async () => undefined }) }));
vi.mock('../ai/cache.js', async (actual) => ({ ...(await actual<typeof import('../ai/cache.js')>()), findCached: async () => null, storeCached: async () => undefined }));
vi.mock('../ai/files.js', async (actual) => {
    const real = await actual<typeof import('../ai/files.js')>();
    return {
        ...real,
        saveFiles: async (paths: string[], files: Array<{ mimeType: string; bytes: Buffer; seconds?: number }>) => (h.saved.push(...paths), files.map((f, i) => ({ path: paths[i], mimeType: f.mimeType, bytes: f.bytes.length, ...(f.seconds ? { seconds: f.seconds } : {}) }))),
        streamToStorage: async (url: string, _hosts: string[], path: string) => (h.streamed.push({ url, path }), url.includes('broken') ? { ok: false, failure: 'unavailable', detail: 'gone' } : { ok: true, bytes: 2048, contentType: 'video/mp4' }),
    };
});

import { askAi, captureAiAsks } from '../ai/askAi.js';
import { replaceFileConnectorsForTest, replaceJobCheckersForTest } from '../ai/connectors/index.js';
import type { FileRequest, JobCheckResult } from '../ai/connectors/types.js';
import { aiJob, checkJobs } from '../ai/jobs.js';
import { purposeProblems } from '../ai/purposes.js';

const KL = { connection: 'kl', model: 'kling-3.0' };
const HG = { connection: 'hg', model: 'avatar-iv' };

function live(extra: Data = {}) {
    h.settings = { mode: 'live', connections: { kl: { preset: 'kling' }, hg: { preset: 'heygen' } }, lists: { video: [KL] }, ...extra };
}

let started: FileRequest[] = [];
let checkAnswer: JobCheckResult = { state: 'running' };
beforeEach(() => {
    h.docs.clear();
    h.totals = [];
    h.saved = [];
    h.streamed = [];
    h.noted = [];
    h.hook.mockReset();
    h.order = [];
    started = [];
    checkAnswer = { state: 'running' };
    const start = async (_c: unknown, r: FileRequest) => (started.push(r), { ok: 'pending' as const, operation: `op-${r.model}` });
    replaceFileConnectorsForTest({ kling: start, heygen: start });
    replaceJobCheckersForTest({ kling: async () => checkAnswer, heygen: async () => checkAnswer });
});
afterEach(() => {
    replaceFileConnectorsForTest({});
    replaceJobCheckersForTest({});
    vi.useRealTimers();
});

const job = () => h.docs.get('AiJobs/rec1') as Data;
const record = () => h.docs.get('AiCalls/rec1') as Data;

describe('a video call', () => {
    it('answers pending, keeps the job with what the check needs, and adds nothing to the totals yet', async () => {
        live();
        const r = await askAi({ purpose: 'clip', input: 'A marble on a track', limitKey: 'k', readers: ['user-1'], video: { seconds: 40, resolution: '1080p' } });
        expect(r).toMatchObject({ ok: 'pending', jobId: 'rec1', recordId: 'rec1' });
        expect(started[0]).toMatchObject({ kind: 'video', model: 'kling-3.0', jobKey: 'rec1', video: { seconds: 15, resolution: '1080p', aspect: '16:9', sound: false } });
        expect(job()).toMatchObject({ status: 'pending', operation: 'op-kling-3.0', connection: 'kl', readers: ['user-1'], allowance: { path: 'AiUsage/2026-11/days/02__clip__k', units: 1 }, test: false });
        expect((job()['timeoutAt'] as Date).getTime() - (job()['startedAt'] as Date).getTime()).toBe(10 * 60_000);
        expect(record()).toMatchObject({ outcome: 'pending', jobId: 'rec1' });
        expect(h.totals).toEqual([]);
        expect(await aiJob('rec1')).toMatchObject({ id: 'rec1', status: 'pending', readers: ['user-1'] });
        // The record before the job, so a check that ends it at once finds it.
        expect(h.order.slice(0, 2)).toEqual(['AiCalls', 'AiJobs']);
        // Nothing Firestore would refuse: a setting left out is left out.
        const deep = (v: unknown): boolean => v === undefined || (typeof v === 'object' && v !== null && Object.values(v).some(deep));
        expect(deep(job())).toBe(false);
        expect('presenter' in (job()['video'] as Data)).toBe(false);
    });

    it('is a job in test mode too, finished with the grey video on the next check', async () => {
        h.settings = { mode: 'test' };
        expect(await askAi({ purpose: 'clip', input: 'x', limitKey: 'k' })).toMatchObject({ ok: 'pending', usage: { test: true } });
        expect(started).toEqual([]);
        expect(await checkJobs()).toEqual({ looked: 1, ended: 1 });
        expect(job()).toMatchObject({ status: 'done', costUsd: 0 });
        expect((job()['files'] as Data[])[0]).toMatchObject({ mimeType: 'video/mp4', seconds: 2 });
        expect(h.saved[0]).toMatch(/ai-files\/_test\/clip\//);
        expect(h.hook).toHaveBeenCalledWith(expect.objectContaining({ ok: true }), expect.objectContaining({ id: 'rec1', status: 'done', test: true }));
    });

    it('answers pending in a capture, without writing anything', async () => {
        const ai = captureAiAsks();
        try {
            expect(await askAi({ purpose: 'clip', input: 'x', limitKey: 'k' })).toMatchObject({ ok: 'pending', jobId: 'captured' });
            expect(h.docs.size).toBe(0);
        } finally {
            ai.stop();
        }
    });
});

describe('the background check', () => {
    beforeEach(async () => {
        live();
        await askAi({ purpose: 'clip', input: 'x', limitKey: 'k', video: { seconds: 5, resolution: '720p', sound: true } });
    });

    it('leaves a running job, and finishes a done one: the file streamed, the record priced, the month counted', async () => {
        expect(await checkJobs()).toEqual({ looked: 1, ended: 0 });
        expect(job()).toMatchObject({ status: 'pending', checks: 1, checkingUntil: null });
        checkAnswer = { state: 'done', files: [{ url: 'https://s15-kling.klingai.com/v.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: 5 } };
        expect(await checkJobs()).toEqual({ looked: 1, ended: 1 });
        expect(h.streamed[0]).toMatchObject({ url: 'https://s15-kling.klingai.com/v.mp4' });
        expect(h.streamed[0].path).toMatch(/^ai-files\/clip\/\d{4}-\d{2}\/rec1-1\.mp4$/);
        // Kling 3.0 at 720p with sound: $0.126 a second.
        expect(record()).toMatchObject({ outcome: 'ok', unit: 'seconds', amount: 5, costFrom: 'price-list' });
        expect(record()['costUsd'] as number).toBeCloseTo(0.63, 9);
        expect(h.totals).toHaveLength(1);
        expect(h.totals[0].record).toMatchObject({ outcome: 'ok', purpose: 'clip' });
        expect(job()).toMatchObject({ status: 'done', files: [{ path: h.streamed[0].path, bytes: 2048, seconds: 5 }] });
        expect(h.hook).toHaveBeenCalledTimes(1);
        // A done job is not looked at again.
        expect(await checkJobs()).toEqual({ looked: 0, ended: 0 });
    });

    it('uses the provider\'s own charge when it reports one', async () => {
        checkAnswer = { state: 'done', files: [{ url: 'https://s15-kling.klingai.com/v.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: 5, costUsd: 0.7 } };
        await checkJobs();
        expect(record()).toMatchObject({ costUsd: 0.7, costFrom: 'provider' });
    });

    it('fails a blocked job, gives back its unbilled allowance, and still runs onJobDone', async () => {
        checkAnswer = { state: 'failed', failure: 'blocked', detail: 'content risk' };
        await checkJobs();
        expect(job()).toMatchObject({ status: 'failed', reason: 'blocked', detail: 'content risk' });
        expect(record()).toMatchObject({ outcome: 'blocked', costUsd: 0 });
        expect(h.docs.get('AiUsage/2026-11/days/02__clip__k')).toEqual({ units: 0 });
        expect(h.hook).toHaveBeenCalledWith({ ok: false, reason: 'blocked', detail: 'content risk' }, expect.objectContaining({ status: 'failed' }));
    });

    it('keeps trying a file it could not fetch while time allows', async () => {
        checkAnswer = { state: 'done', files: [{ url: 'https://s15-kling.klingai.com/broken.mp4', mimeType: 'video/mp4' }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };
        expect(await checkJobs()).toEqual({ looked: 1, ended: 0 });
        expect(job()).toMatchObject({ status: 'pending', claim: null, checkingUntil: null });
    });

    it('asks a job past its time once more, then fails it with timeout and keeps its allowance', async () => {
        expect(await checkJobs(Date.now() + 11 * 60_000)).toEqual({ looked: 1, ended: 1 });
        expect(job()).toMatchObject({ status: 'failed', reason: 'timeout' });
        expect(h.docs.get('AiUsage/2026-11/days/02__clip__k')).toEqual({ units: 1 });
        // One that finished late is not lost.
        h.docs.clear();
        await askAi({ purpose: 'clip', input: 'x', limitKey: 'k' });
        checkAnswer = { state: 'done', files: [{ url: 'https://s15-kling.klingai.com/v.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };
        await checkJobs(Date.now() + 11 * 60_000);
        expect(job()).toMatchObject({ status: 'done' });
    });

    it('keeps a job running when its key is refused on a check, such as after a new key', async () => {
        checkAnswer = { state: 'failed', failure: 'key-refused', detail: 'Kling refused the key' };
        expect(await checkJobs()).toEqual({ looked: 1, ended: 0 });
        expect(job()['status']).toBe('pending');
        expect(h.noted).toEqual([['kl', 'Kling refused the key']]);
    });

    it('ends a job only while its check still holds it: never twice', async () => {
        // Another check takes the job over while this one is asking the provider.
        replaceJobCheckersForTest({ kling: async () => {
            h.docs.set('AiJobs/rec1', { ...job(), claim: 'someone-else' });
            return { state: 'done', files: [{ url: 'https://s15-kling.klingai.com/v.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };
        } });
        expect(await checkJobs()).toEqual({ looked: 1, ended: 0 });
        expect(job()).toMatchObject({ status: 'pending', claim: 'someone-else' });
        expect(h.totals).toEqual([]);
        expect(h.hook).not.toHaveBeenCalled();
    });

    it('runs a throwing onJobDone again on the next checks, at most 3 times', async () => {
        h.hook.mockRejectedValue(new Error('app down'));
        checkAnswer = { state: 'done', files: [{ url: 'https://s15-kling.klingai.com/v.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };
        await checkJobs();
        expect(job()).toMatchObject({ hookPending: true, hookTries: 1, hookError: 'app down' });
        await checkJobs();
        await checkJobs();
        expect(job()).toMatchObject({ hookPending: false, hookTries: 3 });
        await checkJobs();
        expect(h.hook).toHaveBeenCalledTimes(3);
    });

    it('never lets two checks take the same job', async () => {
        const now = Date.now();
        h.docs.set('AiJobs/rec1', { ...job(), checkingUntil: new Date(now + 60_000), claim: 'other' });
        checkAnswer = { state: 'failed', failure: 'blocked', detail: 'x' };
        expect(await checkJobs(now)).toEqual({ looked: 1, ended: 0 });
        expect(job()['status']).toBe('pending');
    });
});

describe('presenter videos', () => {
    it('ask with the named avatar\'s id, the admin\'s over the app\'s, and skip a provider without one', async () => {
        live({ lists: { video: [KL, HG] } });
        await askAi({ purpose: 'host', input: 'Welcome.', avatar: 'ravi' });
        expect(started.map((s) => [s.model, s.avatar])).toEqual([['avatar-iv', 'look-ravi']]);
        expect(record()['attempts']).toEqual([expect.objectContaining({ model: 'kling-3.0', outcome: 'skipped', detail: 'makes no presenter videos' }), expect.objectContaining({ model: 'avatar-iv', outcome: 'pending' })]);
        started = [];
        h.docs.clear();
        live({ lists: { video: [HG] }, purposes: { host: { avatars: { anna: { heygen: 'look-admin' } } } } });
        await askAi({ purpose: 'host', input: 'Welcome.' });
        expect(started[0].avatar).toBe('look-admin');
    });

    it('checks avatars and readers at load and on the call', async () => {
        await expect(askAi({ purpose: 'host', input: 'x', avatar: 'nobody' })).rejects.toThrow('anna, ravi');
        await expect(askAi({ purpose: 'clip', input: 'x', limitKey: 'k', avatar: 'anna' })).rejects.toThrow('presenter video purpose');
        await expect(askAi({ purpose: 'clip', input: 'x', limitKey: 'k', readers: ['a b'] })).rejects.toThrow('arccms_uid');
        expect(purposeProblems({ pp: { label: 'P', makes: 'video', avatars: { a: { heygen: 'x' } } } })).toEqual(['purpose "pp": avatars are for a presenter video purpose, with video: { presenter: true }']);
        expect(purposeProblems({ pp: { label: 'P', makes: 'video', video: { presenter: true }, avatars: { a: { kling: 'x' } } } })[0]).toContain('makes no presenter videos');
        expect(purposeProblems({ pp: { label: 'P', makes: 'image', jobTimeoutMinutes: 10 } })[0]).toContain('jobTimeoutMinutes');
        expect(purposeProblems({ pp: { label: 'P', makes: 'video', jobTimeoutMinutes: 500 } })[0]).toContain('5 to 120');
        expect(purposeProblems({ pp: { label: 'P', makes: 'video', onJobDone: 'no' } })[0]).toContain('onJobDone');
    });
});
