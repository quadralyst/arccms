/**
 * What the connectors share: reading a header, a time limit on a call, and words about a
 * failure with nothing secret in them (rule 9). No slow library here: the webhook loads this.
 */
import type { ConnectorError, Headers } from '../types.js';

export function headerValue(headers: Headers, name: string): string {
    const value = headers[name] ?? headers[name.toLowerCase()];
    const one = Array.isArray(value) ? value[0] : value;
    return typeof one === 'string' ? one : '';
}

/**
 * A provider's words, short, for a detail an app may log: only letters, digits and plain
 * punctuation, and anything long enough to be a key or an address taken out.
 */
export function safeDetail(value: unknown): string {
    const raw = typeof value === 'string' ? value : '';
    return raw
        .replace(/[^\w .,:;'()/-]/g, ' ')
        .split(/\s+/)
        // A provider's own error name is long, and says what went wrong, and no key looks like it.
        .map((word) => ((word.length >= 24 && !/^[A-Z]+(?:_[A-Z]+)+$/.test(word)) || /^https?:/i.test(word) ? '[removed]' : word))
        .join(' ')
        .trim()
        .slice(0, 160);
}

/** Runs a call within a time limit; a call that throws or takes too long comes back in the connectors' words. */
export async function withTimeout<T>(call: () => Promise<T>, timeoutMs: number, service: string): Promise<T | ConnectorError> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ConnectorError>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, failure: 'timeout', detail: `${service} did not answer within ${Math.round(timeoutMs / 1000)} seconds` }), Math.max(1, timeoutMs));
    });
    try {
        return await Promise.race([call(), timeout]);
    } catch {
        // An error from a library can quote the request, keys included: only its fact is kept.
        return { ok: false, failure: 'unavailable', detail: `${service} could not be reached` };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
