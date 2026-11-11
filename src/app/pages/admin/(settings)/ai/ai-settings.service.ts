/**
 * Settings, AI (docs/app/ai.html): `Settings/ai` (admin only), the keys through admin-only
 * callables, the month's totals (`AiUsage`) and the records of calls (`AiCalls`). Keys never
 * reach the page: a connection shows only the preview the server wrote. A connection's
 * balance is written by the functions only (specs/ai-media-spec.md, AM-D32); files a model
 * made are read through `readAiFile` (AM-D27).
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
    Firestore, collection, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where, Timestamp,
} from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { getBlob, ref } from '@angular/fire/storage';
import { arcCallable } from '../../../../core/config/arc-functions';
import { ArcStorage } from '../../../../core/config/arc-storage';

export const AI_TIERS = ['cheap', 'fast', 'thorough'] as const;
export type AiTier = (typeof AI_TIERS)[number];
export type AiReads = 'pictures' | 'pdfs';
/** What a purpose makes (AM-D1); `text` and `data` are answers, the rest files. */
export const AI_KINDS = ['text', 'data', 'image', 'speech', 'audio', 'video'] as const;
export type AiKind = (typeof AI_KINDS)[number];
/** What a model makes: text covers data. */
export const AI_MODEL_KINDS = ['text', 'image', 'speech', 'audio', 'video'] as const;
export type AiModelKind = (typeof AI_MODEL_KINDS)[number];
export const AI_FILE_KINDS = ['image', 'speech', 'audio', 'video'] as const;
export type AiFileKind = (typeof AI_FILE_KINDS)[number];
/** What a model bills by (AM-D5). */
export const AI_UNITS = ['tokens', 'pictures', 'characters', 'seconds'] as const;
export type AiUnit = (typeof AI_UNITS)[number];
export type AiAllowanceUnit = 'calls' | 'pictures' | 'characters' | 'seconds';

export function isFileKind(kind: string): kind is AiFileKind {
    return (AI_FILE_KINDS as readonly string[]).includes(kind);
}

/** The unit a kind of model usually bills by, for a model Arc does not know. */
export function naturalUnit(kind: AiModelKind): AiUnit {
    return kind === 'image' ? 'pictures' : kind === 'speech' ? 'characters' : kind === 'audio' || kind === 'video' ? 'seconds' : 'tokens';
}

export interface AiPresetModel {
    model: string;
    makes?: AiModelKind;
    unit?: AiUnit;
    reads: AiReads[];
    schema: 'strict' | 'json';
    priceIn?: number;
    priceOut?: number;
    priceCachedIn?: number;
    priceCacheWrite?: number;
    priceAbove?: { tokens: number; priceIn: number; priceOut: number; priceCachedIn?: number; priceCacheWrite?: number };
    /** For a unit other than tokens: per picture, per 1,000 characters, or per second. */
    price?: number;
    /** `default`: Arc suggests it for its kind's list (AM-D4). */
    recommend?: Array<AiTier | 'default'>;
    /** Speech: the most characters (or bytes, for Google) a request, and the formats it makes. */
    speech?: { maxChars?: number; maxBytes?: number; formats: string[]; languages?: string[] };
    /** Pictures: what it makes and takes, and its prices by quality or resolution (AM-D19). */
    image?: AiImageAbilities;
    /** Video: what it makes and takes (AM4); `job`: it answers through a long job. */
    video?: { aspects: string[]; resolutions: string[]; seconds: { min: number; max: number }; sound: 'always' | 'never' | 'choice'; firstFrame?: boolean; presenter?: boolean; priceByResolution?: Record<string, number>; priceWithSound?: Record<string, number>; tokensPerSecond?: number };
    job?: boolean;
    /** false: this model has never been called for real (AM-D34). */
    testedLive?: boolean;
}

/** What a picture model makes and takes (AM-D19), as the server's presets say. */
export interface AiImageAbilities {
    aspects: string[];
    resolutions: Array<'standard' | 'high'>;
    qualities?: Array<'low' | 'medium' | 'high'>;
    maxCount: number;
    seed?: boolean;
    negativePrompt?: boolean;
    edit?: boolean;
    formats: string[];
    priceByQuality?: Partial<Record<'low' | 'medium' | 'high', number>>;
    priceByResolution?: Partial<Record<'standard' | 'high', number>>;
    tokensPerPicture?: Partial<Record<'low' | 'medium' | 'high', number>>;
}

/** One voice of a provider (AM-D18). */
export interface AiVoice {
    id: string;
    name: string;
    languages: string[];
    gender: 'female' | 'male' | 'neutral' | null;
    labels: string[];
    previewUrl: string | null;
    /** The models it works with; empty: every model of the provider. */
    models: string[];
}

