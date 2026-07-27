/**
 * Content Translation Model
 *
 * A translation is a *sibling* document, never an edit to the content item
 * itself: `arc_{slug}_drafts/{id}/translations/{lang}` holds only the fields
 * that differ in that language. The base document remains the default-language
 * content, untouched and unmigrated.
 *
 * Rendering a language is therefore `mergeTranslation(base, translation)`, and
 * any field the translator left blank falls back to the default language.
 *
 * Spec: docs/multilingual-spec.md — Phase M2, decisions M-D1 and M-D5.
 */

import { ContentTypeField } from '../content-types/content-types.model';

/** Built-in content fields that can be translated (decision M-D5). */
export const TRANSLATABLE_BUILTIN_FIELDS = [
    'title',
    'content',
    'summary',
    'seoTitle',
    'metaDescription',
] as const;

export type TranslatableBuiltinField = (typeof TRANSLATABLE_BUILTIN_FIELDS)[number];

/**
 * A per-language variant of one content item. Every content field is optional:
 * an absent field means "not translated yet" and falls back to the base
 * document. `lang` is a BCP-47 code and is also the document ID.
 */
export interface IContentTranslation {
    lang: string;
    title?: string;
    content?: string;
    summary?: string;
    seoTitle?: string;
    metaDescription?: string;
    /** Translated custom-field values, keyed by field key. */
    customFields?: Record<string, unknown>;
    translatedAt?: Date;
    translatedBy?: string;
    /** Set when the values came from machine translation and need review. */
    aiGenerated?: boolean;
}

/**
 * Whether a content-type field holds translatable prose.
 *
 * Only free text is translatable. Numbers, dates, booleans and images are
 * language-independent, and dropdown/checkbox/radio values are *keys* chosen
 * from the field's option list — translating them would break the stored
 * value. Collection references hold document IDs for the same reason.
 */
export function isTranslatableField(field: ContentTypeField): boolean {
    if (field.useCollectionRef) return false;
    return field.type === 'text' || field.type === 'richtext';
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
 * Fields the translator left blank keep the base (default-language) value, so
 * a half-finished translation still renders a complete page. `customFields` is
 * merged key-by-key rather than replaced, so untranslated custom fields keep
 * their base values too.
 *
 * Mirrored server-side in functions/src/shared/content-translation.ts — the
 * publish pipeline must merge identically to what the editor previews.
 */
export function mergeTranslation<T extends object>(
    base: T,
    translation: IContentTranslation | null | undefined,
): T {
    if (!translation) return base;

    // Callers pass declared interfaces (IContents, IDraftContents), which
    // TypeScript will not assign to Record<string, unknown> — interfaces get no
    // implicit index signature. The indexing is an implementation detail, so it
    // is cast here rather than pushed onto every call site.
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
            if (hasValue(value)) mergedCustom[key] = value;
        }
        merged['customFields'] = mergedCustom;
    }

    return merged as T;
}

/**
 * Strips a translation down to the fields worth storing — blank values are
 * dropped so they fall back to the base document rather than being persisted
 * as empty overrides.
 */
export function pruneTranslation(translation: IContentTranslation): IContentTranslation {
    const pruned: IContentTranslation = { lang: translation.lang };

    for (const field of TRANSLATABLE_BUILTIN_FIELDS) {
        const value = translation[field];
        if (hasValue(value)) pruned[field] = value as string;
    }

    if (translation.customFields) {
        const custom: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(translation.customFields)) {
            if (hasValue(value)) custom[key] = value;
        }
        if (Object.keys(custom).length > 0) pruned.customFields = custom;
    }

    if (translation.aiGenerated) pruned.aiGenerated = true;
    if (translation.translatedBy) pruned.translatedBy = translation.translatedBy;
    if (translation.translatedAt) pruned.translatedAt = translation.translatedAt;

    return pruned;
}

/** True when a translation carries no translated content at all. */
export function isTranslationEmpty(translation: IContentTranslation): boolean {
    const pruned = pruneTranslation(translation);
    const hasBuiltin = TRANSLATABLE_BUILTIN_FIELDS.some((field) => pruned[field] !== undefined);
    const hasCustom = pruned.customFields !== undefined;
    return !hasBuiltin && !hasCustom;
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
 * Mirrored server-side in functions/src/pages/deployContentPage.ts, so the
 * static page and the SPA fallback title a page the same way.
 */
export function localizedPageTitle(
    localizedContent: { seoTitle?: string; title?: string },
    translation?: IContentTranslation | null,
): string {
    return translation?.seoTitle
        || translation?.title
        || localizedContent.seoTitle
        || localizedContent.title
        || '';
}
