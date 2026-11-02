/**
 * ElevenLabs speech (specs/ai-media-spec.md, AM-D7, section 6.2): `POST
 * /v1/text-to-speech/{voice}`, which answers the audio itself, and the voice list, `GET
 * /v2/voices`, with each voice's own sample. The key goes in `xi-api-key`. ElevenLabs limits
 * requests at once, not a minute, so a 429 is "busy". Written from ElevenLabs' docs as read on
 * 2026-11-02 and not tested live (AM-D34): the `character-cost` header is used when it comes,
 * else Arc counts the characters it sent. Its docs do not say which HTTP status an
 * out-of-quota or unknown-voice answer has, so both are read from `detail.status`.
 */
import { audioSeconds, speechMime } from '../audio.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiVoice } from '../types.js';
import { httpsUrl, languageCode, sendRequest, shortMessage } from './http.js';
import { waitFrom } from './openai.js';
import type { FileConnector, FileProvider, FileResult, VoiceLister, VoicesResult } from './types.js';

const SERVICE = 'ElevenLabs';
/** Multilingual v2 refuses a language code; the other models take one, or ignore it. */
const NO_LANGUAGE = /^eleven_multilingual_v2/;
/** v3 and v4 have no speed setting. */
const NO_SPEED = /^eleven_v[34]/;

/**
 * The output_format for Arc's format: MP3 at 128 kbps, Opus, or WAV at 24 kHz (44.1 kHz WAV
 * needs ElevenLabs' Pro plan).
 */
export function elevenLabsFormat(format: 'mp3' | 'wav' | 'opus' = 'mp3'): string {
    return format === 'wav' ? 'wav_24000' : format === 'opus' ? 'opus_48000_128' : 'mp3_44100_128';
}

/** The request body for one text. ElevenLabs takes a speed from 0.7 to 1.2, so Arc's is kept inside it. */
export function elevenLabsBody(model: string, text: string, speech: { language?: string; speed?: number } = {}): Record<string, unknown> {
    const body: Record<string, unknown> = { text, model_id: model };
    const code = languageCode(speech.language);
    if (code && !NO_LANGUAGE.test(model)) body['language_code'] = code;
    if (speech.speed !== undefined && !NO_SPEED.test(model)) body['voice_settings'] = { speed: Math.min(1.2, Math.max(0.7, speech.speed)) };
    return body;
}

/** The detail ElevenLabs puts in an error: `{ detail: { status, message } }` or a text. */
function errorOf(json: Record<string, unknown> | null, bytes: Buffer): { status: string; message: string } {
    const detail = json?.['detail'];
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        const d = detail as Record<string, unknown>;
        return { status: String(d['status'] ?? d['code'] ?? '').toLowerCase(), message: shortMessage(d['message'] ?? d) };
    }
    return { status: '', message: shortMessage(detail ?? (json ? json : bytes.toString('utf8', 0, 300))) };
}

/** An HTTP answer that is not audio, in the connectors' words. */
export function readElevenLabsError(status: number, json: Record<string, unknown> | null, bytes: Buffer, headers?: Headers): FileResult {
    const { status: code, message } = errorOf(json, bytes);
    if (code === 'quota_exceeded' || /quota|credits?|insufficient/i.test(code) || status === 402) {
        return { ok: false, failure: 'off', detail: `ElevenLabs says the account has no characters left (${status}): ${message}`, outOfCredit: true };
    }
    if (status === 401 || status === 403 || code.includes('api_key') || code === 'unauthorized') return { ok: false, failure: 'key-refused', detail: `ElevenLabs refused the key (${status}): ${message}` };
    if (status === 429) return { ok: false, failure: 'unavailable', detail: `ElevenLabs is busy (${code || 429}): ${message}`, rateLimited: true, wait: headers ? waitFrom(headers) : undefined };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `ElevenLabs answered ${status}: ${message}` };
    if (code.includes('voice_not_found') || (status === 404 && /voice/i.test(message))) return { ok: false, failure: 'off', detail: `ElevenLabs has no such voice: ${message}` };
    if (code.includes('model_not_found') || (status === 404 && /model/i.test(message))) return { ok: false, failure: 'retired', detail: `ElevenLabs has no such model: ${message}` };
    if (/max_character_limit|too long|max(imum)? (length|characters)|text_too_long/i.test(`${code} ${message}`)) return { ok: false, failure: 'too-large', detail: message };
    if (/moderation|safety|blocked|violat/i.test(`${code} ${message}`)) return { ok: false, failure: 'blocked', detail: message };
    return { ok: false, failure: 'unreadable', detail: `ElevenLabs refused the request (${status}): ${message}` };
}

