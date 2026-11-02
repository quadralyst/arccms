/**
 * Google's Gemini picture models (specs/ai-media-spec.md, AM-D7, section 6.3): one picture a
 * request, sent as many times at once as pictures are asked for, 1K for standard and 2K for
 * high. On the Gemini API with its key through the Interactions API (`POST /interactions` with
 * `response_format: { type: 'image' }`), the only shape Google's guide shows for pictures; on
 * Vertex with the functions' service account through `generateContent` with `imageConfig` at
 * Vertex's global address, where Google serves these models (Vertex has no Interactions API
 * for them). Answers are base64 inline. Every picture carries Google's SynthID mark (AM-D29).
 * Written from Google's docs as read on 2026-11-02 and not tested live (AM-D34): how the
 * Interactions API reports a blocked picture (an HTTP error, or `status: failed` with
 * `errors`) is not in its docs, so both are read.
 */
import { madePicture } from '../images.js';
import type { PreparedPart } from '../input.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiImageSettings } from '../types.js';
import { sendRequest, shortMessage } from './http.js';
import type { AttemptUsage, FileConnector, FileRequest, FileResult, MadeFile } from './types.js';
import { googleAccessToken, projectId } from './vertex.js';

/** What makes a picture not come: Google's finish reasons for a block. */
const BLOCKED = ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_RECITATION', 'IMAGE_OTHER', 'MODEL_ARMOR'];

/** The request body for one picture. */
export function geminiImageBody(prompt: string, image: AiImageSettings = {}, pictures: PreparedPart[] = []): Record<string, unknown> {
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    for (const p of pictures) if (p.kind === 'picture') parts.push({ inlineData: { mimeType: p.mimeType, data: p.bytes.toString('base64') } });
    return {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: image.aspect ?? '1:1', imageSize: image.resolution === 'high' ? '2K' : '1K' },
        },
    };
}

