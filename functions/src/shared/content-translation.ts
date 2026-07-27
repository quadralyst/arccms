/**
 * Content translation merging (server side).
 *
 * A translation is a sibling document — `arc_{slug}[_drafts]/{id}/translations/{lang}`
 * — holding only the fields that differ in that language. Rendering a language
 * means overlaying it on the base content document.
 *
 * Mirrors `mergeTranslation` in
 * src/app/pages/admin/contents/draft-content-store/content-translation.model.ts.
 * The publish pipeline must merge exactly the way the editor previews, so the
 * two implementations are kept in step (see contentTranslation.spec.ts).
 *
 * Spec: docs/multilingual-spec.md — Phase M2/M3, decision M-D1.
 */

/** Built-in content fields that can be translated (decision M-D5). */
export const TRANSLATABLE_BUILTIN_FIELDS = [
    'title',
    'content',
    'summary',
    'seoTitle',
    'metaDescription',
] as const;

export interface ContentTranslation {
    lang: string;
    title?: string;
    content?: string;
    summary?: string;
    seoTitle?: string;
    metaDescription?: string;
    customFields?: Record<string, unknown>;
    translatedAt?: unknown;
    translatedBy?: string;
    aiGenerated?: boolean;
}

/** Blank means "not translated" — including whitespace-only and empty HTML. */
function hasValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') {
        const stripped = value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        return stripped.length > 0;
    }
    return true;
}

/**
 * Overlays a translation onto its base content document.
 *
 * Fields the translator left blank keep the base value, so a half-finished
 * translation still deploys a complete page rather than one with holes in it.
 * `customFields` merges key-by-key for the same reason.
 */
export function mergeTranslation<T extends Record<string, unknown>>(
    base: T,
    translation: ContentTranslation | null | undefined,
): T {
    if (!translation) return base;

    const merged: Record<string, unknown> = { ...base };

    for (const field of TRANSLATABLE_BUILTIN_FIELDS) {
        const value = translation[field];
        if (hasValue(value)) merged[field] = value;
    }

    if (translation.customFields) {
        const mergedCustom: Record<string, unknown> = {
            ...((base['customFields'] as Record<string, unknown>) ?? {}),
        };
        for (const [key, value] of Object.entries(translation.customFields)) {
            if (hasValue(value)) mergedCustom[key] = value;
        }
        merged['customFields'] = mergedCustom;
    }

    return merged as T;
}
