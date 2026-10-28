/**
 * The providers Settings, AI offers (specs/ai-spec.md, AI-D6, AI-D7, AI-D13): where each
 * one's address is, where it processes data, and the models Arc knows with what they read
 * and cost. An admin can use any other model of a provider and say what it reads and costs.
 *
 * Prices are USD per million tokens, from the provider's price page on PRICES_CHECKED_ON.
 * Arc ships only prices it has checked; a model with none costs 0 until the admin sets one.
 */

export type AiConnectorKind = 'openai' | 'vertex';
export type AiSchemaSupport = 'strict' | 'json';
export type AiReads = 'pictures' | 'pdfs';

export interface AiKnownModel {
    reads: AiReads[];
    /** strict: the provider holds the answer to the schema; json: it promises JSON only, so the schema goes in the instruction. */
    schema: AiSchemaSupport;
    priceIn?: number;
    priceOut?: number;
}

export interface AiPreset {
    label: string;
    kind: AiConnectorKind;
    /** The OpenAI-style address; `{workspace}` is filled from the connection's workspace. */
    baseUrl?: string;
    /** Where the provider processes what is sent, as the admin page shows it. */
    processesIn: string;
    /** The provider reports each call's cost, used instead of the price list. */
    reportsCost?: boolean;
    models: Record<string, AiKnownModel>;
}

export const PRICES_CHECKED_ON = '2026-10-28';

export const AI_PRESETS: Record<string, AiPreset> = {
    'alibaba-eu': {
        label: 'Alibaba Cloud Model Studio, Frankfurt (EU)',
        kind: 'openai',
        baseUrl: 'https://{workspace}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
        processesIn: 'Germany (Frankfurt), Alibaba Cloud\'s EU deployment',
        models: {
            'qwen3-vl-plus': { reads: ['pictures'], schema: 'json', priceIn: 0.2, priceOut: 1.6 },
        },
    },
    openrouter: {
        label: 'OpenRouter',
        kind: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        processesIn: 'Wherever OpenRouter sends the model: its host\'s country',
        reportsCost: true,
        models: {},
    },
    huggingface: {
        label: 'Hugging Face',
        kind: 'openai',
        baseUrl: 'https://router.huggingface.co/v1',
        processesIn: 'Wherever Hugging Face sends the model: its host\'s country',
        models: {},
    },
    openai: {
        label: 'OpenAI',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        processesIn: 'OpenAI\'s worldwide data centres',
        models: {},
    },
    'openai-eu': {
        label: 'OpenAI, EU project',
        kind: 'openai',
        baseUrl: 'https://eu.api.openai.com/v1',
        processesIn: 'The EU, for a key of an OpenAI project created in its EU region',
        models: {},
    },
    deepseek: {
        label: 'DeepSeek',
        kind: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        processesIn: 'China (DeepSeek\'s own servers)',
        models: {},
    },
    other: {
        label: 'Other OpenAI-style address',
        kind: 'openai',
        processesIn: 'As the provider says',
        models: {},
    },
    vertex: {
        label: 'Google Vertex AI (Gemini)',
        kind: 'vertex',
        processesIn: 'The location chosen for it',
        models: {
            'gemini-3.8-flash': { reads: ['pictures', 'pdfs'], schema: 'strict' },
            'gemini-3.5-flash-lite': { reads: ['pictures', 'pdfs'], schema: 'strict' },
            'gemini-4-argon': { reads: ['pictures', 'pdfs'], schema: 'strict' },
        },
    },
};

export function findPreset(id: unknown): AiPreset | undefined {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(AI_PRESETS, id) ? AI_PRESETS[id] : undefined;
}
