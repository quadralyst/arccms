/**
 * Sarvam speech (specs/ai-media-spec.md, AM-D7, section 6.2): `POST /text-to-speech` at
 * `api.sarvam.ai`, which answers the audio as base64 in JSON. The key goes in
 * `api-subscription-key`, the same key as Sarvam's chat models on this connection. Sarvam
 * has no voice list call, so Arc ships the speakers its docs list for each model, with no
 * sample files: Play makes a short sample (AM-D18). Written from Sarvam's docs as read on
 * 2026-11-02 and not tested live (AM-D34).
 */
import { audioSeconds, speechMime } from '../audio.js';
import { SARVAM_LANGUAGES } from '../presets.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiVoice } from '../types.js';
import { sendRequest, shortMessage } from './http.js';
import type { FileConnector, FileProvider, FileResult, VoiceLister } from './types.js';

const SERVICE = 'Sarvam';


const V3_MALE = 'shubh aditya rahul rohan amit dev ratan varun manan sumit kabir aayan ashutosh advait anand tarun sunny mani gokul vijay mohit rehan soham';
const V3_FEMALE = 'ritu priya neha pooja simran kavya ishita shreya roopa tanya shruti suhani kavitha rupali';
/**
 * The first 40 of bulbul:v4-flash's 222 speakers, as its voices page lists them. The rest
 * are on that page; the admin can type any of them in Settings, AI.
 */
const V4_FLASH = 'aayan_hi_conversational amit_hi_conversational ashutosh_hi_conversational kabir_hi_conversational kavya_hi_conversational manan_hi_conversational rahul_hi_conversational sumit_hi_conversational aditya_hi_conversational aditya_hi_sales anand_hi_documentary anand_hi_news aparna_hi_customer aparna_hi_kyc ashok_hi_character ashok_hi_news chhavi_hi_kids ishita_hi_ads ishita_hi_edtech ishita_hi_banking ishita_hi_ads_informal ishita_hi_devotional ishita_hi_numbers ishita_hi_social kunal_hi_kids mahesh_hi_documentary mani_hi_devotional mani_hi_conversational mohit_hi_conversational nachiket_hi_devotional priya_hi_recovery ratan_hi_latenight ratan_hi_customer_expressive ratan_hi_documentary ratan_hi_devotional ratan_hi_recovery ratan_hi_social ratan_hi_sports ratan_hi_latenight_warm rehan_hi_social';

/** Sarvam's speakers by model, from its docs: bulbul:v3 speaks every language; a v4-flash speaker its own. */
export const SARVAM_SPEAKERS: Record<string, Array<{ id: string; gender: 'female' | 'male' | null }>> = {
    'bulbul:v3': [
        ...V3_MALE.split(' ').map((id) => ({ id, gender: 'male' as const })),
        ...V3_FEMALE.split(' ').map((id) => ({ id, gender: 'female' as const })),
    ],
    'bulbul:v4-flash': V4_FLASH.split(' ').map((id) => ({ id, gender: null })),
};

/** A v4-flash speaker's languages, from its id: `ishita_hi_ads` speaks hi-IN, `shubh_enhi_ads` en-IN and hi-IN. */
export function speakerLanguages(id: string): string[] {
    const lang = id.split('_')[1];
    if (!lang) return SARVAM_LANGUAGES;
    if (lang === 'enhi') return ['en-IN', 'hi-IN'];
    const tag = SARVAM_LANGUAGES.find((l) => l.startsWith(`${lang}-`));
    return tag ? [tag] : SARVAM_LANGUAGES;
}

/** Arc's language tag as Sarvam takes it: any English is `en-IN`, Odia `od-IN`; null when Sarvam has none. */
export function sarvamLanguage(tag: string | undefined): string | null {
    if (!tag) return 'en-IN';
    const code = tag.split('-')[0].toLowerCase();
    if (code === 'en') return 'en-IN';
    if (code === 'or') return 'od-IN';
    return SARVAM_LANGUAGES.find((l) => l.startsWith(`${code}-`)) ?? null;
}

