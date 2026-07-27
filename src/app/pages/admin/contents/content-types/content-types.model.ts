import { IBaseModel } from '../../../../../shared/models/base-model';

export type ContentTypeFieldType = 'text' | 'number' | 'richtext' | 'date' | 'datetime' | 'image' | 'boolean' | 'dropdown' | 'checkbox' | 'radio';

export interface CollectionReferenceConfig {
    collectionSlug: string;         // slug of the referenced content type (e.g., "authors")
    collectionName: string;         // display name of the referenced content type (e.g., "Authors")
    displayField: string;           // field key used as the label shown to the user (e.g., "title")
    valueField: string;             // field key used as the stored value/identifier (e.g., "id")
    syncFields: string[];           // field keys to denormalize/store redundantly (e.g., ["title", "urlSlug", "coverImage"])
}

export interface ContentTypeField {
    key: string;
    label: string;
    type: ContentTypeFieldType;
    required: boolean;
    order: number;
    options?: string;                           // Comma-separated options for dropdown, checkbox, radio (manual mode)
    useCollectionRef?: boolean;                  // NEW: true = options come from another collection
    collectionRef?: CollectionReferenceConfig;   // NEW: configuration for collection reference
}

export interface ContentType extends IBaseModel {
    name: string;           // Plural name (e.g., "Articles") - used for lists
    singularName?: string;  // Singular name (e.g., "Article") - used for single items
    slug: string;
    description?: string;
    icon?: string;
    order: number;
    fields: ContentTypeField[];
    templateFolder?: string; // Template folder name (e.g., "blog") or "default" for built-in template
    listColumns?: string[]; // Keys of columns to show in the list view
    hasPublicUrl?: boolean; // When false, no static HTML pages are generated for this content type
    /**
     * Per-language display names, keyed by BCP-47 code — e.g.
     * `{ hi: { name: 'लेख', singularName: 'लेख' } }`.
     *
     * The type's name reaches the public pages ("Back to Articles", the list
     * page heading), so without this a translated page keeps an English noun
     * however well its chrome is translated. Admin-entered data, so it lives
     * beside the type rather than in the static strings JSON (decision M-D19).
     *
     * Absent or blank for a language means the default `name`/`singularName`.
     */
    nameTranslations?: Record<string, ContentTypeNames>;
}

/** Display names for one language. */
export interface ContentTypeNames {
    name?: string;
    singularName?: string;
}

/**
 * The type's display name in a language, falling back to the default.
 *
 * Mirrored server-side in functions/src/shared/content-type-names.ts.
 */
export function contentTypeName(type: Pick<ContentType, 'name' | 'nameTranslations'>, lang?: string): string {
    const translated = lang ? type.nameTranslations?.[lang]?.name : '';
    return translated?.trim() || type.name;
}

/** The singular display name in a language, falling back to the default. */
export function contentTypeSingularName(
    type: Pick<ContentType, 'name' | 'singularName' | 'nameTranslations'>,
    lang?: string,
): string {
    const translated = lang ? type.nameTranslations?.[lang]?.singularName : '';
    return translated?.trim() || type.singularName || type.name;
}

/**
 * Drops blank entries so a language the admin left empty simply falls back to
 * the default name, rather than persisting empty strings that read as
 * "translated to nothing".
 */
export function pruneNameTranslations(
    raw: Record<string, ContentTypeNames> | null | undefined,
): Record<string, ContentTypeNames> {
    const pruned: Record<string, ContentTypeNames> = {};
    for (const [lang, names] of Object.entries(raw ?? {})) {
        const entry: ContentTypeNames = {};
        if (names?.name?.trim()) entry.name = names.name.trim();
        if (names?.singularName?.trim()) entry.singularName = names.singularName.trim();
        if (Object.keys(entry).length > 0) pruned[lang] = entry;
    }
    return pruned;
}
