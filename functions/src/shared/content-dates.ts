/**
 * Publish and update dates of a content item, resolved once so the sitemap,
 * the JSON-LD and the visible "Updated" line can never disagree.
 *
 * `updatedOn` is an editorial field the author sets from the SEO panel
 * ("Mark as updated today"). It is deliberately not `modifiedAt`, which moves
 * on every save including a typo fix and would overstate freshness
 * (docs/discoverability-spec.md, D-D3).
 */
import { toIsoDate } from './structured-data.js';

export interface ContentDates {
    /** ISO 8601, or undefined when the item has no publish date. */
    published?: string;
    /** ISO 8601: `updatedOn` when set, else `published`. */
    modified?: string;
    /** True only when `updatedOn` is strictly later than the publish date. */
    isUpdated: boolean;
}

export function resolveContentDates(content: { publishedOn?: unknown; updatedOn?: unknown }): ContentDates {
    const published = toIsoDate(content.publishedOn);
    const updated = toIsoDate(content.updatedOn);
    const isUpdated = !!updated && (!published || Date.parse(updated) > Date.parse(published));
    return {
        published,
        modified: isUpdated ? updated : published,
        isUpdated,
    };
}

/** `YYYY-MM-DD` for sitemap `<lastmod>`; today when the item has no dates at all. */
export function lastmodDate(content: { publishedOn?: unknown; updatedOn?: unknown; modifiedAt?: unknown }): string {
    const { modified } = resolveContentDates(content);
    const iso = modified || toIsoDate(content.modifiedAt) || new Date().toISOString();
    return iso.split('T')[0];
}
