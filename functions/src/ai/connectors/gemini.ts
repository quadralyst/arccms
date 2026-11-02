/**
 * The Gemini API connector (specs/ai-media-spec.md, AM-D7, section 6.1): Gemini with an API
 * key, at generativelanguage.googleapis.com, for a site that has no Google Cloud project of
 * its own to bill. Written from Google's docs as read on 2026-11-02 and not tested live
 * (AM-D34).
 *
 * Text goes through `generateContent`, which takes the same body as Vertex, so the request
 * and the answer are read by vertex.ts. Only the address, the key header and what a refused
 * key looks like differ.
 */
import { connectionAuth, connectionBaseUrl } from '../settings.js';
import { errorText } from './openai.js';
import { generateBody, readGenerateResponse } from './vertex.js';
import type { Connector, ConnectorResult } from './types.js';

/** One HTTP answer in the connector's words: a refused key is the key's, not a service account's. */
export function readGeminiResponse(status: number, body: unknown): ConnectorResult {
    const err = ((body ?? {}) as { error?: Record<string, unknown> }).error ?? {};
    const reason = JSON.stringify(err['details'] ?? '');
    const message = errorText(body);
    if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(`${reason} ${message}`))) {
        return { ok: false, failure: 'key-refused', detail: `the Gemini API refused the key (${status}): ${message}` };
    }
    return readGenerateResponse(status, body, 'The Gemini API');
}

export const geminiConnector: Connector = async ({ connection, key }, request) => {
    const base = connectionBaseUrl(connection);
    if (!base) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no address it may call` };
    if (!key) return { ok: false, failure: 'off', detail: `connection ${connection.id} has no key` };
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(request.model)) return { ok: false, failure: 'retired', detail: `"${request.model}" is not a model id` };
    const auth = connectionAuth(connection);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
        const response = await fetch(`${base}/models/${request.model}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [auth.header]: `${auth.prefix}${key}` },
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
        return readGeminiResponse(response.status, body);
    } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: `no answer within ${Math.round(request.timeoutMs / 1000)} seconds` };
        return { ok: false, failure: 'unavailable', detail: `the Gemini API could not be reached: ${String((err as Error).message ?? err).slice(0, 200)}` };
    } finally {
        clearTimeout(timer);
    }
};
