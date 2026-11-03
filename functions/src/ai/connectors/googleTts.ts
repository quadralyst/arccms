/**
 * Google Cloud Text-to-Speech on the Vertex connection (specs/ai-media-spec.md, AM-D7,
 * section 6.2): `POST /v1/text:synthesize` at `texttospeech.googleapis.com`, or
 * `eu-texttospeech.googleapis.com` when the connection's location is in Europe, signed with
 * the functions' own service account, so there is no key. The Text-to-Speech API must be on
 * in the project. Google prices by voice type, so each type is a model (`tts-chirp3-hd`,
 * `tts-neural2`, ...), and a voice of another type is refused before anything is sent.
 * Written from Google's docs as read on 2026-11-02 and not tested live (AM-D34).
 */
import { audioSeconds, speechMime } from '../audio.js';
import { defaultVertexLocation } from '../settings.js';
import type { AiVoice } from '../types.js';
import { sendRequest, shortMessage } from './http.js';
import type { FileConnector, FileProvider, FileResult, VoiceLister } from './types.js';
import { googleAccessToken } from './vertex.js';

const SERVICE = 'Google Cloud Text-to-Speech';

/** Each model's voice type, as it appears in a voice's name (`en-US-Chirp3-HD-Kore`). */
export const GOOGLE_TTS_TYPES: Record<string, string> = {
    'tts-chirp3-hd': 'Chirp3-HD',
    'tts-neural2': 'Neural2',
    'tts-wavenet': 'Wavenet',
    'tts-standard': 'Standard',
    'tts-studio': 'Studio',
};

/** The host for a connection's location: the EU one for a European location, else the worldwide one. */
export function googleTtsHost(location: string): string {
    return location === 'eu' || location.startsWith('europe-') ? 'eu-texttospeech.googleapis.com' : 'texttospeech.googleapis.com';
}

/** A voice's language, from its name: `hi-IN` of `hi-IN-Chirp3-HD-Kore`. */
export function voiceLanguage(voice: string): string | null {
    const m = /^([a-z]{2,3}-[A-Z]{2,3})-/.exec(voice);
    return m ? m[1] : null;
}

const ENCODING = { mp3: 'MP3', wav: 'LINEAR16', opus: 'OGG_OPUS' } as const;

export function googleTtsBody(voice: string, text: string, speech: { language?: string; speed?: number; format?: 'mp3' | 'wav' | 'opus'; sampleRate?: number } = {}): Record<string, unknown> {
    const audioConfig: Record<string, unknown> = { audioEncoding: ENCODING[speech.format ?? 'mp3'] };
    if (speech.speed !== undefined) audioConfig['speakingRate'] = speech.speed;
    if (speech.sampleRate !== undefined) audioConfig['sampleRateHertz'] = speech.sampleRate;
    return { input: { text }, voice: { languageCode: voiceLanguage(voice) ?? speech.language ?? 'en-US', name: voice }, audioConfig };
}

/** An HTTP answer that is not audio, in the connectors' words. */
export function readGoogleTtsError(status: number, json: Record<string, unknown> | null): FileResult {
    const err = (json?.['error'] ?? {}) as Record<string, unknown>;
    const message = shortMessage(err['message'] ?? json ?? '');
    const code = String(err['status'] ?? '');
    if (status === 401 || status === 403 || code === 'PERMISSION_DENIED') {
        return { ok: false, failure: 'off', detail: `Google Cloud refused the project's service account (${status}): switch on the Cloud Text-to-Speech API in the project. ${message}` };
    }
    if (status === 429 || code === 'RESOURCE_EXHAUSTED') return { ok: false, failure: 'unavailable', detail: `${status}: ${message}`, rateLimited: true };
    if (status >= 500 || code === 'UNAVAILABLE') return { ok: false, failure: 'unavailable', detail: `${status}: ${message}` };
    if (/5000 bytes|too long|longer than/i.test(message)) return { ok: false, failure: 'too-large', detail: message };
    if (/voice.*(not|does not) exist|unsupported voice|invalid voice/i.test(message)) return { ok: false, failure: 'off', detail: `Google has no such voice: ${message}` };
    return { ok: false, failure: 'unreadable', detail: `${SERVICE} refused the request (${status}): ${message}` };
}

