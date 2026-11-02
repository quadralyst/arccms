/**
 * OpenAI pictures (specs/ai-media-spec.md, AM-D7, section 6.3): `POST /v1/images/generations`
 * for a new picture and `POST /v1/images/edits` with the picture to change, on OpenAI's own
 * presets only. Answers are always base64, so nothing is fetched from another host. The
 * gpt-image-2 family takes a custom size (multiples of 16, at most 3840 a side, between 1:3
 * and 3:1); the mini takes the three fixed sizes. Written from OpenAI's docs as read on
 * 2026-11-02 and not tested live (AM-D34): the edits body is sent as JSON with `images`, the
 * shape its reference shows.
 */
import { madePicture } from '../images.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import { pictureSize } from '../standins.js';
import type { AiImageSettings } from '../types.js';
import { errorText, outOfCreditError, waitFrom } from './openai.js';
import { sendRequest } from './http.js';
import type { AttemptUsage, FileConnector, FileResult, MadeFile } from './types.js';

const SERVICE = 'OpenAI';
/** The models that take any size; the others take only the three fixed ones. */
const CUSTOM_SIZE = /^gpt-image-2/;
const MAX_EDGE = 3840;
const MIN_PIXELS = 655_360;

/** The size OpenAI is asked for: the fitted shape at the asked resolution, as it takes sizes. */
export function openAiImageSize(model: string, image: AiImageSettings = {}): string {
    const aspect = image.aspect ?? '1:1';
    if (!CUSTOM_SIZE.test(model)) {
        if (aspect === '1:1') return '1024x1024';
        const [w, h] = aspect.split(':').map(Number);
        return w > h ? '1536x1024' : '1024x1536';
    }
    let { width, height } = pictureSize({ aspect, resolution: image.resolution });
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    width *= scale;
    height *= scale;
    // Below its least size, the picture grows to it.
    const grow = Math.max(1, Math.sqrt(MIN_PIXELS / (width * height)));
    const round16 = (n: number) => Math.max(16, Math.round((n * grow) / 16) * 16);
    return `${Math.min(MAX_EDGE, round16(width))}x${Math.min(MAX_EDGE, round16(height))}`;
}

/** The request body; an edit carries the pictures as data URLs. */
export function openAiImageBody(model: string, prompt: string, image: AiImageSettings = {}, pictures: Array<{ mimeType: string; bytes: Buffer }> = []): Record<string, unknown> {
    const body: Record<string, unknown> = { model, prompt, n: image.count ?? 1, size: openAiImageSize(model, image) };
    if (image.quality) body['quality'] = image.quality;
    const format = image.format ?? 'png';
    body['output_format'] = format;
    if (format !== 'png') body['output_compression'] = 90;
    if (pictures.length) body['images'] = pictures.map((p) => ({ image_url: `data:${p.mimeType};base64,${p.bytes.toString('base64')}` }));
    return body;
}

function usageOf(data: Record<string, unknown>): AttemptUsage {
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { tokensIn: n(u['input_tokens']), tokensOut: n(u['output_tokens']), tokensThinking: 0 };
}

/** One HTTP answer in the connectors' words. */
export function readOpenAiImages(status: number, headers: Headers, json: Record<string, unknown> | null, format: 'png' | 'jpeg' | 'webp'): FileResult {
    const data = json ?? {};
    const requestId = headers.get('x-request-id') ?? undefined;
    if (status >= 200 && status < 300) {
        const items = Array.isArray(data['data']) ? (data['data'] as Array<Record<string, unknown>>) : [];
        const files: MadeFile[] = items
            .flatMap((i) => (typeof i['b64_json'] === 'string' ? [Buffer.from(i['b64_json'], 'base64')] : []))
            .filter((b) => b.length > 0)
            .map((bytes) => madePicture(bytes, `image/${format}`));
        if (!files.length) return { ok: false, failure: 'unreadable', detail: 'OpenAI answered with no picture', usage: usageOf(data), requestId };
        return { ok: true, files, usage: usageOf(data), requestId };
    }
    const err = (data['error'] ?? {}) as Record<string, unknown>;
    const code = String(err['code'] ?? err['type'] ?? '').toLowerCase();
    const detail = errorText(data);
    if (code === 'moderation_blocked' || /safety|moderation|content[_ ]policy/i.test(`${code} ${detail}`)) return { ok: false, failure: 'blocked', detail: `OpenAI would not make this picture: ${detail}`, requestId };
    if (status === 401 || status === 403) return { ok: false, failure: 'key-refused', detail: `OpenAI refused the key (${status}): ${detail}`, requestId };
    if (status === 402 || outOfCreditError(data)) return { ok: false, failure: 'off', detail: `OpenAI says the account has no credit (${status}): ${detail}`, outOfCredit: true, requestId };
    if (status === 404 || /model/i.test(code) || /model[^.]*(not found|does not exist|retired|deprecated)/i.test(detail)) return { ok: false, failure: 'retired', detail: `OpenAI has no such model (${status}): ${detail}`, requestId };
    if (status === 429) return { ok: false, failure: 'unavailable', detail: `OpenAI is busy (429): ${detail}`, wait: waitFrom(headers), rateLimited: true, requestId };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `OpenAI answered ${status}: ${detail}`, wait: waitFrom(headers), requestId };
    if (status === 413 || /too large|too long|maximum/i.test(detail)) return { ok: false, failure: 'too-large', detail, requestId };
    return { ok: false, failure: 'unreadable', detail: `OpenAI refused the request (${status}): ${detail}`, requestId };
}

export const openAiImages: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'image') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with OpenAI` };
    const pictures = request.parts.flatMap((p) => (p.kind === 'picture' ? [{ mimeType: p.mimeType, bytes: p.bytes }] : []));
    const format = request.image?.format ?? 'png';
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/images/${pictures.length ? 'edits' : 'generations'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(openAiImageBody(request.model, request.prompt, request.image, pictures)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    return readOpenAiImages(answer.status, answer.headers, answer.json, format);
};

export const openAiFileProvider = { make: openAiImages };
