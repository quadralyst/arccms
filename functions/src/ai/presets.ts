/**
 * The providers Settings, AI offers (specs/ai-spec.md, AI-D6, AI-D7, AI-D13;
 * specs/ai-media-spec.md, AM-D3, AM-D5, AM-D7, AM-D8, AM-D34): where each one's address is,
 * how its key is sent, where it processes data, and the models Arc knows with what they
 * make, read and cost. An admin can use any other model of a provider and say the same.
 *
 * Token prices are per million tokens, in the preset's currency (USD unless it says), from
 * the provider's price page on its `pricesCheckedOn`. Where a provider's pages disagree, or a
 * price changes on a date, the higher one ships, so the budget never counts too little. A
 * model with no price costs 0 until the admin sets one.
 *
 * A preset with `testedLive: false` was written from its provider's docs as read on
 * `docsReadOn` and has never answered a real call; the first project that uses it tests it
 * and sets the flag (AM-D34).
 */
import type { AiKind, AiUnit } from './types.js';

export type AiConnectorKind = 'openai' | 'vertex' | 'anthropic' | 'gemini';
export type AiSchemaSupport = 'strict' | 'json';
export type AiReads = 'pictures' | 'pdfs';
export type AiCurrency = 'USD' | 'INR';
/** How Arc reads a connection's balance with its own key (AM-D32). */
export type AiBalanceReader = 'deepseek' | 'openrouter-key';

/** The higher price a model charges for a prompt above `tokens` (AM-D31). */
export interface AiPriceAbove {
    tokens: number;
    priceIn: number;
    priceOut: number;
    priceCachedIn?: number;
    priceCacheWrite?: number;
}

export interface AiKnownModel {
    /** What it makes. Default: text (which covers data). */
    makes?: AiKind;
    /** What it bills by. Default: tokens. */
    unit?: AiUnit;
    reads: AiReads[];
    /** strict: the provider holds the answer to the schema; json: it promises JSON only, so the schema goes in the instruction. */
    schema: AiSchemaSupport;
    /** Per million tokens. */
    priceIn?: number;
    priceOut?: number;
    /** Per million input tokens read from the provider's cache. Missing: the input price. */
    priceCachedIn?: number;
    /** Per million input tokens written to the provider's cache. Missing: the input price. */
    priceCacheWrite?: number;
    priceAbove?: AiPriceAbove;
    /** For a unit other than tokens: per picture, per 1,000 characters, or per second. */
    price?: number;
    /** The tiers Arc suggests this model for, in Settings, AI's "Use recommended models". */
    recommend?: Array<'cheap' | 'fast' | 'thorough'>;
}

/** How a key goes in a request (AM-D8): `Authorization: Bearer <key>` unless the preset says. */
export interface AiKeyHeader {
    header: string;
    prefix: string;
}

export const BEARER: AiKeyHeader = { header: 'authorization', prefix: 'Bearer ' };

export interface AiPreset {
    label: string;
    kind: AiConnectorKind;
    /** The provider's address; `{workspace}` is filled from the connection's workspace. */
    baseUrl?: string;
    /** How the key is sent. Default: BEARER. */
    auth?: AiKeyHeader;
    /** Where the provider processes what is sent, as the admin page shows it. */
    processesIn: string;
    /** The provider reports each call's cost, used instead of the price list. */
    reportsCost?: boolean;
    /** The currency of its prices. Default USD; another needs the admin's USD rate (AM-D5). */
    currency?: AiCurrency;
    /** The day its prices were read from the provider's page. */
    pricesCheckedOn: string;
    /** false: built from the docs, never called for real (AM-D34). Left out: tested. */
    testedLive?: boolean;
    /** The day its docs were read, for a preset not tested live. */
    docsReadOn?: string;
    /** The most requests a minute and at once on the provider's entry plan (AM-D15). */
    perMinute?: number;
    atOnce?: number;
    /** How its own key reads the balance, when it can (AM-D32). */
    balance?: AiBalanceReader;
    /** Where the admin sees the account's balance and bills. */
    billingUrl?: string;
    models: Record<string, AiKnownModel>;
}

/** The day F38's presets were checked; each preset now carries its own. */
export const PRICES_CHECKED_ON = '2026-10-28';
const DOCS_READ_ON = '2026-11-02';

