/**
 * The site-level JSON-LD every public page shares: the owner (Organization
 * or Person) and the WebSite with its SearchAction. Detail and list pages
 * reference the owner by `@id` as their publisher rather than repeating it.
 *
 * Pure: takes the already-loaded settings so page generators (and tests)
 * decide where the data comes from. docs/discoverability-spec.md, D-D1/D-D2.
 */
import {
    buildOrganization,
    buildWebSite,
    organizationId,
} from './structured-data.js';
import type { AboutConfig, SiteConfig } from './site-settings.js';
import { langPrefix } from './content-translation.js';

export interface SiteNodesInput {
    siteConfig: Pick<SiteConfig, 'siteName' | 'baseUrl'>;
    about?: Partial<AboutConfig> | null;
    lang: string;
    defaultLang: string;
}

export interface SiteNodes {
    organization: Record<string, unknown> | null;
    webSite: Record<string, unknown> | null;
    /** `@id` to use as `publisher` on the page's own node; undefined when there is no owner node. */
    publisherId?: string;
}

/**
 * Public search results live at `/search?q=` (language-prefixed like every
 * public route, docs/search-spec.md S-D18). The widget is on every page, so
 * the SearchAction is always emitted.
 */
export function searchUrlTemplate(baseUrl: string, lang: string, defaultLang: string): string {
    const base = (baseUrl || '').replace(/\/+$/, '');
    return `${base}${langPrefix(lang, defaultLang)}/search?q={search_term_string}`;
}

export function buildSiteNodes(input: SiteNodesInput): SiteNodes {
    const baseUrl = (input.siteConfig.baseUrl || '').replace(/\/+$/, '');
    const about = input.about || {};
    // The owner's name falls back to the site name: a site called "Acme" is
    // published by Acme unless the settings say otherwise.
    const ownerName = (about.name || input.siteConfig.siteName || '').trim();

    const organization = buildOrganization({
        name: ownerName,
        url: baseUrl,
        logoUrl: about.logoUrl,
        description: about.description,
        sameAs: about.sameAs,
        contactEmail: about.contactEmail,
        address: about.address,
        organizationType: about.organizationType,
    });
    const publisherId = organization ? organizationId(baseUrl) : undefined;

    const webSite = buildWebSite(
        {
            name: input.siteConfig.siteName || ownerName,
            url: baseUrl,
            description: about.description,
            inLanguage: input.lang,
            searchUrlTemplate: searchUrlTemplate(baseUrl, input.lang, input.defaultLang),
        },
        publisherId,
    );

    return { organization, webSite, publisherId };
}
