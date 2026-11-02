/**
 * MiniMax speech (specs/ai-media-spec.md, AM-D7, section 6.2): `POST /v1/t2a_v2` at
 * `api.minimax.io`, which answers the audio as hex in JSON, and the voice list, `POST
 * /v1/get_voice`. MiniMax answers HTTP 200 for most failures and says what went wrong in
 * `base_resp.status_code`, so that is what is read. Pictures and video (AM3, AM4) will use
 * the same connection. Written from MiniMax's docs as read on 2026-11-02 and not tested live
 * (AM-D34).
 */
import { speechMime, audioSeconds } from '../audio.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiVoice } from '../types.js';
import { languageCode, sendRequest, shortMessage } from './http.js';
import type { FileConnector, FileProvider, FileResult, VoiceLister } from './types.js';

const SERVICE = 'MiniMax';

/** MiniMax's names for the languages it boosts, by language code; others are left to `auto`. */
const BOOST: Record<string, string> = {
    en: 'English', hi: 'Hindi', ta: 'Tamil', bn: 'Bengali', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
    zh: 'Chinese', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic',
    nl: 'Dutch', tr: 'Turkish', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', pl: 'Polish', uk: 'Ukrainian',
};

export function miniMaxSpeechBody(model: string, voice: string, text: string, speech: { language?: string; speed?: number; format?: 'mp3' | 'wav' | 'opus' } = {}): Record<string, unknown> {
    const code = languageCode(speech.language);
    return {
        model,
        text,
        stream: false,
        voice_setting: { voice_id: voice, speed: speech.speed ?? 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, ...(speech.format === 'wav' || speech.format === 'opus' ? {} : { bitrate: 128000 }), format: speech.format ?? 'mp3', channel: 1 },
        language_boost: (code && BOOST[code]) || 'auto',
        output_format: 'hex',
    };
}

/** What `base_resp.status_code` means, in the connectors' words; null for 0, success. */
export function readMiniMaxStatus(code: number, message: string): Exclude<FileResult, { ok: true }> | null {
    if (code === 0) return null;
    const detail = `MiniMax said ${code}: ${message}`;
    if (code === 1004 || code === 2049) return { ok: false, failure: 'key-refused', detail };
    if (code === 1008) return { ok: false, failure: 'off', detail: `MiniMax says the account has no balance left. ${detail}`, outOfCredit: true };
    if (code === 1002 || code === 1039) return { ok: false, failure: 'unavailable', detail, rateLimited: true };
    if (code === 1001) return { ok: false, failure: 'timeout', detail };
    if (code === 1000 || code === 1013) return { ok: false, failure: 'unavailable', detail };
    if (code === 1026 || code === 1027) return { ok: false, failure: 'blocked', detail };
    if (code === 2053 || code === 2056 || code === 2067) return { ok: false, failure: 'off', detail: `MiniMax says the account has no credit left. ${detail}`, outOfCredit: true };
    if (code === 1041 || code === 1045 || code === 2045 || code === 2064) return { ok: false, failure: 'unavailable', detail, rateLimited: code !== 2064 };
    if (code === 2066) return { ok: false, failure: 'timeout', detail };
    if (code === 2054 || code === 2042 || code === 2043 || code === 20132) return { ok: false, failure: 'off', detail: `MiniMax cannot use this voice with this model. ${detail}` };
    if (code === 2022 || code === 2068 || code === 2069) return { ok: false, failure: 'retired', detail };
    if (code === 1042) return { ok: false, failure: 'unreadable', detail: `the text has too many invisible characters. ${detail}` };
    if (/voice/i.test(message)) return { ok: false, failure: 'off', detail };
    if (/model/i.test(message)) return { ok: false, failure: 'retired', detail };
    if (/length|too long|exceed/i.test(message)) return { ok: false, failure: 'too-large', detail };
    return { ok: false, failure: 'unreadable', detail };
}

function baseResp(json: Record<string, unknown> | null): { code: number; message: string } {
    const r = (json?.['base_resp'] ?? {}) as Record<string, unknown>;
    return { code: Number(r['status_code'] ?? 0) || 0, message: shortMessage(r['status_msg'] ?? '') };
}

