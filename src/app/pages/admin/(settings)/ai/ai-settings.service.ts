/**
 * Settings, AI (docs/app/ai.html): `Settings/ai` (admin only), the keys through admin-only
 * callables, the month's totals (`AiUsage`) and the records of calls (`AiCalls`). Keys never
 * reach the page: a connection shows only the preview the server wrote.
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
    Firestore, collection, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where, Timestamp,
} from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { getDownloadURL, ref } from '@angular/fire/storage';
import { arcCallable } from '../../../../core/config/arc-functions';
import { ArcStorage } from '../../../../core/config/arc-storage';

export const AI_TIERS = ['cheap', 'fast', 'thorough'] as const;
export type AiTier = (typeof AI_TIERS)[number];
export type AiReads = 'pictures' | 'pdfs';

export interface AiPresetInfo {
    id: string;
    label: string;
    kind: 'openai' | 'vertex';
    processesIn: string;
    needsWorkspace: boolean;
    needsAddress: boolean;
    reportsCost: boolean;
    models: Array<{ model: string; reads: AiReads[]; schema: 'strict' | 'json'; priceIn?: number; priceOut?: number }>;
}

export interface AiPurposeInfo {
    id: string;
    label: string;
    description: string;
    tier: AiTier;
    output: 'text' | 'data';
    maxChars: number;
    pictures: { max: number; maxMb: number } | null;
    pdfs: { max: number; maxMb: number } | null;
    perKeyPerDay: number | null;
    timeoutSeconds: number;
}

export interface AiSetupInfo {
    purposes: AiPurposeInfo[];
    presets: AiPresetInfo[];
    pricesCheckedOn: string;
    defaultVertexLocation: string;
}

export interface AiConnectionForm {
    id: string;
    preset: string;
    label: string;
    workspace: string;
    baseUrl: string;
    location: string;
    processesIn: string;
    /** Written by the server only; shown, never saved from here. */
    keyPreview: string | null;
    keySetAt: string | null;
    keySetBy: string | null;
    lastOkAt: string | null;
    lastError: string | null;
}

export interface AiModelRef {
    connection: string;
    model: string;
}

export interface AiPurposeForm {
    enabled: boolean;
    models: AiModelRef[];
    perKeyPerDay: number | null;
    keepContent: boolean;
}

export interface AiModelForm {
    reads?: AiReads[];
    schema?: 'strict' | 'json';
    priceIn?: number;
    priceOut?: number;
}

export interface AiSettingsForm {
    mode: 'test' | 'live';
    connections: AiConnectionForm[];
    tiers: Record<AiTier, AiModelRef[]>;
    purposes: Record<string, AiPurposeForm>;
    /** By `{connection}/{model}`. */
    models: Record<string, AiModelForm>;
    monthlyUsd: number;
}

export const DEFAULT_MONTHLY_USD = 20;

