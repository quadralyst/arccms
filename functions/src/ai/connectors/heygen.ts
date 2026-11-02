/**
 * HeyGen presenter videos (specs/ai-media-spec.md, AM-D33, section 6.4): an avatar (a "look")
 * speaking the call's script in a voice, or speaking to an audio file, through HeyGen's v3
 * API (its v1 and v2 were retired on 2026-11-01). `POST /v3/videos` starts it, with an
 * idempotency key so a retried start never makes two videos; `GET /v3/videos/{id}` says how it
 * is doing and gives the video's presigned address on HeyGen's file host, fetched at once and
 * never with the key. An audio file goes up first through `POST /v3/assets`. HeyGen rejects a
 * render over its concurrency limit (10 on pay as you go) with 429 rather than queueing it; the
 * connection's At once limits only how many starts are sent together, not renders running, so a
 * start over HeyGen's limit answers busy and the next model tries. Each look speaks in its own
 * default voice. HeyGen reports no cost per
 * video: Arc counts the seconds made at the price list's figure. Written from HeyGen's docs as
 * read on 2026-11-02 and not tested live (AM-D34).
 */
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import { httpsUrl, sendRequest, shortMessage } from './http.js';
import type { AiAvatar, AvatarLister, FileConnector, FileProvider, FileResult, JobChecker } from './types.js';

const SERVICE = 'HeyGen';
const ENGINES: Record<string, string> = { 'avatar-iii': 'avatar_iii', 'avatar-iv': 'avatar_iv', 'avatar-v': 'avatar_v' };

/** HeyGen's error body, `{ error: { code, message } }`, in the connectors' words. */
export function readHeyGenError(status: number, json: Record<string, unknown> | null, headers?: Headers): Exclude<FileResult, { ok: true }> {
    const err = (json?.['error'] ?? {}) as Record<string, unknown>;
    const code = String(err['code'] ?? '');
    const detail = `HeyGen said ${code || status}: ${shortMessage(err['message'] ?? json ?? '')}`;
    if (status === 402 || /insufficient_credit|usage_limit_reached|subscription_required|trial_limit_exceeded|plan_upgrade_required/.test(code)) return { ok: false, failure: 'off', detail: `HeyGen says the account has no credit left. ${detail}`, outOfCredit: true };
    if (status === 401 || code === 'unauthorized') return { ok: false, failure: 'key-refused', detail };
    if (code === 'content_policy_violation' || code === 'avatar_not_usable') return { ok: false, failure: 'blocked', detail };
    if (status === 429) {
        const wait = Number(headers?.get('retry-after'));
        return { ok: false, failure: 'unavailable', detail, rateLimited: code !== 'quota_exceeded', ...(Number.isFinite(wait) && wait > 0 ? { wait: Math.ceil(wait) } : {}) };
    }
    if (status === 404 || code === 'not_found') return { ok: false, failure: 'off', detail: `HeyGen has no such avatar or voice. ${detail}` };
    if (status === 409) return { ok: false, failure: 'unavailable', detail };
    if (status >= 500) return { ok: false, failure: 'unavailable', detail };
    return { ok: false, failure: 'unreadable', detail };
}

/** The request body: the avatar speaking the script, or to an uploaded audio file. */
export function heyGenBody(model: string, avatar: string, script: string, video: { aspect?: string; resolution?: string } = {}, audioAssetId?: string): Record<string, unknown> {
    return {
        type: 'avatar',
        avatar_id: avatar,
        ...(audioAssetId ? { audio_asset_id: audioAssetId } : { script: script.slice(0, 5000) }),
        engine: { type: ENGINES[model] ?? 'avatar_iv' },
        resolution: video.resolution === '1080p' || video.resolution === '4k' ? '1080p' : '720p',
        aspect_ratio: ['16:9', '9:16', '1:1'].includes(video.aspect ?? '') ? video.aspect : '16:9',
        output_format: 'mp4',
    };
}