export interface AiPresetInfo {
    id: string;
    label: string;
    kind: 'openai' | 'vertex' | 'anthropic' | 'gemini' | 'elevenlabs' | 'minimax' | 'kling' | 'heygen';
    /** Its connector makes files, and for speech lists voices (AM-D18). */
    files?: string | null;
    makesSpeech?: boolean;
    /** It has a model that makes pictures (AM3). */
    makesImages?: boolean;
    /** It has a model that makes video, and one that makes presenter videos (AM4). */
    makesVideo?: boolean;
    makesPresenters?: boolean;
    /** false: Arc makes only files with it, so Test reads its voices instead (AM-D18). */
    makesText?: boolean;
    processesIn: string;
    needsWorkspace: boolean;
    needsAddress: boolean;
    reportsCost: boolean;
    /** Every kind but Vertex needs a key. Left out by an older server: worked out from `kind`. */
    needsKey?: boolean;
    keyHeader?: string;
    /** The currency of its prices; another than USD needs the admin's USD rate (AM-D5). */
    currency?: 'USD' | 'INR';
    pricesCheckedOn?: string;
    /** false: built from the provider's docs on `docsReadOn`, never called for real (AM-D34). */
    testedLive?: boolean;
    docsReadOn?: string | null;
    /** The entry plan's limits, used when the admin sets none (AM-D15). */
    perMinute?: number | null;
    atOnce?: number | null;
    /** Its own key can read the balance (AM-D32). */
    readsBalance?: boolean;
    billingUrl?: string | null;
    models: AiPresetModel[];
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
    /** What a limitKey is, in a word, such as "merchant"; null: not named. */
    limitKeyLabel: string | null;
    timeoutSeconds: number;
    /** What it makes; left out by an older server: text or data, from `output`. */
    makes?: AiKind;
    /** What the per-key allowance counts (AM-D23). */
    allowanceIn?: AiAllowanceUnit;
    /** A file kind: the app's folder for its files; null: Arc's private `ai-files/`. */
    saveTo?: string | null;
    /** The app's days before files left in `ai-files/` are deleted; null: kept. */
    deleteAfterDays?: number | null;
    /** How long the purpose's cache keeps a file; 0: no cache (AM-D16). */
    cacheDays?: number;
    fallback?: boolean;
    /** One of Arc's own purposes, such as the voice sample (AM-D18). */
    arc?: boolean;
    /** Arc's own purpose that takes no settings: the voice sample. */
    fixed?: boolean;
    /** Offered in Media's Create with AI tab (AM-D24). */
    mediaManager?: boolean;
    /** A speech purpose's named voices, with the app's voice ids by provider (AM-D17). */
    voices?: Array<{ name: string; ids: Record<string, string> }>;
    /** A presenter video purpose, and its named avatars with the app's ids by provider (AM-D33). */
    presenter?: boolean;
    avatars?: Array<{ name: string; ids: Record<string, string> }>;
    /** A video purpose's time for a job, in minutes (AM-D12). */
    jobTimeoutMinutes?: number | null;
}

/** One avatar (a "look") of a presenter provider (AM-D33). */
export interface AiAvatar {
    id: string;
    name: string;
    gender: 'female' | 'male' | null;
    previewUrl: string | null;
    voiceId: string | null;
}

/** Whether a preset's connections need a key: every kind but Vertex, which uses the functions' own account. */
export function presetNeedsKey(p: Pick<AiPresetInfo, 'kind' | 'needsKey'>): boolean {
    return p.needsKey ?? p.kind !== 'vertex';
}

/** What a purpose makes, from what the server says. */
export function purposeKind(p: AiPurposeInfo): AiKind {
    return p.makes ?? (p.output === 'data' ? 'data' : 'text');
}

/** The kind of model a purpose needs: text for text and data, else its file kind. */
export function modelKindFor(kind: AiKind): AiModelKind {
    return kind === 'data' ? 'text' : kind;
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
    /** Other only: the header the key goes in (AM-D8); '' is `Authorization: Bearer`. */
    header: string;
    /** The admin's limits (AM-D15); null: the preset's, or no limit. */
    perMinute: number | null;
    atOnce: number | null;
    /** USD for one unit of the provider's currency (AM-D5); null: not set, its prices count 0. */
    usdRate: number | null;
    /** Written by the functions only (AM-D32); shown, never saved from here. */
    balance: number | null;
    balanceUnit: string | null;
    balanceAt: string | null;
    /** Below this, admins are told once; null: no alert. */
    lowBalance: number | null;
}

