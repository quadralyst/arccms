/** Marketing consent state for a contact (spec §3.5). */
export type MarketingConsent = 'subscribed' | 'unsubscribed' | 'pending';

export interface IContact {
    /** Doc id = emailHash. */
    id?: string;
    email: string;
    emailHash?: string;
    name?: string;
    firstName?: string;
    userId?: string;
    sources?: string[];
    listIds?: string[];
    /** Global tag ids (`ContactTags` doc ids). */
    tags?: string[];
    consent?: { marketing: MarketingConsent; marketingChangedAt?: unknown };
}

/**
 * A global audience tag (`ContactTags`). Not to be confused with the CMS's
 * per-content-type `Tags_{slug}` taxonomy — different feature, different rules.
 */
export interface ITag {
    /** Doc id = slug of the label, which is what merges duplicates. */
    id: string;
    label: string;
    color: string;
    usageCount?: number;
}

/**
 * Deterministic tag doc id from a label. Returns '' when nothing is sluggable.
 *
 * MUST stay identical to `tagIdFromLabel` in
 * `functions/src/email-core/contactTags.ts` — if the two drift, the UI and the
 * migration will write the same label to two different docs. (U7 folds this into
 * one shared source of truth.)
 */
export function tagIdFromLabel(label: string): string {
    return (label || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

export interface IList {
    id: string;
    name: string;
    description?: string;
    type: 'manual' | 'system';
    memberCount?: number;
    /** Set on lists fed by a signup form — the owning form's (waitlist's) id. */
    formId?: string;
}

export interface ICsvPreview {
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    valid: Array<{ email: string; name?: string }>;
    invalidRows: string[];
}
