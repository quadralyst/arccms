import { IBaseModel } from '../../../../../shared/models/base-model';

export type ContentTypeFieldType = 'text' | 'number' | 'richtext' | 'date' | 'datetime' | 'image' | 'icon' | 'boolean' | 'dropdown' | 'checkbox' | 'radio' | 'infocard' | 'gallery' | 'labelvalue';

export interface CollectionReferenceConfig {
    collectionSlug: string;         // slug of the referenced content type (e.g., "authors")
    collectionName: string;         // display name of the referenced content type (e.g., "Authors")
    displayField: string;           // field key used as the label shown to the user (e.g., "title")
    valueField: string;             // field key used as the stored value/identifier (e.g., "id")
    /**
     * Field keys to denormalize/store redundantly (e.g. ["title", "urlSlug",
     * "coverImage"]).
     *
     * Optional because it genuinely can be: the readers all guard for it
     * (`syncFields || []`, `if (field.collectionRef.syncFields)`), which is
     * the honest reading of documents written before the field existed. The
     * type claimed otherwise, which is what NG8107 was pointing at.
     */
    syncFields?: string[];
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
     * Per-language display text, keyed by BCP-47 code — e.g.
     * `{ hi: { name: 'लेख', singularName: 'लेख', description: '...' } }`.
     *
     * This text reaches the public pages ("Back to Articles", the list page
     * heading and its subtitle), so without it a translated page keeps English
     * prose however well its chrome is translated. Admin-entered data, so it
     * lives beside the type rather than in the static strings JSON (M-D19).
     *
     * Absent or blank for a language falls back to the default field.
     *
     * The stored key still says `name` because it predates the description;
     * renaming it would mean migrating every existing content type for no gain.
     */
    nameTranslations?: Record<string, ContentTypeNames>;
    /**
     * Per-language custom-field labels: `{ hi: { articles_title: 'शीर्षक' } }`,
     * keyed by language then by `ContentTypeField.key`.
     *
     * Kept separate from `nameTranslations` so each field stays accurately
     * named and neither needs migrating. Labels are derived from the live field
     * list, so a field added or removed here appears or disappears in the
     * translation tabs automatically; entries for keys that no longer exist are
     * dropped on save.
     */
    fieldLabelTranslations?: Record<string, Record<string, string>>;
}

/** Display text for one language. */
export interface ContentTypeNames {
    name?: string;
    singularName?: string;
    description?: string;
}

/** The keys of `ContentTypeNames` — what the translation tabs offer. */
export type TranslatableTypeText = keyof ContentTypeNames;

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
 * The type's description in a language, falling back to the default.
 *
 * It is the subtitle under the list page heading, so an untranslated one is
 * the most visible English left on an otherwise translated page.
 */
export function contentTypeDescription(
    type: Pick<ContentType, 'description' | 'nameTranslations'> | null | undefined,
    lang?: string,
): string {
    const translated = lang ? type?.nameTranslations?.[lang]?.description : '';
    return translated?.trim() || type?.description || '';
}

/**
 * Drops blank entries so a language the admin left empty simply falls back to
 * the default text, rather than persisting empty strings that read as
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
        if (names?.description?.trim()) entry.description = names.description.trim();
        if (Object.keys(entry).length > 0) pruned[lang] = entry;
    }
    return pruned;
}

/**
 * A custom field's label in a language, falling back to the authored label.
 */
export function contentTypeFieldLabel(
    type: Pick<ContentType, 'fieldLabelTranslations'> | null | undefined,
    fieldKey: string,
    fallback: string,
    lang?: string,
): string {
    const translated = lang ? type?.fieldLabelTranslations?.[lang]?.[fieldKey] : '';
    return translated?.trim() || fallback;
}

/**
 * Drops blank labels and any key that is no longer a field on the type, so the
 * stored translations cannot drift out of step with the field list.
 */
export function pruneFieldLabelTranslations(
    raw: Record<string, Record<string, string>> | null | undefined,
    fieldKeys: string[],
): Record<string, Record<string, string>> {
    const valid = new Set(fieldKeys);
    const pruned: Record<string, Record<string, string>> = {};

    for (const [lang, labels] of Object.entries(raw ?? {})) {
        const entry: Record<string, string> = {};
        for (const [key, label] of Object.entries(labels ?? {})) {
            if (valid.has(key) && label?.trim()) entry[key] = label.trim();
        }
        if (Object.keys(entry).length > 0) pruned[lang] = entry;
    }
    return pruned;
}
