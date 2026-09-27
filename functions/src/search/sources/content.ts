/**
 * Published content: every `arc_{slug}` collection, one entry per language.
 *
 * Indexed by the publish pipeline rather than the wildcard trigger, so a
 * failed index write shows up in the publish log next to the publish it
 * belongs to (S-D12). The reindex tool walks the collections directly.
 *
 * Spec: docs/search-spec.md, decision S-D14 and phase S2 item 2.
 */

import { getPublishedCollectionName } from '../../draftContent/collectionHelpers.js';
import { contentTypeName } from '../../shared/content-type-names.js';
import { langPrefix } from '../../shared/content-translation.js';
import type { SearchSource } from '../source.js';
import { loadContentTypes } from '../context.js';
import {
    contentSearchFields,
    contentSnippet,
    contentTitle,
    contentTypeFor,
    contentVariants,
} from './content-fields.js';

export const CONTENT_SOURCE_ID = 'content';

/** `arc_{slug}` but not `arc_{slug}_drafts`. */
export const PUBLISHED_COLLECTION_REGEX = /^arc_(?!.*_drafts$).+$/;

export function publishedSlug(collection: string): string {
    return collection.replace(/^arc_/, '');
}

export const contentSource: SearchSource = {
    id: CONTENT_SOURCE_ID,
    collection: PUBLISHED_COLLECTION_REGEX,
    scope: 'public',
    trigger: false,
    fields: (_doc, ctx) => contentSearchFields(contentTypeFor(ctx, publishedSlug(ctx.collection))),
    // A type without public pages has nothing to link a visitor to.
    include: (_doc, ctx) => {
        const type = contentTypeFor(ctx, publishedSlug(ctx.collection));
        return !!type && type.hasPublicUrl !== false;
    },
    variants: contentVariants,
    display: (doc, ctx, lang) => {
        const slug = publishedSlug(ctx.collection);
        const type = contentTypeFor(ctx, slug);
        const urlSlug = typeof doc['urlSlug'] === 'string' ? doc['urlSlug'] : ctx.docId;
        return {
            title: contentTitle(doc),
            snippet: contentSnippet(doc),
            badge: type ? contentTypeName(type, lang) : slug,
            link: `${langPrefix(lang, ctx.localization.defaultLanguage)}/${slug}/${urlSlug}`,
            meta: { contentType: slug, urlSlug },
            sortAt: doc['publishedOn'] ?? doc['modifiedAt'] ?? doc['createdAt'],
        };
    },
    expandCollections: async () => {
        // Listing the database finds stray arc_ collections of deleted types
        // too; the include() check drops those, so either way works. Named
        // here so a reindex does not depend on listCollections permissions.
        const types = await loadContentTypes(true);
        return [...types.keys()].map(getPublishedCollectionName);
    },
};