function usageOf(data: Record<string, unknown>): AttemptUsage {
    const u = (data['usageMetadata'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { tokensIn: n(u['promptTokenCount']), tokensOut: n(u['candidatesTokenCount']) + n(u['thoughtsTokenCount']), tokensThinking: n(u['thoughtsTokenCount']) };
}

/** One Vertex generateContent answer in the connectors' words: its picture, or why there is none. */
export function readGeminiImage(status: number, json: Record<string, unknown> | null, service: string): FileResult {
    const data = json ?? {};
    if (status < 200 || status >= 300) {
        const err = (data['error'] ?? {}) as Record<string, unknown>;
        const message = shortMessage(err['message'] ?? data);
        if (status === 401 || status === 403) return { ok: false, failure: 'off', detail: `Vertex AI refused the project's service account (${status}): switch on the Vertex AI API and give it the Vertex AI User role. ${message}` };
        if (status === 404) return { ok: false, failure: 'retired', detail: `${service} has no such picture model here (404): ${message}` };
        if (status === 429) return { ok: false, failure: 'unavailable', detail: `${service} is busy (429): ${message}`, rateLimited: true };
        if (status >= 500) return { ok: false, failure: 'unavailable', detail: `${service} answered ${status}: ${message}` };
        if (/safety|blocked|prohibited/i.test(message)) return { ok: false, failure: 'blocked', detail: message };
        return { ok: false, failure: 'unreadable', detail: `${service} refused the request (${status}): ${message}` };
    }
    const usage = usageOf(data);
    const feedback = (data['promptFeedback'] ?? {}) as Record<string, unknown>;
    if (feedback['blockReason']) return { ok: false, failure: 'blocked', detail: `${service} blocked the prompt (${String(feedback['blockReason'])})`, usage };
    const candidate = ((data['candidates'] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
    const finish = String(candidate?.['finishReason'] ?? '');
    if (BLOCKED.includes(finish)) return { ok: false, failure: 'blocked', detail: `${service} would not make this picture (${finish})`, usage };
    const parts = (((candidate?.['content'] ?? {}) as Record<string, unknown>)['parts'] as Array<Record<string, unknown>>) ?? [];
    const inline = parts.map((p) => (p['inlineData'] ?? p['inline_data']) as Record<string, unknown> | undefined).find((d) => typeof d?.['data'] === 'string');
    if (!inline) return { ok: false, failure: 'unreadable', detail: `${service} answered with no picture${finish ? ` (${finish})` : ''}`, usage };
    const bytes = Buffer.from(String(inline['data']), 'base64');
    return { ok: true, files: [madePicture(bytes, String(inline['mimeType'] ?? inline['mime_type'] ?? 'image/png'))], usage, requestId: typeof data['responseId'] === 'string' ? data['responseId'] : undefined };
}

/** Ask for each picture at once and put the answers together: a picture made is kept even when another failed. */
async function manyAtOnce(request: FileRequest, one: () => Promise<FileResult>): Promise<FileResult> {
    const count = Math.min(4, Math.max(1, request.image?.count ?? 1));
    const results = await Promise.all(Array.from({ length: count }, one));
    const made = results.filter((r): r is Extract<FileResult, { ok: true }> => r.ok);
    const usage: AttemptUsage = { tokensIn: 0, tokensOut: 0, tokensThinking: 0 };
    for (const r of results) {
        const u = r.usage;
        if (!u) continue;
        usage.tokensIn += u.tokensIn;
        usage.tokensOut += u.tokensOut;
        usage.tokensThinking += u.tokensThinking;
    }
    if (!made.length) return { ...(results.find((r) => !r.ok) as Exclude<FileResult, { ok: true }>), usage };
    const files: MadeFile[] = made.flatMap((r) => r.files);
    return { ok: true, files, usage, requestId: made[0].requestId };
}

/** The Interactions API's request for one picture. */
export function interactionImageBody(model: string, prompt: string, image: AiImageSettings = {}, pictures: PreparedPart[] = []): Record<string, unknown> {
    const input: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    for (const p of pictures) if (p.kind === 'picture') input.push({ type: 'image', mime_type: p.mimeType, data: p.bytes.toString('base64') });
    return {
        model,
        input,
        response_format: { type: 'image', aspect_ratio: image.aspect ?? '1:1', image_size: image.resolution === 'high' ? '2K' : '1K' },
        store: false,
    };
}

/** Its error codes for a picture its checks refused. */
const INTERACTION_BLOCKS = /^(image_safety|image_prohibited_content|image_recitation|image_other|safety|recitation|prohibited_content|spii|blocklist|content_blocked)$/;

/** One Interactions API answer in the connectors' words. */
export function readInteractionImage(status: number, json: Record<string, unknown> | null): FileResult {
    const data = json ?? {};
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const usage: AttemptUsage = { tokensIn: n(u['total_input_tokens']), tokensOut: n(u['total_output_tokens']) + n(u['total_thought_tokens']), tokensThinking: n(u['total_thought_tokens']) };
    const errors = [((data['error'] ?? null) as Record<string, unknown> | null), ...((Array.isArray(data['errors']) ? data['errors'] : []) as Array<Record<string, unknown>>)].filter((e): e is Record<string, unknown> => !!e);
    const code = String(errors[0]?.['code'] ?? '').toLowerCase();
    const message = shortMessage(errors[0]?.['message'] ?? '');
    if (INTERACTION_BLOCKS.test(code)) return { ok: false, failure: 'blocked', detail: `the Gemini API would not make this picture (${code}): ${message}`, usage };
    if (status === 401 || code === 'authentication' || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(message))) return { ok: false, failure: 'key-refused', detail: `the Gemini API refused the key (${status}): ${message}` };
    if (status === 402 || code === 'payment_required') return { ok: false, failure: 'off', detail: `the Gemini API says the prepaid credit is used up (${status}): ${message}`, outOfCredit: true };
    if (status === 403 || code === 'permission_denied') return { ok: false, failure: 'key-refused', detail: `the Gemini API refused the key (${status}): ${message}` };
    if (status === 404 || code === 'not_found' || code === 'model_not_found') return { ok: false, failure: 'retired', detail: `the Gemini API has no such picture model (${status}): ${message}` };
    if (status === 429 || code === 'rate_limit_exceeded' || code === 'too_many_requests' || code === 'quota_exceeded') return { ok: false, failure: 'unavailable', detail: `the Gemini API is busy (${code || 429}): ${message}`, rateLimited: code !== 'quota_exceeded' };
    if (status === 504 || code === 'deadline_exceeded') return { ok: false, failure: 'timeout', detail: `the Gemini API took too long: ${message}` };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `the Gemini API answered ${status}: ${message}` };
    if (status < 200 || status >= 300) return { ok: false, failure: 'unreadable', detail: `the Gemini API refused the request (${status}): ${message}` };
    if (data['status'] === 'failed' || data['status'] === 'cancelled') return { ok: false, failure: code === 'no_image' ? 'unreadable' : 'unavailable', detail: `the Gemini API gave no picture (${code || String(data['status'])}): ${message}`, usage };
    // The answer's own steps, never a thought's interim picture.
    const steps = Array.isArray(data['steps']) ? (data['steps'] as Array<Record<string, unknown>>) : [];
    const picture = steps.filter((s) => s['type'] === 'model_output')
        .flatMap((s) => (Array.isArray(s['content']) ? (s['content'] as Array<Record<string, unknown>>) : []))
        .find((c) => c['type'] === 'image' && typeof c['data'] === 'string');
    if (!picture) return { ok: false, failure: 'unreadable', detail: 'the Gemini API answered with no picture (no_image)', usage };
    const bytes = Buffer.from(String(picture['data']), 'base64');
    return { ok: true, files: [madePicture(bytes, String(picture['mime_type'] ?? 'image/png'))], usage, requestId: typeof data['id'] === 'string' ? data['id'] : undefined };
}

/** On the Gemini API, with the connection's key, through the Interactions API. */
export const geminiApiImages: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'image') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with the Gemini API yet` };
    const auth = connectionAuth(connection);
    const body = JSON.stringify(interactionImageBody(request.model, request.prompt, request.image, request.parts));
    return manyAtOnce(request, async () => {
        const answer = await sendRequest(`${base}/interactions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
            body,
        }, request.timeoutMs, 'The Gemini API');
        return answer.ok ? readInteractionImage(answer.status, answer.json) : answer;
    });
};

/** On Vertex, with the functions' service account, at the global address. */
export const vertexImages: FileConnector = async (_context, request) => {
    if (request.kind !== 'image') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with Gemini pictures` };
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(request.model)) return { ok: false, failure: 'retired', detail: `"${request.model}" is not a model id` };
    let project: string;
    let token: string;
    try {
        [project, token] = await Promise.all([projectId(), googleAccessToken()]);
    } catch (err) {
        return { ok: false, failure: 'off', detail: `the functions' service account gave no access token: ${String((err as Error).message ?? err).slice(0, 160)}` };
    }
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${request.model}:generateContent`;
    const body = JSON.stringify(geminiImageBody(request.prompt, request.image, request.parts));
    return manyAtOnce(request, async () => {
        const answer = await sendRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body }, request.timeoutMs, 'Vertex AI');
        return answer.ok ? readGeminiImage(answer.status, answer.json, 'Vertex AI') : answer;
    });
};
