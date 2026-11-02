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
import type { AiAspect, AiFileKind, AiKind, AiUnit } from './types.js';

/** How Arc talks to a provider for text; `elevenlabs` and `minimax` make files only, so far. */
export type AiConnectorKind = 'openai' | 'vertex' | 'anthropic' | 'gemini' | 'elevenlabs' | 'minimax';
/** How Arc asks a provider for files (AM-D7). */
export type AiFileConnectorKind = 'elevenlabs' | 'sarvam' | 'minimax' | 'vertex' | 'openai' | 'gemini' | 'dashscope';
export type AiSchemaSupport = 'strict' | 'json';
export type AiReads = 'pictures' | 'pdfs';
export type AiCurrency = 'USD' | 'INR';
/** How Arc reads a connection's balance with its own key (AM-D32). */
export type AiBalanceReader = 'deepseek' | 'openrouter-key' | 'elevenlabs';

/** What a speech model takes (AM-D19, section 8 item 1): its caps, formats and languages. */
export interface AiSpeechAbilities {
    /** The most characters a request; a longer text skips the model. */
    maxChars?: number;
    /** The most bytes of UTF-8 a request (Google counts bytes, not characters). */
    maxBytes?: number;
    formats: Array<'mp3' | 'wav' | 'opus'>;
    /** BCP 47 tags; left out: the provider takes many, and Arc does not check. */
    languages?: string[];
    /** Speaks only voices whose id holds this type, such as `Chirp3-HD` in `en-US-Chirp3-HD-Kore` (Google prices by type). */
    voiceType?: string;
}

export type AiQuality = 'low' | 'medium' | 'high';
export type AiResolution = 'standard' | 'high';

/**
 * What a picture model makes and takes (AM-D19, section 4.2). A setting it lacks is hidden
 * in the Media Manager; a call that needs one (a seed, an edit) skips the model (AM-D4).
 */
export interface AiImageAbilities {
    /** The shapes it makes; another shape is made at the nearest of these. */
    aspects: AiAspect[];
    /** `high` (about 4 MP) only where the model makes it; else `standard` is used. */
    resolutions: AiResolution[];
    /** Left out: it takes no quality, and the control is hidden. */
    qualities?: AiQuality[];
    /** The most pictures one call makes; Arc asks for at most 4. */
    maxCount: number;
    seed?: boolean;
    negativePrompt?: boolean;
    /** Changes a picture sent with the prompt (AM-D26). Such a model also reads pictures. */
    edit?: boolean;
    /** The file types it makes, the first its default. */
    formats: Array<'png' | 'jpeg' | 'webp'>;
    /** USD (or the preset's currency) per picture by quality, where the price changes with it. */
    priceByQuality?: Partial<Record<AiQuality, number>>;
    /** Per picture by resolution, where the price changes with it. */
    priceByResolution?: Partial<Record<AiResolution, number>>;
    /**
     * A model priced only at its standard size whose price grows with the pixels: `high` costs
     * this many times as much (about 4 MP over 1 MP), so the budget never counts too little.
     */
    highFactor?: number;
    /**
     * A model billed by tokens: about how many output tokens one picture takes, by quality, so
     * the estimate before a call can say "about" (AM-D6).
     */
    tokensPerPicture?: Partial<Record<AiQuality, number>>;
}

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
    /** Speech: what the model takes. */
    speech?: AiSpeechAbilities;
    /** Pictures: what the model makes and takes. */
    image?: AiImageAbilities;
    /** false: this model was built from the docs and never called for real, on a preset that was (AM-D34). */
    testedLive?: boolean;
    /**
     * The tiers Arc suggests this model for, in Settings, AI's "Use recommended models";
     * `default` puts a model that makes files in its kind's list.
     */
    recommend?: Array<'cheap' | 'fast' | 'thorough' | 'default'>;
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
    /** The connector that makes its files, when it makes any (AM-D7). */
    files?: AiFileConnectorKind;
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
    /** Limits a provider sets apart for one kind, such as MiniMax's 10 pictures a minute (AM-D15). */
    kindLimits?: Partial<Record<AiFileKind, { perMinute?: number; atOnce?: number }>>;
    /**
     * The hosts its answers may name for a file to fetch (AM-D28), each a name or a `.suffix`.
     * The key is never sent there.
     */
    downloadHosts?: string[];
    /** How its own key reads the balance, when it can (AM-D32). */
    balance?: AiBalanceReader;
    /** Where the admin sees the account's balance and bills. */
    billingUrl?: string;
    models: Record<string, AiKnownModel>;
}

