/**
 * The Vertex connector for Gemini (specs/ai-spec.md, AI-D6, AI-D7): where it calls, the
 * request it sends, the schema in Vertex's form, and how each kind of answer reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', () => ({ db: {}, storage: {}, owner: {} }));
vi.mock('google-auth-library', () => ({
    GoogleAuth: class {
        getAccessToken = async () => 'token-1';
        getProjectId = async () => 'demo-project';
    },
}));

import { generateBody, readGenerateResponse, vertexConnector, vertexHost, vertexSchema } from '../ai/connectors/vertex.js';
import { resolveAiSettings } from '../ai/settings.js';
import type { ConnectorRequest } from '../ai/connectors/types.js';

const request: ConnectorRequest = {
    model: 'gemini-3.8-flash',
    instruction: 'Read the invoice.',
    parts: [{ kind: 'text', text: 'Total in EUR.' }, { kind: 'pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7'), name: null, storagePath: null }],
    schema: { type: 'object', properties: { total: { type: ['number', 'null'] }, currency: { enum: ['EUR', 'CHF'] }, lines: { type: 'array', items: { type: 'string' } } }, required: ['total'], additionalProperties: false },
    schemaSupport: 'strict',
    maxOutputTokens: 800,
    timeoutMs: 5000,
};

describe('vertexHost', () => {
    it('calls the multi-region, regional or worldwide host for the location', () => {
        expect(vertexHost('eu')).toBe('aiplatform.eu.rep.googleapis.com');
        expect(vertexHost('us')).toBe('aiplatform.us.rep.googleapis.com');
        expect(vertexHost('europe-west4')).toBe('europe-west4-aiplatform.googleapis.com');
        expect(vertexHost('global')).toBe('aiplatform.googleapis.com');
    });
});

describe('generateBody', () => {
    it('sends the instruction, the parts inline, and the schema in Vertex\'s form', () => {
        const body = generateBody(request) as Record<string, any>;
        expect(body['systemInstruction']).toEqual({ parts: [{ text: 'Read the invoice.' }] });
        expect(body['contents'][0].parts).toEqual([{ text: 'Total in EUR.' }, { inlineData: { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') } }]);
        expect(body['generationConfig']).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 800 });
        expect(body['generationConfig'].responseSchema).toEqual({
            type: 'object',
            properties: { total: { type: 'number', nullable: true }, currency: { enum: ['EUR', 'CHF'], type: 'string' }, lines: { type: 'array', items: { type: 'string' } } },
            propertyOrdering: ['total', 'currency', 'lines'],
            required: ['total'],
        });
        expect(vertexSchema({ enum: [1, 2] })).toEqual({});
    });
});

describe('readGenerateResponse', () => {
    it('reads the answer without its thoughts, counting thinking as output', () => {
        const result = readGenerateResponse(200, {
            responseId: 'r1',
            candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"total":12}' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20, thoughtsTokenCount: 100 },
        });
        expect(result).toEqual({ ok: true, text: '{"total":12}', usage: { tokensIn: 900, tokensOut: 120, tokensThinking: 100 }, requestId: 'r1' });
    });

    it('names each failure', () => {
        const cases: Array<[number, unknown, string]> = [
            [200, { promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
            [200, { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }, 'blocked'],
            [200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }, 'unreadable'],
            [200, { candidates: [] }, 'unreadable'],
            [404, { error: { status: 'NOT_FOUND', message: 'Publisher Model gemini-2.0 was not found' } }, 'retired'],
            [403, { error: { status: 'PERMISSION_DENIED', message: 'Vertex AI API has not been used' } }, 'off'],
            [429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, 'unavailable'],
            [503, { error: { status: 'UNAVAILABLE' } }, 'unavailable'],
            [400, { error: { status: 'INVALID_ARGUMENT', message: 'The input token count exceeds the maximum' } }, 'too-large'],
            [400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload' } }, 'unreadable'],
        ];
        for (const [status, body, failure] of cases) {
            const result = readGenerateResponse(status, body);
            expect(result.ok, JSON.stringify(body)).toBe(false);
            if (!result.ok) expect(result.failure, JSON.stringify(body)).toBe(failure);
        }
    });
});

describe('vertexConnector', () => {
    const settings = resolveAiSettings({ connections: { g: { preset: 'vertex' }, nl: { preset: 'vertex', location: 'europe-west4' } } });
    afterEach(() => vi.unstubAllGlobals());

    it('calls the project\'s Vertex with the service account, in the functions region\'s multi-region by default', async () => {
        const prior = process.env['ARC_FUNCTIONS_REGION'];
        process.env['ARC_FUNCTIONS_REGION'] = 'europe-west6';
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        try {
            expect(await vertexConnector({ connection: settings.connections['g'], key: null }, request)).toMatchObject({ ok: true, text: 'OK' });
            const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe(`https://aiplatform.eu.rep.googleapis.com/v1/projects/${process.env['GCLOUD_PROJECT'] || 'demo-project'}/locations/eu/publishers/google/models/gemini-3.8-flash:generateContent`);
            expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer token-1');
            await vertexConnector({ connection: settings.connections['nl'], key: null }, request);
            expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toContain('https://europe-west4-aiplatform.googleapis.com/v1/projects/');
        } finally {
            if (prior === undefined) delete process.env['ARC_FUNCTIONS_REGION'];
            else process.env['ARC_FUNCTIONS_REGION'] = prior;
        }
    });

    it('refuses a model id that is not one', async () => {
        expect(await vertexConnector({ connection: settings.connections['g'], key: null }, { ...request, model: '../x' })).toMatchObject({ ok: false, failure: 'retired' });
    });
});
