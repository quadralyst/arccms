/**
 * About Settings Model
 *
 * Site identity configuration: name, production URL, physical address, and
 * the publisher identity that every public page carries as schema.org
 * structured data (docs/discoverability-spec.md, D-D4).
 * Used by cloud functions for canonical URLs, SEO meta, JSON-LD and email footers.
 * Stored in Firestore at Settings/about. Mirrored server-side as AboutConfig
 * in functions/src/shared/site-settings.ts.
 */

export type OrganizationType = 'Organization' | 'Person';

export interface IAboutSettings {
    name: string;
    finalUrl: string;
    address: string;
    /** Absolute URL of a square-ish logo (Organization.logo / Person.image). */
    logoUrl: string;
    /** One or two sentences on what the site or organisation is. */
    description: string;
    /** Profile URLs for the same entity: social accounts, Wikipedia, GitHub, LinkedIn. */
    sameAs: string[];
    /** Public contact email; empty publishes none. */
    contactEmail: string;
    /** A personal site publishes as a Person rather than an Organization. */
    organizationType: OrganizationType;
}

export const DEFAULT_ABOUT_SETTINGS: IAboutSettings = {
    name: '',
    finalUrl: '',
    address: '',
    logoUrl: '',
    description: '',
    sameAs: [],
    contactEmail: '',
    organizationType: 'Organization',
};

/** Textarea text (one URL per line) → cleaned URL list. */
export function parseSameAs(text: string): string[] {
    return (text || '')
        .split(/\r?\n|,/)
        .map(line => line.trim())
        .filter(line => /^https?:\/\//i.test(line));
}

export function formatSameAs(urls: string[] | undefined): string {
    return (urls || []).join('\n');
}