export function sarvamSpeechBody(model: string, voice: string, text: string, language: string, speech: { speed?: number; format?: 'mp3' | 'wav' | 'opus' } = {}): Record<string, unknown> {
    const body: Record<string, unknown> = { text, language_code: language, speaker: voice, model };
    if (speech.speed !== undefined) body['pace'] = speech.speed;
    if (speech.format === 'mp3') body['output_audio_codec'] = 'mp3';
    return body;
}

/** One HTTP answer in the connectors' words. */
export function readSarvamSpeech(status: number, json: Record<string, unknown> | null, format: 'mp3' | 'wav'): FileResult {
    const err = (json?.['error'] ?? {}) as Record<string, unknown>;
    const message = shortMessage(err['message'] ?? json?.['message'] ?? json?.['detail'] ?? '');
    const code = String(err['code'] ?? '').toLowerCase();
    // Sarvam's pages give 402 or 429 for no credit: its code says which.
    if (status === 402 || /insufficient_quota|no credits|quota exceeded|balance/i.test(`${code} ${message}`)) {
        return { ok: false, failure: 'off', detail: `Sarvam says the account has no credit left (${status}): ${message}`, outOfCredit: true };
    }
    if (status === 401 || status === 403) return { ok: false, failure: 'key-refused', detail: `Sarvam refused the key (${status}): ${message}` };
    if (status === 429 || status === 503) return { ok: false, failure: 'unavailable', detail: `Sarvam is busy (${status}): ${message}`, rateLimited: true };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `Sarvam answered ${status}: ${message}` };
    if (status !== 200 || !json) {
        if (/too long|exceed|max(imum)? (length|characters)/i.test(message)) return { ok: false, failure: 'too-large', detail: message };
        if (/speaker|voice/i.test(message)) return { ok: false, failure: 'off', detail: `Sarvam has no such speaker for this model: ${message}` };
        if (/model/i.test(message)) return { ok: false, failure: 'retired', detail: `Sarvam has no such model: ${message}` };
        return { ok: false, failure: 'unreadable', detail: `Sarvam refused the request (${status}): ${message}` };
    }
    const audios = Array.isArray(json['audios']) ? (json['audios'] as unknown[]).filter((a): a is string => typeof a === 'string' && a.length > 0) : [];
    if (!audios.length) return { ok: false, failure: 'unreadable', detail: 'Sarvam answered with no audio' };
    const bytes = Buffer.from(audios[0], 'base64');
    const mimeType = speechMime(format);
    return {
        ok: true,
        files: [{ bytes, mimeType, seconds: audioSeconds(bytes, mimeType) }],
        usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 },
        requestId: typeof json['request_id'] === 'string' ? json['request_id'] : undefined,
    };
}

export const sarvamSpeech: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'speech') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with Sarvam` };
    if (!request.voice) return { ok: false, failure: 'off', detail: 'no Sarvam speaker was chosen' };
    const language = sarvamLanguage(request.speech?.language);
    if (!language) return { ok: false, failure: 'off', detail: `Sarvam speaks no ${request.speech?.language}` };
    const format = request.speech?.format === 'mp3' ? 'mp3' : 'wav';
    const auth = connectionAuth(connection);
    // Speech is at the address's root, beside the chat models' /v1.
    const answer = await sendRequest(`${new URL(base).origin}/text-to-speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(sarvamSpeechBody(request.model, request.voice, request.prompt, language, { ...request.speech, format })),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    return readSarvamSpeech(answer.status, answer.json, format);
};

/** Sarvam's documented speakers as voices: no call, no key. */
export function sarvamVoices(): AiVoice[] {
    const byId = new Map<string, AiVoice>();
    for (const [model, speakers] of Object.entries(SARVAM_SPEAKERS)) {
        for (const s of speakers) {
            const name = s.id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const voice = byId.get(s.id) ?? { id: s.id, name, languages: model === 'bulbul:v3' ? SARVAM_LANGUAGES : speakerLanguages(s.id), gender: s.gender, labels: [], previewUrl: null, models: [] };
            voice.models = [...voice.models, model];
            byId.set(s.id, voice);
        }
    }
    return [...byId.values()];
}

export const sarvamVoiceList: VoiceLister = async () => ({ ok: true, voices: sarvamVoices(), fromDocs: true });

export const sarvamProvider: FileProvider = { make: sarvamSpeech, voices: sarvamVoiceList };
