/**
 * Settings, AI (`Settings/ai`, specs/ai-spec.md): the mode, the connections to providers,
 * the models of each tier, each purpose's choices, model abilities and prices, and the
 * monthly budget. Admins write it from the admin page; every gap is filled from the
 * defaults here, and a wrong value is dropped rather than trusted.
 *
 * Keys are never here: Settings is readable by every admin, so they live in AiKeys
 * (keys.ts). A connection here shows only the key's preview.
 */
import { db } from '../init.js';
import { arcFunctionsRegion } from '../arc-config.js';
import { AI_TIERS, type AiTier } from './types.js';
import { findPreset, type AiKnownModel, type AiReads, type AiSchemaSupport } from './presets.js';

export const AI_SETTINGS_DOC = 'ai';
export const DEFAULT_MONTHLY_BUDGET_USD = 20;

export type AiMode = 'test' | 'live';

export interface AiConnection {
    id: string;
    preset: string;
    label: string;
    /** Alibaba Cloud's workspace id, part of its address. */
    workspace: string;
    /** Other only: the provider's OpenAI-style address, `https://.../v1`. */
    baseUrl: string;
    /** Vertex only: where Gemini runs, such as `eu` or `europe-west4`. */
    location: string;
    /** Other only: where the admin says it processes data. */
    processesIn: string;
    keyPreview: string | null;
    keySetAt: string | null;
    keySetBy: string | null;
    lastOkAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
}

export interface AiModelRef {
    connection: string;
    model: string;
}

export interface AiPurposeSettings {
    enabled: boolean;
    /** The admin's models for this purpose; empty: the tier's. */
    models: AiModelRef[];
    /** The admin's allowance per key a day; null: the purpose's own. */
    perKeyPerDay: number | null;
    /** Keep the question and answer on each record (AI-D11). */
    keepContent: boolean;
}

/** What the admin says about a model: what it reads, its schema support and its prices. */
export interface AiModelSettings {
    reads?: AiReads[];
    schema?: AiSchemaSupport;
    priceIn?: number;
    priceOut?: number;
}

