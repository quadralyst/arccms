import { IBaseModel, OmitCommonFields } from '../../../../../shared/models/base-model';

/**
 * Interface for next content reference
 * Stores denormalized data for displaying linked content
 */
export interface INextContentReference {
    id: string;           // ID of the referenced content
    title: string;        // Title at time of save
    summary: string;      // Summary/meta description at time of save
    slug: string;         // URL slug at time of save
}

/**
 * Interface for draft content items
 */
export interface IDraftContents extends IBaseModel {
    id: string;
    title: string;
    content: string;
    urlSlug: string;
    type: string;
    status: 'draft' | 'publish';
    coverImage: string | null;
    tags: string[];
    tagsWithColors?: { name: string; color: string }[]; // Tags with their colors for display
    categoryIdArr: string[];
    categoryNameArr: string[];
    seoTitle: string;
    metaDescription: string;
    canonicalUrl: string;
    publishedOn: Date | null;
    publishedStatus: boolean;
    /**
     * When this draft was last copied to the published collection. Stamped by
     * the publish pipeline *after* the copy, so `modifiedAt > lastPublishedAt`
     * means "edited since publishing". Absent on items published before this
     * field existed — see `deriveContentStatus`.
     */
    lastPublishedAt?: Date;
    isFeatured: boolean;
    readTime?: number; // Reading time in minutes
    // IBaseModel fields are inherited: id, createdBy, createdAt, modifiedBy, modifiedAt
    updatedAt?: Date;  // Legacy field, prefer modifiedAt
    publishedId?: string;  // Links to published version in Contents collection (if any)
    nextContent?: INextContentReference | null;  // Reference to next content in a series
    previousContent?: INextContentReference | null; // Reference to previous content
    summary?: string; // Short summary for list view and SEO default
    customFields?: Record<string, unknown>; // Custom field values keyed by field key
}


export type DraftContentsData = OmitCommonFields<IDraftContents>;

export const COMPONENT_NAME: string = 'DraftContents';
