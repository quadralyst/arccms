/**
 * The connectors added in AM1 (specs/ai-media-spec.md, AM-D7, AM-D8, AM-D15, AM-D31, AM-D32):
 * Anthropic's Messages API and the Gemini API with a key, and what the OpenAI-style
 * connector now reads: the preset's key header, cached tokens, a 429, no credit. Each is
 * tested against a fake server that answers as the provider's docs say; none has been
 * called for real (AM-D34).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));

import { anthropicConnector, messagesBody, readMessagesResponse, ANTHROPIC_VERSION } from '../ai/connectors/anthropic.js';
import { geminiConnector, readGeminiResponse } from '../ai/connectors/gemini.js';
import { openAiConnector, readResponse } from '../ai/connectors/openai.js';
import { AI_PRESETS } from '../ai/presets.js';
import { connectionAuth, connectionLimits, resolveAiSettings, safeHeaderName } from '../ai/settings.js';
import type { ConnectorRequest } from '../ai/connectors/types.js';

const request: ConnectorRequest = {
    model: 'claude-haiku-5-5',
    instruction: 'Read the receipt.',
    parts: [
        { kind: 'pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4'), name: 'r.pdf', storagePath: null },
        { kind: 'picture', mimeType: 'image/png', bytes: Buffer.from([0x89, 0x50]), name: null, storagePath: null },
        { kind: 'text', text: 'In francs.' },
    ],
    schema: { type: 'object', properties: { total: { type: ['number', 'null'] } }, required: ['total'] },
    schemaSupport: 'strict',
    temperature: 0.2,
    thinking: 'low',
    timeoutMs: 5000,
};

const settings = resolveAiSettings({
    connections: {
        claude: { preset: 'anthropic' },
        gem: { preset: 'gemini-api' },
        sarvam: { preset: 'sarvam' },
        other: { preset: 'other', baseUrl: 'https://llm.example.com/v1', header: 'api-key' },
        bad: { preset: 'other', baseUrl: 'https://llm.example.com/v1', header: 'host' },
    },
});

afterEach(() => vi.unstubAllGlobals());

describe('presets added in AM1', () => {
    it('are marked not tested live, with the day their docs were read and their prices', () => {
        for (const id of ['anthropic', 'gemini-api', 'mistral', 'mistral-eu', 'groq', 'xai', 'sarvam']) {
            expect(AI_PRESETS[id]).toMatchObject({ testedLive: false, docsReadOn: '2026-11-02', pricesCheckedOn: '2026-11-02' });
            for (const m of Object.values(AI_PRESETS[id].models)) expect(m.priceIn ?? m.price).toBeGreaterThan(0);
        }
        expect(AI_PRESETS['sarvam']).toMatchObject({ currency: 'INR', perMinute: 60 });
        expect(AI_PRESETS['openrouter'].testedLive).toBeUndefined();
    });

    it('send each key in its provider\'s header, and Other in the admin\'s', () => {
        expect(connectionAuth(settings.connections['claude'])).toEqual({ header: 'x-api-key', prefix: '' });
        expect(connectionAuth(settings.connections['gem'])).toEqual({ header: 'x-goog-api-key', prefix: '' });
        expect(connectionAuth(settings.connections['sarvam'])).toEqual({ header: 'api-subscription-key', prefix: '' });
        expect(connectionAuth(settings.connections['other'])).toEqual({ header: 'api-key', prefix: '' });
        // A header that would change the request itself is dropped: the key goes as Bearer.
        expect(settings.connections['bad'].header).toBe('');
        expect(connectionAuth(settings.connections['bad'])).toEqual({ header: 'authorization', prefix: 'Bearer ' });
        expect(safeHeaderName('x-api-key')).toBe(true);
        for (const h of ['host', 'cookie', 'content-type', 'x-forwarded-for', 'Bad Header']) expect(safeHeaderName(h)).toBe(false);
    });
});

describe('connection limits', () => {
    it('use the admin\'s numbers, else the preset\'s, and 0 for none at all', () => {
        const s = resolveAiSettings({ connections: { a: { preset: 'sarvam' }, b: { preset: 'sarvam', perMinute: 200 }, c: { preset: 'sarvam', perMinute: 0, atOnce: 0 }, d: { preset: 'groq' } } });
        expect(connectionLimits(s.connections['a'])).toEqual({ perMinute: 60, atOnce: null });
        expect(connectionLimits(s.connections['b'])).toEqual({ perMinute: 200, atOnce: null });
        expect(connectionLimits(s.connections['c'])).toEqual({ perMinute: null, atOnce: null });
        expect(connectionLimits(s.connections['d'])).toEqual({ perMinute: null, atOnce: null });
    });
});

describe('Anthropic', () => {
    it('sends the instruction as system, the parts in order, a strict schema and the effort, never a temperature', () => {
        const body = messagesBody(request) as Record<string, any>;
        expect(body['system']).toBe('Read the receipt.');
        expect(body['max_tokens']).toBe(16_000);
        const content = body['messages'][0].content as Array<Record<string, any>>;
        expect(content.map((c) => c.type)).toEqual(['document', 'image', 'text']);
        expect(content[0].source).toEqual({ type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') });
        expect(body['output_config']).toMatchObject({ effort: 'low', format: { type: 'json_schema', schema: { additionalProperties: false } } });
        expect(body).not.toHaveProperty('temperature');
        expect(messagesBody({ ...request, schemaSupport: 'json', thinking: undefined })).not.toHaveProperty('output_config');
    });

    it('adds cached and written tokens to the input, as Anthropic counts them apart', () => {
        const r = readMessagesResponse(200, new Headers(), { id: 'msg_1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 20 } });
        expect(r).toEqual({ ok: true, text: 'Hi', requestId: 'msg_1', usage: { tokensIn: 1050, tokensOut: 20, tokensThinking: 0, tokensCached: 900, tokensCacheWrite: 50 } });
    });

    it('reads each failure in Arc\'s words', () => {
        const err = (type: string, message = 'x') => ({ type: 'error', error: { type, message } });
        expect(readMessagesResponse(200, new Headers(), { stop_reason: 'refusal', content: [] })).toMatchObject({ ok: false, failure: 'blocked' });
        expect(readMessagesResponse(200, new Headers(), { stop_reason: 'max_tokens', content: [] })).toMatchObject({ ok: false, failure: 'unreadable' });
        expect(readMessagesResponse(401, new Headers(), err('authentication_error'))).toMatchObject({ failure: 'key-refused' });
        expect(readMessagesResponse(404, new Headers(), err('not_found_error'))).toMatchObject({ failure: 'retired' });
        expect(readMessagesResponse(400, new Headers(), err('invalid_request_error', 'prompt is too long'))).toMatchObject({ failure: 'too-large' });
        expect(readMessagesResponse(400, new Headers(), err('invalid_request_error', 'Your credit balance is too low'))).toMatchObject({ failure: 'unavailable', outOfCredit: true });
        expect(readMessagesResponse(429, new Headers({ 'retry-after': '7' }), err('rate_limit_error'))).toMatchObject({ failure: 'unavailable', rateLimited: true, wait: 7 });
        expect(readMessagesResponse(529, new Headers(), err('overloaded_error'))).toMatchObject({ failure: 'unavailable' });
        expect(readMessagesResponse(400, new Headers(), err('invalid_request_error', 'bad field'))).toMatchObject({ failure: 'unreadable' });
    });

    it('calls the Messages API with the key and version, and gives back the answer without the added nulls', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"total":null}' }], usage: { input_tokens: 5, output_tokens: 2 } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await anthropicConnector({ connection: settings.connections['claude'], key: 'sk-ant-12345678' }, request);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-12345678', 'anthropic-version': ANTHROPIC_VERSION });
        expect(init.redirect).toBe('error');
        expect(r).toMatchObject({ ok: true, text: '{"total":null}' });
        expect(await anthropicConnector({ connection: settings.connections['claude'], key: null }, request)).toMatchObject({ ok: false, failure: 'off' });
    });
});

describe('the Gemini API', () => {
    it('calls generateContent with the key in x-goog-api-key, and counts cached tokens', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 800, candidatesTokenCount: 4 } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await geminiConnector({ connection: settings.connections['gem'], key: 'AIza-12345678' }, { ...request, model: 'gemini-3.8-flash', schema: null });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
        expect(init.headers).toMatchObject({ 'x-goog-api-key': 'AIza-12345678' });
        expect(r).toMatchObject({ ok: true, text: 'OK', usage: { tokensIn: 1000, tokensCached: 800, tokensOut: 4 } });
    });

    it('reads a refused key as the key\'s, and a 429 as busy', () => {
        expect(readGeminiResponse(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })).toMatchObject({ failure: 'key-refused' });
        expect(readGeminiResponse(403, { error: { message: 'denied' } })).toMatchObject({ failure: 'key-refused' });
        expect(readGeminiResponse(429, { error: { message: 'quota', status: 'RESOURCE_EXHAUSTED' } })).toMatchObject({ failure: 'unavailable', rateLimited: true });
        expect(readGeminiResponse(400, { error: { message: 'odd' } })).toMatchObject({ failure: 'unreadable', detail: expect.stringContaining('The Gemini API refused') });
    });
});

describe('the OpenAI-style connector, for AM1', () => {
    it('sends the key in the preset\'s header: Sarvam\'s api-subscription-key', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await openAiConnector({ connection: settings.connections['sarvam'], key: 'sarvam-key-123' }, { ...request, model: 'sarvam-105b', schema: null, parts: [{ kind: 'text', text: 'Hi' }] });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://api.sarvam.ai/v1/chat/completions');
        expect(init.headers).toMatchObject({ 'api-subscription-key': 'sarvam-key-123' });
        expect(init.headers).not.toHaveProperty('authorization');
    });

    it('counts cached and written tokens, and says when the provider is rate limited or out of credit', () => {
        const ok = readResponse(200, new Headers(), { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 } } });
        expect(ok).toMatchObject({ ok: true, usage: { tokensIn: 1000, tokensCached: 600, tokensCacheWrite: 100 } });
        expect(readResponse(429, new Headers({ 'retry-after': '3' }), { error: { message: 'slow down' } })).toMatchObject({ failure: 'unavailable', rateLimited: true, wait: 3 });
        expect(readResponse(402, new Headers(), { error: { message: 'no credit' } })).toMatchObject({ failure: 'unavailable', outOfCredit: true });
        expect(readResponse(403, new Headers(), { error: { message: 'quota', code: 'insufficient_quota_error' } })).toMatchObject({ failure: 'key-refused' });
        expect(readResponse(498, new Headers(), { error: { message: 'capacity' } })).toMatchObject({ failure: 'unavailable' });
    });
});
