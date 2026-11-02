/**
 * Alibaba Cloud's own picture address, DashScope, on the Alibaba EU connection
 * (specs/ai-media-spec.md, AM-D7, section 6.3): Qwen-Image through `POST
 * /api/v1/services/aigc/multimodal-generation/generation` at the connection's Frankfurt
 * workspace, with the same key as its chat models. It answers at once with each picture's
 * signed address, kept 24 hours, which Arc fetches straight away from Alibaba's storage
 * (never with the key). Frankfurt serves pictures under its Global scope only, and wan2.6-t2i
 * there only as a background job, so Arc offers the Qwen-Image models. Written from Alibaba's
 * docs as read on 2026-11-02 and not tested live (AM-D34).
 */
import { madePicture } from '../images.js';
import { findPreset } from '../presets.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiImageSettings } from '../types.js';
import { downloadFile, sendRequest, shortMessage } from './http.js';
import type { FileConnector, FileProvider, FileResult, MadeFile } from './types.js';

const SERVICE = 'Alibaba Cloud Model Studio';

/** Qwen-Image's sizes by shape: about 1.7 MP standard; the 3.0 Pro makes about 4 MP. */
const SIZES: Record<string, { standard: string; high: string }> = {
    '1:1': { standard: '1328*1328', high: '2048*2048' },
    '16:9': { standard: '1664*928', high: '2688*1536' },
    '9:16': { standard: '928*1664', high: '1536*2688' },
    '4:3': { standard: '1472*1104', high: '2304*1728' },
    '3:4': { standard: '1104*1472', high: '1728*2304' },
};

export function dashScopeSize(image: AiImageSettings = {}): string {
    const sizes = SIZES[image.aspect ?? '1:1'] ?? SIZES['1:1'];
    return image.resolution === 'high' ? sizes.high : sizes.standard;
}

/** The request body: one user message, the pictures to change before the text. */
export function dashScopeBody(model: string, prompt: string, image: AiImageSettings = {}, pictures: Array<{ mimeType: string; bytes: Buffer }> = []): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = pictures.map((p) => ({ image: `data:${p.mimeType};base64,${p.bytes.toString('base64')}` }));
    content.push({ text: prompt });
    const parameters: Record<string, unknown> = { size: dashScopeSize(image), n: Math.min(4, Math.max(1, image.count ?? 1)), watermark: false, prompt_extend: false };
    if (image.seed !== undefined) parameters['seed'] = Math.abs(image.seed) % 2_147_483_648;
    if (image.negativePrompt) parameters['negative_prompt'] = image.negativePrompt.slice(0, 500);
    return { model, input: { messages: [{ role: 'user', content }] }, parameters };
}

/** An HTTP answer that holds no pictures, in the connectors' words; null when it holds some. */
export function readDashScopeError(status: number, json: Record<string, unknown> | null): Exclude<FileResult, { ok: true }> | null {
    const code = String(json?.['code'] ?? '');
    const message = shortMessage(json?.['message'] ?? json ?? '');
    const detail = `${SERVICE} said ${code || status}: ${message}`;
    if (status >= 200 && status < 300 && !code) return null;
    if (code === 'DataInspectionFailed' || code === 'data_inspection_failed' || code === 'IPInfringementSuspect' || code.startsWith('InvalidParameter.DataInspection')) return { ok: false, failure: 'blocked', detail };
    if (code === 'Arrearage' || code === 'AllocationQuota.FreeTierOnly') return { ok: false, failure: 'off', detail: `${SERVICE} says the account has no credit. ${detail}`, outOfCredit: true };
    if (status === 401 || code === 'InvalidApiKey') return { ok: false, failure: 'key-refused', detail };
    if (status === 403 || code.startsWith('AccessDenied') || code === 'Model.AccessDenied') return { ok: false, failure: 'off', detail: `${SERVICE} refused this model for the workspace: ${detail}` };
    if (status === 404 || code === 'ModelNotFound') return { ok: false, failure: 'retired', detail };
    if (status === 429 || code.startsWith('Throttling')) return { ok: false, failure: 'unavailable', detail, rateLimited: true };
    if (status >= 500 || code === 'InternalError' || code.startsWith('InternalError')) return { ok: false, failure: 'unavailable', detail };
    if (code.startsWith('InvalidFile')) return { ok: false, failure: 'too-large', detail };
    return { ok: false, failure: 'unreadable', detail };
}

/** The pictures' addresses in a sync answer. */
export function dashScopeImageUrls(json: Record<string, unknown> | null): string[] {
    const output = (json?.['output'] ?? {}) as Record<string, unknown>;
    const choices = Array.isArray(output['choices']) ? (output['choices'] as Array<Record<string, unknown>>) : [];
    return choices.flatMap((c) => {
        const content = ((c['message'] ?? {}) as Record<string, unknown>)['content'];
        return (Array.isArray(content) ? (content as Array<Record<string, unknown>>) : []).map((i) => i['image']).filter((u): u is string => typeof u === 'string' && !!u);
    });
}

export const dashScopeImages: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no workspace address` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'image') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with ${SERVICE}` };
    const started = Date.now();
    const auth = connectionAuth(connection);
    const pictures = request.parts.flatMap((p) => (p.kind === 'picture' ? [{ mimeType: p.mimeType, bytes: p.bytes }] : []));
    const answer = await sendRequest(`${new URL(base).origin}/api/v1/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(dashScopeBody(request.model, request.prompt, request.image, pictures)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    const failed = readDashScopeError(answer.status, answer.json);
    const requestId = typeof answer.json?.['request_id'] === 'string' ? answer.json['request_id'] : undefined;
    if (failed) return { ...failed, requestId };
    const urls = dashScopeImageUrls(answer.json);
    if (!urls.length) return { ok: false, failure: 'unreadable', detail: `${SERVICE} answered with no picture`, requestId };
    const hosts = findPreset(connection.preset)?.downloadHosts ?? [];
    const left = Math.max(1000, request.timeoutMs - (Date.now() - started));
    const fetched = await Promise.all(urls.map((u) => downloadFile(u, hosts, left, SERVICE, 30 * 1024 * 1024)));
    const files: MadeFile[] = fetched.flatMap((f) => (f.ok ? [madePicture(f.bytes, f.contentType || 'image/png')] : []));
    if (!files.length) {
        const first = fetched.find((f) => !f.ok) as Extract<(typeof fetched)[number], { ok: false }>;
        // Made and billed, but not fetched: the attempt counts its pictures as made.
        return { ok: false, failure: first.failure, detail: first.detail, usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: urls.length }, requestId };
    }
    // Alibaba bills each picture it made, fetched or not.
    return { ok: true, files, usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: urls.length }, requestId };
};

export const dashScopeProvider: FileProvider = { make: dashScopeImages };