export const heyGenStart: FileConnector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (request.kind !== 'video' || !request.video?.presenter) return { ok: false, failure: 'off', detail: 'HeyGen makes presenter videos only' };
    if (!request.avatar) return { ok: false, failure: 'off', detail: 'no HeyGen avatar was chosen' };
    const auth = connectionAuth(connection);
    const keyHeader = { [auth.header]: `${auth.prefix}${key}` };
    let assetId: string | undefined;
    if (request.speechFile) {
        // The audio goes up first, as an asset the video refers to.
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(request.speechFile.bytes)], { type: request.speechFile.mimeType }), request.speechFile.mimeType.includes('wav') ? 'speech.wav' : 'speech.mp3');
        const up = await sendRequest(`${base}/assets`, { method: 'POST', headers: keyHeader, body: form }, request.timeoutMs, SERVICE);
        if (!up.ok) return up;
        if (up.status < 200 || up.status >= 300) return readHeyGenError(up.status, up.json, up.headers);
        assetId = String(((up.json?.['data'] ?? {}) as Record<string, unknown>)['asset_id'] ?? '');
        if (!assetId) return { ok: false, failure: 'unreadable', detail: 'HeyGen kept no audio asset' };
    } else if (!request.prompt.trim()) {
        return { ok: false, failure: 'unreadable', detail: 'a presenter video needs a script or an audio file' };
    }
    const answer = await sendRequest(`${base}/videos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...keyHeader, ...(request.jobKey ? { 'idempotency-key': request.jobKey } : {}) },
        body: JSON.stringify(heyGenBody(request.model, request.avatar, request.prompt, request.video, assetId)),
    }, request.timeoutMs, SERVICE);
    if (!answer.ok) return answer;
    const requestId = answer.headers.get('x-heygen-request-id') ?? undefined;
    if (answer.status < 200 || answer.status >= 300) return { ...readHeyGenError(answer.status, answer.json, answer.headers), requestId };
    const id = ((answer.json?.['data'] ?? {}) as Record<string, unknown>)['video_id'];
    if (typeof id !== 'string' || !id) return { ok: false, failure: 'unreadable', detail: 'HeyGen started no video', requestId };
    return { ok: 'pending', operation: id, requestId };
};

export const heyGenCheck: JobChecker = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { state: 'failed', failure: 'off', detail: `connection ${connection.id} has no address or key` };
    const auth = connectionAuth(connection);
    const answer = await sendRequest(`${base}/videos/${encodeURIComponent(request.operation)}`, { headers: { [auth.header]: `${auth.prefix}${key}` } }, request.timeoutMs, SERVICE);
    if (!answer.ok) return { state: 'running' };
    if (answer.status < 200 || answer.status >= 300) {
        const failed = readHeyGenError(answer.status, answer.json, answer.headers);
        return failed.failure === 'unavailable' ? { state: 'running' } : { state: 'failed', ...failed };
    }
    const data = (answer.json?.['data'] ?? {}) as Record<string, unknown>;
    const status = String(data['status'] ?? '');
    if (status === 'failed') {
        const message = shortMessage(data['failure_message'] ?? data['failure_code'] ?? 'no reason given');
        return { state: 'failed', failure: /policy|moderation|content/i.test(message) ? 'blocked' : 'unreadable', detail: `HeyGen's video failed: ${message}` };
    }
    // `waiting`, `pending` and `processing` all mean it is still being made.
    if (status !== 'completed') return { state: 'running' };
    const url = httpsUrl(data['video_url']);
    if (!url) return { state: 'failed', failure: 'unreadable', detail: 'HeyGen finished the video with no address' };
    const seconds = Number(data['duration']);
    return { state: 'done', files: [{ url, mimeType: 'video/mp4', ...(seconds > 0 ? { seconds } : {}) }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, ...(seconds > 0 ? { amount: seconds } : {}) } };
};

/** One look of `GET /v3/avatars/looks` in Arc's words. */
export function heyGenAvatar(raw: Record<string, unknown>): AiAvatar | null {
    const id = typeof raw['id'] === 'string' ? raw['id'] : '';
    if (!id || (raw['status'] !== undefined && raw['status'] !== 'completed')) return null;
    const gender = String(raw['gender'] ?? '').toLowerCase();
    return {
        id,
        name: String(raw['name'] ?? id).slice(0, 80),
        gender: gender === 'female' || gender === 'male' ? gender : null,
        previewUrl: httpsUrl(raw['preview_image_url']),
        voiceId: typeof raw['default_voice_id'] === 'string' ? raw['default_voice_id'] : null,
    };
}

const MAX_PAGES = 10;

export const heyGenAvatars: AvatarLister = async ({ connection, key }, { timeoutMs }) => {
    const base = connectionBaseUrl(connection);
    if (!base || !key) return { ok: false, detail: key ? `connection ${connection.id} has no address` : `connection ${connection.id} has no key` };
    const auth = connectionAuth(connection);
    const avatars: AiAvatar[] = [];
    const deadline = Date.now() + timeoutMs;
    let token = '';
    for (let page = 0; page < MAX_PAGES; page++) {
        const left = deadline - Date.now();
        if (left < 1000) break;
        const answer = await sendRequest(`${base}/avatars/looks?limit=50${token ? `&token=${encodeURIComponent(token)}` : ''}`, { headers: { [auth.header]: `${auth.prefix}${key}` } }, left, SERVICE);
        if (!answer.ok) return avatars.length ? { ok: true, avatars } : { ok: false, detail: answer.detail };
        if (answer.status < 200 || answer.status >= 300) {
            const failed = readHeyGenError(answer.status, answer.json);
            return { ok: false, detail: failed.detail, keyRefused: failed.failure === 'key-refused' };
        }
        const body = answer.json ?? {};
        const data = body['data'];
        const list = Array.isArray(data) ? data : Array.isArray((data as Record<string, unknown>)?.['looks']) ? ((data as Record<string, unknown>)['looks'] as unknown[]) : [];
        avatars.push(...(list as Array<Record<string, unknown>>).map(heyGenAvatar).filter((a): a is AiAvatar => a !== null));
        token = typeof body['next_token'] === 'string' ? body['next_token'] : '';
        if (body['has_more'] !== true || !token) break;
    }
    return { ok: true, avatars };
};

export const heyGenProvider: FileProvider = { make: heyGenStart, check: heyGenCheck, avatars: heyGenAvatars };