export const googleTtsSpeech: FileConnector = async ({ connection }, request) => {
    if (request.kind !== 'speech') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with Google Cloud yet` };
    const type = GOOGLE_TTS_TYPES[request.model];
    if (!type) return { ok: false, failure: 'retired', detail: `"${request.model}" is not a Google Cloud voice type Arc knows: use ${Object.keys(GOOGLE_TTS_TYPES).join(', ')}` };
    const voice = request.voice ?? '';
    // A voice of another type would be billed at that type's price, not this model's.
    if (!voice.includes(`-${type}-`)) return { ok: false, failure: 'off', detail: `"${voice}" is not a ${type} voice, which ${request.model} speaks with` };
    const format = request.speech?.format ?? 'mp3';
    let token: string;
    try {
        token = await googleAccessToken();
    } catch (err) {
        return { ok: false, failure: 'off', detail: `the service account gave no token: ${String((err as Error).message ?? err).slice(0, 160)}` };
    }
    const host = googleTtsHost(connection.location || defaultVertexLocation());
    const answer = await sendRequest(`https://${host}/v1/text:synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(googleTtsBody(voice, request.prompt, { ...request.speech, format })),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    if (answer.status !== 200) return readGoogleTtsError(answer.status, answer.json);
    const audio = typeof answer.json?.['audioContent'] === 'string' ? Buffer.from(answer.json['audioContent'], 'base64') : Buffer.alloc(0);
    if (!audio.length) return { ok: false, failure: 'unreadable', detail: `${SERVICE} answered with no audio` };
    const mimeType = speechMime(format);
    return { ok: true, files: [{ bytes: audio, mimeType, seconds: audioSeconds(audio, mimeType) }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 } };
};

/** One voice of `GET /v1/voices` in Arc's words; the models are the voice type's. */
export function googleTtsVoice(raw: Record<string, unknown>): AiVoice | null {
    const name = typeof raw['name'] === 'string' ? raw['name'] : '';
    if (!name) return null;
    const gender = String(raw['ssmlGender'] ?? '').toLowerCase();
    const models = Object.entries(GOOGLE_TTS_TYPES).filter(([, t]) => name.includes(`-${t}-`)).map(([m]) => m);
    return {
        id: name,
        name,
        languages: Array.isArray(raw['languageCodes']) ? (raw['languageCodes'] as unknown[]).filter((l): l is string => typeof l === 'string') : [],
        gender: gender === 'female' || gender === 'male' || gender === 'neutral' ? gender : null,
        labels: models.length ? [GOOGLE_TTS_TYPES[models[0]]] : [],
        previewUrl: null,
        models,
    };
}

export const googleTtsVoices: VoiceLister = async ({ connection }, { timeoutMs }) => {
    let token: string;
    try {
        token = await googleAccessToken();
    } catch (err) {
        return { ok: false, detail: `the service account gave no token: ${String((err as Error).message ?? err).slice(0, 160)}` };
    }
    const host = googleTtsHost(connection.location || defaultVertexLocation());
    const answer = await sendRequest(`https://${host}/v1/voices`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } }, timeoutMs, SERVICE);
    if (!answer.ok) return { ok: false, detail: answer.detail };
    if (answer.status !== 200 || !answer.json) {
        const failure = readGoogleTtsError(answer.status, answer.json);
        return { ok: false, detail: failure.ok ? `${SERVICE} gave no voices` : failure.detail };
    }
    const list = Array.isArray(answer.json['voices']) ? (answer.json['voices'] as Array<Record<string, unknown>>) : [];
    // Only the voice types Arc prices: a voice of any other type could not be used.
    return { ok: true, voices: list.map(googleTtsVoice).filter((v): v is AiVoice => v !== null && v.models.length > 0) };
};

export const googleTtsProvider: FileProvider = { make: googleTtsSpeech, voices: googleTtsVoices };
