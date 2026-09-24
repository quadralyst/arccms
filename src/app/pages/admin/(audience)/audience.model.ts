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
    /** Custom field values (U4.5), keyed by registry field key. */
    fields?: Record<string, unknown>;
    /**
     * Admin kill-switch (U-D12) — blocks every email, including transactional.
     * Distinct from `consent.marketing:'unsubscribed'`, which is the contact's
     * own choice.
     */
    disabled?: boolean;
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

/** A custom contact field definition (`Settings/contact_fields`, U4.5). */
export interface IContactField {
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'boolean' | 'select';
    options?: string[];
    /** `fill` keeps an existing value; `overwrite` replaces it on re-submit. */
    writePolicy?: 'fill' | 'overwrite';
    /** Suggested inline fallback for `##FIELD:key|default##`. */
    defaultValue?: string;
}

/**
 * MUST match `fieldKeyFromLabel` in `functions/src/email-core/contactFields.ts`
 * (underscores, unlike tags which use dashes).
 */
export function fieldKeyFromLabel(label: string): string {
    return (label || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
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

/** Mirrors APP_LIST_OPS in functions/src/app-audience/appLists.ts. */
export type AppListOp = 'is' | 'is_not' | 'any_of' | 'contains' | 'gt' | 'lt' | 'empty' | 'not_empty';

/** One condition of an App users (live) list, on a field of the host app's user documents. */
export interface AppListCondition {
    field: string;
    op: AppListOp;
    value?: string | string[];
}

export interface IList {
    id: string;
    name: string;
    description?: string;
    /** `app`: App users (live), resolved from the host app at every use (CO6.5b). */
    type: 'manual' | 'system' | 'app';
    memberCount?: number;
    /** Set on lists fed by a signup form — the owning form's (waitlist's) id. */
    formId?: string;
    /** App users (live) lists only: who matches. */
    conditions?: AppListCondition[];
}

export interface ICsvPreview {
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    valid: Array<{ email: string; name?: string }>;
    invalidRows: string[];
}
