/**
 * The month's totals, allowances, budget alerts, keys, the admin callables and the daily
 * cleanup (specs/ai-spec.md, AI-D8, AI-D12 to AI-D15), on a small in-memory Firestore that
 * knows subcollections, merges and increments.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Data = Record<string, unknown>;

const h = vi.hoisted(() => {
    const docs = new Map<string, Record<string, unknown>>();
    const isInc = (v: unknown): v is { _increment: number } => typeof v === 'object' && v !== null && '_increment' in v;
    const isDel = (v: unknown) => typeof v === 'object' && v !== null && (v as { _delete?: boolean })._delete === true;
    const merge = (target: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> => {
        const out = { ...target };
        for (const [k, v] of Object.entries(fields)) {
            if (isDel(v)) delete out[k];
            else if (isInc(v)) out[k] = Number(out[k] ?? 0) + v._increment;
            else if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v as { toMillis?: unknown }).toMillis) out[k] = merge((out[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
            else out[k] = v;
        }
        return out;
    };
    const setPath = (target: Record<string, unknown>, path: string, value: unknown) => {
        const keys = path.split('.');
        let at = target;
        for (const k of keys.slice(0, -1)) at = (at[k] = { ...((at[k] as Record<string, unknown>) ?? {}) }) as Record<string, unknown>;
        const last = keys[keys.length - 1];
        if (isDel(value)) delete at[last];
        else if (isInc(value)) at[last] = Number(at[last] ?? 0) + value._increment;
        else at[last] = value;
    };
    let auto = 0;
    const docRef = (path: string): any => ({
        id: path.split('/').pop(),
        path,
        get: async () => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => (docs.has(path) ? { ...docs.get(path) } : undefined), ref: docRef(path) }),
        set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => void docs.set(path, opts?.merge ? merge(docs.get(path) ?? {}, data) : merge({}, data)),
        update: async (data: Record<string, unknown>) => {
            if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
            const next = JSON.parse(JSON.stringify(docs.get(path)!));
            for (const [k, v] of Object.entries(data)) setPath(next, k, v);
            docs.set(path, next);
        },
        delete: async () => void docs.delete(path),
        collection: (name: string) => collRef(`${path}/${name}`),
    });
    const children = (prefix: string) => [...docs.keys()].filter((k) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'));
    const query = (prefix: string, filters: Array<(d: Record<string, unknown>) => boolean>, max = Infinity): any => ({
        where: (f: string, op: string, v: unknown) => query(prefix, [...filters, (d) => {
            const x = d[f] as { toMillis?: () => number } | unknown;
            if (op === '<') return (x as { toMillis: () => number }).toMillis() < (v as { toMillis: () => number }).toMillis();
            return x === v;
        }], max),
        limit: (n: number) => query(prefix, filters, n),
        get: async () => {
            const found = children(prefix).filter((k) => filters.every((f) => f(docs.get(k)!))).slice(0, max);
            const snaps = await Promise.all(found.map((k) => docRef(k).get()));
            return { empty: snaps.length === 0, size: snaps.length, docs: snaps };
        },
    });
    const collRef = (path: string): any => ({
        doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++auto}`}`),
        where: (f: string, op: string, v: unknown) => query(path, []).where(f, op, v),
        listDocuments: async () => {
            const ids = new Set([...docs.keys()].filter((k) => k.startsWith(`${path}/`)).map((k) => k.slice(path.length + 1).split('/')[0]));
            return [...ids].map((id) => docRef(`${path}/${id}`));
        },
        _path: path,
    });
    const db = {
        collection: (name: string) => collRef(name),
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
            get: (ref: { get: () => Promise<unknown> }) => ref.get(),
            set: (ref: { set: (d: unknown, o?: unknown) => Promise<void> }, d: unknown, o?: unknown) => void ref.set(d, o),
        }),
        batch: () => {
            const ops: Array<() => Promise<void>> = [];
            return { delete: (ref: { delete: () => Promise<void> }) => void ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
        },
        recursiveDelete: async (ref: { path?: string; _path?: string }) => {
            const p = ref.path ?? ref._path!;
            for (const k of [...docs.keys()]) if (k === p || k.startsWith(`${p}/`)) docs.delete(k);
        },
    };
    return { docs, db, notified: [] as Array<{ type: string; payload: Data }>, deletedPrefixes: [] as string[], zone: 'Europe/Zurich' };
});

vi.mock('../init', () => ({
    db: h.db,
    owner: {},
    storage: { bucket: () => ({ deleteFiles: async ({ prefix }: { prefix: string }) => void h.deletedPrefixes.push(prefix), file: () => ({ save: async () => undefined }) }) },
}));
vi.mock('firebase-admin/firestore', () => {
    class Ts {
        constructor(private ms: number) {}
        static now() { return new Ts(Date.now()); }
        static fromDate(d: Date) { return new Ts(d.getTime()); }
        toMillis() { return this.ms; }
    }
    return { Timestamp: Ts, FieldValue: { increment: (n: number) => ({ _increment: n }), delete: () => ({ _delete: true }), serverTimestamp: () => ({}) } };
});
vi.mock('../shared/site-settings.js', () => ({ getLocalizationSettings: async () => ({ timeZone: h.zone }) }));
vi.mock('../email-core/adminAlerts.js', () => ({ notifyAdmins: async (type: string, payload: Data) => void h.notified.push({ type, payload }) }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (a: unknown, b?: unknown) => (typeof a === 'function' ? a : b),
    HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_o: unknown, fn: unknown) => fn }));
vi.mock('../search/auth.js', () => ({
    requireAdmin: async (request: { auth?: { token?: Data } }) => {
        if (request.auth?.token?.['admin'] !== true) throw Object.assign(new Error('Admin access required.'), { code: 'permission-denied' });
    },
}));
vi.mock('../custom/ai.js', () => ({ AI_PURPOSES: { 'menu-scan': { label: 'Menu scan', instruction: 'SECRET PROMPT', testAnswer: 'x', perKeyPerDay: 20, input: { pictures: { max: 5, maxMb: 10 } } } } }));

import { siteDay, consumeAllowance, checkBudget } from '../ai/limits.js';
import { addToTotals, aiUsage, modelField } from '../ai/usage.js';
import { keyPreview, cleanKey, readKey, forgetKeys } from '../ai/keys.js';
import { forgetAiSettings, resolveAiSettings } from '../ai/settings.js';
import { monthsBefore, purgeAiCalls, purgeAiUsage, purgeOrphanKeys } from '../ai/callables/cleanUpAi.js';
import { setAiKey as setAiKeyFn } from '../ai/callables/setAiKey.js';
import { removeAiKey as removeAiKeyFn } from '../ai/callables/removeAiKey.js';
import { listAiPurposes as listAiPurposesFn } from '../ai/callables/listAiPurposes.js';
import { writeAiCall, MAX_KEPT_CHARS, type AiCallRecord } from '../ai/records.js';

// The onCall mock hands back the handler itself.
const handler = (fn: unknown) => fn as (request: never) => Promise<any>;
const setAiKey = handler(setAiKeyFn);
const removeAiKey = handler(removeAiKeyFn);
const listAiPurposes = handler(listAiPurposesFn);

const admin = (data: Data) => ({ auth: { uid: 'a1', token: { admin: true, email: 'admin@example.com' } }, data }) as never;
const member = (data: Data) => ({ auth: { uid: 'm1', token: {} }, data }) as never;

const call = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
    purpose: 'menu-scan', tier: 'thorough', test: false, ref: null, limitKey: 'b1', units: 2, input: { chars: 0, files: 1, bytes: 10 },
    attempts: [], connection: 'qwen', model: 'qwen3.7-flash', tokensIn: 1000, tokensOut: 100, tokensThinking: 0, costUsd: 0.5, costFrom: 'price-list', ms: 900, outcome: 'ok', ...over,
});

beforeEach(() => {
    h.docs.clear();
    h.notified = [];
    h.deletedPrefixes = [];
    h.zone = 'Europe/Zurich';
    forgetAiSettings();
    forgetKeys();
});

describe('the site\'s day', () => {
    it('is the site\'s calendar day, with the seconds to its midnight and month end', () => {
        // 23:30 UTC on 31 October is 00:30 on 1 November in Zurich (UTC+1 after the clocks change).
        const d = siteDay(new Date('2026-10-31T23:30:00Z'), 'Europe/Zurich');
        expect(d).toMatchObject({ month: '2026-11', day: '01', secondsLeftToday: 23.5 * 3600 });
        expect(siteDay(new Date('2026-10-31T23:30:00Z'), 'UTC')).toMatchObject({ month: '2026-10', day: '31', secondsLeftToday: 1800, secondsLeftThisMonth: 1800 });
        expect(monthsBefore('2026-01', 1)).toBe('2025-12');
        expect(monthsBefore('2026-10', 23)).toBe('2024-11');
    });
});

describe('allowance', () => {
    it('counts units per key and purpose a day, refuses past it, and gives back a failed call\'s', async () => {
        const now = new Date('2026-10-28T10:00:00Z');
        const first = await consumeAllowance('menu-scan', 'b1', 15, 20, now);
        expect(first.ok).toBe(true);
        const over = await consumeAllowance('menu-scan', 'b1', 6, 20, now);
        expect(over).toMatchObject({ ok: false });
        expect(!over.ok && over.wait).toBe(13 * 3600);
        expect((await consumeAllowance('menu-scan', 'b2', 20, 20, now)).ok).toBe(true);
        if (first.ok) await first.release();
        expect((await consumeAllowance('menu-scan', 'b1', 20, 20, now)).ok).toBe(true);
    });
});

describe('totals and the budget', () => {
    it('adds each live call to the month, by day, purpose, model and key; a test call only counts', async () => {
        const at = new Date('2026-10-28T10:00:00Z');
        await addToTotals(call(), at);
        await addToTotals(call({ outcome: 'unavailable', costUsd: 0, tokensIn: 0, tokensOut: 0 }), at);
        await addToTotals(call({ test: true }), at);
        const month = h.docs.get('AiUsage/2026-10')!;
        expect(month).toMatchObject({ calls: 2, failed: 1, tokensIn: 1000, costUsd: 0.5, testCalls: 1 });
        expect(month['byDay']).toMatchObject({ '28': { calls: 2 } });
        expect(month['byPurpose']).toMatchObject({ 'menu-scan': { calls: 2, failed: 1 } });
        expect(month['byModel']).toMatchObject({ [modelField('qwen', 'qwen3.7-flash')]: { connection: 'qwen', model: 'qwen3.7-flash', calls: 2 } });
        expect(modelField('router', 'qwen/qwen3.7-flash')).toBe('router__qwen_qwen3_7-flash');
        expect(await aiUsage({ limitKey: 'b1', month: '2026-10' })).toEqual({ calls: 2, failed: 1, units: 2, tokensIn: 1000, tokensOut: 100, costUsd: 0.5 });
        expect(await aiUsage({ limitKey: 'b1', purpose: 'menu-scan', month: '2026-10' })).toMatchObject({ calls: 2 });
        expect(await aiUsage({ limitKey: 'nobody', month: '2026-10' })).toMatchObject({ calls: 0 });
        await expect(aiUsage({ limitKey: 'b1', month: 'October' })).rejects.toThrow('month is yyyy-mm');
    });

    it('stops at the budget and tells admins once at 80% and once at 100%', async () => {
        h.docs.set('Settings/ai', { budget: { monthlyUsd: 1 } });
        const at = new Date('2026-10-28T10:00:00Z');
        const settings = resolveAiSettings(h.docs.get('Settings/ai'));
        await addToTotals(call({ costUsd: 0.5 }), at);
        expect(h.notified).toEqual([]);
        await addToTotals(call({ costUsd: 0.35 }), at);
        await addToTotals(call({ costUsd: 0.01 }), at);
        expect(h.notified.map((n) => n.payload['title'])).toEqual(['AI budget at 80%']);
        expect(await checkBudget(settings, at)).toEqual({ ok: true });
        await addToTotals(call({ costUsd: 0.2 }), at);
        await addToTotals(call({ costUsd: 0.2 }), at);
        expect(h.notified.map((n) => n.type)).toEqual(['admin_ai_budget', 'admin_ai_budget']);
        expect(h.notified[1].payload['title']).toBe('AI budget spent');
        expect(await checkBudget(settings, at)).toMatchObject({ ok: false });
    });
});

describe('keys', () => {
    beforeEach(() => {
        h.docs.set('Settings/ai', { connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1' }, g: { preset: 'vertex' } } });
    });

    it('shows only the last 4 characters and takes a whole key', () => {
        expect(keyPreview('sk-abcdefgh1234')).toBe('••••1234');
        expect(cleanKey('  sk-abcdefgh1234 ')).toBe('sk-abcdefgh1234');
        expect(cleanKey('short')).toBeNull();
        expect(cleanKey('two words here')).toBeNull();
    });

    it('lets only admins set a key, stores it apart and shows its preview', async () => {
        await expect(setAiKey(member({ connection: 'qwen', key: 'sk-abcdefgh1234' }))).rejects.toThrow('Admin access required.');
        await expect(setAiKey(admin({ connection: 'nope', key: 'sk-abcdefgh1234' }))).rejects.toThrow('Save the connection first');
        await expect(setAiKey(admin({ connection: 'g', key: 'sk-abcdefgh1234' }))).rejects.toThrow('needs no key');
        expect(await setAiKey(admin({ connection: 'qwen', key: 'sk-abcdefgh1234' }))).toMatchObject({ keyPreview: '••••1234', keySetBy: 'admin@example.com' });
        expect(h.docs.get('AiKeys/qwen')).toMatchObject({ key: 'sk-abcdefgh1234', baseUrl: 'https://ws1.eu-central-1.maas.aliyuncs.com/compatible-mode/v1' });
        const connection = (h.docs.get('Settings/ai')!['connections'] as Record<string, Data>)['qwen'];
        expect(connection).toMatchObject({ keyPreview: '••••1234', keySetBy: 'admin@example.com' });
        expect(JSON.stringify(h.docs.get('Settings/ai'))).not.toContain('sk-abcdefgh1234');
    });

    it('stops sending a key once the connection\'s address changes', async () => {
        await setAiKey(admin({ connection: 'qwen', key: 'sk-abcdefgh1234' }));
        const before = resolveAiSettings(h.docs.get('Settings/ai')).connections['qwen'];
        expect(await readKey(before)).toEqual({ ok: true, key: 'sk-abcdefgh1234' });
        const moved = { ...before, workspace: 'attacker' };
        expect(await readKey(moved)).toMatchObject({ ok: false, detail: expect.stringContaining('set for another address') });
    });

    it('removes a key and its preview, and the cleanup removes a key whose connection is gone', async () => {
        await setAiKey(admin({ connection: 'qwen', key: 'sk-abcdefgh1234' }));
        await removeAiKey(admin({ connection: 'qwen' }));
        expect(h.docs.has('AiKeys/qwen')).toBe(false);
        expect((h.docs.get('Settings/ai')!['connections'] as Record<string, Data>)['qwen']['keyPreview']).toBeUndefined();
        h.docs.set('AiKeys/old', { key: 'sk-old-12345678' });
        expect(await purgeOrphanKeys()).toBe(1);
        expect(h.docs.has('AiKeys/old')).toBe(false);
    });
});

describe('listAiPurposes', () => {
    it('shows admins what each purpose takes, never its instruction or test answer', async () => {
        const { purposes } = await listAiPurposes(admin({}));
        expect(purposes).toEqual([{ id: 'menu-scan', label: 'Menu scan', description: '', tier: 'fast', output: 'text', maxChars: 20000, pictures: { max: 5, maxMb: 10 }, pdfs: null, perKeyPerDay: 20, timeoutSeconds: 60 }]);
        expect(JSON.stringify(purposes)).not.toContain('SECRET');
        await expect(listAiPurposes(member({}))).rejects.toThrow('Admin access required.');
    });
});

describe('records', () => {
    it('keep 60 days, and the content only when asked, with its files beside it', async () => {
        const now = new Date('2026-10-28T10:00:00Z');
        const bare = await writeAiCall(call(), null, now);
        const doc = h.docs.get(`AiCalls/${bare}`)!;
        expect(doc).toMatchObject({ purpose: 'menu-scan', outcome: 'ok', costUsd: 0.5 });
        expect(doc).not.toHaveProperty('content');
        expect((doc['expiresAt'] as { toMillis: () => number }).toMillis() - now.getTime()).toBe(60 * 24 * 3600 * 1000);

        const kept = await writeAiCall(call(), {
            instruction: 'Read the menu.',
            parts: [
                { kind: 'text', text: 'x'.repeat(MAX_KEPT_CHARS) },
                { kind: 'picture', mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]), name: 'menu photo.jpg', storagePath: 'app/menus/p1.jpg' },
            ],
            answer: '{"items":[]}',
        }, now);
        const content = h.docs.get(`AiCalls/${kept}`)!['content'] as { instruction: string; parts: Array<Record<string, unknown>>; answer: string };
        expect(content.instruction).toBe('Read the menu.');
        // One budget for all the text: the instruction took its share first, so the answer has none left.
        expect((content.parts[0]['text'] as string).length).toBe(MAX_KEPT_CHARS - 'Read the menu.'.length);
        expect(content.answer).toBe('');
        expect(content.parts[1]).toEqual({ kind: 'picture', mimeType: 'image/jpeg', size: 3, path: `ai-calls/${kept}/2-menu-photo.jpg`, from: 'app/menus/p1.jpg' });
    });
});

describe('the daily cleanup', () => {
    it('deletes records after 60 days with their files, old totals and spent counters', async () => {
        const now = new Date('2026-10-28T10:00:00Z');
        const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) });
        h.docs.set('AiCalls/old', { createdAt: ts('2026-08-01T00:00:00Z'), content: { answer: 'x' } });
        h.docs.set('AiCalls/old2', { createdAt: ts('2026-08-20T00:00:00Z') });
        h.docs.set('AiCalls/new', { createdAt: ts('2026-10-01T00:00:00Z') });
        expect(await purgeAiCalls(now)).toBe(2);
        expect([...h.docs.keys()].filter((k) => k.startsWith('AiCalls/'))).toEqual(['AiCalls/new']);
        expect(h.deletedPrefixes).toEqual(['ai-calls/old/']);

        h.docs.set('AiUsage/2024-10', { calls: 1 });
        h.docs.set('AiUsage/2024-10/keys/x', { calls: 1 });
        h.docs.set('AiUsage/2024-11', { calls: 1 });
        h.docs.set('AiUsage/2026-09', { calls: 1 });
        h.docs.set('AiUsage/2026-09/days/30__menu-scan__k', { units: 3 });
        h.docs.set('AiUsage/2026-09/keys/menu-scan__k', { calls: 3 });
        h.docs.set('AiUsage/2026-10/days/28__menu-scan__k', { units: 3 });
        await purgeAiUsage(now);
        expect([...h.docs.keys()].filter((k) => k.startsWith('AiUsage/')).sort()).toEqual(['AiUsage/2024-11', 'AiUsage/2026-09', 'AiUsage/2026-09/keys/menu-scan__k', 'AiUsage/2026-10/days/28__menu-scan__k']);
    });
});
