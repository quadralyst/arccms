/**
 * Google Vertex AI for Gemini (specs/ai-spec.md, AI-D6, AI-D7): the Gemini API on Vertex,
 * over REST, signed with the functions' own service account through google-auth-library,
 * so there is no key to paste or leak. The location is the connection's, else the
 * multi-region of the functions region; never `global` unless the admin types it.
 *
 * Setup on the project: the Vertex AI API on, and the functions' service account with the
 * Vertex AI User role (docs/app/ai.html#vertex).
 */
import { GoogleAuth } from 'google-auth-library';
import type { JsonSchema } from '../schema.js';
import { defaultVertexLocation } from '../settings.js';
import type { Connector, ConnectorRequest, ConnectorResult, AttemptUsage } from './types.js';

let auth: GoogleAuth | null = null;

function googleAuth(): GoogleAuth {
    auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return auth;
}

/** Where Vertex answers for a location: the multi-region, regional or worldwide host. */
export function vertexHost(location: string): string {
    if (location === 'global') return 'aiplatform.googleapis.com';
    if (location === 'eu' || location === 'us') return `aiplatform.${location}.rep.googleapis.com`;
    return `${location}-aiplatform.googleapis.com`;
}

/**
 * A JSON schema in the form Vertex's responseSchema takes (an OpenAPI subset): a type list
 * with null becomes `nullable`, and `additionalProperties` is left out. Arc checks the
 * answer against the full schema afterwards.
 */
export function vertexSchema(schema: JsonSchema): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
    const real = types.filter((t) => t !== 'null');
    if (real.length) out['type'] = real[0];
    if (types.includes('null')) out['nullable'] = true;
    if (schema.description) out['description'] = schema.description;
    // Vertex takes text enums only; any other enum is left to Arc's own check.
    if (schema.enum?.every((e) => typeof e === 'string')) {
        out['enum'] = schema.enum;
        out['type'] ??= 'string';
    }
    if (schema.properties) {
        out['properties'] = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, vertexSchema(v)]));
        out['propertyOrdering'] = Object.keys(schema.properties);
    }
    if (schema.required) out['required'] = schema.required;
    if (schema.items) out['items'] = vertexSchema(schema.items);
    if (schema.minItems !== undefined) out['minItems'] = schema.minItems;
    if (schema.maxItems !== undefined) out['maxItems'] = schema.maxItems;
    return out;
}

export function generateBody(request: ConnectorRequest): Record<string, unknown> {
    const parts = request.parts.map((part) => (part.kind === 'text'
        ? { text: part.text }
        : { inlineData: { mimeType: part.mimeType, data: part.bytes.toString('base64') } }));
    const generationConfig: Record<string, unknown> = {};
    if (request.schema) {
        generationConfig['responseMimeType'] = 'application/json';
        if (request.schemaSupport === 'strict') generationConfig['responseSchema'] = vertexSchema(request.schema);
    }
    if (request.maxOutputTokens) generationConfig['maxOutputTokens'] = request.maxOutputTokens;
    if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
    if (request.thinking) generationConfig['thinkingConfig'] = { thinkingLevel: request.thinking };
    return {
        systemInstruction: { parts: [{ text: request.instruction }] },
        contents: [{ role: 'user', parts: parts.length ? parts : [{ text: '' }] }],
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    };
}

const BLOCKED_FINISH = ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION', 'IMAGE_SAFETY'];

