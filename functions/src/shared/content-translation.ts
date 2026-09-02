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

/**
 * Path prefix for a language: '' for the default language — whose URLs are
 * unchanged by the multilingual feature — and '/{code}' for every other.
 */
export function langPrefix(lang: string, defaultLang: string): string {
    return lang && lang !== defaultLang ? `/${lang}` : '';
}

/**
 * Absolute URL of a content detail page in a given language.
 * The slug is identical across languages; only the prefix differs.
 */
export function detailUrl(
    baseUrl: string,
    lang: string,
    defaultLang: string,
    contentTypeSlug: string,
    urlSlug: string,
): string {
    return `${baseUrl.replace(/\/+$/, '')}${langPrefix(lang, defaultLang)}/${contentTypeSlug}/${urlSlug}`;
}

/** Absolute URL of a content list page in a given language. */
export function listUrl(
    baseUrl: string,
    lang: string,
    defaultLang: string,
    contentTypeSlug: string,
): string {
    return `${baseUrl.replace(/\/+$/, '')}${langPrefix(lang, defaultLang)}/${contentTypeSlug}`;
}

/** Hosting file path for a detail page in a given language. */
export function detailFilePath(
    lang: string,
    defaultLang: string,
    contentTypeSlug: string,
    urlSlug: string,
): string {
    return `${langPrefix(lang, defaultLang)}/${contentTypeSlug}/${urlSlug}.html`;
}

/** Hosting file path for a list page in a given language. */
export function listFilePath(lang: string, defaultLang: string, contentTypeSlug: string): string {
    return `${langPrefix(lang, defaultLang)}/${contentTypeSlug}/index.html`;
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
 * Overlays a translation's rows onto the base rows of a repeating field.
 *
 * The default language owns the *structure* — how many rows there are, their
 * order, their images and icons. A translation supplies only prose, and only
 * for rows that still exist.
 *
 * Rows are matched by `id`, never by position. An index would move: delete the
 * second of four cards and every later translation shifts onto the wrong card,
 * publishing the wrong text under the wrong headline with no error. Matching
 * by id also means a translation row whose card has since been deleted is
 * simply ignored rather than resurrected.
 *
 * `id` and `position` are never taken from the translation, so a translation
 * cannot reorder or re-key the list even if its stored document says otherwise.
 */
function mergeTranslatedRows(
    baseRows: unknown[],
    translatedRows: unknown[],
): unknown[] {
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of translatedRows) {
        if (row && typeof row === 'object') {
            const id = (row as Record<string, unknown>)['id'];
            if (typeof id === 'string') byId.set(id, row as Record<string, unknown>);
        }
    }

    return baseRows.map((row) => {
        if (!row || typeof row !== 'object') return row;

        const base = row as Record<string, unknown>;
        const id = base['id'];
        const translated = typeof id === 'string' ? byId.get(id) : undefined;
        if (!translated) return base;

        const merged: Record<string, unknown> = { ...base };
        for (const [key, value] of Object.entries(translated)) {
            if (key === 'id' || key === 'position') continue;
            if (hasValue(value)) merged[key] = value;
        }
        return merged;
    });
}

/** Both sides being row arrays is what marks a value as a repeating field. */
function isRowArray(value: unknown): boolean {
    return Array.isArray(value)
        && value.every((row) => !!row && typeof row === 'object' && typeof (row as Record<string, unknown>)['id'] === 'string');
}

/**
 * Overlays a translation onto its base content document.
 *
 * Fields the translator left blank keep the base value, so a half-finished
 * translation still deploys a complete page rather than one with holes in it.
 * `customFields` merges key-by-key for the same reason.
 */
export function mergeTranslation<T extends object>(
    base: T,
    translation: ContentTranslation | null | undefined,
): T {
    if (!translation) return base;

    // See the client mirror: declared interfaces are not assignable to
    // Record<string, unknown>, so the indexing is cast here rather than pushed
    // onto every call site.
    const source = base as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...source };

    for (const field of TRANSLATABLE_BUILTIN_FIELDS) {
        const value = translation[field];
        if (hasValue(value)) merged[field] = value;
    }

    if (translation.customFields) {
        const mergedCustom: Record<string, unknown> = {
            ...((source['customFields'] as Record<string, unknown>) ?? {}),
        };
        for (const [key, value] of Object.entries(translation.customFields)) {
            const baseValue = mergedCustom[key];

            // A repeating field merges row by row: structure from the base,
            // prose from the translation. Replacing it wholesale would let a
            // translation drop cards or lose their images.
            if (isRowArray(baseValue) && isRowArray(value)) {
                mergedCustom[key] = mergeTranslatedRows(baseValue as unknown[], value as unknown[]);
                continue;
            }

            if (hasValue(value)) mergedCustom[key] = value;
        }
        merged['customFields'] = mergedCustom;
    }

    return merged as T;
}

/**
 * The page title for one language variant.
 *
 * `seoTitle || title` is the right precedence *within* a language and the
 * wrong one across two: a translator who filled in the title but left the SEO
 * title blank would get the base language's `seoTitle` — English chrome on an
 * otherwise translated page, which is what a translated page exists to avoid.
 * So the translation is asked first, in full, and only a language with nothing
 * to say falls back.
 *
 * Mirrors localizedPageTitle in
 * src/app/pages/admin/contents/draft-content-store/content-translation.model.ts,
 * so the static page and the SPA fallback title a page the same way.
 */
export function localizedPageTitle(
    localizedContent: { seoTitle?: string; title?: string },
    translation?: { seoTitle?: string; title?: string } | null,
): string {
    return translation?.seoTitle
        || translation?.title
        || localizedContent.seoTitle
        || localizedContent.title
        || '';
}
