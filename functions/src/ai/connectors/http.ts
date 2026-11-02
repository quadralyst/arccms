/**
 * One HTTPS request for a file connector (specs/ai-media-spec.md, AM-D7): plain fetch with
 * the call's time limit, no redirects (a key must never follow one to another host), and the
 * answer read once, as JSON or as bytes. A request that could not be sent or timed out comes
 * back in the connectors' own words.
 */
import { safeBaseUrl } from '../settings.js';
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

/** The most a download from a provider's file address may be: a video's worth. */
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Fetch a file a provider made from the address in its answer (AM-D28): https only, a host
 * the preset lists for its downloads (by suffix, such as `.aliyuncs.com`), never with the key,
 * and every redirect checked the same way, at most three. Answers the bytes, or a failure in
 * the connectors' words.
 */
export async function downloadFile(address: unknown, hosts: readonly string[], timeoutMs: number, service: string, maxBytes = MAX_DOWNLOAD_BYTES): Promise<{ ok: true; bytes: Buffer; contentType: string } | { ok: false; failure: AttemptFailure; detail: string }> {
    let url = httpsUrl(address);
    // A listed host, and a public one by the same rules as an admin's address (AI-D19), on every hop.
    const allowed = (u: string) => {
        const parsed = new URL(u);
        const host = parsed.hostname.toLowerCase();
        return safeBaseUrl(`${parsed.protocol}//${parsed.host}`) && hosts.some((h) => host === h.replace(/^\./, '') || (h.startsWith('.') && host.endsWith(h)));
    };
    const deadline = Date.now() + timeoutMs;
    for (let hop = 0; hop < 4; hop++) {
        if (!url || !allowed(url)) return { ok: false, failure: 'unreadable', detail: `${service} gave a file address Arc does not fetch from` };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
        try {
            const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
            if (response.status >= 300 && response.status < 400) {
                const next = response.headers.get('location');
                url = next ? httpsUrl(new URL(next, url).toString()) : null;
                continue;
            }
            if (response.status !== 200) return { ok: false, failure: response.status >= 500 ? 'unavailable' : 'unreadable', detail: `${service}'s file could not be fetched (${response.status})` };
            const length = Number(response.headers.get('content-length'));
            if (Number.isFinite(length) && length > maxBytes) return { ok: false, failure: 'too-large', detail: `${service}'s file is larger than Arc fetches (${Math.round(length / 1048576)} MB)` };
            // Read in parts and stop at the cap, so an answer with no length cannot fill the memory.
            const parts: Buffer[] = [];
            let size = 0;
            const reader = response.body?.getReader();
            if (reader) {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.length;
                    if (size > maxBytes) {
                        await reader.cancel().catch(() => undefined);
                        return { ok: false, failure: 'too-large', detail: `${service}'s file is larger than Arc fetches` };
                    }
                    parts.push(Buffer.from(value));
                }
            } else {
                parts.push(Buffer.from(await response.arrayBuffer()));
                if (parts[0].length > maxBytes) return { ok: false, failure: 'too-large', detail: `${service}'s file is larger than Arc fetches` };
            }
            return { ok: true, bytes: Buffer.concat(parts), contentType: response.headers.get('content-type') ?? '' };
        } catch (err) {
            if ((err as { name?: string }).name === 'AbortError') return { ok: false, failure: 'timeout', detail: `${service}'s file did not come within the call's time` };
            return { ok: false, failure: 'unavailable', detail: `${service}'s file could not be fetched: ${String((err as Error).message ?? err).slice(0, 160)}` };
        } finally {
            clearTimeout(timer);
        }
    }
    return { ok: false, failure: 'unreadable', detail: `${service}'s file address redirected too many times` };
}
