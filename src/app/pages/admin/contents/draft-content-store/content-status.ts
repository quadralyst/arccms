/**
 * Content publish status
 *
 * A content item carries two independent facts: whether a published page
 * exists, and whether the draft has moved on since that page was published.
 * `publishedStatus` alone collapses them, so a published article with a week
 * of unpublished edits looked identical to one that is perfectly in sync.
 *
 * These are surfaced as three mutually exclusive states, because from the
 * author's point of view the question is "what do I need to do about this
 * row?" and that has exactly one answer.
 */

export type ContentPublishState = 'draft' | 'published' | 'edited';

/**
 * Normalizes the several shapes a timestamp arrives in — a Firestore
 * `Timestamp`, its serialized `{seconds}` form, an ISO string, or a `Date`.
 */
export function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    if (typeof value === 'object') {
        const candidate = value as { toDate?: () => Date; seconds?: number };
        if (typeof candidate.toDate === 'function') {
            const date = candidate.toDate();
            return isNaN(date.getTime()) ? null : date;
        }
        if (typeof candidate.seconds === 'number') {
            return new Date(candidate.seconds * 1000);
        }
        return null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }

    return null;
}

/**
 * Which of the three states a content row is in.
 *
 * `lastPublishedAt` is stamped on the draft by the publish pipeline *after*
 * the published copy is written, so it is always at or after the `modifiedAt`
 * of the write that triggered it. A draft edited afterwards therefore has
 * `modifiedAt > lastPublishedAt` exactly — no timing tolerance needed.
 *
 * Rows published before that field existed have no `lastPublishedAt`. Those
 * report `published` rather than `edited`: the honest answer is "unknown", and
 * a badge that cries wolf teaches authors to ignore it.
 */
export function deriveContentStatus(row: Record<string, unknown> | null | undefined): ContentPublishState {
    if (!row || !row['publishedStatus']) return 'draft';

    const lastPublishedAt = toDate(row['lastPublishedAt']);
    if (!lastPublishedAt) return 'published';

    const modifiedAt = toDate(row['modifiedAt']) ?? toDate(row['updatedAt']);
    if (!modifiedAt) return 'published';

    return modifiedAt.getTime() > lastPublishedAt.getTime() ? 'edited' : 'published';
}

/**
 * The English labels, kept as the source of truth for tests and for anything
 * that needs a state's name without an injector to hand.
 */
export const CONTENT_STATUS_LABEL: Record<ContentPublishState, string> = {
    draft: 'Draft',
    published: 'Published',
    edited: 'Edited',
};

/** Translation keys for the same three states, for anything user-facing. */
export const CONTENT_STATUS_LABEL_KEY: Record<ContentPublishState, string> = {
    draft: 'common.status.draft',
    published: 'common.status.published',
    edited: 'common.status.edited',
};

/**
 * Badge tone per state. `edited` is amber — it is not an error, it is an
 * outstanding action.
 */
export const CONTENT_STATUS_CLASS: Record<ContentPublishState, string> = {
    draft: 'inactive',
    published: 'active',
    edited: 'pending',
};

export const CONTENT_STATUS_TOOLTIP: Record<ContentPublishState, string> = {
    draft: 'Not published yet',
    published: 'Live and up to date',
    edited: 'Published, with draft changes that are not live yet',
};

export const CONTENT_STATUS_TOOLTIP_KEY: Record<ContentPublishState, string> = {
    draft: 'common.status.tooltip.draft',
    published: 'common.status.tooltip.published',
    edited: 'common.status.tooltip.edited',
};