/** A connection with nothing set yet beyond what is given. */
export function blankConnection(c: Pick<AiConnectionForm, 'id' | 'preset' | 'label'> & Partial<AiConnectionForm>): AiConnectionForm {
    return {
        workspace: '', baseUrl: '', location: '', processesIn: '', keyPreview: null, keySetAt: null, keySetBy: null, lastOkAt: null, lastError: null,
        header: '', perMinute: null, atOnce: null, usdRate: null, balance: null, balanceUnit: null, balanceAt: null, lowBalance: null,
        ...c,
    };
}

/** The headers Other offers for its key, besides a custom one: '' is `Authorization: Bearer`. */
export const KEY_HEADERS = ['', 'api-key', 'x-api-key'] as const;
/** Headers a key may never go in, as the server refuses them (functions/src/ai/settings.ts). */
const FORBIDDEN_HEADERS = /^(host|cookie|set-cookie|connection|content-.*|transfer-encoding|te|upgrade|proxy-.*|x-forwarded-.*|forwarded|origin|referer|user-agent|accept.*)$/;

/** A header name Other may use: lower-case letters, digits and -, not one the server refuses. */
export function safeHeaderName(value: string): boolean {
    return /^[a-z][a-z0-9-]{0,39}$/.test(value) && !FORBIDDEN_HEADERS.test(value);
}

/** A stored header as the form keeps it: lower case, and '' for Authorization (Bearer). */
function formHeader(value: unknown): string {
    const h = str(value).trim().toLowerCase();
    return h === 'authorization' ? '' : h;
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
    /** The admin's off switch for the purpose's cache (AM-D16): false is off; null: the purpose's. */
    cache: boolean | null;
    /** The admin's days before files in `ai-files/` are deleted; null: the purpose's. */
    deleteAfterDays: number | null;
    /** A speech purpose: the admin's voice ids by voice name and preset, over the app's (AM-D17). */
    voices: Record<string, Record<string, string>>;
    /** A presenter purpose: the admin's avatar ids by avatar name and preset (AM-D33). */
    avatars: Record<string, Record<string, string>>;
}

export function blankPurpose(): AiPurposeForm {
    return { enabled: true, models: [], perKeyPerDay: null, keepContent: false, cache: null, deleteAfterDays: null, voices: {}, avatars: {} };
}

/** The presets a voice map may name: those that make speech (AM-D17). */
export const SPEECH_PRESETS = ['elevenlabs', 'sarvam', 'minimax', 'vertex'] as const;
const VOICE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
/** A provider's voice id, as the server takes it. */
export const VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:@()-]{0,119}$/;

/** The presets an avatar map may name: those that make presenter videos (AM-D33). */
export const AVATAR_PRESETS = ['heygen'] as const;

function voiceMapsFrom(v: unknown, presets: readonly string[] = SPEECH_PRESETS): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [name, raw] of Object.entries(obj(v))) {
        if (!VOICE_NAME.test(name)) continue;
        const map = Object.fromEntries(Object.entries(obj(raw)).filter(([p, id]) => presets.includes(p) && typeof id === 'string' && VOICE_ID.test(id))) as Record<string, string>;
        if (Object.keys(map).length) out[name] = map;
    }
    return out;
}

/**
 * The admin's voices as save writes them: merged, so a voice or provider taken away since
 * `before` is deleted rather than left behind.
 */
function voiceMapsData(after: Record<string, Record<string, string>>, before: Record<string, Record<string, string>> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, map] of Object.entries(after)) out[name] = { ...map };
    for (const [name, map] of Object.entries(before ?? {})) {
        if (!after[name]) out[name] = deleteField();
        else for (const preset of Object.keys(map)) if (!(preset in after[name])) (out[name] as Record<string, unknown>)[preset] = deleteField();
    }
    return out;
}

export type AiPriceField = 'priceIn' | 'priceOut' | 'priceCachedIn' | 'priceCacheWrite' | 'price';
export const AI_PRICE_FIELDS: readonly AiPriceField[] = ['priceIn', 'priceOut', 'priceCachedIn', 'priceCacheWrite', 'price'];

export interface AiModelForm {
    makes?: AiModelKind;
    unit?: AiUnit;
    reads?: AiReads[];
    schema?: 'strict' | 'json';
    priceIn?: number;
    priceOut?: number;
    /** Per million tokens read from, and written to, the provider's cache (AM-D31). */
    priceCachedIn?: number;
    priceCacheWrite?: number;
    /** For a unit other than tokens: per picture, per 1,000 characters, or per second. */
    price?: number;
}

