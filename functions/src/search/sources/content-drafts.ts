/**
 * Draft content: every `arc_{slug}_drafts` collection, one entry per
 * language, linking to the editor. Admin scope, so only the admin header
 * search and the admin results page ever see these.
 *
 * Indexed by the wildcard trigger: drafts are written by the browser, so
 * nothing server-side sees the write otherwise.
 *
 * Spec: docs/search-spec.md, decision S-D14 and phase S2 item 3.
 */

import { getDraftCollectionName, extractContentTypeSlug } from '../../draftContent/collectionHelpers.js';
import { contentTypeName } from '../../shared/content-type-names.js';
import type { SearchSource } from '../source.js';
import { loadContentTypes } from '../context.js';
import {
    contentSearchFields,
    contentSnippet,
    contentTitle,
    contentTypeFor,
    contentVariants,
} from './content-fields.js';

export const CONTENT_DRAFTS_SOURCE_ID = 'content-drafts';

export const DRAFT_COLLECTION_REGEX = /^arc_(.+)_drafts$/;

function toMillis(value: unknown): number | null {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis();
    }
    if (typeof value === 'object' && typeof (value as { seconds?: unknown }).seconds === 'number') {
        return (value as { seconds: number }).seconds * 1000;
    }
    return null;
}

/**
 * Draft, Published or Edited, the way the admin list derives it
 * (src/app/pages/admin/contents/draft-content-store/content-status.ts).
 */
export function draftState(doc: Record<string, unknown>): 'draft' | 'published' | 'edited' {
    if (!doc['publishedStatus']) return 'draft';
    const lastPublishedAt = toMillis(doc['lastPublishedAt']);
    if (!lastPublishedAt) return 'published';
    const modifiedAt = toMillis(doc['modifiedAt']) ?? toMillis(doc['updatedAt']);
    if (!modifiedAt) return 'published';
    return modifiedAt > lastPublishedAt ? 'edited' : 'published';
}

const STATE_LABEL = { draft: 'Draft', published: 'Published', edited: 'Edited' } as const;

export const contentDraftsSource: SearchSource = {
    id: CONTENT_DRAFTS_SOURCE_ID,
    collection: DRAFT_COLLECTION_REGEX,
    scope: 'admin',
    fields: (_doc, ctx) => contentSearchFields(contentTypeFor(ctx, extractContentTypeSlug(ctx.collection) ?? '')),
    include: (_doc, ctx) => !!contentTypeFor(ctx, extractContentTypeSlug(ctx.collection) ?? ''),
    variants: contentVariants,
    display: (doc, ctx, lang) => {
        const slug = extractContentTypeSlug(ctx.collection) ?? ctx.collection;
        const type = contentTypeFor(ctx, slug);
        const state = draftState(doc);
        return {
            title: contentTitle(doc),
            snippet: contentSnippet(doc),
            badge: `${type ? contentTypeName(type, lang) : slug} · ${STATE_LABEL[state]}`,
            link: `/admin/contents/${slug}/edit/${ctx.docId}`,
            meta: { contentType: slug, state },
            sortAt: doc['modifiedAt'] ?? doc['updatedAt'] ?? doc['createdAt'],
        };
    },
    expandCollections: async () => {
        const types = await loadContentTypes(true);
        return [...types.keys()].map(getDraftCollectionName);
    },
};