export function emptyAiForm(): AiSettingsForm {
    return { mode: 'test', connections: [], tiers: { cheap: [], fast: [], thorough: [] }, purposes: {}, models: {}, monthlyUsd: DEFAULT_MONTHLY_USD };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const refs = (v: unknown): AiModelRef[] => (Array.isArray(v) ? v.map(obj).map((r) => ({ connection: str(r['connection']), model: str(r['model']) })).filter((r) => r.connection && r.model) : []);

/** The form from the stored document; the server checks it again on every call. */
export function aiFormFrom(data: Record<string, unknown> | undefined): AiSettingsForm {
    const d = data ?? {};
    const form = emptyAiForm();
    form.mode = d['mode'] === 'live' ? 'live' : 'test';
    form.connections = Object.entries(obj(d['connections'])).map(([id, raw]) => {
        const c = obj(raw);
        return {
            id, preset: str(c['preset']), label: str(c['label']), workspace: str(c['workspace']), baseUrl: str(c['baseUrl']),
            location: str(c['location']), processesIn: str(c['processesIn']), keyPreview: strOrNull(c['keyPreview']),
            keySetAt: strOrNull(c['keySetAt']), keySetBy: strOrNull(c['keySetBy']), lastOkAt: strOrNull(c['lastOkAt']), lastError: strOrNull(c['lastError']),
        };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const tiers = obj(d['tiers']);
    for (const t of AI_TIERS) form.tiers[t] = refs(tiers[t]);
    for (const [id, raw] of Object.entries(obj(d['purposes']))) {
        const p = obj(raw);
        form.purposes[id] = {
            enabled: p['enabled'] !== false,
            models: refs(p['models']),
            perKeyPerDay: Number.isInteger(p['perKeyPerDay']) && (p['perKeyPerDay'] as number) >= 1 ? (p['perKeyPerDay'] as number) : null,
            keepContent: p['keepContent'] === true,
        };
    }
    for (const [key, raw] of Object.entries(obj(d['models']))) {
        const m = obj(raw);
        form.models[key] = {
            ...(Array.isArray(m['reads']) ? { reads: (m['reads'] as unknown[]).filter((r): r is AiReads => r === 'pictures' || r === 'pdfs') } : {}),
            ...(m['schema'] === 'strict' || m['schema'] === 'json' ? { schema: m['schema'] } : {}),
            ...(typeof m['priceIn'] === 'number' ? { priceIn: m['priceIn'] } : {}),
            ...(typeof m['priceOut'] === 'number' ? { priceOut: m['priceOut'] } : {}),
        };
    }
    const budget = obj(d['budget'])['monthlyUsd'];
    form.monthlyUsd = typeof budget === 'number' && budget >= 0 ? budget : DEFAULT_MONTHLY_USD;
    return form;
}

/**
 * What save writes. Merged, so what only the server writes on a connection (the key's
 * preview, the last success or error) stays; a connection, purpose or model the admin
 * took away since `loaded` is deleted.
 */
export function aiSettingsData(form: AiSettingsForm, loaded: AiSettingsForm): Record<string, unknown> {
    const connections: Record<string, unknown> = {};
    for (const c of form.connections) {
        connections[c.id] = { preset: c.preset, label: c.label.trim(), workspace: c.workspace.trim(), baseUrl: c.baseUrl.trim(), location: c.location.trim(), processesIn: c.processesIn.trim() };
        // New here: nothing the server noted about an older connection of the same id carries over.
        if (!loaded.connections.some((l) => l.id === c.id)) {
            Object.assign(connections[c.id] as Record<string, unknown>, { keyPreview: deleteField(), keySetAt: deleteField(), keySetBy: deleteField(), lastOkAt: deleteField(), lastError: deleteField(), lastErrorAt: deleteField() });
        }
    }
    for (const c of loaded.connections) if (!form.connections.some((f) => f.id === c.id)) connections[c.id] = deleteField();
    const purposes: Record<string, unknown> = {};
    for (const [id, p] of Object.entries(form.purposes)) {
        purposes[id] = { enabled: p.enabled, models: p.models, perKeyPerDay: p.perKeyPerDay ?? deleteField(), keepContent: p.keepContent };
    }
    const models: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(form.models)) {
        models[key] = {
            reads: m.reads ?? deleteField(), schema: m.schema ?? deleteField(),
            priceIn: m.priceIn ?? deleteField(), priceOut: m.priceOut ?? deleteField(),
        };
    }
    for (const key of Object.keys(loaded.models)) if (!(key in form.models)) models[key] = deleteField();
    return { mode: form.mode, connections, tiers: form.tiers, purposes, models, budget: { monthlyUsd: form.monthlyUsd } };
}

/** A new connection's id from its label: lower case letters, digits and -, unique among `taken`. */
export function connectionId(label: string, taken: readonly string[]): string {
    const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'connection';
    let id = base;
    for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
    return id;
}

export interface AiTotals {
    calls: number;
    failed: number;
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    costUsd: number;
}

export interface AiMonthUsage extends AiTotals {
    month: string;
    testCalls: number;
    byPurpose: Array<{ id: string } & AiTotals>;
    byModel: Array<{ connection: string; model: string } & AiTotals>;
    byDay: Array<{ day: string } & AiTotals>;
    keys: Array<{ purpose: string; limitKey: string; units: number } & AiTotals>;
}

function totals(raw: unknown): AiTotals {
    const t = obj(raw);
    const n = (k: string) => (typeof t[k] === 'number' ? (t[k] as number) : 0);
    return { calls: n('calls'), failed: n('failed'), tokensIn: n('tokensIn'), tokensOut: n('tokensOut'), tokensThinking: n('tokensThinking'), costUsd: n('costUsd') };
}

export function monthUsageFrom(month: string, data: Record<string, unknown> | undefined, keys: Array<Record<string, unknown>>): AiMonthUsage {
    const d = data ?? {};
    const byCost = <T extends AiTotals>(a: T, b: T) => b.costUsd - a.costUsd || b.calls - a.calls;
    return {
        month,
        ...totals(d),
        testCalls: typeof d['testCalls'] === 'number' ? (d['testCalls'] as number) : 0,
        byPurpose: Object.entries(obj(d['byPurpose'])).map(([id, t]) => ({ id, ...totals(t) })).sort(byCost),
        byModel: Object.values(obj(d['byModel'])).map((t) => ({ connection: str(obj(t)['connection']), model: str(obj(t)['model']), ...totals(t) })).sort(byCost),
        byDay: Object.entries(obj(d['byDay'])).map(([day, t]) => ({ day, ...totals(t) })).sort((a, b) => a.day.localeCompare(b.day)),
        keys: keys.map((k) => ({ purpose: str(k['purpose']), limitKey: str(k['limitKey']), units: typeof k['units'] === 'number' ? (k['units'] as number) : 0, ...totals(k) })),
    };
}

export interface AiCallRow {
    id: string;
    createdAt: Date | null;
    purpose: string;
    test: boolean;
    outcome: string;
    scope?: string;
    detail?: string;
    connection: string | null;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    costUsd: number;
    costFrom: string;
    ms: number;
    ref: string | null;
    limitKey: string | null;
    units: number;
    input: { chars: number; files: number; bytes: number };
    attempts: Array<{ connection: string; model: string; outcome: string; ms: number; detail?: string }>;
    content: { instruction: string; parts: Array<{ kind: string; text?: string; mimeType?: string; size?: number; path?: string | null }>; answer: string | null } | null;
}

export function callRowFrom(id: string, d: Record<string, unknown>): AiCallRow {
    const created = d['createdAt'] as { toDate?: () => Date } | undefined;
    const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
    const input = obj(d['input']);
    const content = d['content'] ? obj(d['content']) : null;
    return {
        id,
        createdAt: created?.toDate ? created.toDate() : null,
        purpose: str(d['purpose']),
        test: d['test'] === true,
        outcome: str(d['outcome']),
        ...(d['scope'] ? { scope: str(d['scope']) } : {}),
        ...(d['detail'] ? { detail: str(d['detail']) } : {}),
        connection: strOrNull(d['connection']),
        model: strOrNull(d['model']),
        tokensIn: num('tokensIn'), tokensOut: num('tokensOut'), tokensThinking: num('tokensThinking'),
        costUsd: num('costUsd'), costFrom: str(d['costFrom']), ms: num('ms'),
        ref: strOrNull(d['ref']), limitKey: strOrNull(d['limitKey']), units: num('units') || 1,
        input: { chars: Number(input['chars'] ?? 0), files: Number(input['files'] ?? 0), bytes: Number(input['bytes'] ?? 0) },
        attempts: Array.isArray(d['attempts']) ? (d['attempts'] as Array<Record<string, unknown>>).map((a) => ({ connection: str(a['connection']), model: str(a['model']), outcome: str(a['outcome']), ms: Number(a['ms'] ?? 0), ...(a['detail'] ? { detail: str(a['detail']) } : {}) })) : [],
        content: content ? {
            instruction: str(content['instruction']),
            parts: Array.isArray(content['parts']) ? (content['parts'] as Array<Record<string, unknown>>).map((p) => ({ kind: str(p['kind']), text: typeof p['text'] === 'string' ? p['text'] : undefined, mimeType: typeof p['mimeType'] === 'string' ? p['mimeType'] : undefined, size: typeof p['size'] === 'number' ? p['size'] : undefined, path: typeof p['path'] === 'string' ? p['path'] : null })) : [],
            answer: typeof content['answer'] === 'string' ? content['answer'] : null,
        } : null,
    };
}

const csvCell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // A cell a spreadsheet would run as a formula starts with a quote instead.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The calls as CSV, one row each, for a spreadsheet. */
export function callsCsv(rows: AiCallRow[]): string {
    const head = ['time (UTC)', 'purpose', 'test', 'outcome', 'detail', 'connection', 'model', 'tokens in', 'tokens out', 'thinking tokens', 'cost USD', 'cost from', 'ms', 'key', 'units', 'ref'];
    const lines = rows.map((r) => [
        r.createdAt?.toISOString() ?? '', r.purpose, r.test ? 'yes' : 'no', r.outcome, r.detail ?? '', r.connection ?? '', r.model ?? '',
        r.tokensIn, r.tokensOut, r.tokensThinking, r.costUsd.toFixed(6), r.costFrom, r.ms, r.limitKey ?? '', r.units, r.ref ?? '',
    ].map(csvCell).join(','));
    return [head.join(','), ...lines].join('\n') + '\n';
}

@Injectable({ providedIn: 'root' })
export class AiSettingsService {
    private readonly firestore = inject(Firestore);
    private readonly functions = inject(Functions);
    private readonly injector = inject(Injector);
    private readonly arcStorage = inject(ArcStorage);

    private inCtx<T>(fn: () => Promise<T>): Promise<T> {
        return runInInjectionContext(this.injector, fn);
    }

    async setup(): Promise<AiSetupInfo> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'aiSetupInfo')({}));
        return result.data as AiSetupInfo;
    }

    async load(): Promise<AiSettingsForm> {
        const snap = await this.inCtx(() => getDoc(doc(this.firestore, 'Settings', 'ai')));
        return aiFormFrom(snap.data());
    }

    async save(form: AiSettingsForm, loaded: AiSettingsForm): Promise<void> {
        const data = aiSettingsData(form, loaded);
        await this.inCtx(() => setDoc(doc(this.firestore, 'Settings', 'ai'), { ...data, updatedAt: serverTimestamp() }, { merge: true }));
    }

    async setKey(connection: string, key: string): Promise<{ keyPreview: string; keySetAt: string; keySetBy: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'setAiKey')({ connection, key }));
        return result.data as { keyPreview: string; keySetAt: string; keySetBy: string };
    }

    async removeKey(connection: string): Promise<void> {
        await this.inCtx(() => arcCallable(this.functions, 'removeAiKey')({ connection }));
    }

    async test(connection: string, model: string): Promise<{ ok: boolean; ms: number; reply?: string; failure?: string; detail?: string; costUsd?: number }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'testAiConnection', { timeout: 70_000 })({ connection, model }));
        return result.data as { ok: boolean; ms: number; reply?: string; failure?: string; detail?: string; costUsd?: number };
    }

    async usage(month: string): Promise<AiMonthUsage> {
        const [snap, keys] = await Promise.all([
            this.inCtx(() => getDoc(doc(this.firestore, 'AiUsage', month))),
            this.inCtx(() => getDocs(query(collection(this.firestore, 'AiUsage', month, 'keys'), orderBy('costUsd', 'desc'), limit(20)))).catch(() => null),
        ]);
        return monthUsageFrom(month, snap.data(), keys?.docs.map((d) => d.data()) ?? []);
    }

    async recentCalls(max = 100): Promise<AiCallRow[]> {
        const snap = await this.inCtx(() => getDocs(query(collection(this.firestore, 'AiCalls'), orderBy('createdAt', 'desc'), limit(max))));
        return snap.docs.map((d) => callRowFrom(d.id, d.data()));
    }

    /** Every record kept (the last 60 days), for the CSV download. */
    async allCalls(): Promise<AiCallRow[]> {
        const since = Timestamp.fromDate(new Date(Date.now() - 61 * 24 * 3600 * 1000));
        const snap = await this.inCtx(() => getDocs(query(collection(this.firestore, 'AiCalls'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(20_000))));
        return snap.docs.map((d) => callRowFrom(d.id, d.data()));
    }

    /** A kept file's link, for an admin (storage.rules). */
    async fileUrl(path: string): Promise<string> {
        const storage = await this.arcStorage.get();
        return this.inCtx(() => getDownloadURL(ref(storage, path)));
    }
}