export interface AiSettingsForm {
    mode: 'test' | 'live';
    connections: AiConnectionForm[];
    tiers: Record<AiTier, AiModelRef[]>;
    /** The default models of each file kind, in order (AM-D4). */
    lists: Record<AiFileKind, AiModelRef[]>;
    purposes: Record<string, AiPurposeForm>;
    /** By `{connection}/{model}`. */
    models: Record<string, AiModelForm>;
    monthlyUsd: number;
}

export const DEFAULT_MONTHLY_USD = 20;

/** What a provider test answers. `costFrom` 'none': no price is known, so the cost was not counted. */
export interface AiTestResult {
    ok: boolean;
    ms: number;
    reply?: string;
    failure?: string;
    detail?: string;
    costUsd?: number;
    costFrom?: 'provider' | 'price-list' | 'none';
}

export function emptyAiForm(): AiSettingsForm {
    return { mode: 'test', connections: [], tiers: { cheap: [], fast: [], thorough: [] }, lists: { image: [], speech: [], audio: [], video: [] }, purposes: {}, models: {}, monthlyUsd: DEFAULT_MONTHLY_USD };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const wholeOrNull = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null);
const numberOrNull = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
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
            header: formHeader(c['header']),
            perMinute: wholeOrNull(c['perMinute'], 0, 100_000), atOnce: wholeOrNull(c['atOnce'], 0, 1000),
            usdRate: numberOrNull(c['usdRate'], 0, 1000),
            balance: numberOrNull(c['balance'], -1e12, 1e12), balanceUnit: strOrNull(c['balanceUnit']), balanceAt: strOrNull(c['balanceAt']),
            lowBalance: numberOrNull(c['lowBalance'], 0, 1e12),
        };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const tiers = obj(d['tiers']);
    for (const t of AI_TIERS) form.tiers[t] = refs(tiers[t]);
    const lists = obj(d['lists']);
    for (const k of AI_FILE_KINDS) form.lists[k] = refs(lists[k]);
    for (const [id, raw] of Object.entries(obj(d['purposes']))) {
        const p = obj(raw);
        form.purposes[id] = {
            enabled: p['enabled'] !== false,
            models: refs(p['models']),
            perKeyPerDay: Number.isInteger(p['perKeyPerDay']) && (p['perKeyPerDay'] as number) >= 1 ? (p['perKeyPerDay'] as number) : null,
            keepContent: p['keepContent'] === true,
            cache: typeof p['cache'] === 'boolean' ? p['cache'] : null,
            deleteAfterDays: wholeOrNull(p['deleteAfterDays'], 1, 3650),
            voices: voiceMapsFrom(p['voices']),
            avatars: voiceMapsFrom(p['avatars'], AVATAR_PRESETS),
        };
    }
    for (const [key, raw] of Object.entries(obj(d['models']))) {
        const m = obj(raw);
        form.models[key] = {
            ...((AI_MODEL_KINDS as readonly unknown[]).includes(m['makes']) ? { makes: m['makes'] as AiModelKind } : {}),
            ...((AI_UNITS as readonly unknown[]).includes(m['unit']) ? { unit: m['unit'] as AiUnit } : {}),
            ...(Array.isArray(m['reads']) ? { reads: (m['reads'] as unknown[]).filter((r): r is AiReads => r === 'pictures' || r === 'pdfs') } : {}),
            ...(m['schema'] === 'strict' || m['schema'] === 'json' ? { schema: m['schema'] } : {}),
            ...(typeof m['priceIn'] === 'number' ? { priceIn: m['priceIn'] } : {}),
            ...(typeof m['priceOut'] === 'number' ? { priceOut: m['priceOut'] } : {}),
            ...(typeof m['priceCachedIn'] === 'number' ? { priceCachedIn: m['priceCachedIn'] } : {}),
            ...(typeof m['priceCacheWrite'] === 'number' ? { priceCacheWrite: m['priceCacheWrite'] } : {}),
            ...(typeof m['price'] === 'number' ? { price: m['price'] } : {}),
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
        connections[c.id] = connectionFields(c);
        // A new address, workspace or key header means the key no longer goes out (AI-D8, AM-D8): the card says Key needed.
        const before = loaded.connections.find((l) => l.id === c.id);
        if (before && addressChanged(before, c)) {
            Object.assign(connections[c.id] as Record<string, unknown>, { keyPreview: deleteField(), keySetAt: deleteField(), keySetBy: deleteField(), lastOkAt: deleteField() });
        }
        // New here: nothing the server noted about an older connection of the same id carries over.
        if (!loaded.connections.some((l) => l.id === c.id)) {
            Object.assign(connections[c.id] as Record<string, unknown>, { keyPreview: deleteField(), keySetAt: deleteField(), keySetBy: deleteField(), lastOkAt: deleteField(), lastError: deleteField(), lastErrorAt: deleteField() });
        }
    }
    for (const c of loaded.connections) if (!form.connections.some((f) => f.id === c.id)) connections[c.id] = deleteField();
    const purposes: Record<string, unknown> = {};
    for (const [id, p] of Object.entries(form.purposes)) {
        purposes[id] = {
            enabled: p.enabled, models: p.models, perKeyPerDay: p.perKeyPerDay ?? deleteField(), keepContent: p.keepContent,
            cache: p.cache ?? deleteField(), deleteAfterDays: p.deleteAfterDays ?? deleteField(),
            voices: voiceMapsData(p.voices ?? {}, loaded.purposes[id]?.voices),
            avatars: voiceMapsData(p.avatars ?? {}, loaded.purposes[id]?.avatars),
        };
    }
    const models: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(form.models)) {
        models[key] = {
            makes: m.makes ?? deleteField(), unit: m.unit ?? deleteField(),
            reads: m.reads ?? deleteField(), schema: m.schema ?? deleteField(),
            ...Object.fromEntries(AI_PRICE_FIELDS.map((f) => [f, m[f] ?? deleteField()])),
        };
    }
    for (const key of Object.keys(loaded.models)) if (!(key in form.models)) models[key] = deleteField();
    return { mode: form.mode, connections, tiers: form.tiers, lists: form.lists, purposes, models, budget: { monthlyUsd: form.monthlyUsd } };
}

