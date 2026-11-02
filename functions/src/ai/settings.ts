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
import { AI_FILE_KINDS, AI_KINDS, AI_TIERS, AI_UNITS, type AiFileKind, type AiKind, type AiTier, type AiUnit } from './types.js';
import { SPEECH_PRESETS, VOICE_ID, VOICE_NAME } from './voices.js';
import { BEARER, findPreset, type AiCurrency, type AiKeyHeader, type AiKnownModel, type AiPriceAbove, type AiReads, type AiSchemaSupport } from './presets.js';

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
    /** Other only: the header the key goes in (AM-D8): `authorization` (Bearer), `api-key`, `x-api-key` or another name. */
    header: string;
    /** The most requests a minute, and at once, across every instance (AM-D15); null: the preset's; 0: no limit. */
    perMinute: number | null;
    atOnce: number | null;
    /** USD for one unit of the provider's currency, for a provider that does not price in USD (AM-D5). */
    usdRate: number | null;
    /** The balance last read with the connection's key (AM-D32), its unit (`USD`, `characters`...) and when. */
    balance: number | null;
    balanceUnit: string | null;
    balanceAt: string | null;
    /** Below this, admins are told once (AM-D32); null: no alert. */
    lowBalance: number | null;
    balanceLowAlerted: boolean;
    /** The low mark admins were last told about: a new mark tells them again. */
    balanceAlertMark: number | null;
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
    /** The admin's word on the purpose's cache (AM-D16): false switches it off; null: the purpose's. */
    cache: boolean | null;
    /** The admin's days before files left in `ai-files/` are deleted (AM-D10); null: the purpose's. */
    deleteAfterDays: number | null;
    /**
     * A speech purpose: the admin's voice ids by voice name and preset, over the app's
     * (AM-D17). An empty id takes the app's back.
     */
    voices: Record<string, Record<string, string>>;
}

/** What the admin says about a model: what it reads, its schema support and its prices. */
export interface AiModelSettings {
    makes?: AiKind;
    unit?: AiUnit;
    reads?: AiReads[];
    schema?: AiSchemaSupport;
    priceIn?: number;
    priceOut?: number;
    priceCachedIn?: number;
    priceCacheWrite?: number;
    /** For a unit other than tokens: per picture, per 1,000 characters, or per second. */
    price?: number;
}

/** A model as askAi uses it: what it makes and bills, its prices and their currency (AM-D3, AM-D5). */
export interface AiModelInfo extends AiKnownModel {
    makes: AiKind;
    unit: AiUnit;
    currency: AiCurrency;
    /** USD for one unit of `currency`; null when the admin has not given one (the price then counts 0). */
    usdRate: number | null;
    testedLive: boolean;
}

/** The default list of models for each file kind (AM-D4). */
export type AiKindLists = Record<AiFileKind, AiModelRef[]>;

export interface AiSettings {
    mode: AiMode;
    connections: Record<string, AiConnection>;
    tiers: Record<AiTier, AiModelRef[]>;
    /** The models that make pictures, speech, other audio and video, in order (AM-D4). */
    lists: AiKindLists;
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

function wholeOrNull(value: unknown, min: number, max: number): number | null {
    return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : null;
}

function numberOrNull(value: unknown, min: number, max: number): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** Headers a key may never go in: they would change the request itself, or where it goes. */
const FORBIDDEN_HEADERS = /^(host|cookie|set-cookie|connection|content-.*|transfer-encoding|te|upgrade|proxy-.*|x-forwarded-.*|forwarded|origin|referer|user-agent|accept.*)$/;

/** A header name the admin may choose for Other (AM-D8): letters, digits and -, not one of the forbidden. */
export function safeHeaderName(value: string): boolean {
    return /^[a-z][a-z0-9-]{0,39}$/.test(value) && !FORBIDDEN_HEADERS.test(value);
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

/** The admin's voice maps: known names and presets, usable ids; anything else is dropped. */
function voiceMaps(value: unknown): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [name, raw] of Object.entries(obj(value)).slice(0, 20)) {
        if (!VOICE_NAME.test(name)) continue;
        const map: Record<string, string> = {};
        for (const [preset, id] of Object.entries(obj(raw))) {
            if ((SPEECH_PRESETS as readonly string[]).includes(preset) && typeof id === 'string' && VOICE_ID.test(id)) map[preset] = id;
        }
        if (Object.keys(map).length) out[name] = map;
    }
    return out;
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
            header: (() => {
                const h = text(c['header'], 40).toLowerCase();
                return h && safeHeaderName(h) ? h : '';
            })(),
            perMinute: wholeOrNull(c['perMinute'], 0, 100_000),
            atOnce: wholeOrNull(c['atOnce'], 0, 1000),
            usdRate: numberOrNull(c['usdRate'], 0, 1000),
            balance: numberOrNull(c['balance'], -1e12, 1e12),
            balanceUnit: textOrNull(c['balanceUnit'], 20),
            balanceAt: textOrNull(c['balanceAt'], 40),
            lowBalance: numberOrNull(c['lowBalance'], 0, 1e12),
            balanceLowAlerted: c['balanceLowAlerted'] === true,
            balanceAlertMark: numberOrNull(c['balanceAlertMark'], 0, 1e12),
        };
    }
    const tiersRaw = obj(data['tiers']);
    const tiers = Object.fromEntries(AI_TIERS.map((t) => [t, modelRefs(tiersRaw[t], connections)])) as Record<AiTier, AiModelRef[]>;
    const listsRaw = obj(data['lists']);
    const lists = Object.fromEntries(AI_FILE_KINDS.map((k) => [k, modelRefs(listsRaw[k], connections)])) as AiKindLists;
    const purposes: Record<string, AiPurposeSettings> = {};
    for (const [id, value] of Object.entries(obj(data['purposes']))) {
        const p = obj(value);
        const allowance = p['perKeyPerDay'];
        purposes[id] = {
            enabled: p['enabled'] !== false,
            models: modelRefs(p['models'], connections),
            perKeyPerDay: Number.isInteger(allowance) && (allowance as number) >= 1 ? (allowance as number) : null,
            keepContent: p['keepContent'] === true,
            cache: typeof p['cache'] === 'boolean' ? p['cache'] : null,
            deleteAfterDays: wholeOrNull(p['deleteAfterDays'], 1, 3650),
            voices: voiceMaps(p['voices']),
        };
    }
    const models: Record<string, AiModelSettings> = {};
    for (const [key, value] of Object.entries(obj(data['models']))) {
        const m = obj(value);
        const reads = Array.isArray(m['reads']) ? (m['reads'] as unknown[]).filter((r): r is AiReads => r === 'pictures' || r === 'pdfs') : undefined;
        const schema = m['schema'] === 'strict' || m['schema'] === 'json' ? m['schema'] : undefined;
        const makes = AI_KINDS.includes(m['makes'] as AiKind) ? (m['makes'] as AiKind) : undefined;
        const unit = AI_UNITS.includes(m['unit'] as AiUnit) ? (m['unit'] as AiUnit) : undefined;
        models[key.slice(0, 160)] = {
            makes, unit, reads, schema,
            priceIn: price(m['priceIn']), priceOut: price(m['priceOut']),
            priceCachedIn: price(m['priceCachedIn']), priceCacheWrite: price(m['priceCacheWrite']),
            price: price(m['price']),
        };
    }
    const budget = obj(data['budget'])['monthlyUsd'];
    return {
        mode: data['mode'] === 'live' ? 'live' : 'test',
        connections,
        tiers,
        lists,
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
    return settings.purposes[purposeId] ?? { enabled: true, models: [], perKeyPerDay: null, keepContent: false, cache: null, deleteAfterDays: null, voices: {} };
}

