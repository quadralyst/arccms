/**
 * Kling video (specs/ai-media-spec.md, AM-D7, AM-D12, section 6.4): Kling's current API
 * standard at `api-singapore.klingai.com` with one API key (`Authorization: Bearer`), never
 * the legacy access-key pair. `POST /text-to-video/{model}` or, with a first frame,
 * `POST /image-to-video/{model}` starts a task; `GET /tasks?task_ids=` says how it is doing;
 * a finished task gives the video's address (kept 30 days, fetched at once from Kling's own
 * hosts, never with the key) and `billing[]`, what it was charged, which Arc uses as the
 * cost when it is in USD. Kling answers out-of-credit with HTTP 429 and its own code, so the
 * code is read before the status. Written from Kling's docs as read on 2026-11-02 and not
 * tested live (AM-D34).
 */
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { AiVideoSettings } from '../types.js';
import { sendRequest, shortMessage } from './http.js';
import type { FileConnector, FileProvider, FileResult, JobChecker, JobCheckResult } from './types.js';

const SERVICE = 'Kling';

/** Kling's resolution for Arc's: 480p is not made, so 720p; 4k only on 3.0. */
export function klingResolution(model: string, resolution: AiVideoSettings['resolution']): string {
    if (resolution === '4k' && /3\.0/.test(model)) return '4k';
    return resolution === '1080p' || resolution === '4k' ? '1080p' : '720p';
}

export function klingBody(model: string, prompt: string, video: AiVideoSettings = {}, firstFrame?: { mimeType: string; bytes: Buffer }): Record<string, unknown> {
    const settings: Record<string, unknown> = { resolution: klingResolution(model, video.resolution), duration: Math.round(video.seconds ?? 5) };
    // Kling 4.0 always makes sound; 3.0 makes it only when asked.
    if (/3\.0/.test(model)) {
        settings['audio'] = video.sound ? 'native' : 'off';
        settings['multi_shot'] = false;
    }
    if (!firstFrame) settings['aspect_ratio'] = video.aspect ?? '16:9';
    const options = { watermark_info: { enabled: false } };
    if (firstFrame) {
        return { contents: [{ type: 'prompt', text: prompt }, { type: 'first_frame', url: firstFrame.bytes.toString('base64') }], settings, options };
    }
    return { prompt, settings, options };
}

/** An error answer in the connectors' words, by Kling's own code first (out of credit comes as 429). */
export function readKlingError(status: number, json: Record<string, unknown> | null): Exclude<FileResult, { ok: true }> | null {
    const code = Number(json?.['code'] ?? 0);
    if (status >= 200 && status < 300 && code === 0) return null;
    const detail = `Kling said ${code || status}: ${shortMessage(json?.['message'] ?? json ?? '')}`;
    if (code === 1101 || code === 1102) return { ok: false, failure: 'off', detail: `Kling says the account has no credit or resource pack left. ${detail}`, outOfCredit: true };
    if (code === 1100) return { ok: false, failure: 'off', detail: `Kling says the account is not in good standing. ${detail}` };
    if (code >= 1000 && code <= 1004) return { ok: false, failure: 'key-refused', detail };
    if (code === 1103) return { ok: false, failure: 'off', detail: `Kling's key may not use this model. ${detail}` };
    if (code === 1300 || code === 1301) return { ok: false, failure: 'blocked', detail };
    if (code === 1302 || code === 1303) return { ok: false, failure: 'unavailable', detail, rateLimited: true };
    if (code === 1304) return { ok: false, failure: 'off', detail: `Kling refused this server's address (its IP allow-list). ${detail}` };
    if (code === 1202 || code === 1203 || status === 404) return { ok: false, failure: 'retired', detail };
    if (code === 5002) return { ok: false, failure: 'timeout', detail };
    if (status === 401) return { ok: false, failure: 'key-refused', detail };
    if (status === 429 || status >= 500 || code >= 5000) return { ok: false, failure: 'unavailable', detail, rateLimited: status === 429 };
    return { ok: false, failure: 'unreadable', detail };
}

