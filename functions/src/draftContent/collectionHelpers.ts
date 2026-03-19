/**
 * Helpers for identifying draft/published collection names
 * in the per-content-type collection pattern: arc_{slug}_drafts / arc_{slug}
 */

export const DRAFT_COLLECTION_REGEX = /^arc_(.+)_drafts$/;

export function extractContentTypeSlug(collectionId: string): string | null {
  const match = collectionId.match(DRAFT_COLLECTION_REGEX);
  return match ? match[1] : null;
}

export function getPublishedCollectionName(slug: string): string {
  return `arc_${slug}`;
}

export function getDraftCollectionName(slug: string): string {
  return `arc_${slug}_drafts`;
}
