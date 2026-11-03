/**
 * The OpenAI-style connector (specs/ai-spec.md, AI-D6): Chat Completions over plain HTTPS,
 * which OpenAI, Alibaba Cloud Model Studio, DeepSeek, OpenRouter, Hugging Face and most
 * others speak. No SDK, so a function's cold start stays small. Pictures and PDFs go inline
 * as data URLs.
 */
import { findPreset } from '../presets.js';
import { parseJsonAnswer, strictSchema, withoutAddedNulls } from '../schema.js';
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import type { Connector, ConnectorRequest, ConnectorResult, AttemptUsage } from './types.js';

/** The request body, as the provider gets it. */
export interface ChatOptions {
    /** OpenRouter: ask for the call's cost. OpenAI refuses a field it does not know, so only there. */
    askCost?: boolean;
    /** OpenAI itself: `max_completion_tokens`, which its reasoning models need in place of `max_tokens`. */
    completionTokens?: boolean;
    /** Leave temperature out: the model refused it. */
    noTemperature?: boolean;
    /** OpenRouter: route only to hosts that honour every parameter sent, so a strict schema is kept. */
    openRouter?: boolean;
}

/**
 * The user message's content. Text alone goes as one string, which every Chat Completions
 * server takes (Sarvam's refuses a list of parts); with pictures or PDFs, as a list of parts.
 */
export function chatContent(parts: ConnectorRequest['parts']): string | Array<Record<string, unknown>> {
    const texts = parts.flatMap((part) => (part.kind === 'text' ? [part.text] : []));
    if (texts.length === parts.length) return texts.join('\n\n');
    return parts.map((part) => {
        if (part.kind === 'text') return { type: 'text', text: part.text };
        const url = `data:${part.mimeType};base64,${part.bytes.toString('base64')}`;
        if (part.kind === 'picture') return { type: 'image_url', image_url: { url } };
        return { type: 'file', file: { filename: part.name ?? 'document.pdf', file_data: url } };
    });
}

export function chatBody(request: ConnectorRequest, options: ChatOptions = {}): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model: request.model,
        messages: [
            // No instruction, no system message: some servers refuse an empty one.
            ...(request.instruction ? [{ role: 'system', content: request.instruction }] : []),
            { role: 'user', content: chatContent(request.parts) },
        ],
    };
    if (request.schema) {
        body['response_format'] = request.schemaSupport === 'strict'
            ? { type: 'json_schema', json_schema: { name: 'answer', schema: strictSchema(request.schema), strict: true } }
            : { type: 'json_object' };
    }
    if (request.maxOutputTokens) body[options.completionTokens ? 'max_completion_tokens' : 'max_tokens'] = request.maxOutputTokens;
    if (request.temperature !== undefined && !options.noTemperature) body['temperature'] = request.temperature;
    if (options.askCost) body['usage'] = { include: true };
    if (request.thinking) {
        if (options.openRouter) body['reasoning'] = { effort: request.thinking };
        else if (options.completionTokens) body['reasoning_effort'] = request.thinking;
    }
    if (options.openRouter && request.schema && request.schemaSupport === 'strict') body['provider'] = { require_parameters: true };
    return body;
}

