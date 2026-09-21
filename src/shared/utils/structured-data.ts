/**
 * JSON-LD builders for the SPA fallback pages (docs/discoverability-spec.md, D1).
 *
 * Mirrors functions/src/shared/structured-data.ts, which is the source of
 * truth for the statically published pages. The two must stay in step: same
 * `@id` scheme, same omit-when-unknown rule. Only the subset the Angular
 * pages need is mirrored here.
 */

export const SCHEMA_CONTEXT = 'https://schema.org';

export type JsonLd = Record<string, unknown>;

export interface OrganizationInput {
    name: string;
    url: string;
    logoUrl?: string;
    description?: string;
    sameAs?: string[];
    contactEmail?: string;
    address?: string;
    organizationType?: 'Organization' | 'Person';
}

export interface WebSiteInput {
    name: string;
    url: string;
    description?: string;
    inLanguage?: string;
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
    url: string;
    headline: string;
    description?: string;
    imageUrl?: string;
    datePublished?: string;
    dateModified?: string;
    inLanguage?: string;
    keywords?: string[];
    articleSection?: string;
    wordCount?: number;
    abstract?: string;
    author?: PersonInput;
    publisherId?: string;
    citations?: { title?: string; url: string }[];
    type?: 'Article' | 'BlogPosting' | 'NewsArticle';
}

export function organizationId(baseUrl: string): string {
    return `${trimSlash(baseUrl)}/#organization`;
}

export function webSiteId(baseUrl: string): string {
    return `${trimSlash(baseUrl)}/#website`;
}

export function buildOrganization(input: OrganizationInput): JsonLd | null {
    const name = clean(input.name);
    if (!name) return null;
    const isPerson = input.organizationType === 'Person';
    const node: JsonLd = {
        '@context': SCHEMA_CONTEXT,
        '@type': isPerson ? 'Person' : 'Organization',
        '@id': organizationId(input.url),
        name,
        url: trimSlash(input.url) + '/',
    };
    const logo = clean(input.logoUrl);
    if (logo) {
        if (!isPerson) node['logo'] = { '@type': 'ImageObject', url: logo };
        node['image'] = logo;
    }
    setIf(node, 'description', clean(input.description));
    setIf(node, 'email', clean(input.contactEmail));
    const sameAs = urls(input.sameAs);
    if (sameAs.length) node['sameAs'] = sameAs;
    const address = clean(input.address);
    if (address) node['address'] = { '@type': 'PostalAddress', description: address };
    return node;
}

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
    const published = input.datePublished ? toIsoDate(input.datePublished) : undefined;
    const modified = (input.dateModified ? toIsoDate(input.dateModified) : undefined) || published;
    setIf(node, 'datePublished', published);
    setIf(node, 'dateModified', modified);
    setIf(node, 'inLanguage', clean(input.inLanguage));
    const keywords = (input.keywords || []).map(k => clean(k)).filter(Boolean);
    if (keywords.length) node['keywords'] = keywords.join(', ');
    setIf(node, 'articleSection', clean(input.articleSection));
    if (input.wordCount && input.wordCount > 0) node['wordCount'] = input.wordCount;
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

/**
 * Publish and update dates resolved once, mirroring
 * functions/src/shared/content-dates.ts: `updatedOn` counts only when it is
 * strictly later than the publish date.
 */
export function resolveContentDates(content: { publishedOn?: unknown; updatedOn?: unknown }): {
    published?: string;
    modified?: string;
    isUpdated: boolean;
} {
    const published = toIsoDate(content.publishedOn);
    const updated = toIsoDate(content.updatedOn);
    const isUpdated = !!updated && (!published || Date.parse(updated) > Date.parse(published));
    return { published, modified: isUpdated ? updated : published, isUpdated };
}

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

export function countWords(htmlOrText: string): number {
    const text = (htmlOrText || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Serialise for a script element; `<` cannot close it once escaped. */
export function serializeJsonLd(node: JsonLd): string {
    return JSON.stringify(node).replace(/</g, '\\u003c');
}

/**
 * Writes (or replaces) one `<script type="application/ld+json">` in <head>,
 * keyed by `id` so a page can update its own node on navigation without
 * leaving stale ones behind. A null node removes the element.
 */
export function setJsonLd(doc: Document, id: string, node: JsonLd | null): void {
    const existing = doc.getElementById(id);
    if (!node) {
        existing?.remove();
        return;
    }
    const script = existing ?? doc.createElement('script');
    script.id = id;
    script.setAttribute('type', 'application/ld+json');
    script.textContent = serializeJsonLd(node);
    if (!existing) doc.head.appendChild(script);
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