/**
 * What removing a provider writes, and nothing else: the provider gone, the tiers, file lists
 * and purpose lists without its models, its model details deleted.
 */
export function removalData(id: string, after: Pick<AiSettingsForm, 'tiers' | 'purposes'> & Partial<Pick<AiSettingsForm, 'lists'>>, before: AiSettingsForm): Record<string, unknown> {
    const purposes: Record<string, unknown> = {};
    for (const [pid, p] of Object.entries(after.purposes)) {
        if (JSON.stringify(p.models) !== JSON.stringify(before.purposes[pid]?.models ?? [])) purposes[pid] = { models: p.models };
    }
    const models = Object.fromEntries(Object.keys(before.models).filter((k) => k.startsWith(`${id}/`)).map((k) => [k, deleteField()]));
    const lists = after.lists && JSON.stringify(after.lists) !== JSON.stringify(before.lists) ? { lists: after.lists } : {};
    return { connections: { [id]: deleteField() }, tiers: after.tiers, ...lists, ...(Object.keys(purposes).length ? { purposes } : {}), ...(Object.keys(models).length ? { models } : {}) };
}

/**
 * Whether what a connection's key was set for changed: its address, or for Other the header
 * it goes in (AM-D8). The key, set for the old one, is then no longer sent.
 */
export function addressChanged(before: AiConnectionForm, after: AiConnectionForm): boolean {
    return before.workspace.trim() !== after.workspace.trim() || before.baseUrl.trim() !== after.baseUrl.trim()
        || formHeader(before.header ?? '') !== formHeader(after.header ?? '');
}

/** One connection's own fields, as save writes them. The header is Other's only. */
function connectionFields(c: AiConnectionForm): Record<string, unknown> {
    const header = c.preset === 'other' ? formHeader(c.header ?? '') : '';
    return {
        preset: c.preset, label: c.label.trim(), workspace: c.workspace.trim(), baseUrl: c.baseUrl.trim(), location: c.location.trim(), processesIn: c.processesIn.trim(),
        header: header || deleteField(),
        perMinute: c.perMinute ?? deleteField(), atOnce: c.atOnce ?? deleteField(), usdRate: c.usdRate ?? deleteField(), lowBalance: c.lowBalance ?? deleteField(),
    };
}

/** What saving one new connection writes: its fields, and nothing an older one of the same id left behind. */
export function connectionData(c: AiConnectionForm): Record<string, unknown> {
    return {
        connections: {
            [c.id]: { ...connectionFields(c), keyPreview: deleteField(), keySetAt: deleteField(), keySetBy: deleteField(), lastOkAt: deleteField(), lastError: deleteField(), lastErrorAt: deleteField() },
        },
    };
}

/**
 * Each tier's models as a provider recommends them, in its order: what "Use recommended
 * models" puts in the tiers. Empty when Arc knows no models of the provider.
 */
