/**
 * One HTTPS request for a file connector (specs/ai-media-spec.md, AM-D7): plain fetch with
 * the call's time limit, no redirects (a key must never follow one to another host), and the
 * answer read once, as JSON or as bytes. A request that could not be sent or timed out comes
 * back in the connectors' own words.
 */
import type { AttemptFailure } from './types.js';

export type HttpAnswer = { ok: true; status: number; headers: Headers; bytes: Buffer; json: Record<string, unknown> | null } | { ok: false; failure: AttemptFailure; detail: string };

/** Send one request; `service` names the provider in a failure. */
export async function sendRequest(url: string, init: RequestInit, timeoutMs: number, service: string): Promise<HttpAnswer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
        const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
        const bytes = Buffer.from(await response.arrayBuffer());
        let json: Record<string, unknown> | null = null;
        if (/json/i.test(response.headers.get('content-type') ?? '') || (bytes.length && (bytes[0] === 0x7b || bytes[0] === 0x5b))) {
            try {
                const parsed: unknown = JSON.parse(bytes.toString('utf8'));
                json = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
            } catch {
                json = null;
            }
        }
        return { ok: true, status: response.status, headers: response.headers, bytes, json };
    } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: `no answer within ${Math.round(timeoutMs / 1000)} seconds` };
        return { ok: false, failure: 'unavailable', detail: `${service} could not be reached: ${String((err as Error).message ?? err).slice(0, 200)}` };
    } finally {
        clearTimeout(timer);
    }
}

/** A provider's message, short, with anything that looks like a key taken out. */
export function shortMessage(value: unknown): string {
    const raw = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return raw.replace(/(sk|xi|key|Bearer)[-_ ]?[A-Za-z0-9_-]{12,}/gi, '[key]').slice(0, 300);
}

/** A language tag's first part, such as `hi` for `hi-IN`. */
export function languageCode(tag: string | undefined): string | undefined {
    const code = tag?.split('-')[0]?.toLowerCase();
    return code && /^[a-z]{2,3}$/.test(code) ? code : undefined;
}

/** A https address a browser may play, else null: never another scheme from a provider's answer. */
export function httpsUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2000) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
    } catch {
        return null;
    }
}
