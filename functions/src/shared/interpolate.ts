/**
 * `{{ token }}` substitution for translated strings.
 *
 * One rule, used by all three renderers of `data-arc-t`: the Angular directive,
 * the SPA hydrator and the publish pipeline. Extracted so a translation like
 * `"वापस {{ contentType }} पर"` cannot mean one thing on a published page and
 * another in the SPA fallback.
 *
 * Mirrored in src/app/core/i18n/interpolate.ts.
 *
 * Spec: docs/i18n-guide.md — §1.4.
 */

/** Replaces `{{ name }}` tokens; an unknown token is left exactly as authored. */
export function interpolate(
    text: string,
    params: Record<string, unknown> | null | undefined,
): string {
    if (!params || !text || !text.includes('{{')) return text;
    return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
    });
}

/**
 * Reads a `data-arc-t-params` attribute.
 *
 * In an Angular template it is a property binding and arrives as an object; in
 * a static template it is a literal attribute, so it is written as JSON:
 *
 *   <span data-arc-t="min_read" data-arc-t-params='{"count": 5}'>5 min read</span>
 *
 * Malformed JSON yields no params rather than throwing — a broken annotation
 * must degrade to the authored English, never abort a publish.
 */
export function parseParams(raw: string | null | undefined): Record<string, unknown> | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}
