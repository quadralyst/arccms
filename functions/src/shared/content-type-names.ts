/**
 * Content-type display names per language.
 *
 * Mirrors `contentTypeName` in
 * src/app/pages/admin/contents/content-types/content-types.model.ts — the
 * publish pipeline and the SPA must label a page the same way.
 *
 * Spec: docs/multilingual-spec.md — Phase M5.2, decision M-D19.
 */

export interface ContentTypeNames {
    name?: string;
    singularName?: string;
}

interface NameSource {
    name?: string;
    singularName?: string;
    nameTranslations?: Record<string, ContentTypeNames>;
}

/** The type's plural name in a language, falling back to the default. */
export function contentTypeName(type: NameSource, lang?: string): string {
    const translated = lang ? type.nameTranslations?.[lang]?.name : '';
    return translated?.trim() || type.name || '';
}

/** The type's singular name in a language, falling back to the default. */
export function contentTypeSingularName(type: NameSource, lang?: string): string {
    const translated = lang ? type.nameTranslations?.[lang]?.singularName : '';
    return translated?.trim() || type.singularName || type.name || '';
}
