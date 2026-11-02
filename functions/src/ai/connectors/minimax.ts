/**
 * MiniMax speech (specs/ai-media-spec.md, AM-D7, section 6.2): `POST /v1/t2a_v2` at
 * `api.minimax.io`, which answers the audio as hex in JSON, and the voice list, `POST
 * /v1/get_voice`. MiniMax answers HTTP 200 for most failures and says what went wrong in
 * `base_resp.status_code`, so that is what is read. Pictures (AM3) come from `POST
 * /v1/image_generation` as base64, and video (AM4) uses the same connection. Written from MiniMax's docs as read on 2026-11-02 and not tested live
 * (AM-D34).
 */
import { speechMime, audioSeconds } from '../audio.js';
import { madePicture } from '../images.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiVoice } from '../types.js';
import { httpsUrl, languageCode, sendRequest, shortMessage } from './http.js';
import type { FileConnector, FileProvider, FileResult, JobChecker, VoiceLister } from './types.js';

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

/** The request body for pictures: base64 back, so nothing is fetched from another host. */
export function miniMaxImageBody(model: string, prompt: string, image: { aspect?: string; count?: number; seed?: number } = {}): Record<string, unknown> {
    return {
        model,
        prompt,
        aspect_ratio: image.aspect ?? '1:1',
        n: Math.min(4, Math.max(1, image.count ?? 1)),
        ...(image.seed !== undefined ? { seed: image.seed } : {}),
        response_format: 'base64',
        prompt_optimizer: false,
    };
}

/** One HTTP answer to image_generation in the connectors' words. */
export function readMiniMaxImages(status: number, json: Record<string, unknown> | null): FileResult {
    const resp = baseResp(json);
    if (status === 401 || status === 403) return { ok: false, failure: 'key-refused', detail: `MiniMax refused the key (${status}): ${resp.message}` };
    if (status === 429) return { ok: false, failure: 'unavailable', detail: `MiniMax is busy (429): ${resp.message}`, rateLimited: true };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `MiniMax answered ${status}: ${resp.message}` };
    if (status !== 200 || !json) return { ok: false, failure: 'unreadable', detail: `MiniMax refused the request (${status}): ${resp.message}` };
    const failed = readMiniMaxStatus(resp.code, resp.message);
    if (failed) return failed;
    const data = (json['data'] ?? {}) as Record<string, unknown>;
    const list = Array.isArray(data['image_base64']) ? (data['image_base64'] as unknown[]) : [];
    const files = list.filter((b): b is string => typeof b === 'string' && !!b).map((b) => madePicture(Buffer.from(b, 'base64'), 'image/jpeg')).filter((f) => f.bytes.length > 0);
    const meta = (json['metadata'] ?? {}) as Record<string, unknown>;
    if (!files.length) {
        // A picture its checks refused is counted as failed, with no reason given.
        return Number(meta['failed_count']) > 0 ? { ok: false, failure: 'blocked', detail: 'MiniMax made no picture: its checks refused it' } : { ok: false, failure: 'unreadable', detail: 'MiniMax answered with no picture' };
    }
    return { ok: true, files, usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0 }, requestId: typeof json['id'] === 'string' ? json['id'] : undefined };
}

export const miniMaxImages: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/image_generation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(miniMaxImageBody(request.model, request.prompt, request.image)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    return readMiniMaxImages(answer.status, answer.json);
};

// ---------------------------------------------------------------- video (AM4)
// MiniMax H3 lives on /v2 only: the start answers a task id, and the query answers the
// video's address directly (no file id step, unlike its older Hailuo models on /v1).

/** MiniMax's resolution for Arc's: the base H3 makes 768P and 2K, the others 480P and 768P. */
export function miniMaxVideoResolution(model: string, resolution: string | undefined): string {
    const base = model === 'MiniMax-H3';
    if (base) return resolution === '1080p' || resolution === '4k' ? '2K' : '768P';
    return resolution === '480p' ? '480P' : '768P';
}

/** v2's ratios; a first frame sets its own. */
const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

export function miniMaxVideoBody(model: string, prompt: string, video: { seconds?: number; aspect?: string; resolution?: string } = {}, firstFrame?: { mimeType: string; bytes: Buffer }): Record<string, unknown> {
    const min = model === 'MiniMax-H3-Max' ? 5 : 4;
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    if (firstFrame) content.push({ type: 'image_url', image_url: { url: `data:${firstFrame.mimeType};base64,${firstFrame.bytes.toString('base64')}` }, role: 'first_frame' });
    return {
        model,
        content,
        resolution: miniMaxVideoResolution(model, video.resolution),
        duration: Math.min(15, Math.max(min, Math.round(video.seconds ?? 6))),
        ratio: firstFrame ? 'adaptive' : RATIOS.includes(video.aspect ?? '') ? video.aspect : '16:9',
    };
}

