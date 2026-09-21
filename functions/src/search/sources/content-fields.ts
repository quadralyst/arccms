/**
 * What the two content sources share: which fields of a content document
 * are indexed, and the per-language variants built from its translations.
 *
 * Spec: docs/search-spec.md, phase S2 item 1 and decision S-D15.
 */

import { db } from '../../init.js';
import { mergeTranslation, type ContentTranslation } from '../../shared/content-translation.js';
import {
    ANY_LANGUAGE,
    type SearchContentType,
    type SearchContext,
    type SearchDocument,
    type SearchFieldSpec,
    type SearchVariant,
} from '../source.js';

export const CONTENT_TITLE_WEIGHT = 3;
export const CONTENT_SUMMARY_WEIGHT = 2;
export const CONTENT_CUSTOM_WEIGHT = 1;
/** The credited author's name (docs/discoverability-spec.md, D2): "posts by Jane". */
export const CONTENT_AUTHOR_WEIGHT = 1;

/** Custom field types whose values are short prose worth indexing. */
const INDEXABLE_FIELD_TYPES = new Set(['text']);

/** The content type a collection belongs to, or undefined for a stray `arc_` collection. */
export function contentTypeFor(ctx: SearchContext, slug: string): SearchContentType | undefined {
    return ctx.contentTypes.get(slug);
}

/**
 * Title and summary always; custom fields only when an admin listed them on
 * the content type and they are plain text (S-D15). Rich text is never
 * indexed, whatever the list says.
 */
export function contentSearchFields(type: SearchContentType | undefined): SearchFieldSpec[] {
    const specs: SearchFieldSpec[] = [
        { path: 'title', weight: CONTENT_TITLE_WEIGHT, prefix: true },
        { path: 'summary', weight: CONTENT_SUMMARY_WEIGHT, prefix: true },
        { path: 'authorName', weight: CONTENT_AUTHOR_WEIGHT, prefix: true },
    ];
    if (!type) return specs;

    const byKey = new Map(type.fields.map(field => [field.key, field]));
    for (const key of type.searchFields ?? []) {
        const field = byKey.get(key);
        if (!field || !INDEXABLE_FIELD_TYPES.has(field.type)) continue;
        specs.push({ path: `customFields.${key}`, weight: CONTENT_CUSTOM_WEIGHT, prefix: true });
    }
    return specs;
}

/**
 * One variant per language the item exists in: the default language from
 * the base document, then every enabled language with a translation, merged
 * over the base so untranslated fields index the fallback text (S-D10).
 */
export async function contentVariants(doc: SearchDocument, ctx: SearchContext): Promise<SearchVariant[]> {
    const defaultLang = ctx.localization.defaultLanguage || ANY_LANGUAGE;
    const variants: SearchVariant[] = [{ lang: defaultLang, doc }];

    const enabled = new Set(ctx.localization.enabledLanguages.map(language => language.code));
    if (enabled.size <= 1) return variants;

    const translations = await db.collection(ctx.collection).doc(ctx.docId).collection('translations').get();
    for (const snap of translations.docs) {
        const lang = snap.id;
        if (lang === defaultLang || !enabled.has(lang)) continue;
        const translation = { ...(snap.data() as ContentTranslation), lang };
        variants.push({ lang, doc: mergeTranslation(doc, translation) });
    }
    return variants;
}

/** The summary shown under a hit, falling back to the meta description. */
export function contentSnippet(doc: SearchDocument): string {
    const summary = doc['summary'];
    if (typeof summary === 'string' && summary.trim()) return summary;
    const meta = doc['metaDescription'];
    return typeof meta === 'string' ? meta : '';
}

export function contentTitle(doc: SearchDocument): string {
    const title = doc['title'];
    return typeof title === 'string' ? title : '';
}
