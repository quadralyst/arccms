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
}

export interface ICsvPreview {
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    valid: Array<{ email: string; name?: string }>;
    invalidRows: string[];
}
