/**
 * Gemini Omni Flash video on the Gemini API (specs/ai-media-spec.md, AM-D7, AM-D12, section
 * 6.4): `POST /interactions` with `response_format: { type: 'video' }` and `background: true`,
 * then `GET /interactions/{id}` until it ends, which answers the video inline as base64.
 * Google's docs do not confirm that Omni runs in the background: when the start answers with
 * the video already made, it is still a job, which the next check ends. 480p is asked as Omni's 360p; sound is always
 * on; it bills tokens ($17.50 per million video tokens, about $0.10 a second at 720p). Written
 * from Google's docs as read on 2026-11-02 and not tested live (AM-D34).
 */
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiVideoSettings } from '../types.js';
import { sendRequest, shortMessage } from './http.js';
import type { AttemptUsage, FileConnector, FileResult, JobChecker, JobCheckResult } from './types.js';

const SERVICE = 'The Gemini API';
const BLOCKS = /^(safety|prohibited_content|content_blocked|blocklist|spii|recitation|language|image_safety|image_prohibited_content|image_recitation|image_other)$/;

export function omniBody(model: string, prompt: string, video: AiVideoSettings = {}, firstFrame?: { mimeType: string; bytes: Buffer }): Record<string, unknown> {
    const input: Array<Record<string, unknown>> = [];
    if (firstFrame) input.push({ type: 'image', mime_type: firstFrame.mimeType, data: firstFrame.bytes.toString('base64') });
    input.push({ type: 'text', text: prompt });
    return {
        model,
        input,
        response_format: { type: 'video', aspect_ratio: video.aspect === '9:16' ? '9:16' : '16:9', resolution: video.resolution === '480p' ? '360p' : video.resolution ?? '720p' },
        ...(firstFrame ? { generation_config: { video_config: { task: 'image_to_video' } } } : {}),
        background: true,
        store: true,
    };
}

function usageOf(data: Record<string, unknown>): AttemptUsage {
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { tokensIn: n(u['total_input_tokens']), tokensOut: n(u['total_output_tokens']) + n(u['total_thought_tokens']), tokensThinking: n(u['total_thought_tokens']) };
}

/** An error of the Interactions API (an HTTP error or a failed interaction) in the connectors' words. */
export function readOmniError(status: number, data: Record<string, unknown>): Exclude<FileResult, { ok: true }> | null {
    const errors = [((data['error'] ?? null) as Record<string, unknown> | null), ...((Array.isArray(data['errors']) ? data['errors'] : []) as Array<Record<string, unknown>>)].filter((e): e is Record<string, unknown> => !!e);
    const code = String(errors[0]?.['code'] ?? errors[0]?.['status'] ?? '').toLowerCase();
    const message = shortMessage(errors[0]?.['message'] ?? '');
    const failedState = data['status'] === 'failed' || data['status'] === 'cancelled' || data['status'] === 'incomplete';
    if (status >= 200 && status < 300 && !failedState) return null;
    if (BLOCKS.test(code)) return { ok: false, failure: 'blocked', detail: `the Gemini API would not make this video (${code}): ${message}` };
    if (status === 401 || code === 'authentication' || /API_KEY_INVALID|API key not valid/i.test(message)) return { ok: false, failure: 'key-refused', detail: `the Gemini API refused the key (${status}): ${message}` };
    if (status === 402 || code === 'payment_required') return { ok: false, failure: 'off', detail: `the Gemini API says the prepaid credit is used up: ${message}`, outOfCredit: true };
    if (status === 403 || code === 'permission_denied') return { ok: false, failure: 'key-refused', detail: `the Gemini API refused the key (${status}): ${message}` };
    if (status === 404 || code === 'model_not_found') return { ok: false, failure: 'retired', detail: `the Gemini API has no such video model: ${message}` };
    if (status === 429 || /rate_limit|too_many|quota|resource_exhausted/.test(code)) return { ok: false, failure: 'unavailable', detail: `the Gemini API is busy (${code || 429}): ${message}`, rateLimited: code !== 'quota_exceeded' };
    if (status === 504 || code === 'deadline_exceeded') return { ok: false, failure: 'timeout', detail: message };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail: `the Gemini API answered ${status}: ${message}` };
    if (failedState) return { ok: false, failure: 'unreadable', detail: `the Gemini API's video ${String(data['status'])} (${code || 'no code'}): ${message}` };
    return { ok: false, failure: 'unreadable', detail: `the Gemini API refused the request (${status}): ${message}` };
}

/** A finished interaction's video, inline as base64. */
export function omniVideo(data: Record<string, unknown>): JobCheckResult {
    const steps = Array.isArray(data['steps']) ? (data['steps'] as Array<Record<string, unknown>>) : [];
    const item = steps.filter((s) => s['type'] === 'model_output')
        .flatMap((s) => (Array.isArray(s['content']) ? (s['content'] as Array<Record<string, unknown>>) : []))
        .find((c) => c['type'] === 'video' && typeof c['data'] === 'string');
    if (!item) return { state: 'failed', failure: 'unreadable', detail: 'the Gemini API finished with no video' };
    return { state: 'done', files: [{ bytes: Buffer.from(String(item['data']), 'base64'), mimeType: String(item['mime_type'] ?? 'video/mp4') }], usage: usageOf(data) };
}

export const omniStart: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    const frame = request.parts.find((p) => p.kind === 'picture');
    const firstFrame = frame && frame.kind === 'picture' ? { mimeType: frame.mimeType, bytes: frame.bytes } : undefined;
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
        body: JSON.stringify(omniBody(request.model, request.prompt, request.video, firstFrame)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    const data = answer.json ?? {};
    const failed = readOmniError(answer.status, data);
    if (failed) return failed;
    // Made at once when Omni did not run it in the background: it still goes through a job, so
    // the purpose's onJobDone and a page listening to the job hear of it; the next check reads
    // the finished interaction.
    const id = data['id'];
    if (typeof id !== 'string' || !id) return { ok: false, failure: 'unreadable', detail: 'the Gemini API started no interaction' };
    return { ok: 'pending', operation: id };
};

export const omniCheck: JobChecker = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { state: 'failed', failure: 'off', detail: `connection ${connection.id} has no address or key` };
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(request.operation)) return { state: 'failed', failure: 'unreadable', detail: 'the job has no interaction id' };
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/interactions/${request.operation}`, { headers: { [auth.header]: `${auth.prefix}${key}` } }, request.timeoutMs, SERVICE);
    if (!answer.ok) return { state: 'running' };
    const data = answer.json ?? {};
    const failed = readOmniError(answer.status, data);
    if (failed) return failed.failure === 'unavailable' || failed.failure === 'timeout' ? { state: 'running' } : { state: 'failed', ...failed };
    if (data['status'] !== 'completed') return { state: 'running' };
    return omniVideo(data);
};
