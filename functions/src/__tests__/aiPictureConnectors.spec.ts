/**
 * The picture connectors of AM3 (specs/ai-media-spec.md, AM-D7, AM-D19, AM-D28, section 6.3):
 * OpenAI, Gemini on the Gemini API (Interactions) and on Vertex (generateContent), Alibaba's
 * DashScope and MiniMax, each against a fake server that answers as the provider's docs say,
 * success and every failure; a picture's size and type read from its bytes; and the guarded
 * fetch of a file a provider names. None has been called for real (AM-D34).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));
vi.mock('../ai/connectors/vertex.js', () => ({ googleAccessToken: async () => 'ya29.token', projectId: async () => 'proj-1' }));

import { dashScopeBody, dashScopeImages, dashScopeSize } from '../ai/connectors/dashscope.js';
import { geminiApiImages, geminiImageBody, interactionImageBody, vertexImages } from '../ai/connectors/geminiImages.js';
import { downloadFile } from '../ai/connectors/http.js';
import { miniMaxImageBody, miniMaxProvider } from '../ai/connectors/minimax.js';
import { openAiImageBody, openAiImages, openAiImageSize } from '../ai/connectors/openaiImages.js';
import type { FileRequest } from '../ai/connectors/types.js';
import { pictureDimensions, pictureMime } from '../ai/images.js';
import { AI_PRESETS } from '../ai/presets.js';
import { resolveAiSettings } from '../ai/settings.js';
import { greyPng } from '../ai/standins.js';

const settings = resolveAiSettings({
    connections: {
        oa: { preset: 'openai' },
        gem: { preset: 'gemini-api' },
        vx: { preset: 'vertex', location: 'eu' },
        ali: { preset: 'alibaba-eu', workspace: 'ws-123' },
        mm: { preset: 'minimax' },
    },
});
const c = settings.connections;
const PNG = greyPng(16, 8);

function pic(model: string, extra: Partial<FileRequest> = {}): FileRequest {
    return { kind: 'image', model, prompt: 'A bowl of fruit', parts: [], image: { aspect: '1:1', count: 1 }, timeoutMs: 5000, ...extra };
}

type Call = { url: string; init: RequestInit };
type Answer = { status?: number; json?: unknown; bytes?: Buffer; headers?: Record<string, string> };
function fakeFetch(...answers: Answer[]): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        const a = answers.shift() ?? { status: 500, json: { error: 'no more answers' } };
        const body = a.bytes ?? Buffer.from(JSON.stringify(a.json ?? {}));
        const headers = new Headers({ 'content-type': a.bytes ? 'image/png' : 'application/json', ...(a.headers ?? {}) });
        return { status: a.status ?? 200, headers, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) } as unknown as Response;
    }));
    return calls;
}
const sent = (call: Call) => JSON.parse(String(call.init.body));
const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];
const b64 = PNG.toString('base64');

afterEach(() => vi.unstubAllGlobals());

describe('the picture presets', () => {
    it('make pictures billed per picture (or tokens), are marked not tested live, and edit where they read pictures', () => {
        const models = Object.values(AI_PRESETS).flatMap((p) => Object.values(p.models)).filter((m) => m.makes === 'image');
        expect(models.length).toBeGreaterThanOrEqual(10);
        for (const m of models) {
            expect(m.testedLive === false || AI_PRESETS['minimax'].testedLive === false).toBe(true);
            expect(m.image?.maxCount).toBeGreaterThanOrEqual(1);
            expect(m.reads.includes('pictures')).toBe(m.image?.edit === true);
            const priced = m.unit === 'tokens' ? m.priceOut : m.price ?? m.image?.priceByQuality?.medium ?? m.image?.priceByResolution?.standard;
            expect(priced).toBeGreaterThan(0);
        }
        expect(AI_PRESETS['openai'].models['gpt-image-1-mini']).toBeUndefined();
        expect(AI_PRESETS['minimax'].kindLimits).toEqual({ image: { perMinute: 10 } });
        expect(AI_PRESETS['alibaba-eu']).toMatchObject({ files: 'dashscope', downloadHosts: ['.aliyuncs.com'] });
    });
});

describe('reading pictures', () => {
    it('reads a PNG, JPEG and WebP size and type from its bytes', () => {
        expect(pictureDimensions(PNG)).toEqual({ width: 16, height: 8 });
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03]);
        expect(pictureDimensions(jpeg)).toEqual({ width: 64, height: 48 });
        expect(pictureMime(jpeg)).toBe('image/jpeg');
        const webp = Buffer.alloc(30);
        webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1');
        webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(49, 27, 3);
        expect(pictureDimensions(webp)).toEqual({ width: 100, height: 50 });
        expect(pictureMime(Buffer.from('nothing'), 'image/webp')).toBe('image/webp');
        expect(pictureDimensions(Buffer.from('nothing'))).toBeNull();
    });
});

describe('OpenAI', () => {
    it('asks a custom size in multiples of 16 within its limits', () => {
        expect(openAiImageSize('gpt-image-2', { aspect: '1:1' })).toBe('1024x1024');
        expect(openAiImageSize('gpt-image-2', { aspect: '16:9' })).toBe('1376x768');
        expect(openAiImageSize('gpt-image-2', { aspect: '1:1', resolution: 'high' })).toBe('2048x2048');
        const [w, h] = openAiImageSize('gpt-image-2.5-flare', { aspect: '21:9', resolution: 'high' }).split('x').map(Number);
        expect(w % 16 + h % 16).toBe(0);
        expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
        expect(openAiImageSize('some-fixed-model', { aspect: '16:9' })).toBe('1536x1024');
        expect(openAiImageSize('some-fixed-model', { aspect: '9:16' })).toBe('1024x1536');
    });

    it('sends the prompt, count, quality and format, and pictures to edit as data URLs', () => {
        expect(openAiImageBody('gpt-image-2', 'fruit', { count: 2, quality: 'low', format: 'webp' })).toEqual({ model: 'gpt-image-2', prompt: 'fruit', n: 2, size: '1024x1024', quality: 'low', output_format: 'webp', output_compression: 90 });
        expect(openAiImageBody('gpt-image-2', 'x', {}, [{ mimeType: 'image/png', bytes: PNG }])['images']).toEqual([{ image_url: `data:image/png;base64,${b64}` }]);
    });

    it('answers base64 pictures with their size and the tokens used', async () => {
        const calls = fakeFetch({ json: { data: [{ b64_json: b64 }, { b64_json: b64 }], usage: { input_tokens: 20, output_tokens: 2000 } }, headers: { 'x-request-id': 'req-1' } });
        const r = await openAiImages({ connection: c['oa'], key: 'sk-test' }, pic('gpt-image-2', { image: { count: 2, quality: 'medium', format: 'png' } }));
        expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
        expect(header(calls[0], 'authorization')).toBe('Bearer sk-test');
        expect(r).toMatchObject({ ok: true, usage: { tokensIn: 20, tokensOut: 2000 }, requestId: 'req-1' });
        expect(r.ok && r.files.map((f) => [f.mimeType, f.width, f.height])).toEqual([['image/png', 16, 8], ['image/png', 16, 8]]);
    });

    it('edits through /images/edits', async () => {
        const calls = fakeFetch({ json: { data: [{ b64_json: b64 }] } });
        await openAiImages({ connection: c['oa'], key: 'sk-test' }, pic('gpt-image-2', { parts: [{ kind: 'picture', mimeType: 'image/png', bytes: PNG, name: null, storagePath: 'mediaImages/a.png' }] }));
        expect(calls[0].url).toBe('https://api.openai.com/v1/images/edits');
        expect(sent(calls[0]).images).toHaveLength(1);
    });

    it('reads each failure as the docs say', async () => {
        const cases: Array<[Answer, string, Record<string, unknown>?]> = [
            [{ status: 400, json: { error: { type: 'image_generation_user_error', code: 'moderation_blocked', message: 'blocked' } } }, 'blocked'],
            [{ status: 401, json: { error: { message: 'bad key' } } }, 'key-refused'],
            [{ status: 429, json: { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'no credit' } } }, 'off', { outOfCredit: true }],
            [{ status: 429, json: { error: { type: 'rate_limit_error', message: 'slow down' } }, headers: { 'retry-after': '7' } }, 'unavailable', { rateLimited: true, wait: 7 }],
            [{ status: 404, json: { error: { code: 'model_not_found', message: 'no' } } }, 'retired'],
            [{ status: 503, json: { error: { code: 'server_is_overloaded', message: 'busy' } } }, 'unavailable'],
            [{ json: { data: [] } }, 'unreadable'],
        ];
        for (const [answer, failure, more] of cases) {
            fakeFetch(answer);
            expect(await openAiImages({ connection: c['oa'], key: 'sk-test' }, pic('gpt-image-2'))).toMatchObject({ ok: false, failure, ...(more ?? {}) });
        }
    });
});

describe('Gemini on the Gemini API (Interactions)', () => {
    const answer = (extra: Record<string, unknown> = {}) => ({
        json: { id: 'int_1', status: 'completed', steps: [{ type: 'thought', content: [{ type: 'image', data: 'AAAA' }] }, { type: 'model_output', content: [{ type: 'text', text: 'Here' }, { type: 'image', mime_type: 'image/png', data: b64 }] }], usage: { total_input_tokens: 10, total_output_tokens: 1290 }, ...extra },
    });

    it('asks for one picture a request, as many at once as asked, with the key header', async () => {
        expect(interactionImageBody('gemini-nano-banana-2.1', 'fruit', { aspect: '16:9', resolution: 'high' })).toEqual({ model: 'gemini-nano-banana-2.1', input: [{ type: 'text', text: 'fruit' }], response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' }, store: false });
        const calls = fakeFetch(answer(), answer());
        const r = await geminiApiImages({ connection: c['gem'], key: 'AIza-test' }, pic('gemini-nano-banana-2.1', { image: { count: 2 } }));
        expect(calls.map((x) => x.url)).toEqual(['https://generativelanguage.googleapis.com/v1beta/interactions', 'https://generativelanguage.googleapis.com/v1beta/interactions']);
        expect(header(calls[0], 'x-goog-api-key')).toBe('AIza-test');
        // The answer's own picture, never a thought's.
        expect(r).toMatchObject({ ok: true, usage: { tokensIn: 20, tokensOut: 2580 } });
        expect(r.ok && r.files).toHaveLength(2);
    });

    it('keeps the pictures made when another request failed', async () => {
        fakeFetch(answer(), { status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'slow' } } });
        const r = await geminiApiImages({ connection: c['gem'], key: 'k' }, pic('gemini-nano-banana-2.1', { image: { count: 2 } }));
        expect(r.ok && r.files).toHaveLength(1);
    });

    it('reads a block whether it comes as an HTTP error or a failed interaction', async () => {
        const cases: Array<[Answer, string, Record<string, unknown>?]> = [
            [{ status: 400, json: { error: { code: 'image_safety', message: 'no' } } }, 'blocked'],
            [{ json: { status: 'failed', errors: [{ code: 'image_prohibited_content', message: 'no' }] } }, 'blocked'],
            [{ json: { status: 'completed', steps: [] } }, 'unreadable'],
            [{ status: 401, json: { error: { code: 'authentication', message: 'bad' } } }, 'key-refused'],
            [{ status: 402, json: { error: { code: 'payment_required', message: 'prepay' } } }, 'off', { outOfCredit: true }],
            [{ status: 404, json: { error: { code: 'model_not_found', message: 'no' } } }, 'retired'],
            [{ status: 429, json: { error: { code: 'quota_exceeded', message: 'daily' } } }, 'unavailable', { rateLimited: false }],
            [{ status: 504, json: { error: { code: 'deadline_exceeded', message: 'slow' } } }, 'timeout'],
        ];
        for (const [a, failure, more] of cases) {
            fakeFetch(a);
            expect(await geminiApiImages({ connection: c['gem'], key: 'k' }, pic('gemini-nano-banana-2.1'))).toMatchObject({ ok: false, failure, ...(more ?? {}) });
        }
    });
});

describe('Gemini on Vertex (generateContent)', () => {
    it('asks at the global address with the service account, aspect and size in imageConfig', async () => {
        expect(geminiImageBody('fruit', { aspect: '4:3' }, [{ kind: 'picture', mimeType: 'image/png', bytes: PNG, name: null, storagePath: null }])).toEqual({
            contents: [{ role: 'user', parts: [{ text: 'fruit' }, { inlineData: { mimeType: 'image/png', data: b64 } }] }],
            generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:3', imageSize: '1K' } },
        });
        const calls = fakeFetch({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1290 } } });
        const r = await vertexImages({ connection: c['vx'], key: null }, pic('gemini-3.1-flash-image'));
        expect(calls[0].url).toBe('https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent');
        expect(header(calls[0], 'authorization')).toBe('Bearer ya29.token');
        expect(r).toMatchObject({ ok: true, files: [{ mimeType: 'image/png', width: 16, height: 8 }] });
    });

    it('reads a refused service account, a block and a missing model', async () => {
        const cases: Array<[Answer, string]> = [
            [{ json: { candidates: [{ finishReason: 'IMAGE_SAFETY' }] } }, 'blocked'],
            [{ json: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } }, 'blocked'],
            [{ json: { candidates: [{ finishReason: 'NO_IMAGE', content: { parts: [{ text: 'sorry' }] } }] } }, 'unreadable'],
            [{ status: 403, json: { error: { message: 'denied' } } }, 'off'],
            [{ status: 404, json: { error: { message: 'no model' } } }, 'retired'],
            [{ status: 429, json: { error: { message: 'busy' } } }, 'unavailable'],
        ];
        for (const [a, failure] of cases) {
            fakeFetch(a);
            expect(await vertexImages({ connection: c['vx'], key: null }, pic('gemini-3.1-flash-image'))).toMatchObject({ ok: false, failure });
        }
    });
});

describe('Alibaba DashScope', () => {
    const made = { output: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ image: 'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/a.png?Expires=1' }] } }] }, usage: { image_count: 1 }, request_id: 'r-1' };

    it('asks Qwen-Image at the workspace address, then fetches the picture without the key', async () => {
        expect(dashScopeSize({ aspect: '16:9' })).toBe('1664*928');
        expect(dashScopeSize({ aspect: '16:9', resolution: 'high' })).toBe('2688*1536');
        expect(dashScopeBody('qwen-image-3.0', 'fruit', { count: 2, seed: 9, negativePrompt: 'text' })).toEqual({
            model: 'qwen-image-3.0', input: { messages: [{ role: 'user', content: [{ text: 'fruit' }] }] }, parameters: { size: '1328*1328', n: 2, watermark: false, prompt_extend: false, seed: 9, negative_prompt: 'text' },
        });
        const calls = fakeFetch({ json: made }, { bytes: PNG });
        const r = await dashScopeImages({ connection: c['ali'], key: 'sk-ali' }, pic('qwen-image-2.1-turbo'));
        expect(calls[0].url).toBe('https://ws-123.eu-central-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
        expect(header(calls[0], 'authorization')).toBe('Bearer sk-ali');
        expect(calls[1].url).toContain('dashscope-result-sh');
        expect(calls[1].init.headers).toBeUndefined();
        expect(r).toMatchObject({ ok: true, usage: { amount: 1 }, requestId: 'r-1', files: [{ width: 16 }] });
    });

    it('reads its error codes, and a picture made but not fetched still counts', async () => {
        const cases: Array<[Answer, string, Record<string, unknown>?]> = [
            [{ status: 400, json: { code: 'DataInspectionFailed', message: 'flagged' } }, 'blocked'],
            [{ status: 400, json: { code: 'Arrearage', message: 'overdue' } }, 'off', { outOfCredit: true }],
            [{ status: 401, json: { code: 'InvalidApiKey', message: 'bad' } }, 'key-refused'],
            [{ status: 404, json: { code: 'ModelNotFound', message: 'no' } }, 'retired'],
            [{ status: 429, json: { code: 'Throttling.RateQuota', message: 'slow' } }, 'unavailable', { rateLimited: true }],
        ];
        for (const [a, failure, more] of cases) {
            fakeFetch(a);
            expect(await dashScopeImages({ connection: c['ali'], key: 'k' }, pic('qwen-image-3.0'))).toMatchObject({ ok: false, failure, ...(more ?? {}) });
        }
        fakeFetch({ json: { ...made, output: { choices: [{ message: { content: [{ image: 'https://evil.example.com/a.png' }] } }] } } });
        expect(await dashScopeImages({ connection: c['ali'], key: 'k' }, pic('qwen-image-3.0'))).toMatchObject({ ok: false, failure: 'unreadable', usage: { amount: 1 } });
    });
});

describe('MiniMax pictures', () => {
    it('asks image_generation for base64 with the shape, count and seed', async () => {
        expect(miniMaxImageBody('image-01', 'fruit', { aspect: '16:9', count: 3, seed: 4 })).toEqual({ model: 'image-01', prompt: 'fruit', aspect_ratio: '16:9', n: 3, seed: 4, response_format: 'base64', prompt_optimizer: false });
        const calls = fakeFetch({ json: { id: 'mm-1', data: { image_base64: [b64, b64] }, metadata: { success_count: 2, failed_count: 0 }, base_resp: { status_code: 0, status_msg: 'success' } } });
        const r = await miniMaxProvider.make({ connection: c['mm'], key: 'mm-key' }, pic('image-01', { image: { count: 2 } }));
        expect(calls[0].url).toBe('https://api.minimax.io/v1/image_generation');
        expect(r.ok && r.files).toHaveLength(2);
    });

    it('reads a refused picture, a bad key and no balance', async () => {
        const cases: Array<[Answer, string]> = [
            [{ json: { data: { image_base64: [] }, metadata: { failed_count: 1 }, base_resp: { status_code: 0 } } }, 'blocked'],
            [{ json: { base_resp: { status_code: 1004, status_msg: 'auth' } } }, 'key-refused'],
            [{ json: { base_resp: { status_code: 1008, status_msg: 'balance' } } }, 'off'],
            [{ json: { base_resp: { status_code: 1026, status_msg: 'sensitive' } } }, 'blocked'],
            [{ status: 429, json: {} }, 'unavailable'],
        ];
        for (const [a, failure] of cases) {
            fakeFetch(a);
            expect(await miniMaxProvider.make({ connection: c['mm'], key: 'k' }, pic('image-01'))).toMatchObject({ ok: false, failure });
        }
    });
});

describe('downloadFile', () => {
    it('fetches only https from a listed host, follows a checked redirect, and never sends a key', async () => {
        const calls = fakeFetch({ status: 302, headers: { location: 'https://b.cdn.example.com/x.png' } }, { bytes: PNG });
        expect(await downloadFile('https://a.cdn.example.com/x.png', ['.cdn.example.com'], 5000, 'Test')).toMatchObject({ ok: true });
        expect(calls.map((x) => x.url)).toEqual(['https://a.cdn.example.com/x.png', 'https://b.cdn.example.com/x.png']);
        expect(calls.every((x) => x.init.headers === undefined)).toBe(true);
        fakeFetch({ status: 302, headers: { location: 'https://metadata.internal/x' } });
        expect(await downloadFile('https://a.cdn.example.com/x.png', ['.cdn.example.com'], 5000, 'Test')).toMatchObject({ ok: false, failure: 'unreadable' });
        expect(await downloadFile('http://a.cdn.example.com/x.png', ['.cdn.example.com'], 5000, 'Test')).toMatchObject({ ok: false });
        expect(await downloadFile('https://cdn.example.com.evil.io/x.png', ['.cdn.example.com'], 5000, 'Test')).toMatchObject({ ok: false });
        fakeFetch({ bytes: PNG, headers: { 'content-length': String(500 * 1024 * 1024) } });
        expect(await downloadFile('https://a.cdn.example.com/x.png', ['.cdn.example.com'], 5000, 'Test')).toMatchObject({ ok: false, failure: 'too-large' });
        // With no length given, the read stops at the cap.
        fakeFetch({ bytes: Buffer.alloc(64) });
        expect(await downloadFile('https://a.cdn.example.com/x.png', ['.cdn.example.com'], 5000, 'Test', 32)).toMatchObject({ ok: false, failure: 'too-large' });
        // An address literal or a local name is never fetched, even when listed.
        expect(await downloadFile('https://10.0.0.1/x.png', ['10.0.0.1'], 5000, 'Test')).toMatchObject({ ok: false, failure: 'unreadable' });
    });
});
