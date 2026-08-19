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
import { repeaterHeadingKey, repeaterSchema } from '../../../../../shared/models/repeater.model';

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
    if (field.type === 'text' || field.type === 'richtext') return true;

    // A repeating field is translatable when any part of a row is prose — an
    // Info Card's headline, a gallery caption. Its *structure* is not: the
    // translation tab locks row count, order and media, and supplies only the
    // words. See `translatableRepeaterKeys`.
    const schema = repeaterSchema(field.type);
    if (!schema) return false;

    return schema.subFields.some((sub) => sub.translatable)
        || schema.heading?.translatable === true;
}

/**
 * The row keys a translator may fill in for a repeating field, plus `id` so
 * the merge can match rows.
 *
 * Everything else — position, images, icons, video URLs — belongs to the
 * default language and is deliberately absent from a translation document.
 */
export function translatableRepeaterKeys(field: ContentTypeField): string[] {
    const schema = repeaterSchema(field.type);
    if (!schema) return [];

    return ['id', ...schema.subFields.filter((sub) => sub.translatable).map((sub) => sub.key)];
}

/** The heading key a translator may fill in, or null. */
export function translatableHeadingKey(field: ContentTypeField): string | null {
    const schema = repeaterSchema(field.type);
    if (!schema?.heading?.translatable) return null;
    return repeaterHeadingKey(field.key, schema);
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