export interface AiSettings {
    mode: AiMode;
    connections: Record<string, AiConnection>;
    tiers: Record<AiTier, AiModelRef[]>;
    purposes: Record<string, AiPurposeSettings>;
    /** By `{connection}/{model}`. */
    models: Record<string, AiModelSettings>;
    budget: { monthlyUsd: number };
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LOCATION = /^[a-z0-9-]{2,30}$/;

function text(value: unknown, max = 200): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function textOrNull(value: unknown, max = 500): string | null {
    const t = text(value, max);
    return t || null;
}

function obj(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function price(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : undefined;
}

/** Vertex's location when the admin sets none: the multi-region of the functions region, never global (AI-D7). */
export function defaultVertexLocation(functionsRegion = arcFunctionsRegion()): string {
    if (functionsRegion.startsWith('europe-')) return 'eu';
    if (functionsRegion.startsWith('us-')) return 'us';
    return functionsRegion;
}

function modelRefs(value: unknown, connections: Record<string, AiConnection>): AiModelRef[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((v) => obj(v))
        .map((v) => ({ connection: text(v['connection'], 40), model: text(v['model'], 120) }))
        .filter((r) => r.model && connections[r.connection])
        .slice(0, 5);
}

/** Stored settings with every gap filled from the defaults. */
export function resolveAiSettings(raw: Record<string, unknown> | undefined): AiSettings {
    const data = raw ?? {};
    const connections: Record<string, AiConnection> = {};
    for (const [id, value] of Object.entries(obj(data['connections']))) {
        const c = obj(value);
        if (!ID.test(id) || !findPreset(c['preset'])) continue;
        const location = text(c['location'], 30);
        connections[id] = {
            id,
            preset: String(c['preset']),
            label: text(c['label'], 80) || findPreset(c['preset'])!.label,
            workspace: text(c['workspace'], 80),
            baseUrl: text(c['baseUrl'], 300),
            location: LOCATION.test(location) ? location : '',
            processesIn: text(c['processesIn'], 120),
            keyPreview: textOrNull(c['keyPreview'], 20),
            keySetAt: textOrNull(c['keySetAt'], 40),
            keySetBy: textOrNull(c['keySetBy'], 200),
            lastOkAt: textOrNull(c['lastOkAt'], 40),
            lastError: textOrNull(c['lastError'], 300),
            lastErrorAt: textOrNull(c['lastErrorAt'], 40),
        };
    }
    const tiersRaw = obj(data['tiers']);
    const tiers = Object.fromEntries(AI_TIERS.map((t) => [t, modelRefs(tiersRaw[t], connections)])) as Record<AiTier, AiModelRef[]>;
    const purposes: Record<string, AiPurposeSettings> = {};
    for (const [id, value] of Object.entries(obj(data['purposes']))) {
        const p = obj(value);
        const allowance = p['perKeyPerDay'];
        purposes[id] = {
            enabled: p['enabled'] !== false,
            models: modelRefs(p['models'], connections),
            perKeyPerDay: Number.isInteger(allowance) && (allowance as number) >= 1 ? (allowance as number) : null,
            keepContent: p['keepContent'] === true,
        };
    }
    const models: Record<string, AiModelSettings> = {};
    for (const [key, value] of Object.entries(obj(data['models']))) {
        const m = obj(value);
        const reads = Array.isArray(m['reads']) ? (m['reads'] as unknown[]).filter((r): r is AiReads => r === 'pictures' || r === 'pdfs') : undefined;
        const schema = m['schema'] === 'strict' || m['schema'] === 'json' ? m['schema'] : undefined;
        models[key.slice(0, 160)] = { reads, schema, priceIn: price(m['priceIn']), priceOut: price(m['priceOut']) };
    }
    const budget = obj(data['budget'])['monthlyUsd'];
    return {
        mode: data['mode'] === 'live' ? 'live' : 'test',
        connections,
        tiers,
        purposes,
        models,
        budget: { monthlyUsd: typeof budget === 'number' && Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_MONTHLY_BUDGET_USD },
    };
}

let cached: { at: number; value: AiSettings } | null = null;
const CACHE_MS = 15_000;

/** Settings, AI, read at most every 15 seconds per instance. */
export async function readAiSettings(now = Date.now()): Promise<AiSettings> {
    if (cached && now - cached.at < CACHE_MS) return cached.value;
    const snap = await db.collection('Settings').doc(AI_SETTINGS_DOC).get();
    const value = resolveAiSettings(snap.exists ? snap.data() : undefined);
    cached = { at: now, value };
    return value;
}

/** Forget the cached settings: a test, or a callable that just changed them. */
export function forgetAiSettings(): void {
    cached = null;
}

/** The settings for one purpose: the admin's, else on, the tier's models, the purpose's allowance, no content kept. */
export function purposeSettings(settings: AiSettings, purposeId: string): AiPurposeSettings {
    return settings.purposes[purposeId] ?? { enabled: true, models: [], perKeyPerDay: null, keepContent: false };
}

/** A model's abilities and prices: the admin's word first, else what Arc knows of it, else text only, JSON, no price. */
export function modelInfo(settings: AiSettings, ref: AiModelRef): AiKnownModel {
    const connection = settings.connections[ref.connection];
    const known = connection ? findPreset(connection.preset)?.models[ref.model] : undefined;
    const admin = settings.models[`${ref.connection}/${ref.model}`] ?? {};
    return {
        reads: admin.reads ?? known?.reads ?? [],
        schema: admin.schema ?? known?.schema ?? 'json',
        priceIn: admin.priceIn ?? known?.priceIn,
        priceOut: admin.priceOut ?? known?.priceOut,
    };
}

/**
 * A connection's OpenAI-style address: the preset's (with the workspace filled in), or the
 * admin's for Other. '' when it cannot be built. Keys are tied to this address (AI-D8).
 */
export function connectionBaseUrl(connection: AiConnection): string {
    const preset = findPreset(connection.preset);
    if (!preset || preset.kind !== 'openai') return '';
    if (preset.baseUrl) {
        if (!preset.baseUrl.includes('{workspace}')) return preset.baseUrl;
        return /^[A-Za-z0-9-]{1,63}$/.test(connection.workspace) ? preset.baseUrl.replace('{workspace}', connection.workspace) : '';
    }
    return safeBaseUrl(connection.baseUrl) ? connection.baseUrl.replace(/\/+$/, '') : '';
}

/** Whether an address the admin typed may be called: https, a public host name, no credentials (AI-D19). */
export function safeBaseUrl(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase();
    // A trailing dot is the same host (metadata.google.internal.), so it is refused rather than let past the names below.
    if (host.endsWith('.')) return false;
    if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') return false;
    // No address literals: a private, local or metadata address could be reached that way.
    if (/^[0-9.]+$/.test(host) || host.startsWith('[') || host.includes(':')) return false;
    return true;
}

/** Where a connection processes data, as the admin page shows it. */
export function connectionProcessesIn(connection: AiConnection): string {
    const preset = findPreset(connection.preset);
    if (!preset) return '';
    if (preset.kind === 'vertex') return `Google Cloud, ${connection.location || defaultVertexLocation()}`;
    if (connection.preset === 'other') return connection.processesIn || preset.processesIn;
    return preset.processesIn;
}