export function recommendedTiers(connectionId: string, preset: AiPresetInfo): Record<AiTier, AiModelRef[]> {
    return Object.fromEntries(AI_TIERS.map((t) => [t, preset.models.filter((m) => m.recommend?.includes(t)).map((m) => ({ connection: connectionId, model: m.model }))])) as Record<AiTier, AiModelRef[]>;
}

/** Each file kind's models as a provider recommends them: what "Use recommended models" puts in the file lists. */
export function recommendedLists(connectionId: string, preset: AiPresetInfo): Record<AiFileKind, AiModelRef[]> {
    return Object.fromEntries(AI_FILE_KINDS.map((k) => [k, preset.models.filter((m) => m.makes === k && m.recommend?.includes('default')).map((m) => ({ connection: connectionId, model: m.model }))])) as Record<AiFileKind, AiModelRef[]>;
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
    /** Answered from Arc's own cache (AM-D16): kept apart, never in `calls`. */
    cacheHits: number;
    /** Input tokens read from, and written to, the provider's cache (AM-D31). */
    tokensCached: number;
    tokensCacheWrite: number;
    /** What file kinds billed, in each unit (AM-D27). */
    pictures: number;
    characters: number;
    seconds: number;
}

export interface AiMonthUsage extends AiTotals {
    month: string;
    testCalls: number;
    byPurpose: Array<{ id: string } & AiTotals>;
    byKind: Array<{ kind: string } & AiTotals>;
    byModel: Array<{ connection: string; model: string } & AiTotals>;
    byDay: Array<{ day: string } & AiTotals>;
    keys: Array<{ purpose: string; limitKey: string; units: number } & AiTotals>;
}

function totals(raw: unknown): AiTotals {
    const t = obj(raw);
    const n = (k: string) => (typeof t[k] === 'number' ? (t[k] as number) : 0);
    return {
        calls: n('calls'), failed: n('failed'), tokensIn: n('tokensIn'), tokensOut: n('tokensOut'), tokensThinking: n('tokensThinking'), costUsd: n('costUsd'),
        cacheHits: n('cacheHits'), tokensCached: n('tokensCached'), tokensCacheWrite: n('tokensCacheWrite'), pictures: n('pictures'), characters: n('characters'), seconds: n('seconds'),
    };
}

export function monthUsageFrom(month: string, data: Record<string, unknown> | undefined, keys: Array<Record<string, unknown>>): AiMonthUsage {
    const d = data ?? {};
    const byCost = <T extends AiTotals>(a: T, b: T) => b.costUsd - a.costUsd || b.calls - a.calls;
    return {
        month,
        ...totals(d),
        testCalls: typeof d['testCalls'] === 'number' ? (d['testCalls'] as number) : 0,
        byPurpose: Object.entries(obj(d['byPurpose'])).map(([id, t]) => ({ id, ...totals(t) })).sort(byCost),
        byKind: Object.entries(obj(d['byKind'])).map(([kind, t]) => ({ kind, ...totals(t) })).sort(byCost),
        byModel: Object.values(obj(d['byModel'])).map((t) => ({ connection: str(obj(t)['connection']), model: str(obj(t)['model']), ...totals(t) })).sort(byCost),
        byDay: Object.entries(obj(d['byDay'])).map(([day, t]) => ({ day, ...totals(t) })).sort((a, b) => a.day.localeCompare(b.day)),
        keys: keys.map((k) => ({ purpose: str(k['purpose']), limitKey: str(k['limitKey']), units: typeof k['units'] === 'number' ? (k['units'] as number) : 0, ...totals(k) })),
    };
}

export interface AiCallRow {
    id: string;
    createdAt: Date | null;
    purpose: string;
    /** What the purpose makes; text for records written before kinds. */
    kind: string;
    test: boolean;
    outcome: string;
    scope?: string;
    detail?: string;
    connection: string | null;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    tokensCached: number;
    tokensCacheWrite: number;
    /** What was billed, in `unit`. */
    amount: number;
    unit: string;
    costUsd: number;
    costFrom: string;
    ms: number;
    ref: string | null;
    limitKey: string | null;
    units: number;
    input: { chars: number; files: number; bytes: number };
    attempts: Array<{ connection: string; model: string; outcome: string; ms: number; detail?: string }>;
    /** The purpose kept what was sent and answered; it is read when the call is opened. */
    hasContent: boolean;
    /** The files a file kind made (AM-D27), read through readAiFile when the call is opened. */
    files: AiCallFile[];
    /** Answered from Arc's own cache (AM-D16), with the record of the call that made the files. */
    cached: boolean;
    cachedFrom: string | null;
}

export interface AiCallFile {
    path: string;
    mimeType: string;
    bytes: number;
    width?: number;
    height?: number;
    seconds?: number;
}