/** What every speech model is: it makes speech and bills by the characters sent (AM-D5). */
const SPEECH: Pick<AiKnownModel, 'makes' | 'unit' | 'reads' | 'schema'> = { makes: 'speech', unit: 'characters', reads: [], schema: 'json' };
/** Google Cloud Text-to-Speech: 5,000 bytes a request, not characters (about 1,600 of Devanagari). */
function googleTts(voiceType: string, price: number): AiKnownModel {
    return { ...SPEECH, speech: { maxBytes: 5000, formats: ['mp3', 'wav', 'opus'], voiceType }, price, testedLive: false };
}
/** What every picture model is: it makes pictures, and a model that edits reads one. */
function picture(image: AiImageAbilities, extra: Partial<AiKnownModel> = {}): AiKnownModel {
    return { makes: 'image', unit: 'pictures', reads: image.edit ? ['pictures'] : [], schema: 'json', image, ...extra };
}
/** OpenAI's gpt-image models (AM3), all taking custom sizes (gpt-image-1-mini and 1.5 shut down on 2026-12-01, so Arc offers neither). */
const GPT_IMAGE_ASPECTS: AiAspect[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const OPENAI_IMAGE_MODELS: Record<string, AiKnownModel> = {
    // Per picture at 1024 square, the dearest standard size (its pages give less for 3:2 and 2:3); a high
    // picture, about 4 MP, is counted at four times that, since OpenAI prices its pictures by their tokens.
    'gpt-image-2': picture({ aspects: GPT_IMAGE_ASPECTS, resolutions: ['standard', 'high'], qualities: ['low', 'medium', 'high'], maxCount: 4, edit: true, formats: ['png', 'jpeg', 'webp'], priceByQuality: { low: 0.006, medium: 0.053, high: 0.211 }, highFactor: 4 }, { testedLive: false, recommend: ['default'] }),
    // Token prices only (picture tokens out $30 per million, picture tokens in $8, the higher of text and picture input).
    // The typical tokens a picture takes are OpenAI's published figures for a 1536 by 1024 picture, the larger.
    'gpt-image-2.5-flare': picture({ aspects: GPT_IMAGE_ASPECTS, resolutions: ['standard', 'high'], qualities: ['low', 'medium', 'high'], maxCount: 4, edit: true, formats: ['png', 'jpeg', 'webp'], tokensPerPicture: { low: 408, medium: 1584, high: 6240 } }, { unit: 'tokens', priceIn: 8, priceOut: 30, testedLive: false }),
    // OpenAI's own choice for edits.
    'gpt-image-2.5-sunburst': picture({ aspects: GPT_IMAGE_ASPECTS, resolutions: ['standard', 'high'], qualities: ['low', 'medium', 'high'], maxCount: 4, edit: true, formats: ['png', 'jpeg', 'webp'], tokensPerPicture: { low: 408, medium: 1584, high: 6240 } }, { unit: 'tokens', priceIn: 8, priceOut: 30, testedLive: false }),
};
/** Google's Gemini picture models (AM3), the same on the Gemini API and on Vertex: 1K standard, 2K high. */
const GEMINI_IMAGE_ASPECTS: AiAspect[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const GEMINI_IMAGE_MODELS: Record<string, AiKnownModel> = {
    'gemini-nano-banana-2.1': picture({ aspects: GEMINI_IMAGE_ASPECTS, resolutions: ['standard', 'high'], maxCount: 4, edit: true, formats: ['png'], priceByResolution: { standard: 0.0336, high: 0.0504 } }, { testedLive: false, recommend: ['default'] }),
    'gemini-3.1-flash-image': picture({ aspects: GEMINI_IMAGE_ASPECTS, resolutions: ['standard', 'high'], maxCount: 4, edit: true, formats: ['png'], priceByResolution: { standard: 0.067, high: 0.101 } }, { testedLive: false }),
    'gemini-3.1-flash-lite-image': picture({ aspects: GEMINI_IMAGE_ASPECTS, resolutions: ['standard'], maxCount: 4, edit: true, formats: ['png'], priceByResolution: { standard: 0.034 } }, { testedLive: false }),
};

/** The languages Sarvam speaks, as its `target_language_code` takes them. */
export const SARVAM_LANGUAGES = ['bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN'];

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
            // Pictures (AM3) through DashScope's own address in Frankfurt (Global scope). Singapore's
            // prices, the higher; Frankfurt's are a little less.
            'qwen-image-2.1-turbo': picture({ aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], resolutions: ['standard'], maxCount: 4, seed: true, edit: true, formats: ['png'] }, { price: 0.016, testedLive: false, recommend: ['default'] }),
            // The 3.0 series takes a negative prompt; 2.1 does not.
            'qwen-image-3.0': picture({ aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], resolutions: ['standard'], maxCount: 4, seed: true, negativePrompt: true, edit: true, formats: ['png'] }, { price: 0.03, testedLive: false }),
            'qwen-image-3.0-pro': picture({ aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], resolutions: ['standard'], maxCount: 4, seed: true, negativePrompt: true, edit: true, formats: ['png'], priceByResolution: { standard: 0.04 } }, { testedLive: false }),
        },
        files: 'dashscope',
        // DashScope answers a picture's signed address, kept 24 hours, on Alibaba Cloud's storage
        // (dashscope-result-*.oss-*.aliyuncs.com in its docs).
        downloadHosts: ['.aliyuncs.com'],
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
        // Its own images endpoints (AM3), on OpenAI's own presets only.
        files: 'openai',
        models: { ...OPENAI_IMAGE_MODELS },
    },
    'openai-eu': {
        label: 'OpenAI, EU project',
        kind: 'openai',
        baseUrl: 'https://eu.api.openai.com/v1',
        processesIn: 'The EU, for a key of an OpenAI project created in its EU region',
        pricesCheckedOn: PRICES_CHECKED_ON,
        billingUrl: 'https://platform.openai.com/settings/organization/billing',
        files: 'openai',
        models: { ...OPENAI_IMAGE_MODELS },
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
            // Cloud Text-to-Speech (AM2), one model per voice type, priced per 1,000 characters
            // after the monthly free amount, which Arc does not count.
            'tts-chirp3-hd': { ...googleTts('Chirp3-HD', 0.03), recommend: ['default'] },
            'tts-neural2': googleTts('Neural2', 0.016),
            'tts-wavenet': googleTts('Wavenet', 0.004),
            'tts-standard': googleTts('Standard', 0.004),
            'tts-studio': googleTts('Studio', 0.16),
            // Pictures (AM3) through generateContent at Vertex's global address, where Google serves them.
            ...GEMINI_IMAGE_MODELS,
        },
        files: 'vertex',
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
            ...GEMINI_IMAGE_MODELS,
        },
        files: 'gemini',
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
        files: 'sarvam',
        models: {
            'sarvam-105b': { reads: [], schema: 'json', priceIn: 15, priceOut: 60, priceCachedIn: 5, recommend: ['cheap', 'fast', 'thorough'] },
            // Speech (AM2): Rs 30 and Rs 10 per 10,000 characters.
            'bulbul:v3': { ...SPEECH, price: 3, speech: { maxChars: 2500, formats: ['wav', 'mp3'], languages: SARVAM_LANGUAGES }, recommend: ['default'] },
            // No Malayalam or Odia yet.
            'bulbul:v4-flash': { ...SPEECH, price: 1, speech: { maxChars: 2500, formats: ['wav', 'mp3'], languages: SARVAM_LANGUAGES.filter((l) => l !== 'ml-IN' && l !== 'od-IN') } },
        },
    },
    // AM2 (specs/ai-media-spec.md, section 6.2): speech, written from each provider's docs, not tested live.
    elevenlabs: {
        label: 'ElevenLabs',
        kind: 'elevenlabs',
        files: 'elevenlabs',
        baseUrl: 'https://api.elevenlabs.io/v1',
        auth: { header: 'xi-api-key', prefix: '' },
        processesIn: 'ElevenLabs\' data centres in the US (EU and India residency is for Enterprise plans, with their own keys)',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        // Requests at once on the Starter plan; ElevenLabs sets no limit a minute.
        atOnce: 3,
        balance: 'elevenlabs',
        billingUrl: 'https://elevenlabs.io/app/subscription',
        models: {
            'eleven_v4': { ...SPEECH, price: 0.08, speech: { maxChars: 10_000, formats: ['mp3', 'wav', 'opus'] }, recommend: ['default'] },
            'eleven_v3': { ...SPEECH, price: 0.08, speech: { maxChars: 5000, formats: ['mp3', 'wav', 'opus'] } },
            'eleven_multilingual_v2': { ...SPEECH, price: 0.08, speech: { maxChars: 10_000, formats: ['mp3', 'wav', 'opus'] } },
            'eleven_flash_v2_5': { ...SPEECH, price: 0.04, speech: { maxChars: 40_000, formats: ['mp3', 'wav', 'opus'] } },
        },
    },
    minimax: {
        label: 'MiniMax',
        kind: 'minimax',
        files: 'minimax',
        baseUrl: 'https://api.minimax.io/v1',
        processesIn: 'MiniMax\'s international servers (api.minimax.io), outside mainland China',
        pricesCheckedOn: DOCS_READ_ON,
        testedLive: false,
        docsReadOn: DOCS_READ_ON,
        // Speech requests a minute on the entry plan; pictures have their own, lower limit.
        perMinute: 60,
        kindLimits: { image: { perMinute: 10 } },
        billingUrl: 'https://platform.minimax.io/user-center/payment/balance',
        models: {
            // $1.00 and $0.60 per 10,000 characters; fewer than 10,000 characters a request.
            'speech-2.8-hd': { ...SPEECH, price: 0.1, speech: { maxChars: 9999, formats: ['mp3', 'wav', 'opus'] }, recommend: ['default'] },
            'speech-2.8-turbo': { ...SPEECH, price: 0.06, speech: { maxChars: 9999, formats: ['mp3', 'wav', 'opus'] } },
            'speech-2.6-hd': { ...SPEECH, price: 0.1, speech: { maxChars: 9999, formats: ['mp3', 'wav', 'opus'] } },
            'speech-2.6-turbo': { ...SPEECH, price: 0.06, speech: { maxChars: 9999, formats: ['mp3', 'wav', 'opus'] } },
            // Pictures (AM3), answered as base64 so nothing is fetched from another host.
            'image-01': picture({ aspects: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'], resolutions: ['standard'], maxCount: 4, seed: true, formats: ['jpeg'] }, { price: 0.0035, recommend: ['default'] }),
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
