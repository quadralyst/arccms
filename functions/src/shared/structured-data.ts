/**
 * JSON-LD builders for the public pages (docs/discoverability-spec.md, D1).
 *
 * Every builder is a pure function from plain inputs to a schema.org object.
 * Nothing here reads Firestore or knows about Hosting, so the same builders
 * are unit-tested in isolation and mirrored client-side in
 * src/shared/utils/structured-data.ts for the SPA fallback.
 *
 * Two rules the builders enforce (D-D1, section 4 of the spec):
 *  - A property that cannot be filled truthfully is omitted, never defaulted.
 *    Wrong structured data is worse than none.
 *  - Entities that appear on more than one page (the site, the organisation)
 *    carry a stable `@id`, so a page can reference them instead of repeating
 *    them and consumers can tell the pages describe one publisher.
 */

export const SCHEMA_CONTEXT = 'https://schema.org';

/** What `Settings/about` knows about the site owner. */
export interface OrganizationInput {
    name: string;
    url: string;
    logoUrl?: string;
    description?: string;
    sameAs?: string[];
    contactEmail?: string;
    address?: string;
    /** A personal site publishes as a Person rather than an Organization. */
    organizationType?: 'Organization' | 'Person';
}

export interface WebSiteInput {
    name: string;
    url: string;
    description?: string;
    inLanguage?: string;
    /**
     * Absolute URL template of the search results page with the literal
     * `{search_term_string}` placeholder, e.g. `https://x.com/search?q={search_term_string}`.
     * Omitted when the site has no search.
     */
    searchUrlTemplate?: string;
}

export interface BreadcrumbItem {
    name: string;
    url: string;
}

export interface PersonInput {
    name: string;
    url?: string;
    imageUrl?: string;
    description?: string;
    jobTitle?: string;
    sameAs?: string[];
}

export interface ArticleInput {
    /** Absolute URL of the page; becomes `@id` and `mainEntityOfPage`. */
    url: string;
    headline: string;
    description?: string;
    imageUrl?: string;
    /** ISO 8601. */
    datePublished?: string;
    /** ISO 8601. Falls back to datePublished when absent. */
    dateModified?: string;
    inLanguage?: string;
    keywords?: string[];
    articleSection?: string;
    wordCount?: number;
    /** Plain-text body, used only for wordCount when that is not given. */
    bodyText?: string;
    /** Short summary of the piece; from the key takeaways block (D-D10). */
    abstract?: string;
    author?: PersonInput;
    /** Site owner, as returned by `organizationId(baseUrl)`; referenced, not repeated. */
    publisherId?: string;
    /** Outbound references the author cited (D4). */
    citations?: { title?: string; url: string }[];
    /** `Article` by default; content types may choose a subtype (D5). */
    type?: 'Article' | 'BlogPosting' | 'NewsArticle';
}

export interface CollectionPageInput {
    url: string;
    name: string;
    description?: string;
    inLanguage?: string;
    items: { name: string; url: string }[];
    publisherId?: string;
}

type JsonLd = Record<string, unknown>;

/** Stable identifier of the site owner across every page. */
export function organizationId(baseUrl: string): string {
    return `${trimSlash(baseUrl)}/#organization`;
}

/** Stable identifier of the WebSite node across every page. */
export function webSiteId(baseUrl: string): string {
    return `${trimSlash(baseUrl)}/#website`;
}

/**
 * The site owner. Returns null when there is no name to publish under, since
 * an anonymous Organization node carries no information.
 */
export function buildOrganization(input: OrganizationInput): JsonLd | null {
    const name = clean(input.name);
    if (!name) return null;

    const node: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': input.organizationType === 'Person' ? 'Person' : 'Organization',
        '@id': organizationId(input.url),
        name,
        url: trimSlash(input.url) + '/',
    };
    const logo = clean(input.logoUrl);
    if (logo) {
        // Google wants the logo as an ImageObject on Organization; Person takes a plain image.
        node['logo'] = node['@type'] === 'Organization' ? { '@type': 'ImageObject', url: logo } : undefined;
        node['image'] = logo;
    }
    setIf(node, 'description', clean(input.description));
    setIf(node, 'email', clean(input.contactEmail));
    const sameAs = urls(input.sameAs);
    if (sameAs.length) node['sameAs'] = sameAs;
    const address = clean(input.address);
    if (address) {
        // A free-text address is still useful to consumers; a PostalAddress
        // with invented street/locality fields would not be.
        node['address'] = { '@type': 'PostalAddress', description: address };
    }
    return stripUndefined(node);
}

/** The site itself, with a SearchAction when a results page exists. */
export function buildWebSite(input: WebSiteInput, publisherId?: string): JsonLd | null {
    const name = clean(input.name);
    if (!name) return null;

    const node: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': 'WebSite',
        '@id': webSiteId(input.url),
        name,
        url: trimSlash(input.url) + '/',
    };
    setIf(node, 'description', clean(input.description));
    setIf(node, 'inLanguage', clean(input.inLanguage));
    if (publisherId) node['publisher'] = { '@id': publisherId };

    const template = clean(input.searchUrlTemplate);
    if (template && template.includes('{search_term_string}')) {
        node['potentialAction'] = {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: template },
            'query-input': 'required name=search_term_string',
        };
    }
    return node;
}