export const AI_PRESETS: Record<string, AiPreset> = {
    'alibaba-eu': {
        label: 'Alibaba Cloud Model Studio, Frankfurt (EU)',
        kind: 'openai',
        baseUrl: 'https://{workspace}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
        processesIn: 'Germany (Frankfurt), Alibaba Cloud\'s EU deployment',
        pricesCheckedOn: PRICES_CHECKED_ON,
        billingUrl: 'https://modelstudio.console.alibabacloud.com/',
        models: {
            'qwen3-vl-plus': { reads: ['pictures'], schema: 'json', priceIn: 0.2, priceOut: 1.6, recommend: ['cheap', 'fast', 'thorough'] },
        },
    },
    openrouter: {
        label: 'OpenRouter',
        kind: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        processesIn: 'Wherever OpenRouter sends the model: its host\'s country',
        reportsCost: true,
        pricesCheckedOn: PRICES_CHECKED_ON,
        balance: 'openrouter-key',
        billingUrl: 'https://openrouter.ai/settings/credits',
        // OpenRouter reports each call's cost, so these need no price. Checked on OpenRouter's
        // model list on PRICES_CHECKED_ON: all three read pictures; the Qwen 3.7 Flash host
        // promises JSON but not a schema.
        models: {
            'qwen/qwen3.8-flash': { reads: ['pictures'], schema: 'strict', recommend: ['fast', 'thorough'] },
            'qwen/qwen3-vl-30b-a3b-instruct': { reads: ['pictures'], schema: 'strict', recommend: ['thorough'] },
            'qwen/qwen3.7-flash': { reads: ['pictures'], schema: 'json', recommend: ['cheap'] },
        },
    },
    huggingface: {
        label: 'Hugging Face',
        kind: 'openai',
        baseUrl: 'https://router.huggingface.co/v1',
        processesIn: 'Wherever Hugging Face sends the model: its host\'s country',
        pricesCheckedOn: PRICES_CHECKED_ON,
        billingUrl: 'https://huggingface.co/settings/billing',
        models: {},
    },
    openai: {
        label: 'OpenAI',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        processesIn: 'OpenAI\'s worldwide data centres',
        pricesCheckedOn: PRICES_CHECKED_ON,
        billingUrl: 'https://platform.openai.com/settings/organization/billing',
        models: {},
    },
    'openai-eu': {
        label: 'OpenAI, EU project',
        kind: 'openai',
        baseUrl: 'https://eu.api.openai.com/v1',
        processesIn: 'The EU, for a key of an OpenAI project created in its EU region',
        pricesCheckedOn: PRICES_CHECKED_ON,
        billingUrl: 'https://platform.openai.com/settings/organization/billing',
        models: {},
    },
    deepseek: {
        label: 'DeepSeek',
        kind: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        processesIn: 'China (DeepSeek\'s own servers)',
        pricesCheckedOn: PRICES_CHECKED_ON,
        balance: 'deepseek',
        billingUrl: 'https://platform.deepseek.com/usage',
        models: {},
    },
    other: {
        label: 'Other OpenAI-style address',
        kind: 'openai',
        processesIn: 'As the provider says',
        pricesCheckedOn: PRICES_CHECKED_ON,
        models: {},
    },
    vertex: {
        label: 'Google Cloud (Vertex AI)',
        kind: 'vertex',
        processesIn: 'The location chosen for it',
        pricesCheckedOn: PRICES_CHECKED_ON,
        billingUrl: 'https://console.cloud.google.com/billing',
        models: {
            'gemini-3.8-flash': { reads: ['pictures', 'pdfs'], schema: 'strict', recommend: ['fast', 'thorough'] },
            'gemini-3.5-flash-lite': { reads: ['pictures', 'pdfs'], schema: 'strict', recommend: ['cheap'] },
            'gemini-4-argon': { reads: ['pictures', 'pdfs'], schema: 'strict' },
        },
    },
    // AM1 (specs/ai-media-spec.md, section 6.1): written from each provider's docs, not tested live.
    anthropic: {
        label: 'Anthropic (Claude)',
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        auth: { header: 'x-api-key', prefix: '' },
        processesIn: 'Anthropic\'s worldwide data centres',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        billingUrl: 'https://console.anthropic.com/settings/billing',
        models: {
            // Reads from cache: Anthropic's page says 0.10 for Sonnet 5.5, its model guide 0.20; the higher ships.
            'claude-haiku-5-5': { reads: ['pictures', 'pdfs'], schema: 'strict', priceIn: 0.1, priceOut: 0.5, priceCachedIn: 0.01, priceCacheWrite: 0.125, priceAbove: { tokens: 100_000, priceIn: 0.5, priceOut: 2.5, priceCachedIn: 0.05, priceCacheWrite: 0.625 }, recommend: ['cheap'] },
            'claude-sonnet-5-5': { reads: ['pictures', 'pdfs'], schema: 'strict', priceIn: 2, priceOut: 10, priceCachedIn: 0.2, priceCacheWrite: 2.5, recommend: ['fast'] },
            'claude-opus-5-5': { reads: ['pictures', 'pdfs'], schema: 'strict', priceIn: 4, priceOut: 20, priceCachedIn: 0.2, priceCacheWrite: 5, recommend: ['thorough'] },
        },
    },
    'gemini-api': {
        label: 'Google Gemini API (key)',
        kind: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        auth: { header: 'x-goog-api-key', prefix: '' },
        processesIn: 'Google\'s worldwide data centres (no regional choice on this API)',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        billingUrl: 'https://aistudio.google.com/usage',
        // The prices Google gives from 2026-12-01 (Argon) and 2027-01-01 (3.8 Flash): the higher ones ship.
        models: {
            'gemini-3.5-flash-lite': { reads: ['pictures', 'pdfs'], schema: 'strict', priceIn: 0.3, priceOut: 2.5, priceCachedIn: 0.03, recommend: ['cheap'] },
            'gemini-3.8-flash': { reads: ['pictures', 'pdfs'], schema: 'strict', priceIn: 1.5, priceOut: 7.5, priceCachedIn: 0.15, recommend: ['fast'] },
            'gemini-4-argon': { reads: ['pictures', 'pdfs'], schema: 'strict', priceIn: 4, priceOut: 20, priceCachedIn: 0.2, recommend: ['thorough'] },
        },
    },
    mistral: {
        label: 'Mistral',
        kind: 'openai',
        baseUrl: 'https://api.mistral.ai/v1',
        processesIn: 'Mistral\'s data centres, with no location promised',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        billingUrl: 'https://console.mistral.ai/billing',
        models: {
            'ministral-8b-2512': { reads: ['pictures'], schema: 'strict', priceIn: 0.15, priceOut: 0.15, priceCachedIn: 0.015, recommend: ['cheap'] },
            'mistral-small-2603': { reads: ['pictures'], schema: 'strict', priceIn: 0.15, priceOut: 0.6, priceCachedIn: 0.015, recommend: ['fast'] },
        },
    },
    'mistral-eu': {
        label: 'Mistral, EU',
        kind: 'openai',
        baseUrl: 'https://api.eu.mistral.ai/v1',
        processesIn: 'Mistral\'s EU and EFTA data centres',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        billingUrl: 'https://console.mistral.ai/billing',
        // 1.1 times the global prices.
        models: {
            'ministral-8b-2512': { reads: ['pictures'], schema: 'strict', priceIn: 0.165, priceOut: 0.165, priceCachedIn: 0.0165, recommend: ['cheap'] },
            'mistral-small-2603': { reads: ['pictures'], schema: 'strict', priceIn: 0.165, priceOut: 0.66, priceCachedIn: 0.0165, recommend: ['fast'] },
        },
    },
    groq: {
        label: 'Groq',
        kind: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        processesIn: 'Groq\'s data centres, with no location promised',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        billingUrl: 'https://console.groq.com/settings/billing',
        models: {
            'openai/gpt-oss-20b': { reads: [], schema: 'json', priceIn: 0.075, priceOut: 0.3, priceCachedIn: 0.0375, recommend: ['cheap'] },
            'openai/gpt-oss-120b': { reads: [], schema: 'json', priceIn: 0.15, priceOut: 0.6, priceCachedIn: 0.075, recommend: ['fast'] },
        },
    },
    xai: {
        label: 'xAI (Grok)',
        kind: 'openai',
        baseUrl: 'https://api.x.ai/v1',
        processesIn: 'xAI\'s data centres, which may route between regions',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        billingUrl: 'https://console.x.ai/',
        // From 200K prompt tokens xAI charges double.
        models: {
            'grok-4.3': { reads: ['pictures'], schema: 'strict', priceIn: 1.25, priceOut: 2.5, priceCachedIn: 0.2, priceAbove: { tokens: 200_000, priceIn: 2.5, priceOut: 5, priceCachedIn: 0.4 }, recommend: ['cheap', 'fast'] },
            'grok-4.7': { reads: ['pictures'], schema: 'strict', priceIn: 2, priceOut: 6, priceCachedIn: 0.5, priceAbove: { tokens: 200_000, priceIn: 4, priceOut: 12, priceCachedIn: 1 }, recommend: ['thorough'] },
        },
    },
    sarvam: {
        label: 'Sarvam AI',
        kind: 'openai',
        baseUrl: 'https://api.sarvam.ai/v1',
        auth: { header: 'api-subscription-key', prefix: '' },
        processesIn: 'India (Sarvam\'s own servers)',
        currency: 'INR',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        // Per account, across its keys, on pay as you go.
        perMinute: 60,
        billingUrl: 'https://dashboard.sarvam.ai/',
        models: {
            'sarvam-105b': { reads: [], schema: 'json', priceIn: 15, priceOut: 60, priceCachedIn: 5, recommend: ['cheap', 'fast', 'thorough'] },
        },
    },
};

/** Whether a preset's connections need a key: every kind but Vertex, which uses the functions' own account. */
export function presetNeedsKey(preset: AiPreset): boolean {
    return preset.kind !== 'vertex';
}

export function findPreset(id: unknown): AiPreset | undefined {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(AI_PRESETS, id) ? AI_PRESETS[id] : undefined;
}
