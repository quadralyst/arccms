import { IBaseModel, OmitCommonFields } from '../../../../../shared/models/base-model';

/**
 * Interface for published content items
 */
export interface IContents extends IBaseModel {
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
    isFeatured: boolean;
    readTime?: number; // Reading time in minutes
    summary?: string;
    nextContent?: { id: string; title: string; summary: string; slug: string } | null;
    previousContent?: { id: string; title: string; summary: string; slug: string } | null;

    // Deployment status fields (written by Cloud Function processPublishQueue)
    deployStatus?: 'deployed' | 'failed' | 'pending';
    deployError?: string;
    deployErrorCode?: string;
    deployedAt?: Date | null;
    deployedUrl?: string;
    deployDurationMs?: number;
}

export type IContentsData = OmitCommonFields<IContents>;

export const COMPONENT_NAME: string = 'Contents';