function usageOf(data: Record<string, unknown>): AttemptUsage {
    const u = (data['usageMetadata'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const thinking = n(u['thoughtsTokenCount']);
    // Thinking is billed as output: tokensOut holds all of it, tokensThinking the part that was thinking.
    return { tokensIn: n(u['promptTokenCount']), tokensOut: n(u['candidatesTokenCount']) + thinking, tokensThinking: thinking };
}

/** One HTTP answer in the connector's words. */
export function readGenerateResponse(status: number, body: unknown): ConnectorResult {
    const data = (body ?? {}) as Record<string, unknown>;
    if (status >= 200 && status < 300) {
        const usage = usageOf(data);
        const requestId = typeof data['responseId'] === 'string' ? data['responseId'] : undefined;
        const feedback = (data['promptFeedback'] ?? {}) as Record<string, unknown>;
        if (feedback['blockReason']) return { ok: false, failure: 'blocked', detail: `the question was blocked (${String(feedback['blockReason'])})`, usage, requestId };
        const candidate = ((data['candidates'] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
        if (!candidate) return { ok: false, failure: 'unreadable', detail: 'the answer had no candidates', usage, requestId };
        const finish = String(candidate['finishReason'] ?? '');
        if (BLOCKED_FINISH.includes(finish)) return { ok: false, failure: 'blocked', detail: `the answer was blocked (${finish})`, usage, requestId };
        const parts = (((candidate['content'] ?? {}) as Record<string, unknown>)['parts'] as Array<Record<string, unknown>>) ?? [];
        const text = parts.filter((p) => p['thought'] !== true && typeof p['text'] === 'string').map((p) => p['text'] as string).join('');
        if (!text.trim() && finish === 'MAX_TOKENS') return { ok: false, failure: 'unreadable', detail: 'the answer ran out of tokens before it began', usage, requestId };
        return { ok: true, text, usage, requestId };
    }
    const err = (data['error'] ?? {}) as Record<string, unknown>;
    const message = String(err['message'] ?? JSON.stringify(body ?? '')).slice(0, 300);
    const code = String(err['status'] ?? '');
    if (status === 404 || code === 'NOT_FOUND') return { ok: false, failure: 'retired', detail: `the model is not there in this location (404): ${message}` };
    if (status === 401 || status === 403 || code === 'PERMISSION_DENIED') {
        return { ok: false, failure: 'off', detail: `Vertex AI refused the project's service account (${status}): switch on the Vertex AI API and give it the Vertex AI User role. ${message}` };
    }
    if (status === 429 || status >= 500 || code === 'RESOURCE_EXHAUSTED' || code === 'UNAVAILABLE') return { ok: false, failure: 'unavailable', detail: `${status}: ${message}` };
    if (/token|too large|exceeds|size/i.test(message)) return { ok: false, failure: 'too-large', detail: message };
    if (/safety|blocked|prohibited/i.test(message)) return { ok: false, failure: 'blocked', detail: message };
    return { ok: false, failure: 'unreadable', detail: `Vertex AI refused the request (${status}): ${message}` };
}

/** The project to call Vertex in: the functions' own. */
async function projectId(): Promise<string> {
    return process.env['GCLOUD_PROJECT'] || process.env['GOOGLE_CLOUD_PROJECT'] || (await googleAuth().getProjectId());
}

export const vertexConnector: Connector = async ({ connection }, request) => {
    const location = connection.location || defaultVertexLocation();
    if (!/^[a-z0-9-]{2,30}$/.test(location)) return { ok: false, failure: 'off', detail: `connection ${connection.id}: "${location}" is not a location` };
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(request.model)) return { ok: false, failure: 'retired', detail: `"${request.model}" is not a model id` };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
        const [project, token] = await Promise.all([projectId(), googleAuth().getAccessToken()]);
        const url = `https://${vertexHost(location)}/v1/projects/${project}/locations/${location}/publishers/google/models/${request.model}:generateContent`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(generateBody(request)),
            signal: controller.signal,
            redirect: 'error',
        });
        const raw = await response.text();
        let body: unknown;
        try {
            body = raw ? JSON.parse(raw) : null;
        } catch {
            body = { error: { message: raw.slice(0, 300) } };
        }
        return readGenerateResponse(response.status, body);
    } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: `no answer within ${Math.round(request.timeoutMs / 1000)} seconds` };
        return { ok: false, failure: 'unavailable', detail: `Vertex AI could not be reached: ${String((err as Error).message ?? err).slice(0, 200)}` };
    } finally {
        clearTimeout(timer);
    }
};