function usageOf(data: Record<string, unknown>): AttemptUsage {
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const details = (u['completion_tokens_details'] ?? {}) as Record<string, unknown>;
    const promptDetails = (u['prompt_tokens_details'] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    const usage: AttemptUsage = { tokensIn: n(u['prompt_tokens']), tokensOut: n(u['completion_tokens']), tokensThinking: n(details['reasoning_tokens']) };
    // Cached tokens are part of prompt_tokens (AM-D31); cache writes, where billed, too.
    const cached = n(promptDetails['cached_tokens']) || n(u['prompt_cache_hit_tokens']);
    const written = n(promptDetails['cache_write_tokens']) || n(u['cache_write_tokens']);
    if (cached) usage.tokensCached = Math.min(cached, usage.tokensIn);
    if (written) usage.tokensCacheWrite = Math.min(written, usage.tokensIn - (usage.tokensCached ?? 0));
    if (typeof u['cost'] === 'number' && Number.isFinite(u['cost'])) usage.costUsd = u['cost'];
    return usage;
}

export function waitFrom(headers: Headers): number | undefined {
    const raw = headers.get('retry-after');
    if (!raw) return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : undefined;
}

/** The provider's error message, short, without anything that looks like a key. */
export function errorText(body: unknown): string {
    const err = (body as { error?: unknown })?.error;
    const raw = typeof err === 'string' ? err : typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : JSON.stringify(body ?? '');
    return raw.replace(/(sk|hf|key|Bearer)[-_ ]?[A-Za-z0-9_-]{12,}/gi, '[key]').slice(0, 300);
}

/**
 * Whether OpenAI's answer says the account has no credit (a 429 with `insufficient_quota`
 * and one of its billing codes), not that it is busy: retrying will not help.
 */
export function outOfCreditError(body: unknown): boolean {
    const err = (body as { error?: Record<string, unknown> })?.error;
    const type = String(err?.['type'] ?? '').toLowerCase();
    const code = String(err?.['code'] ?? '').toLowerCase();
    return type === 'insufficient_quota' || /^(insufficient_quota|credit_balance_exhausted|organization_spend_limit_exceeded|project_spend_limit_exceeded|organization_usage_limit_exceeded|billing_hard_limit_reached)$/.test(code);
}

function errorCode(body: unknown): string {
    const err = (body as { error?: Record<string, unknown> })?.error;
    return String(err?.['code'] ?? err?.['type'] ?? '').toLowerCase();
}

const BLOCK_WORDS = /content[_ ]?(filter|policy|management)|inspection|moderation|safety|harmful|inappropriate/i;
const TOO_LARGE_WORDS = /context[_ ]?length|too (long|large|many tokens)|maximum context|request entity too large|payload/i;
const MODEL_GONE_WORDS = /model[^.]*(not[_ ]?found|does not exist|deprecated|retired|decommissioned|not supported|unknown)|no such model|invalid model/i;

/** One HTTP answer in the connector's words. */
export function readResponse(status: number, headers: Headers, body: unknown): ConnectorResult {
    const data = (body ?? {}) as Record<string, unknown>;
    if (status >= 200 && status < 300) {
        const choice = ((data['choices'] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
        const usage = usageOf(data);
        const requestId = typeof data['id'] === 'string' ? data['id'] : undefined;
        if (!choice) return { ok: false, failure: 'unreadable', detail: 'the answer had no choices', usage, requestId };
        const message = (choice['message'] ?? {}) as Record<string, unknown>;
        const finish = String(choice['finish_reason'] ?? '');
        if (finish === 'content_filter') return { ok: false, failure: 'blocked', detail: 'the provider blocked the answer', usage, requestId };
        if (typeof message['refusal'] === 'string' && message['refusal']) return { ok: false, failure: 'blocked', detail: `the model refused: ${String(message['refusal']).slice(0, 200)}`, usage, requestId };
        const content = message['content'];
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : String((c as { text?: unknown })?.text ?? ''))).join('') : '';
        if (finish === 'length' && !text.trim()) return { ok: false, failure: 'unreadable', detail: 'the answer ran out of tokens before it began', usage, requestId };
        return { ok: true, text, usage, requestId };
    }
    const detail = errorText(body);
    const code = errorCode(body);
    if (status === 401 || status === 403) {
        if (BLOCK_WORDS.test(detail) || BLOCK_WORDS.test(code)) return { ok: false, failure: 'blocked', detail };
        return { ok: false, failure: 'key-refused', detail: `the provider refused the key (${status}): ${detail}` };
    }
    if (status === 402 || code === 'insufficient_quota_error' || outOfCreditError(body)) return { ok: false, failure: 'unavailable', detail: `the provider account has no credit (${status}): ${detail}`, outOfCredit: true };
    if (status === 404 || MODEL_GONE_WORDS.test(detail) || code === 'model_not_found') return { ok: false, failure: 'retired', detail: `the model is not there (${status}): ${detail}` };
    if (status === 413 || TOO_LARGE_WORDS.test(detail) || code.includes('context_length')) return { ok: false, failure: 'too-large', detail };
    if (status === 429) return { ok: false, failure: 'unavailable', detail: `429: ${detail}`, wait: waitFrom(headers), rateLimited: true };
    // 498 is Groq's "capacity exceeded".
    if (status === 408 || status === 498 || status >= 500) return { ok: false, failure: 'unavailable', detail: `${status}: ${detail}`, wait: waitFrom(headers) };
    if (BLOCK_WORDS.test(detail) || BLOCK_WORDS.test(code)) return { ok: false, failure: 'blocked', detail };
    // Another 4xx: the request itself, which no other model would take either.
    return { ok: false, failure: 'unreadable', detail: `the provider refused the request (${status}): ${detail}` };
}

/** A strict answer as the purpose's schema has it, without the nulls strictSchema() allowed. */
function fromStrict(result: Extract<ConnectorResult, { ok: true }>, request: ConnectorRequest): ConnectorResult {
    const data = parseJsonAnswer(result.text);
    return data === undefined ? result : { ...result, text: JSON.stringify(withoutAddedNulls(data, request.schema!)) };
}

export const openAiConnector: Connector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    const auth = connectionAuth(connection);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
        const options: ChatOptions = {
            askCost: findPreset(connection.preset)?.reportsCost === true,
            completionTokens: connection.preset === 'openai' || connection.preset === 'openai-eu',
            openRouter: connection.preset === 'openrouter',
        };
        const send = async (o: ChatOptions) => {
            const response = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
                body: JSON.stringify(chatBody(request, o)),
                signal: controller.signal,
                redirect: 'error',
            });
            const raw = await response.text();
            let body: unknown = null;
            try {
                body = raw ? JSON.parse(raw) : null;
            } catch {
                body = { error: raw.slice(0, 300) };
            }
            return { response, body };
        };
        let { response, body } = await send(options);
        // Reasoning models take no temperature: ask once more without it.
        if (response.status === 400 && request.temperature !== undefined && /temperature/i.test(errorText(body))) {
            ({ response, body } = await send({ ...options, noTemperature: true }));
        }
        const result = readResponse(response.status, response.headers, body);
        return result.ok && request.schema && request.schemaSupport === 'strict' ? fromStrict(result, request) : result;
    } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: `no answer within ${Math.round(request.timeoutMs / 1000)} seconds` };
        return { ok: false, failure: 'unavailable', detail: `the provider could not be reached: ${String((err as Error).message ?? err).slice(0, 200)}` };
    } finally {
        clearTimeout(timer);
    }
};
