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
    consent?: { marketing: MarketingConsent; marketingChangedAt?: unknown };
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