/** A task's own state, from Kling's task object, in the connectors' words. */
export function readKlingTask(task: Record<string, unknown>): JobCheckResult {
    const status = String(task['status'] ?? '');
    if (status === 'submitted' || status === 'processing' || status === '') return { state: 'running' };
    if (status === 'failed') {
        const message = shortMessage(task['message'] ?? 'no reason given');
        const blocked = /safety|sensitive|policy|risk|violat|inappropriate/i.test(message);
        return { state: 'failed', failure: blocked ? 'blocked' : 'unreadable', detail: `Kling's task failed: ${message}` };
    }
    if (status !== 'succeeded') return { state: 'failed', failure: 'unreadable', detail: `Kling answered an unknown state: ${shortMessage(status)}` };
    const outputs = Array.isArray(task['outputs']) ? (task['outputs'] as Array<Record<string, unknown>>) : [];
    const files = outputs
        .filter((o) => (o['type'] ?? 'video') === 'video' && typeof o['url'] === 'string')
        .map((o) => ({ url: String(o['url']), mimeType: 'video/mp4', ...(Number(o['duration']) > 0 ? { seconds: Number(o['duration']) } : {}) }));
    if (!files.length) return { state: 'failed', failure: 'unreadable', detail: 'Kling finished the task with no video' };
    // What the task was charged, which Arc uses as the cost when Kling bills in USD (AM-D6).
    const billing = Array.isArray(task['billing']) ? (task['billing'] as Array<Record<string, unknown>>) : [];
    const usd = billing.every((b) => String(b['currency'] ?? '').toUpperCase() === 'USD') && billing.length
        ? billing.reduce((sum, b) => sum + (Number(b['amount']) || 0), 0)
        : undefined;
    const seconds = files.reduce((n, f) => n + (f.seconds ?? 0), 0);
    return { state: 'done', files, usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, ...(seconds ? { amount: seconds } : {}), ...(usd !== undefined ? { costUsd: usd } : {}) } };
}

function headers(connection: Parameters<FileConnector>[0]['connection'], key: string): Record<string, string> {
    const auth = connectionAuth(connection);
    return { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` };
}

export const klingStart: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'video') return { ok: false, failure: 'off', detail: `Arc makes no ${request.kind} with Kling` };
    if (!/^[a-z0-9.-]{1,40}$/.test(request.model)) return { ok: false, failure: 'retired', detail: `"${request.model}" is not a Kling model` };
    const frame = request.parts.find((p) => p.kind === 'picture');
    const firstFrame = frame && frame.kind === 'picture' ? { mimeType: frame.mimeType, bytes: frame.bytes } : undefined;
    const answer = await sendRequest(`${base}/${firstFrame ? 'image' : 'text'}-to-video/${request.model}`, {
        method: 'POST',
        headers: headers(connection, key),
        body: JSON.stringify(klingBody(request.model, request.prompt, request.video, firstFrame)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    const failed = readKlingError(answer.status, answer.json);
    const requestId = typeof answer.json?.['request_id'] === 'string' ? answer.json['request_id'] : undefined;
    if (failed) return { ...failed, requestId };
    const id = (answer.json?.['data'] as Record<string, unknown> | undefined)?.['id'];
    if (typeof id !== 'string' || !id) return { ok: false, failure: 'unreadable', detail: 'Kling started no task', requestId };
    return { ok: 'pending', operation: id, requestId };
};

export const klingCheck: JobChecker = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { state: 'failed', failure: 'off', detail: `connection ${connection.id} has no address or key` };
    const answer = await sendRequest(`${base}/tasks?task_ids=${encodeURIComponent(request.operation)}`, { headers: headers(connection, key) }, request.timeoutMs, SERVICE);
    // A check that could not be made is tried again on the next one.
    if (!answer.ok) return { state: 'running' };
    const failed = readKlingError(answer.status, answer.json);
    if (failed) return failed.failure === 'unavailable' || failed.failure === 'timeout' ? { state: 'running' } : { state: 'failed', ...failed };
    const data = answer.json?.['data'];
    const list = Array.isArray(data) ? data : Array.isArray((data as Record<string, unknown>)?.['result']) ? ((data as Record<string, unknown>)['result'] as unknown[]) : data ? [data] : [];
    const task = (list as Array<Record<string, unknown>>).find((t) => t['id'] === request.operation);
    if (!task) return { state: 'failed', failure: 'unreadable', detail: 'Kling no longer knows this task' };
    return readKlingTask(task);
};

export const klingProvider: FileProvider = { make: klingStart, check: klingCheck };