export const elevenLabsSpeech: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'speech') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with ElevenLabs yet` };
    if (!request.voice) return { ok: false, failure: 'off', detail: 'no ElevenLabs voice was chosen' };
    const format = request.speech?.format ?? 'mp3';
    const auth = connectionAuth(connection);
    const url = `${base}/text-to-speech/${encodeURIComponent(request.voice)}?output_format=${elevenLabsFormat(format)}`;
    const answer = await sendRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'audio/*', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(elevenLabsBody(request.model, request.prompt, request.speech)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    const requestId = answer.headers.get('request-id') ?? undefined;
    if (answer.status < 200 || answer.status >= 300) return readElevenLabsError(answer.status, answer.json, answer.bytes, answer.headers);
    if (answer.json || !answer.bytes.length) return { ok: false, failure: 'unreadable', detail: 'ElevenLabs answered with no audio', requestId };
    const bytes = answer.bytes;
    const mimeType = speechMime(format);
    const cost = Number(answer.headers.get('character-cost'));
    return {
        ok: true,
        files: [{ bytes, mimeType, seconds: audioSeconds(bytes, mimeType) }],
        // The characters ElevenLabs says it billed, when it says; else Arc counts what it sent.
        usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, ...(Number.isFinite(cost) && cost > 0 ? { amount: cost } : {}) },
        requestId,
    };
};

/** One voice of `GET /v2/voices` in Arc's words. */
export function elevenLabsVoice(raw: Record<string, unknown>): AiVoice | null {
    const id = typeof raw['voice_id'] === 'string' ? raw['voice_id'] : '';
    if (!id) return null;
    const labels = (raw['labels'] ?? {}) as Record<string, unknown>;
    const verified = Array.isArray(raw['verified_languages']) ? (raw['verified_languages'] as Array<Record<string, unknown>>) : [];
    const gender = String(labels['gender'] ?? '').toLowerCase();
    const languages = [...new Set(verified.map((l) => String(l['locale'] ?? l['language'] ?? '')).filter(Boolean))];
    if (!languages.length && typeof labels['language'] === 'string') languages.push(labels['language']);
    return {
        id,
        name: String(raw['name'] ?? id).slice(0, 80),
        languages,
        gender: gender === 'female' || gender === 'male' || gender === 'neutral' ? gender : null,
        labels: ['accent', 'age', 'descriptive', 'use_case', 'use case'].map((k) => labels[k]).filter((v): v is string => typeof v === 'string' && !!v).map((v) => v.replace(/_/g, ' ')),
        previewUrl: httpsUrl(raw['preview_url']),
        models: Array.isArray(raw['high_quality_base_model_ids']) ? (raw['high_quality_base_model_ids'] as unknown[]).filter((m): m is string => typeof m === 'string') : [],
    };
}

const MAX_PAGES = 10;

export const elevenLabsVoices: VoiceLister = async ({ connection, key }, { timeoutMs }) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { ok: false, detail: key ? `connection ${connection.id} has no address` : `connection ${connection.id} has no key` };
    const auth = connectionAuth(connection);
    const root = new URL(base).origin;
    const voices: AiVoice[] = [];
    let token = '';
    // One time limit for every page together.
    const deadline = Date.now() + timeoutMs;
    for (let page = 0; page < MAX_PAGES; page++) {
        const left = deadline - Date.now();
        if (left < 1000) break;
        const url = `${root}/v2/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`;
        const answer = await sendRequest(url, { headers: { accept: 'application/json', [auth.header]: `${auth.prefix}${key}` } }, left, SERVICE);
        // A later page that does not come in time leaves the voices read so far.
        if (!answer.ok) return voices.length ? { ok: true, voices } : { ok: false, detail: answer.detail };
        if (answer.status !== 200 || !answer.json) {
            const failure = readElevenLabsError(answer.status, answer.json, answer.bytes);
            return { ok: false, detail: failure.ok ? 'ElevenLabs gave no voices' : failure.detail, keyRefused: !failure.ok && failure.failure === 'key-refused' };
        }
        const list = Array.isArray(answer.json['voices']) ? (answer.json['voices'] as Array<Record<string, unknown>>) : [];
        voices.push(...list.map(elevenLabsVoice).filter((v): v is AiVoice => v !== null));
        token = typeof answer.json['next_page_token'] === 'string' ? answer.json['next_page_token'] : '';
        if (answer.json['has_more'] !== true || !token) break;
    }
    return { ok: true, voices } satisfies VoicesResult;
};

export const elevenLabsProvider: FileProvider = { make: elevenLabsSpeech, voices: elevenLabsVoices };