/** Position-numbered trail. Needs at least two crumbs to say anything. */
export function buildBreadcrumbList(items: BreadcrumbItem[]): JsonLd | null {
    const crumbs = (items || []).filter(item => clean(item.name) && clean(item.url));
    if (crumbs.length < 2) return null;
    return {
        '@context': SCHEMA_CONTEXT,
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name.trim(),
            item: item.url.trim(),
        })),
    };
}

export function buildPerson(input: PersonInput): JsonLd | null {
    const name = clean(input.name);
    if (!name) return null;
    const node: JsonLd = { '@type': 'Person', name };
    setIf(node, 'url', clean(input.url));
    setIf(node, 'image', clean(input.imageUrl));
    setIf(node, 'description', clean(input.description));
    setIf(node, 'jobTitle', clean(input.jobTitle));
    const sameAs = urls(input.sameAs);
    if (sameAs.length) node['sameAs'] = sameAs;
    return node;
}

/** A content detail page. */
export function buildArticle(input: ArticleInput): JsonLd | null {
    const headline = clean(input.headline);
    const url = clean(input.url);
    if (!headline || !url) return null;

    const node: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': input.type || 'Article',
        '@id': url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        headline,
    };
    setIf(node, 'description', clean(input.description));
    setIf(node, 'image', clean(input.imageUrl));
    const published = isoOrUndefined(input.datePublished);
    const modified = isoOrUndefined(input.dateModified) || published;
    setIf(node, 'datePublished', published);
    setIf(node, 'dateModified', modified);
    setIf(node, 'inLanguage', clean(input.inLanguage));
    const keywords = (input.keywords || []).map(k => clean(k)).filter(Boolean);
    if (keywords.length) node['keywords'] = keywords.join(', ');
    setIf(node, 'articleSection', clean(input.articleSection));
    const words = input.wordCount ?? (input.bodyText ? countWords(input.bodyText) : undefined);
    if (words && words > 0) node['wordCount'] = words;
    setIf(node, 'abstract', clean(input.abstract));
    const author = input.author ? buildPerson(input.author) : null;
    if (author) node['author'] = author;
    if (input.publisherId) node['publisher'] = { '@id': input.publisherId };
    const citations = (input.citations || [])
        .filter(c => clean(c.url))
        .map(c => {
            const cite: JsonLd = { '@type': 'CreativeWork', url: c.url.trim() };
            setIf(cite, 'name', clean(c.title));
            return cite;
        });
    if (citations.length) node['citation'] = citations;
    return node;
}

/** A content list page: the page plus the ordered items it shows. */
export function buildCollectionPage(input: CollectionPageInput): JsonLd | null {
    const name = clean(input.name);
    const url = clean(input.url);
    if (!name || !url) return null;

    const node: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name,
    };
    setIf(node, 'description', clean(input.description));
    setIf(node, 'inLanguage', clean(input.inLanguage));
    if (input.publisherId) node['publisher'] = { '@id': input.publisherId };
    const items = (input.items || []).filter(item => clean(item.name) && clean(item.url));
    if (items.length) {
        node['mainEntity'] = {
            '@type': 'ItemList',
            numberOfItems: items.length,
            itemListElement: items.map((item, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: item.name.trim(),
                url: item.url.trim(),
            })),
        };
    }
    return node;
}

/**
 * Serialises one node for a `<script type="application/ld+json">`. The only
 * sequence that can break out of the element is `</script`, and `<` inside a
 * JSON string is legal as `<`, so that is all the escaping needed. The
 * `<!--` case is covered by the same replacement.
 */
export function serializeJsonLd(node: JsonLd): string {
    return JSON.stringify(node).replace(/</g, '\\u003c');
}

/** The `<script>` tags for a page, one per node, nulls skipped. */
export function renderJsonLdScripts(nodes: (JsonLd | null | undefined)[]): string {
    return (nodes || [])
        .filter((node): node is JsonLd => !!node)
        .map(node => `    <script type="application/ld+json">${serializeJsonLd(node)}</script>`)
        .join('\n');
}

/**
 * Turns whatever a Firestore date field holds (Timestamp-like, Date, ISO
 * string, epoch millis) into an ISO 8601 string, or undefined when it is not a
 * date at all. Callers pass the result straight into the builders.
 */
export function toIsoDate(value: unknown): string | undefined {
    if (!value) return undefined;
    let date: Date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'object' && value !== null && 'seconds' in value) {
        date = new Date(Number((value as { seconds: number }).seconds) * 1000);
    } else if (typeof value === 'object' && value !== null && typeof (value as { toDate?: unknown }).toDate === 'function') {
        date = (value as { toDate: () => Date }).toDate();
    } else if (typeof value === 'string' || typeof value === 'number') {
        date = new Date(value);
    } else {
        return undefined;
    }
    return isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Word count of an HTML fragment or plain text. */
export function countWords(htmlOrText: string): number {
    const text = (htmlOrText || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clean(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function urls(values?: string[]): string[] {
    return (values || []).map(v => clean(v)).filter(v => /^https?:\/\//i.test(v));
}

function trimSlash(url: string): string {
    return clean(url).replace(/\/+$/, '');
}

function setIf(node: JsonLd, key: string, value: string | number | undefined): void {
    if (value !== undefined && value !== '') node[key] = value;
}

function isoOrUndefined(value?: string): string | undefined {
    return value ? toIsoDate(value) : undefined;
}

function stripUndefined(node: JsonLd): JsonLd {
    return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined));
}