export interface AiCallContent {
    instruction: string;
    parts: Array<{ kind: string; text?: string; mimeType?: string; size?: number; path?: string | null }>;
    answer: string | null;
}

/** The most records the CSV download reads. */
export const CSV_MAX_ROWS = 20_000;

export function callRowFrom(id: string, d: Record<string, unknown>): AiCallRow {
    const created = d['createdAt'] as { toDate?: () => Date } | undefined;
    const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
    const input = obj(d['input']);
    return {
        id,
        createdAt: created?.toDate ? created.toDate() : null,
        purpose: str(d['purpose']),
        kind: str(d['kind']) || 'text',
        test: d['test'] === true,
        outcome: str(d['outcome']),
        ...(d['scope'] ? { scope: str(d['scope']) } : {}),
        ...(d['detail'] ? { detail: str(d['detail']) } : {}),
        connection: strOrNull(d['connection']),
        model: strOrNull(d['model']),
        tokensIn: num('tokensIn'), tokensOut: num('tokensOut'), tokensThinking: num('tokensThinking'),
        tokensCached: num('tokensCached'), tokensCacheWrite: num('tokensCacheWrite'),
        amount: num('amount'), unit: str(d['unit']) || 'tokens',
        costUsd: num('costUsd'), costFrom: str(d['costFrom']), ms: num('ms'),
        ref: strOrNull(d['ref']), limitKey: strOrNull(d['limitKey']), units: num('units') || 1,
        input: { chars: Number(input['chars'] ?? 0), files: Number(input['files'] ?? 0), bytes: Number(input['bytes'] ?? 0) },
        attempts: Array.isArray(d['attempts']) ? (d['attempts'] as Array<Record<string, unknown>>).map((a) => ({ connection: str(a['connection']), model: str(a['model']), outcome: str(a['outcome']), ms: Number(a['ms'] ?? 0), ...(a['detail'] ? { detail: str(a['detail']) } : {}) })) : [],
        hasContent: d['hasContent'] === true,
        files: Array.isArray(d['files'])
            ? (d['files'] as unknown[]).map(obj).filter((f) => typeof f['path'] === 'string' && f['path']).map((f) => ({
                path: str(f['path']), mimeType: str(f['mimeType']), bytes: Number(f['bytes'] ?? 0),
                ...(typeof f['width'] === 'number' ? { width: f['width'] } : {}),
                ...(typeof f['height'] === 'number' ? { height: f['height'] } : {}),
                ...(typeof f['seconds'] === 'number' ? { seconds: f['seconds'] } : {}),
            }))
            : [],
        cached: d['cached'] === true,
        cachedFrom: strOrNull(d['cachedFrom']),
    };
}

