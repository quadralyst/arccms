/**
 * The video connectors of AM4 (specs/ai-media-spec.md, AM-D7, AM-D12, AM-D32, AM-D33, section
 * 6.4): Gemini Omni Flash, Kling, MiniMax H3 and HeyGen presenters, each started and checked
 * against a fake server that answers as the provider's docs say, success and every failure;
 * HeyGen's avatars; the Kling and HeyGen balances; and how Arc fits a video to each model and
 * prices its seconds. None has been called for real (AM-D34).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));
vi.mock('../ai/connectors/vertex.js', () => ({ googleAccessToken: async () => 'ya29.token', projectId: async () => 'proj-1' }));

import { readHeyGenWallet, readKlingPacks } from '../ai/balances.js';
import { omniBody, omniCheck, omniStart } from '../ai/connectors/geminiVideo.js';
import { heyGenAvatars, heyGenBody, heyGenCheck, heyGenStart } from '../ai/connectors/heygen.js';
import { klingBody, klingCheck, klingResolution, klingStart } from '../ai/connectors/kling.js';
import { miniMaxProvider, miniMaxVideoBody, miniMaxVideoResolution } from '../ai/connectors/minimax.js';
import type { FileRequest } from '../ai/connectors/types.js';
import { AI_PRESETS } from '../ai/presets.js';
import { resolveAiSettings } from '../ai/settings.js';
import { fittedVideo, nearestResolution, secondPrice, videoSkip } from '../ai/videos.js';
import { estimateFor } from '../ai/estimate.js';

const settings = resolveAiSettings({
    connections: { gem: { preset: 'gemini-api' }, kl: { preset: 'kling' }, mm: { preset: 'minimax' }, hg: { preset: 'heygen' } },
});
const c = settings.connections;
const MP4 = Buffer.from('fake-mp4-bytes');

function vid(model: string, extra: Partial<FileRequest> = {}): FileRequest {
    return { kind: 'video', model, prompt: 'A marble rolling down a track', parts: [], video: { seconds: 6, aspect: '16:9', resolution: '720p', sound: false }, timeoutMs: 5000, ...extra };
}
const check = (model: string, operation: string) => ({ kind: 'video' as const, model, operation, timeoutMs: 5000 });

type Call = { url: string; init: RequestInit };
type Answer = { status?: number; json?: unknown; headers?: Record<string, string> };
function fakeFetch(...answers: Answer[]): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        const a = answers.shift() ?? { status: 500, json: { error: 'no more answers' } };
        const body = Buffer.from(JSON.stringify(a.json ?? {}));
        return { status: a.status ?? 200, headers: new Headers({ 'content-type': 'application/json', ...(a.headers ?? {}) }), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) } as unknown as Response;
    }));
    return calls;
}
const sent = (call: Call) => JSON.parse(String(call.init.body));
const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];

afterEach(() => vi.unstubAllGlobals());

describe('the video presets', () => {
    it('are long jobs billed by seconds or tokens, marked not tested live, with download hosts', () => {
        const models = Object.entries(AI_PRESETS).flatMap(([id, p]) => Object.entries(p.models).map(([m, k]) => ({ id, m, k }))).filter((x) => x.k.makes === 'video');
        expect(models.map((x) => x.m).sort()).toEqual(['MiniMax-H3', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Lite', 'MiniMax-H3-Max', 'avatar-iii', 'avatar-iv', 'avatar-v', 'gemini-omni-1.1-flash', 'kling-3.0', 'kling-4.0']);
        for (const { k } of models) {
            expect(k).toMatchObject({ job: true, testedLive: false });
            expect(k.reads.includes('pictures')).toBe(k.video?.firstFrame === true);
        }
        expect(AI_PRESETS['kling']).toMatchObject({ kind: 'kling', files: 'kling', balance: 'kling', downloadHosts: ['.klingai.com'], testedLive: false });
        expect(AI_PRESETS['heygen']).toMatchObject({ files: 'heygen', atOnce: 10, auth: { header: 'x-api-key' }, balance: 'heygen' });
        expect(AI_PRESETS['minimax'].downloadHosts).toContain('.hailuoai.com');
    });
});

describe('fitting and pricing a video', () => {
    const kling3 = AI_PRESETS['kling'].models['kling-3.0'].video!;
    const kling4 = AI_PRESETS['kling'].models['kling-4.0'].video!;
    const h3 = AI_PRESETS['minimax'].models['MiniMax-H3'].video!;

    it('takes the nearest shape and resolution, a length in range, and sound only where there is a choice', () => {
        expect(nearestResolution('4k', ['720p', '1080p'])).toBe('1080p');
        expect(nearestResolution('480p', ['720p', '1080p'])).toBe('720p');
        expect(fittedVideo({ seconds: 40, aspect: '21:9', resolution: '4k', sound: true }, kling3)).toEqual({ seconds: 15, aspect: '16:9', resolution: '4k', sound: true });
        expect(fittedVideo({ seconds: 2, aspect: '4:3' }, kling4)).toEqual({ seconds: 3, aspect: '1:1', resolution: '720p', sound: true });
        expect(fittedVideo({ sound: true }, h3)).toMatchObject({ sound: false, seconds: 8 });
    });

    it('skips a model for a first frame, a presenter or sound it cannot give', () => {
        expect(videoSkip({}, AI_PRESETS['heygen'].models['avatar-iv'].video, false)).toBe('makes only presenter videos');
        expect(videoSkip({ presenter: true }, kling3, false)).toBe('makes no presenter videos');
        expect(videoSkip({ sound: true }, h3, false)).toBe('makes no sound');
        expect(videoSkip({ sound: false }, kling4, false)).toBe('always makes sound');
        expect(videoSkip({ seed: 3 }, kling3, false)).toBe('takes no seed');
        expect(videoSkip({}, kling3, true)).toBeNull();
    });

    it('prices a second by resolution, with sound where it costs more, and estimates tokens with about', () => {
        expect(secondPrice(kling3, undefined, { resolution: '1080p', sound: false })).toBe(0.112);
        expect(secondPrice(kling3, undefined, { resolution: '1080p', sound: true })).toBe(0.168);
        expect(secondPrice(AI_PRESETS['heygen'].models['avatar-iv'].video, 0.0805, {})).toBe(0.0805);
        const info = { makes: 'video' as const, unit: 'tokens' as const, reads: [], schema: 'json' as const, currency: 'USD' as const, usdRate: 1, testedLive: false, priceOut: 17.5, video: AI_PRESETS['gemini-api'].models['gemini-omni-1.1-flash'].video };
        const e = estimateFor(info, 'video', { video: { seconds: 8 } }, 10);
        expect(e.about).toBe(true);
        expect(e.usd).toBeCloseTo((5792 * 8 * 17.5) / 1e6, 9);
        const k = estimateFor({ ...info, unit: 'seconds', priceOut: undefined, video: kling3 }, 'video', { video: { seconds: 5, resolution: '720p', sound: true } }, 0);
        expect(k).toMatchObject({ about: false, amount: 5, unit: 'seconds' });
        expect(k.usd).toBeCloseTo(0.63, 9);
    });
});

describe('Kling', () => {
    it('starts text to video and image to video on its current standard, with the key as a Bearer token', async () => {
        expect(klingResolution('kling-4.0', '4k')).toBe('1080p');
        expect(klingBody('kling-3.0', 'x', { seconds: 6, resolution: '1080p', aspect: '9:16', sound: true })).toEqual({ prompt: 'x', settings: { resolution: '1080p', duration: 6, audio: 'native', multi_shot: false, aspect_ratio: '9:16' }, options: { watermark_info: { enabled: false } } });
        const calls = fakeFetch({ json: { code: 0, request_id: 'r1', data: { id: 'task-1', status: 'submitted' } } });
        expect(await klingStart({ connection: c['kl'], key: 'kl-key' }, vid('kling-3.0'))).toEqual({ ok: 'pending', operation: 'task-1', requestId: 'r1' });
        expect(calls[0].url).toBe('https://api-singapore.klingai.com/text-to-video/kling-3.0');
        expect(header(calls[0], 'authorization')).toBe('Bearer kl-key');
        fakeFetch({ json: { code: 0, data: { id: 'task-2' } } });
        const frame = { kind: 'picture' as const, mimeType: 'image/png', bytes: Buffer.from('png'), name: null, storagePath: null };
        const calls2 = fakeFetch({ json: { code: 0, data: { id: 'task-2' } } });
        await klingStart({ connection: c['kl'], key: 'k' }, vid('kling-4.0', { parts: [frame] }));
        expect(calls2[0].url).toBe('https://api-singapore.klingai.com/image-to-video/kling-4.0');
        expect(sent(calls2[0]).contents[1]).toEqual({ type: 'first_frame', url: Buffer.from('png').toString('base64') });
    });

    it('reads out of credit by its code, though it comes as 429, and other failures', async () => {
        const cases: Array<[Answer, string, Record<string, unknown>?]> = [
            [{ status: 429, json: { code: 1102, message: 'pack used up' } }, 'off', { outOfCredit: true }],
            [{ status: 429, json: { code: 1302, message: 'slow' } }, 'unavailable', { rateLimited: true }],
            [{ status: 401, json: { code: 1002, message: 'bad' } }, 'key-refused'],
            [{ status: 400, json: { code: 1301, message: 'content' } }, 'blocked'],
            [{ status: 404, json: { code: 1203, message: 'no model' } }, 'retired'],
        ];
        for (const [a, failure, more] of cases) {
            fakeFetch(a);
            expect(await klingStart({ connection: c['kl'], key: 'k' }, vid('kling-3.0'))).toMatchObject({ ok: false, failure, ...(more ?? {}) });
        }
    });

    it('checks a task: running, done with its address, seconds and USD charge, or failed', async () => {
        fakeFetch({ json: { code: 0, data: [{ id: 't', status: 'processing' }] } });
        expect(await klingCheck({ connection: c['kl'], key: 'k' }, check('kling-3.0', 't'))).toEqual({ state: 'running' });
        const calls = fakeFetch({ json: { code: 0, data: [{ id: 't', status: 'succeeded', outputs: [{ type: 'video', url: 'https://s15-kling.klingai.com/v.mp4', duration: 5 }], billing: [{ charge_type: 'cash', amount: '0.63', currency: 'USD' }] }] } });
        expect(await klingCheck({ connection: c['kl'], key: 'k' }, check('kling-3.0', 't'))).toEqual({ state: 'done', files: [{ url: 'https://s15-kling.klingai.com/v.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: 5, costUsd: 0.63 } });
        expect(calls[0].url).toBe('https://api-singapore.klingai.com/tasks?task_ids=t');
        fakeFetch({ json: { code: 0, data: [{ id: 't', status: 'failed', message: 'content risk detected' }] } });
        expect(await klingCheck({ connection: c['kl'], key: 'k' }, check('kling-3.0', 't'))).toMatchObject({ state: 'failed', failure: 'blocked' });
        // A busy check is tried again next minute; units, not USD, give no cost of their own.
        fakeFetch({ status: 503, json: { code: 5001, message: 'maintenance' } });
        expect(await klingCheck({ connection: c['kl'], key: 'k' }, check('kling-3.0', 't'))).toEqual({ state: 'running' });
        fakeFetch({ json: { code: 0, data: [{ id: 't', status: 'succeeded', outputs: [{ type: 'video', url: 'https://s15-kling.klingai.com/v.mp4' }], billing: [{ charge_type: 'unit', amount: '4.5' }] }] } });
        const r = await klingCheck({ connection: c['kl'], key: 'k' }, check('kling-3.0', 't'));
        expect(r.state === 'done' && r.usage.costUsd).toBeUndefined();
    });

    it('reads the units left of its packs still in use', () => {
        expect(readKlingPacks({ data: { resource_pack_subscribe_infos: [{ status: 'online', remaining_quantity: 30 }, { status: 'expired', remaining_quantity: 99 }, { status: 'online', remaining_quantity: 12.5 }] } })).toEqual({ ok: true, balance: 42.5, unit: 'units' });
        expect(readKlingPacks({})).toMatchObject({ ok: false });
    });
});

describe('MiniMax H3', () => {
    it('starts on /v2 with its resolution, length and shape, and a first frame as a data URI', async () => {
        expect(miniMaxVideoResolution('MiniMax-H3', '1080p')).toBe('2K');
        expect(miniMaxVideoResolution('MiniMax-H3-Lite', '480p')).toBe('480P');
        expect(miniMaxVideoBody('MiniMax-H3-Max', 'x', { seconds: 2, aspect: '2:3' })).toMatchObject({ duration: 5, ratio: '16:9', resolution: '768P' });
        const calls = fakeFetch({ json: { task_id: '4240' } });
        expect(await miniMaxProvider.make({ connection: c['mm'], key: 'mm' }, vid('MiniMax-H3'))).toEqual({ ok: 'pending', operation: '4240' });
        expect(calls[0].url).toBe('https://api.minimax.io/v2/video_generation');
        expect(sent(calls[0])).toMatchObject({ model: 'MiniMax-H3', content: [{ type: 'text', text: 'A marble rolling down a track' }], resolution: '768P', duration: 6, ratio: '16:9' });
    });

    it('reads its v2 errors by the code in the message', async () => {
        const cases: Array<[Answer, string]> = [
            [{ status: 401, json: { type: 'error', error: { type: 'authorized_error', message: 'invalid key (1004)', http_code: 401 } } }, 'key-refused'],
            [{ status: 402, json: { type: 'error', error: { type: 'insufficient_balance_error', message: 'no balance (1008)' } } }, 'off'],
            [{ status: 422, json: { type: 'error', error: { message: 'sensitive (1026)' } } }, 'blocked'],
            [{ status: 429, json: { type: 'error', error: { message: 'slow (1002)' } } }, 'unavailable'],
        ];
        for (const [a, failure] of cases) {
            fakeFetch(a);
            expect(await miniMaxProvider.make({ connection: c['mm'], key: 'k' }, vid('MiniMax-H3'))).toMatchObject({ ok: false, failure });
        }
    });

    it('checks a task until its address comes, with the seconds made', async () => {
        fakeFetch({ json: { task: { id: '4240', status: 'running' } } });
        expect(await miniMaxProvider.check!({ connection: c['mm'], key: 'k' }, check('MiniMax-H3', '4240'))).toEqual({ state: 'running' });
        const calls = fakeFetch({ json: { task: { id: '4240', status: 'succeeded', content: { url: 'https://cdn.hailuoai.com/x/output.mp4' }, usage: { output_seconds: 5 } } } });
        expect(await miniMaxProvider.check!({ connection: c['mm'], key: 'k' }, check('MiniMax-H3', '4240'))).toEqual({ state: 'done', files: [{ url: 'https://cdn.hailuoai.com/x/output.mp4', mimeType: 'video/mp4', seconds: 5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: 5 } });
        expect(calls[0].url).toBe('https://api.minimax.io/v2/query/video_generation/4240');
        fakeFetch({ json: { task: { id: '4240', status: 'failed', error: { code: '1026', message: 'sensitive' } } } });
        expect(await miniMaxProvider.check!({ connection: c['mm'], key: 'k' }, check('MiniMax-H3', '4240'))).toMatchObject({ state: 'failed', failure: 'blocked' });
    });
});

describe('Gemini Omni Flash', () => {
    it('starts in the background, 480p as its 360p, with a first frame before the text', async () => {
        const frame = { kind: 'picture' as const, mimeType: 'image/jpeg', bytes: Buffer.from('jpg'), name: null, storagePath: null };
        expect(omniBody('gemini-omni-1.1-flash', 'x', { resolution: '480p', aspect: '9:16' }, { mimeType: 'image/jpeg', bytes: Buffer.from('jpg') })).toEqual({
            model: 'gemini-omni-1.1-flash',
            input: [{ type: 'image', mime_type: 'image/jpeg', data: Buffer.from('jpg').toString('base64') }, { type: 'text', text: 'x' }],
            response_format: { type: 'video', aspect_ratio: '9:16', resolution: '360p' },
            generation_config: { video_config: { task: 'image_to_video' } },
            background: true,
            store: true,
        });
        const calls = fakeFetch({ json: { id: 'v1_abc', status: 'in_progress' } });
        expect(await omniStart({ connection: c['gem'], key: 'AIza' }, vid('gemini-omni-1.1-flash', { parts: [frame] }))).toEqual({ ok: 'pending', operation: 'v1_abc' });
        expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
        expect(header(calls[0], 'x-goog-api-key')).toBe('AIza');
    });

    it('keeps a video the start already made as a job too, so its hook and listeners hear of it', async () => {
        fakeFetch({ json: { id: 'v1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: MP4.toString('base64') }] }], usage: { total_input_tokens: 9, total_output_tokens: 46336 } } });
        expect(await omniStart({ connection: c['gem'], key: 'k' }, vid('gemini-omni-1.1-flash'))).toEqual({ ok: 'pending', operation: 'v1' });
    });

    it('checks the interaction until its video comes inline, and reads blocks and refusals', async () => {
        fakeFetch({ json: { id: 'v1', status: 'in_progress' } });
        expect(await omniCheck({ connection: c['gem'], key: 'k' }, check('gemini-omni-1.1-flash', 'v1'))).toEqual({ state: 'running' });
        fakeFetch({ json: { id: 'v1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: MP4.toString('base64') }] }], usage: { total_output_tokens: 100 } } });
        const done = await omniCheck({ connection: c['gem'], key: 'k' }, check('gemini-omni-1.1-flash', 'v1'));
        expect(done.state === 'done' && done.files[0]).toEqual({ bytes: MP4, mimeType: 'video/mp4' });
        fakeFetch({ json: { id: 'v1', status: 'failed', errors: [{ code: 'safety', message: 'no' }] } });
        expect(await omniCheck({ connection: c['gem'], key: 'k' }, check('gemini-omni-1.1-flash', 'v1'))).toMatchObject({ state: 'failed', failure: 'blocked' });
        fakeFetch({ status: 402, json: { error: { code: 'payment_required', message: 'prepay' } } });
        expect(await omniStart({ connection: c['gem'], key: 'k' }, vid('gemini-omni-1.1-flash'))).toMatchObject({ ok: false, failure: 'off', outOfCredit: true });
        fakeFetch({ status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'slow' } } });
        expect(await omniCheck({ connection: c['gem'], key: 'k' }, check('gemini-omni-1.1-flash', 'v1'))).toEqual({ state: 'running' });
    });
});

describe('HeyGen presenters', () => {
    const presenter = (extra: Partial<FileRequest> = {}) => vid('avatar-iv', { video: { presenter: true, aspect: '9:16', resolution: '1080p' }, avatar: 'look-1', prompt: 'Welcome to the tour.', jobKey: 'rec-9', ...extra });

    it('starts an avatar speaking the script, with an idempotency key', async () => {
        expect(heyGenBody('avatar-v', 'look-1', 'Hi', { aspect: '4:3' })).toEqual({ type: 'avatar', avatar_id: 'look-1', script: 'Hi', engine: { type: 'avatar_v' }, resolution: '720p', aspect_ratio: '16:9', output_format: 'mp4' });
        const calls = fakeFetch({ json: { data: { video_id: 'v_abc', status: 'waiting' } } });
        expect(await heyGenStart({ connection: c['hg'], key: 'hg-key' }, presenter())).toEqual({ ok: 'pending', operation: 'v_abc', requestId: undefined });
        expect(calls[0].url).toBe('https://api.heygen.com/v3/videos');
        expect(header(calls[0], 'x-api-key')).toBe('hg-key');
        expect(header(calls[0], 'idempotency-key')).toBe('rec-9');
        expect(sent(calls[0])).toMatchObject({ avatar_id: 'look-1', script: 'Welcome to the tour.', resolution: '1080p', aspect_ratio: '9:16' });
    });

    it('uploads an audio file first and has the avatar speak to it', async () => {
        const calls = fakeFetch({ json: { data: { asset_id: 'asset-1' } } }, { json: { data: { video_id: 'v_2' } } });
        await heyGenStart({ connection: c['hg'], key: 'k' }, presenter({ speechFile: { bytes: Buffer.from('ID3'), mimeType: 'audio/mpeg' }, prompt: '' }));
        expect(calls[0].url).toBe('https://api.heygen.com/v3/assets');
        expect(calls[0].init.body).toBeInstanceOf(FormData);
        expect(sent(calls[1])).toMatchObject({ audio_asset_id: 'asset-1' });
        expect(sent(calls[1]).script).toBeUndefined();
    });

    it('refuses a video that is not a presenter, and reads its errors', async () => {
        expect(await heyGenStart({ connection: c['hg'], key: 'k' }, vid('avatar-iv'))).toMatchObject({ ok: false, failure: 'off' });
        const cases: Array<[Answer, string, Record<string, unknown>?]> = [
            [{ status: 402, json: { error: { code: 'insufficient_credit', message: 'top up' } } }, 'off', { outOfCredit: true }],
            [{ status: 401, json: { error: { code: 'unauthorized', message: 'bad' } } }, 'key-refused'],
            [{ status: 400, json: { error: { code: 'content_policy_violation', message: 'no' } } }, 'blocked'],
            [{ status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'slow' } }, headers: { 'retry-after': '12' } }, 'unavailable', { rateLimited: true, wait: 12 }],
        ];
        for (const [a, failure, more] of cases) {
            fakeFetch(a);
            expect(await heyGenStart({ connection: c['hg'], key: 'k' }, presenter())).toMatchObject({ ok: false, failure, ...(more ?? {}) });
        }
    });

    it('checks a video: waiting is running, completed gives its address and seconds', async () => {
        fakeFetch({ json: { data: { id: 'v', status: 'waiting' } } });
        expect(await heyGenCheck({ connection: c['hg'], key: 'k' }, check('avatar-iv', 'v'))).toEqual({ state: 'running' });
        fakeFetch({ json: { data: { id: 'v', status: 'completed', video_url: 'https://files.heygen.ai/v.mp4', duration: 12.5 } } });
        expect(await heyGenCheck({ connection: c['hg'], key: 'k' }, check('avatar-iv', 'v'))).toEqual({ state: 'done', files: [{ url: 'https://files.heygen.ai/v.mp4', mimeType: 'video/mp4', seconds: 12.5 }], usage: { tokensIn: 0, tokensOut: 0, tokensThinking: 0, amount: 12.5 } });
        fakeFetch({ json: { data: { id: 'v', status: 'failed', failure_message: 'moderation rejected' } } });
        expect(await heyGenCheck({ connection: c['hg'], key: 'k' }, check('avatar-iv', 'v'))).toMatchObject({ state: 'failed', failure: 'blocked' });
    });

    it('lists its finished looks with their pictures and voices, page by page', async () => {
        const calls = fakeFetch(
            { json: { data: [{ id: 'l1', name: 'Asha', gender: 'female', preview_image_url: 'https://files.heygen.ai/l1.jpg', default_voice_id: 'voice-1' }, { id: 'l2', name: 'Busy', status: 'processing' }], has_more: true, next_token: 'p2' } },
            { json: { data: [{ id: 'l3', name: 'Ravi', gender: 'male', preview_image_url: 'javascript:alert(1)' }], has_more: false } },
        );
        const r = await heyGenAvatars({ connection: c['hg'], key: 'k' }, { timeoutMs: 5000 });
        expect(r).toEqual({ ok: true, avatars: [
            { id: 'l1', name: 'Asha', gender: 'female', previewUrl: 'https://files.heygen.ai/l1.jpg', voiceId: 'voice-1' },
            { id: 'l3', name: 'Ravi', gender: 'male', previewUrl: null, voiceId: null },
        ] });
        expect(calls[1].url).toBe('https://api.heygen.com/v3/avatars/looks?limit=50&token=p2');
        fakeFetch({ status: 401, json: { error: { code: 'unauthorized', message: 'bad' } } });
        expect(await heyGenAvatars({ connection: c['hg'], key: 'k' }, { timeoutMs: 5000 })).toMatchObject({ ok: false, keyRefused: true });
    });

    it('reads what is left of the wallet', () => {
        expect(readHeyGenWallet({ data: { billing_type: 'wallet', wallet: { currency: 'usd', remaining_balance: 41.5 } } })).toEqual({ ok: true, balance: 41.5, unit: 'USD' });
        expect(readHeyGenWallet({ data: { billing_type: 'subscription' } })).toMatchObject({ ok: false });
    });
});
