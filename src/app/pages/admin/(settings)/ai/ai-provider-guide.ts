/**
 * What Settings, AI tells a first-time admin about each provider (docs/features/ai.html):
 * where to get a key, with links, and what a key looks like. The words are translations
 * (`admin.settings.ai.guide_<id>_*`); the links are the providers' own pages.
 */

export interface GuideStep {
    /** The step's words: `admin.settings.ai.<key>`. */
    key: string;
    /** A page of the provider's the step points to. */
    url?: string;
}

export interface ProviderGuide {
    /** What a key starts with, to warn about a key copied short or from elsewhere. */
    keyPrefix?: string;
    /** Highlighted as the easiest way to start. */
    easiest?: boolean;
    steps: GuideStep[];
}

export const PROVIDER_GUIDES: Record<string, ProviderGuide> = {
    openrouter: {
        keyPrefix: 'sk-or-',
        easiest: true,
        steps: [
            { key: 'guide_openrouter_1', url: 'https://openrouter.ai/settings/keys' },
            { key: 'guide_openrouter_2' },
            { key: 'guide_openrouter_3' },
            { key: 'guide_openrouter_4', url: 'https://openrouter.ai/settings/credits' },
        ],
    },
    'alibaba-eu': {
        keyPrefix: 'sk-',
        steps: [
            { key: 'guide_alibaba_1', url: 'https://modelstudio.console.alibabacloud.com/' },
            { key: 'guide_alibaba_2' },
            { key: 'guide_alibaba_3' },
        ],
    },
    huggingface: {
        keyPrefix: 'hf_',
        steps: [
            { key: 'guide_huggingface_1', url: 'https://huggingface.co/settings/tokens' },
            { key: 'guide_huggingface_2' },
            { key: 'guide_huggingface_3', url: 'https://huggingface.co/settings/billing' },
        ],
    },
    openai: {
        keyPrefix: 'sk-',
        steps: [
            { key: 'guide_openai_1', url: 'https://platform.openai.com/api-keys' },
            { key: 'guide_openai_2' },
            { key: 'guide_openai_3', url: 'https://platform.openai.com/settings/organization/billing/overview' },
        ],
    },
    'openai-eu': {
        keyPrefix: 'sk-',
        steps: [
            { key: 'guide_openai_eu_1', url: 'https://platform.openai.com/settings/organization/projects' },
            { key: 'guide_openai_2', url: 'https://platform.openai.com/api-keys' },
            { key: 'guide_openai_3', url: 'https://platform.openai.com/settings/organization/billing/overview' },
        ],
    },
    deepseek: {
        keyPrefix: 'sk-',
        steps: [
            { key: 'guide_deepseek_1', url: 'https://platform.deepseek.com/api_keys' },
            { key: 'guide_deepseek_2', url: 'https://platform.deepseek.com/top_up' },
        ],
    },
    other: {
        steps: [{ key: 'guide_other_1' }, { key: 'guide_other_2' }],
    },
    // Built from each provider's docs, not tested live (specs/ai-media-spec.md, AM-D34).
    anthropic: {
        keyPrefix: 'sk-ant-',
        steps: [
            { key: 'guide_key_page', url: 'https://console.anthropic.com/settings/keys' },
            { key: 'guide_add_credit', url: 'https://console.anthropic.com/settings/billing' },
        ],
    },
    'gemini-api': {
        steps: [
            { key: 'guide_key_page', url: 'https://aistudio.google.com/apikey' },
            { key: 'guide_add_credit', url: 'https://aistudio.google.com/usage' },
        ],
    },
    mistral: {
        steps: [
            { key: 'guide_key_page', url: 'https://console.mistral.ai/api-keys' },
            { key: 'guide_add_credit', url: 'https://console.mistral.ai/billing' },
        ],
    },
    'mistral-eu': {
        steps: [
            { key: 'guide_key_page', url: 'https://console.mistral.ai/api-keys' },
            { key: 'guide_add_credit', url: 'https://console.mistral.ai/billing' },
        ],
    },
    groq: {
        keyPrefix: 'gsk_',
        steps: [
            { key: 'guide_key_page', url: 'https://console.groq.com/keys' },
            { key: 'guide_add_credit', url: 'https://console.groq.com/settings/billing' },
        ],
    },
    xai: {
        keyPrefix: 'xai-',
        steps: [
            { key: 'guide_key_page', url: 'https://console.x.ai/' },
            { key: 'guide_add_credit', url: 'https://console.x.ai/' },
        ],
    },
    sarvam: {
        steps: [
            { key: 'guide_key_page', url: 'https://dashboard.sarvam.ai/' },
            { key: 'guide_add_credit', url: 'https://dashboard.sarvam.ai/' },
            { key: 'guide_sarvam_rate' },
        ],
    },
    elevenlabs: {
        keyPrefix: 'sk_',
        steps: [
            { key: 'guide_key_page', url: 'https://elevenlabs.io/app/settings/api-keys' },
            { key: 'guide_elevenlabs_plan', url: 'https://elevenlabs.io/app/subscription' },
        ],
    },
    minimax: {
        steps: [
            { key: 'guide_key_page', url: 'https://platform.minimax.io/user-center/basic-information/interface-key' },
            { key: 'guide_add_credit', url: 'https://platform.minimax.io/user-center/payment/balance' },
        ],
    },
    kling: {
        steps: [
            { key: 'guide_key_page', url: 'https://app.klingai.com/global/dev/api-key' },
            { key: 'guide_kling_units', url: 'https://app.klingai.com/global/dev/console' },
        ],
    },
    heygen: {
        steps: [
            { key: 'guide_key_page', url: 'https://app.heygen.com/settings?nav=API' },
            { key: 'guide_heygen_wallet', url: 'https://app.heygen.com/settings?nav=API' },
        ],
    },
    vertex: {
        steps: [
            { key: 'guide_vertex_1', url: 'https://console.cloud.google.com/apis/library/aiplatform.googleapis.com' },
            { key: 'guide_vertex_2', url: 'https://console.cloud.google.com/iam-admin/iam' },
            { key: 'guide_vertex_3' },
        ],
    },
};

/**
 * Why a test or call failed, in words a first-time admin can act on: a translation key.
 * `failure` is the connector's word when the page has it; a provider's stored error has only
 * its text, which is read for the same cases.
 */
export function failureAdvice(failure: string | undefined, detail = ''): string {
    if (/credit|402|insufficient|balance|billing/i.test(detail)) return 'advice_credit';
    if (/another (address|header)/i.test(detail)) return 'advice_key_again';
    if (/Text-to-Speech API/i.test(detail)) return 'advice_tts';
    if (/service account|Vertex AI API/i.test(detail)) return 'advice_vertex';
    if (failure === 'key-refused' || /refused the key|has no key|\b40[13]\b/i.test(detail)) return 'advice_key';
    if (failure === 'retired' || /not there|not a model|\b404\b/i.test(detail)) return 'advice_model';
    if (/ran out of tokens/i.test(detail)) return 'advice_tokens';
    // A name that does not resolve is almost always a mistyped workspace or address, not a busy provider.
    if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|could not be reached/i.test(detail)) return 'advice_reach';
    if (failure === 'timeout' || /no answer within/i.test(detail)) return 'advice_slow';
    if (failure === 'unavailable' || /could not be reached|\b(429|5\d\d)\b|overloaded|busy/i.test(detail)) return 'advice_busy';
    if (failure === 'off') return /address/i.test(detail) ? 'advice_address' : 'advice_key';
    return 'advice_other';
}
