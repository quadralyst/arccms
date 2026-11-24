/**
 * Content-type display names per language.
 *
 * Mirrors `contentTypeName` in
 * src/app/pages/admin/contents/content-types/content-types.model.ts — the
 * publish pipeline and the SPA must label a page the same way.
 *
 * Spec: specs/multilingual-spec.md — Phase M5.2, decision M-D19.
 */

export interface ContentTypeNames {
    name?: string;
    singularName?: string;
    description?: string;
}

interface NameSource {
    name?: string;
    singularName?: string;
    description?: string;
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

/**
 * The type's description in a language, falling back to the default.
 *
 * It is the subtitle under the list page heading, so an untranslated one is
 * the most visible English left on an otherwise translated page.
 */
export function contentTypeDescription(type: NameSource, lang?: string): string {
    const translated = lang ? type.nameTranslations?.[lang]?.description : '';
    return translated?.trim() || type.description || '';
}

/**
 * Whether the type has its own name and description in a language, rather than
 * the default language's: what a list page in it says until an editor changes
 * it (specs/visual-editing-spec.md, VE-D60).
 */
export function contentTypeNamedIn(type: NameSource, lang: string): { title: boolean; intro: boolean } {
    const own = type.nameTranslations?.[lang];
    return { title: !!own?.name?.trim(), intro: !!own?.description?.trim() };
}
