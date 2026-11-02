/**
 * The Anthropic connector (specs/ai-media-spec.md, AM-D7, section 6.1): the Messages API over
 * plain HTTPS, no SDK. Written from Anthropic's docs as read on 2026-11-02 and not tested
 * live (AM-D34).
 *
 * The key goes in `x-api-key` with `anthropic-version`. No temperature is sent: Anthropic's
 * current models refuse sampling settings. `thinking` sets the effort. A strict schema goes
 * in `output_config.format`, which Anthropic holds the answer to. Cached input comes back
 * apart from `input_tokens`, so the connector adds it in (AM-D31).
 */
import { parseJsonAnswer, strictSchema, withoutAddedNulls } from '../schema.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import { errorText, waitFrom } from './openai.js';
import type { AttemptUsage, Connector, ConnectorRequest, ConnectorResult } from './types.js';

export const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic needs a ceiling on every answer; this is what one gets when the purpose sets none. */
export const DEFAULT_MAX_TOKENS = 16_000;

export function messagesBody(request: ConnectorRequest): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = request.parts.map((part) => {
        if (part.kind === 'text') return { type: 'text', text: part.text };
        const source = { type: 'base64', media_type: part.mimeType, data: part.bytes.toString('base64') };
        return part.kind === 'picture' ? { type: 'image', source } : { type: 'document', source };
    });
    if (!content.length) content.push({ type: 'text', text: '' });
    const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        system: request.instruction,
        messages: [{ role: 'user', content }],
    };
    const output: Record<string, unknown> = {};
    if (request.schema && request.schemaSupport === 'strict') output['format'] = { type: 'json_schema', schema: strictSchema(request.schema) };
    if (request.thinking) output['effort'] = request.thinking;
    if (Object.keys(output).length) body['output_config'] = output;
    return body;
}

function usageOf(data: Record<string, unknown>): AttemptUsage {
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const cached = n(u['cache_read_input_tokens']);
    const written = n(u['cache_creation_input_tokens']);
    // input_tokens counts only what came after the cache; Arc's tokensIn is every input token.
    const usage: AttemptUsage = { tokensIn: n(u['input_tokens']) + cached + written, tokensOut: n(u['output_tokens']), tokensThinking: 0 };
    if (cached) usage.tokensCached = cached;
    if (written) usage.tokensCacheWrite = written;
    return usage;
}

/** One HTTP answer in the connector's words. */
export function readMessagesResponse(status: number, headers: Headers, body: unknown): ConnectorResult {
    const data = (body ?? {}) as Record<string, unknown>;
    if (status >= 200 && status < 300) {
        const usage = usageOf(data);
        const requestId = typeof data['id'] === 'string' ? data['id'] : undefined;
        const stop = String(data['stop_reason'] ?? '');
        if (stop === 'refusal') return { ok: false, failure: 'blocked', detail: 'the model declined the request', usage, requestId };
        const blocks = Array.isArray(data['content']) ? (data['content'] as Array<Record<string, unknown>>) : [];
        const text = blocks.filter((b) => b['type'] === 'text' && typeof b['text'] === 'string').map((b) => b['text'] as string).join('');
        if (!text.trim() && stop === 'max_tokens') return { ok: false, failure: 'unreadable', detail: 'the answer ran out of tokens before it began', usage, requestId };
        return { ok: true, text, usage, requestId };
    }
    const err = (data['error'] ?? {}) as Record<string, unknown>;
    const type = String(err['type'] ?? '');
    const detail = errorText(body);
    if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') return { ok: false, failure: 'key-refused', detail: `Anthropic refused the key (${status}): ${detail}` };
    if (/credit balance/i.test(detail) || type === 'billing_error') return { ok: false, failure: 'unavailable', detail: `the Anthropic account has no credit (${status}): ${detail}`, outOfCredit: true };
    if (status === 404 || type === 'not_found_error') return { ok: false, failure: 'retired', detail: `the model is not there (${status}): ${detail}` };
    if (status === 413 || type === 'request_too_large' || /prompt is too long|too large/i.test(detail)) return { ok: false, failure: 'too-large', detail };
    if (status === 429 || type === 'rate_limit_error') return { ok: false, failure: 'unavailable', detail: `429: ${detail}`, wait: waitFrom(headers), rateLimited: true };
    // 529 is Anthropic's "overloaded".
    if (status >= 500 || type === 'overloaded_error' || type === 'api_error') return { ok: false, failure: 'unavailable', detail: `${status}: ${detail}`, wait: waitFrom(headers) };
    return { ok: false, failure: 'unreadable', detail: `Anthropic refused the request (${status}): ${detail}` };
}

export const anthropicConnector: Connector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    const auth = connectionAuth(connection);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
        const response = await fetch(`${base}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, [auth.header]: `${auth.prefix}${key}` },
            body: JSON.stringify(messagesBody(request)),
            signal: controller.signal,
            redirect: 'error',
        });
        const raw = await response.text();
        let body: unknown = null;
        try {
            body = raw ? JSON.parse(raw) : null;
        } catch {
            body = { error: { message: raw.slice(0, 300) } };
        }
        const result = readMessagesResponse(response.status, response.headers, body);
        if (!result.ok || !request.schema || request.schemaSupport !== 'strict') return result;
        const data = parseJsonAnswer(result.text);
        return data === undefined ? result : { ...result, text: JSON.stringify(withoutAddedNulls(data, request.schema)) };
    } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: `no answer within ${Math.round(request.timeoutMs / 1000)} seconds` };
        return { ok: false, failure: 'unavailable', detail: `Anthropic could not be reached: ${String((err as Error).message ?? err).slice(0, 200)}` };
    } finally {
        clearTimeout(timer);
    }
};
