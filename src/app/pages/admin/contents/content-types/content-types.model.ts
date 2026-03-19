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
}