/**
 * A model's abilities and prices: the admin's word first, else what Arc knows of it, else a
 * text model billed by tokens, JSON only, with no price. The higher price above a prompt
 * size is Arc's only: an admin who sets a price sets the one price.
 */
export function modelInfo(settings: AiSettings, ref: AiModelRef): AiModelInfo {
    const connection = settings.connections[ref.connection];
    const preset = connection ? findPreset(connection.preset) : undefined;
    const known = preset?.models[ref.model];
    const admin = settings.models[`${ref.connection}/${ref.model}`] ?? {};
    const adminPriced = admin.priceIn !== undefined || admin.priceOut !== undefined;
    const currency = preset?.currency ?? 'USD';
    return {
        makes: admin.makes ?? known?.makes ?? 'text',
        unit: admin.unit ?? known?.unit ?? 'tokens',
        reads: admin.reads ?? known?.reads ?? [],
        schema: admin.schema ?? known?.schema ?? 'json',
        priceIn: admin.priceIn ?? known?.priceIn,
        priceOut: admin.priceOut ?? known?.priceOut,
        priceCachedIn: admin.priceCachedIn ?? (adminPriced ? undefined : known?.priceCachedIn),
        priceCacheWrite: admin.priceCacheWrite ?? (adminPriced ? undefined : known?.priceCacheWrite),
        priceAbove: adminPriced ? undefined : (known?.priceAbove as AiPriceAbove | undefined),
        price: admin.price ?? known?.price,
        recommend: known?.recommend,
        // What a speech model takes is Arc's knowledge only: a model the admin describes has no caps.
        speech: known?.speech,
        currency,
        usdRate: currency === 'USD' ? 1 : connection?.usdRate ?? null,
        testedLive: preset?.testedLive !== false && known?.testedLive !== false,
    };
}

/** How a connection's key is sent (AM-D8): the preset's way, or for Other the admin's header. */
export function connectionAuth(connection: AiConnection): AiKeyHeader {
    const preset = findPreset(connection.preset);
    if (preset?.auth) return preset.auth;
    if (connection.preset === 'other' && connection.header && connection.header !== 'authorization') return { header: connection.header, prefix: '' };
    return BEARER;
}

/** The connection's limits: the admin's (0: none at all), else the preset's entry-plan numbers (AM-D15). */
export function connectionLimits(connection: AiConnection): { perMinute: number | null; atOnce: number | null } {
    const preset = findPreset(connection.preset);
    const limit = (admin: number | null, own: number | undefined) => (admin === 0 ? null : admin ?? own ?? null);
    return { perMinute: limit(connection.perMinute, preset?.perMinute), atOnce: limit(connection.atOnce, preset?.atOnce) };
}

/**
 * A connection's address: the preset's (with the workspace filled in), or the admin's for
 * Other. '' when it cannot be built, and for Vertex, which needs none. Keys are tied to this
 * address (AI-D8).
 */
export function connectionBaseUrl(connection: AiConnection): string {
    const preset = findPreset(connection.preset);
    if (!preset || preset.kind === 'vertex') return '';
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