export function callContentFrom(d: Record<string, unknown> | undefined): AiCallContent | null {
    if (!d) return null;
    return {
        instruction: str(d['instruction']),
        parts: Array.isArray(d['parts']) ? (d['parts'] as Array<Record<string, unknown>>).map((p) => ({ kind: str(p['kind']), text: typeof p['text'] === 'string' ? p['text'] : undefined, mimeType: typeof p['mimeType'] === 'string' ? p['mimeType'] : undefined, size: typeof p['size'] === 'number' ? p['size'] : undefined, path: typeof p['path'] === 'string' ? p['path'] : null })) : [],
        answer: typeof d['answer'] === 'string' ? d['answer'] : null,
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
    const head = ['time (UTC)', 'purpose', 'test', 'outcome', 'detail', 'connection', 'model', 'tokens in', 'tokens out', 'thinking tokens', 'cost USD', 'cost from', 'ms', 'key', 'units', 'ref', 'kind', 'amount', 'unit', 'cached', 'cached tokens'];
    const lines = rows.map((r) => [
        r.createdAt?.toISOString() ?? '', r.purpose, r.test ? 'yes' : 'no', r.outcome, r.detail ?? '', r.connection ?? '', r.model ?? '',
        r.tokensIn, r.tokensOut, r.tokensThinking, r.costUsd.toFixed(6), r.costFrom, r.ms, r.limitKey ?? '', r.units, r.ref ?? '',
        r.kind, r.amount, r.unit, r.cached ? 'yes' : 'no', r.tokensCached,
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

    /** Saves one new connection alone, so connecting it commits none of the page's other changes. */
    async saveConnection(c: AiConnectionForm): Promise<void> {
        await this.inCtx(() => setDoc(doc(this.firestore, 'Settings', 'ai'), { ...connectionData(c), updatedAt: serverTimestamp() }, { merge: true }));
    }

    /** Saves only these fields of Settings, AI: a button that changes one thing commits nothing else. */
    async savePart(data: Record<string, unknown>): Promise<void> {
        await this.inCtx(() => setDoc(doc(this.firestore, 'Settings', 'ai'), { ...data, updatedAt: serverTimestamp() }, { merge: true }));
    }

    async setKey(connection: string, key: string): Promise<{ keyPreview: string; keySetAt: string; keySetBy: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'setAiKey')({ connection, key }));
        return result.data as { keyPreview: string; keySetAt: string; keySetBy: string };
    }

    async removeKey(connection: string): Promise<void> {
        await this.inCtx(() => arcCallable(this.functions, 'removeAiKey')({ connection }));
    }

    /** Reads a connection's balance now, with its own key (AM-D32). */
    async refreshBalance(connection: string): Promise<{ ok: true; balance: number | null; unit: string } | { ok: false; detail: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'refreshAiBalance', { timeout: 40_000 })({ connection }));
        return result.data as { ok: true; balance: number | null; unit: string } | { ok: false; detail: string };
    }

    /** A speech connection's voices (AM-D18); `fresh` reads the provider again rather than the server's copy. */
    /** A presenter connection's avatars (AM-D33). */
    async avatars(connection: string, fresh = false): Promise<{ ok: true; avatars: AiAvatar[] } | { ok: false; detail: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'aiAvatars', { timeout: 70_000 })({ connection, fresh }));
        return result.data as { ok: true; avatars: AiAvatar[] } | { ok: false; detail: string };
    }

    async voices(connection: string, fresh = false): Promise<{ ok: true; voices: AiVoice[] } | { ok: false; detail: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'aiVoices', { timeout: 70_000 })({ connection, fresh }));
        return result.data as { ok: true; voices: AiVoice[] } | { ok: false; detail: string };
    }

    /** A sample of a voice with no sample file of its own, made as Arc's purpose arc-voice-sample. */
    async voiceSample(connection: string, model: string, voice: string, language?: string): Promise<{ ok: true; path: string; mimeType: string; cached: boolean; test: boolean; costUsd: number } | { ok: false; reason: string; detail: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'aiVoiceSample', { timeout: 100_000 })({ connection, model, voice, ...(language ? { language } : {}) }));
        return result.data as { ok: true; path: string; mimeType: string; cached: boolean; test: boolean; costUsd: number } | { ok: false; reason: string; detail: string };
    }

    async test(connection: string, model: string): Promise<AiTestResult> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'testAiConnection', { timeout: 70_000 })({ connection, model }));
        return result.data as AiTestResult;
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

    /** The records kept (the last 60 days), newest first, at most CSV_MAX_ROWS, for the CSV download. */
    async allCalls(): Promise<{ rows: AiCallRow[]; truncated: boolean }> {
        const since = Timestamp.fromDate(new Date(Date.now() - 61 * 24 * 3600 * 1000));
        const snap = await this.inCtx(() => getDocs(query(collection(this.firestore, 'AiCalls'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(CSV_MAX_ROWS))));
        return { rows: snap.docs.map((d) => callRowFrom(d.id, d.data())), truncated: snap.size >= CSV_MAX_ROWS };
    }

    /** What a call sent and was answered, when its purpose kept it. */
    async callContent(id: string): Promise<AiCallContent | null> {
        const snap = await this.inCtx(() => getDoc(doc(this.firestore, 'AiCalls', id, 'content', 'main')));
        return callContentFrom(snap.data());
    }

    /**
     * A kept file as a link that lives only in this page (an object URL), not a lasting
     * download link anyone holding it could open (storage.rules lets admins read it).
     */
    async fileUrl(path: string): Promise<string> {
        const storage = await this.arcStorage.get();
        const blob = await this.inCtx(() => getBlob(ref(storage, path)));
        return URL.createObjectURL(blob);
    }

    /**
     * A file a model made, read through the admin-only readAiFile (so the bucket's CORS setup
     * does not matter), as an object URL the caller revokes when it is closed. A file moved or
     * deleted throws the callable's not-found.
     */
    async aiFileUrl(path: string): Promise<{ url: string; contentType: string }> {
        const result = await this.inCtx(() => arcCallable(this.functions, 'readAiFile', { timeout: 70_000 })({ path }));
        const { data, contentType } = result.data as { data: string; contentType: string; bytes: number };
        return { url: URL.createObjectURL(base64Blob(data, contentType)), contentType };
    }
}

/** Base64 from a callable as a Blob of its type. */
export function base64Blob(data: string, contentType: string): Blob {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: contentType || 'application/octet-stream' });
}