/** v2's error body, `{ type: 'error', error: { message: '... (1004)', http_code } }`, as a status code and message. */
function v2Error(json: Record<string, unknown> | null): { code: number; message: string } {
    const err = (json?.['error'] ?? {}) as Record<string, unknown>;
    const message = shortMessage(err['message'] ?? '');
    const code = Number(/\((\d{3,6})\)\s*$/.exec(String(err['message'] ?? ''))?.[1] ?? 0);
    return { code, message };
}

/** A v2 answer that is not a success, in the connectors' words. */
export function readMiniMaxV2Error(status: number, json: Record<string, unknown> | null): Exclude<FileResult, { ok: true }> {
    const { code, message } = v2Error(json);
    const known = code ? readMiniMaxStatus(code, message) : null;
    if (known) return known;
    if (status === 401) return { ok: false, failure: 'key-refused', detail: `MiniMax refused the key (401): ${message}` };
    if (status === 402) return { ok: false, failure: 'off', detail: `MiniMax says the account has no balance left: ${message}`, outOfCredit: true };
    if (status === 422) return { ok: false, failure: 'blocked', detail: `MiniMax would not make this video: ${message}` };
    if (status === 429 || status === 529 || status >= 500) return { ok: false, failure: 'unavailable', detail: `MiniMax answered ${status}: ${message}`, rateLimited: status === 429 };
    return { ok: false, failure: 'unreadable', detail: `MiniMax refused the request (${status}): ${message}` };
}

export const miniMaxVideoStart: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    const frame = request.parts.find((p) => p.kind === 'picture');
    const firstFrame = frame && frame.kind === 'picture' ? { mimeType: frame.mimeType, bytes: frame.bytes } : undefined;
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${new URL(base).origin}/v2/video_generation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(miniMaxVideoBody(request.model, request.prompt, request.video, firstFrame)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    if (answer.status < 200 || answer.status >= 300) return readMiniMaxV2Error(answer.status, answer.json);
    const id = answer.json?.['task_id'];
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id)) return { ok: false, failure: 'unreadable', detail: 'MiniMax started no video task' };
    return { ok: 'pending', operation: String(id) };
};

export const miniMaxVideoCheck: JobChecker = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { state: 'failed', failure: 'off', detail: `connection ${connection.id} has no address or key` };
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${new URL(base).origin}/v2/query/video_generation/${encodeURIComponent(request.operation)}`, { headers: { [auth.header]: `${auth.prefix}${key}` } }, request.timeoutMs, SERVICE);
    if (!answer.ok) return { state: 'running' };
    if (answer.status < 200 || answer.status >= 300) {
        const failed = readMiniMaxV2Error(answer.status, answer.json);
        return failed.failure === 'unavailable' ? { state: 'running' } : { state: 'failed', ...failed };
    }
    const task = (answer.json?.['task'] ?? {}) as Record<string, unknown>;
    const status = String(task['status'] ?? '');
    if (status === 'queued' || status === 'running' || status === '') return { state: 'running' };
    if (status === 'failed' || status === 'cancelled') {
        const err = (task['error'] ?? {}) as Record<string, unknown>;
        const known = readMiniMaxStatus(Number(err['code'] ?? 0) || -1, shortMessage(err['message'] ?? status));
        return { state: 'failed', ...(known ?? { ok: false, failure: 'unreadable', detail: `MiniMax's task ${status}` }) };
    }
    const url = httpsUrl(((task['content'] ?? {}) as Record<string, unknown>)['url']);
    if (!url) return { state: 'failed', failure: 'unreadable', detail: 'MiniMax finished the task with no video' };
    const usage = (task['usage'] ?? {}) as Record<string, unknown>;
    const seconds = Number(usage['output_seconds'] ?? task['duration']);
    return { state: 'done', files: [{ url, mimeType: 'video/mp4', ...(seconds > 0 ? { seconds } : {}) }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, ...(seconds > 0 ? { amount: seconds } : {}) } };
};

/** Each kind MiniMax makes, by the call's kind. */
const miniMaxMake: FileConnector = async (context, request) => {
    if (request.kind === 'image') return miniMaxImages(context, request);
    if (request.kind === 'video') return miniMaxVideoStart(context, request);
    return miniMaxSpeech(context, request);
};

export const miniMaxProvider: FileProvider = { make: miniMaxMake, voices: miniMaxVoices, check: miniMaxVideoCheck };
