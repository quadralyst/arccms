/**
 * The OpenAI-style connector (specs/ai-spec.md, AI-D6, AI-D9): the request it sends and
 * how each kind of answer reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));

import { chatBody, openAiConnector, readResponse } from '../ai/connectors/openai.js';
import { resolveAiSettings } from '../ai/settings.js';
import type { ConnectorRequest } from '../ai/connectors/types.js';

const request: ConnectorRequest = {
    model: 'qwen3-vl-plus',
    instruction: 'Read the menu.',
    parts: [
        { kind: 'text', text: 'In German.' },
        { kind: 'picture', mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 1]), name: null, storagePath: null },
        { kind: 'pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4'), name: 'menu.pdf', storagePath: null },
    ],
    schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    schemaSupport: 'json',
    timeoutMs: 5000,
};

const headers = (h: Record<string, string> = {}) => new Headers(h);
const ok = (content: unknown, extra: Record<string, unknown> = {}) => ({ id: 'req-1', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 100 } }, ...extra });

describe('chatBody', () => {
    it('sends the instruction, then text, pictures and PDFs in order', () => {
        const body = chatBody(request) as { messages: Array<{ role: string; content: unknown }>; response_format: unknown };
        expect(body.messages[0]).toEqual({ role: 'system', content: 'Read the menu.' });
        const content = body.messages[1].content as Array<Record<string, unknown>>;
        expect(content[0]).toEqual({ type: 'text', text: 'In German.' });
        expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AQ==' } });
        expect(content[2]).toMatchObject({ type: 'file', file: { filename: 'menu.pdf' } });
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body).not.toHaveProperty('usage');
    });

    it('holds a strict model to the schema, and asks OpenRouter for the cost', () => {
        const body = chatBody({ ...request, schemaSupport: 'strict', maxOutputTokens: 500, temperature: 0 }, { askCost: true });
        expect(body['response_format']).toMatchObject({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: { additionalProperties: false, required: ['a'] } } });
        expect(body['max_tokens']).toBe(500);
        expect(body['temperature']).toBe(0);
        expect(body['usage']).toEqual({ include: true });
        expect(chatBody({ ...request, schema: null })).not.toHaveProperty('response_format');
    });

    it('asks OpenRouter for little thinking and for hosts that keep the schema; OpenAI for its effort', () => {
        const router = chatBody({ ...request, schemaSupport: 'strict', thinking: 'low' }, { openRouter: true });
        expect(router['reasoning']).toEqual({ effort: 'low' });
        expect(router['provider']).toEqual({ require_parameters: true });
        const openai = chatBody({ ...request, thinking: 'high' }, { completionTokens: true });
        expect(openai['reasoning_effort']).toBe('high');
        expect(openai).not.toHaveProperty('provider');
        expect(chatBody({ ...request, thinking: 'low' })).not.toHaveProperty('reasoning');
    });

    it('uses max_completion_tokens for OpenAI, and can leave temperature out', () => {
        const body = chatBody({ ...request, maxOutputTokens: 300, temperature: 0.2 }, { completionTokens: true, noTemperature: true });
        expect(body['max_completion_tokens']).toBe(300);
        expect(body).not.toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('temperature');
    });
});

describe('readResponse', () => {
    it('reads the answer and its tokens, and the provider\'s cost when given', () => {
        expect(readResponse(200, headers(), ok('{"a":"b"}'))).toEqual({ ok: true, text: '{"a":"b"}', usage: { tokensIn: 1200, tokensOut: 300, tokensThinking: 100 }, requestId: 'req-1' });
        const withCost = readResponse(200, headers(), { ...ok('x'), usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0004 } });
        expect(withCost).toMatchObject({ ok: true, usage: { costUsd: 0.0004 } });
    });

    it('names each failure', () => {
        const cases: Array<[number, unknown, string, Record<string, string>?]> = [
            [200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }, 'blocked'],
            [200, { choices: [{ message: { content: null, refusal: 'I cannot help with that.' } }] }, 'blocked'],
            [200, { choices: [] }, 'unreadable'],
            [401, { error: { message: 'Incorrect API key provided' } }, 'key-refused'],
            [402, { error: 'Insufficient credits' }, 'unavailable'],
            [404, { error: { message: 'The model `gemini-2.0` does not exist' } }, 'retired'],
            [400, { error: { message: 'model qwen-old is deprecated' } }, 'retired'],
            [400, { error: { message: "This model's maximum context length is 8192 tokens" } }, 'too-large'],
            [413, 'Request Entity Too Large', 'too-large'],
            [400, { error: { code: 'data_inspection_failed', message: 'Input data may contain inappropriate content.' } }, 'blocked'],
            [429, { error: { message: 'Rate limit reached' } }, 'unavailable', { 'retry-after': '20' }],
            [503, { error: 'overloaded' }, 'unavailable'],
            [400, { error: { message: 'messages[1].content[0].type is invalid' } }, 'unreadable'],
        ];
        for (const [status, body, failure, h] of cases) {
            const result = readResponse(status, headers(h), body);
            expect(result.ok, `${status} ${JSON.stringify(body)}`).toBe(false);
            if (!result.ok) expect(result.failure, `${status} ${JSON.stringify(body)}`).toBe(failure);
        }
        const limited = readResponse(429, headers({ 'retry-after': '20' }), {});
        expect(!limited.ok && limited.wait).toBe(20);
    });

    it('never repeats a key from an error', () => {
        const result = readResponse(401, headers(), { error: { message: 'Incorrect API key provided: sk-abcdefghijklmnop1234' } });
        expect(!result.ok && result.detail).not.toContain('abcdefghijklmnop');
    });
});

describe('openAiConnector', () => {
    const settings = resolveAiSettings({ connections: { qwen: { preset: 'alibaba-eu', workspace: 'ws1' }, router: { preset: 'openrouter' }, oai: { preset: 'openai' } } });
    afterEach(() => vi.unstubAllGlobals());

    it('posts to the connection\'s address with the key', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok('{"a":"b"}')), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await openAiConnector({ connection: settings.connections['qwen'], key: 'sk-test-123456' }, request);
        expect(result.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://ws1.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
        expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test-123456');
        expect(init.redirect).toBe('error');
        expect(JSON.parse(String(init.body))).not.toHaveProperty('usage');
    });

    it('asks OpenRouter for the cost', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok('x')), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await openAiConnector({ connection: settings.connections['router'], key: 'sk-or-123456' }, { ...request, schema: null });
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))['usage']).toEqual({ include: true });
    });

    it('asks again without temperature when a model refuses it', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model." } }), { status: 400 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(ok('fine')), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await openAiConnector({ connection: settings.connections['oai'], key: 'sk-test-123456' }, { ...request, schema: null, temperature: 0.2, maxOutputTokens: 100 });
        expect(result).toMatchObject({ ok: true, text: 'fine' });
        const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
        expect(second).not.toHaveProperty('temperature');
        expect(second['max_completion_tokens']).toBe(100);
    });

    it('gives a strict answer back in the purpose\'s own shape', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ok('{"a":null}')), { status: 200 })));
        const schema = { type: 'object' as const, properties: { a: { type: 'string' as const }, b: { type: 'string' as const } }, required: ['b'] };
        const result = await openAiConnector({ connection: settings.connections['oai'], key: 'sk-test-123456' }, { ...request, schema, schemaSupport: 'strict' });
        expect(result).toMatchObject({ ok: true, text: '{}' });
    });

    it('stops waiting at the call\'s time', async () => {
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })));
        const result = await openAiConnector({ connection: settings.connections['qwen'], key: 'sk-test-123456' }, { ...request, timeoutMs: 20 });
        expect(result).toMatchObject({ ok: false, failure: 'timeout' });
    });

    it('says when it cannot reach the provider, or has no key', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND'); }));
        expect(await openAiConnector({ connection: settings.connections['qwen'], key: 'sk-test-123456' }, request)).toMatchObject({ ok: false, failure: 'unavailable' });
        expect(await openAiConnector({ connection: settings.connections['qwen'], key: null }, request)).toMatchObject({ ok: false, failure: 'off' });
    });
});
