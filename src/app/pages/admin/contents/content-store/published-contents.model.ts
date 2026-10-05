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
    /**
     * Editorial "last substantive revision" date, set from the SEO panel.
     * Feeds `dateModified` in the page's structured data, the sitemap's
     * `lastmod` and the visible "Updated" line, and only when it is later
     * than `publishedOn`. Deliberately not `modifiedAt`, which moves on every
     * save (specs/discoverability-spec.md, D-D3).
     */
    updatedOn?: Date | null;
    /**
     * The `Authors/{id}` this item is credited to, and the name denormalised
     * for lists and search (specs/discoverability-spec.md, D-D5). The name is
     * kept even if the author is later deleted.
     */
    authorId?: string | null;
    authorName?: string;
    /**
     * The detail layout this item uses: `detail-{layout}.html` in its type's
     * template folder; empty or missing for the folder's `detail.html`
     * (specs/site-sections-spec.md, SS8). Shared by every language.
     */
    layout?: string;
    /**
     * Sources the author cited (specs/discoverability-spec.md, D-D11):
     * rendered as a "Sources" list and emitted as Article.citation.
     */
    references?: { title: string; url: string }[];
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