/** One HTTP answer to t2a_v2 in the connectors' words. */
export function readMiniMaxSpeech(status: number, json: Record<string, unknown> | null, format: 'mp3' | 'wav' | 'opus'): FileResult {
    const resp = baseResp(json);
    if (status === 401 || status === 403) return { ok: false, failure: 'key-refused', detail: `MiniMax refused the key (${status}): ${resp.message}` };
    if (status === 429) return { ok: false, failure: 'unavailable', detail: `MiniMax is busy (429): ${resp.message}`, rateLimited: true };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `MiniMax answered ${status}: ${resp.message}` };
    if (status !== 200 || !json) return { ok: false, failure: 'unreadable', detail: `MiniMax refused the request (${status}): ${resp.message}` };
    const failed = readMiniMaxStatus(resp.code, resp.message);
    if (failed) return failed;
    const data = (json['data'] ?? {}) as Record<string, unknown>;
    const hex = typeof data['audio'] === 'string' ? data['audio'] : '';
    if (!hex || !/^[0-9a-f]+$/i.test(hex)) return { ok: false, failure: 'unreadable', detail: 'MiniMax answered with no audio' };
    const bytes = Buffer.from(hex, 'hex');
    const info = (json['extra_info'] ?? {}) as Record<string, unknown>;
    const ms = Number(info['audio_length']);
    const chars = Number(info['usage_characters']);
    const mimeType = speechMime(format);
    return {
        ok: true,
        files: [{ bytes, mimeType, seconds: Number.isFinite(ms) && ms > 0 ? Math.round(ms / 100) / 10 : audioSeconds(bytes, mimeType) }],
        usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, ...(Number.isFinite(chars) && chars > 0 ? { amount: chars } : {}) },
        requestId: typeof json['trace_id'] === 'string' ? json['trace_id'] : undefined,
    };
}

export const miniMaxSpeech: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'speech') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with MiniMax yet` };
    if (!request.voice) return { ok: false, failure: 'off', detail: 'no MiniMax voice was chosen' };
    const format = request.speech?.format ?? 'mp3';
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/t2a_v2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(miniMaxSpeechBody(request.model, request.voice, request.prompt, { ...request.speech, format })),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    return readMiniMaxSpeech(answer.status, answer.json, format);
};

/** One voice of `get_voice` in Arc's words. MiniMax gives a name and a description, little else. */
export function miniMaxVoice(raw: Record<string, unknown>, label: string): AiVoice | null {
    const id = typeof raw['voice_id'] === 'string' ? raw['voice_id'] : '';
    if (!id) return null;
    // Its docs do not show whether a description is a text or a list of them: both are read.
    const description = (Array.isArray(raw['description']) ? (raw['description'] as unknown[]) : [raw['description']]).filter((d): d is string => typeof d === 'string' && !!d);
    const words = `${id} ${description.join(' ')}`.toLowerCase();
    const gender = /\b(female|woman|girl|lady)\b/.test(words) ? 'female' : /\b(male|man|boy)\b/.test(words) ? 'male' : null;
    return { id, name: String(raw['voice_name'] ?? id).slice(0, 80), languages: [], gender, labels: [label, ...description.slice(0, 2)].filter(Boolean).map((d) => d.slice(0, 60)), previewUrl: null, models: [] };
}

export const miniMaxVoices: VoiceLister = async ({ connection, key }, { timeoutMs }) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { ok: false, detail: key ? `connection ${connection.id} has no address` : `connection ${connection.id} has no key` };
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/get_voice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify({ voice_type: 'all' }),
    }, timeoutMs, SERVICE);
    if (!answer.ok) return { ok: false, detail: answer.detail };
    const resp = baseResp(answer.json);
    if (answer.status !== 200 || !answer.json || resp.code !== 0) {
        const failed = answer.status === 200 ? readMiniMaxStatus(resp.code, resp.message) : null;
        return { ok: false, detail: failed?.detail ?? `MiniMax answered ${answer.status}: ${resp.message}`, keyRefused: failed?.failure === 'key-refused' || answer.status === 401 };
    }
    const groups: Array<[string, string]> = [['system_voice', 'MiniMax voice'], ['voice_cloning', 'Cloned'], ['voice_generation', 'Designed']];
    const voices = groups.flatMap(([field, label]) => (Array.isArray(answer.json![field]) ? (answer.json![field] as Array<Record<string, unknown>>) : []).map((v) => miniMaxVoice(v, label)));
    return { ok: true, voices: voices.filter((v): v is AiVoice => v !== null) };
};

export const miniMaxProvider: FileProvider = { make: miniMaxSpeech, voices: miniMaxVoices };
