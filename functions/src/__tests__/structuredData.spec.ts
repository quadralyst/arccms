import { describe, it, expect } from 'vitest';
import {
    buildArticle,
    buildBreadcrumbList,
    buildCollectionPage,
    buildOrganization,
    buildPerson,
    buildWebSite,
    countWords,
    organizationId,
    renderJsonLdScripts,
    serializeJsonLd,
    toIsoDate,
    webSiteId,
} from '../shared/structured-data.js';

describe('buildOrganization', () => {
    it('returns null without a name', () => {
        expect(buildOrganization({ name: '  ', url: 'https://x.com' })).toBeNull();
    });

    it('builds a minimal Organization with a stable @id', () => {
        const node = buildOrganization({ name: 'Acme', url: 'https://x.com/' })!;
        expect(node['@type']).toBe('Organization');
        expect(node['@id']).toBe('https://x.com/#organization');
        expect(node['url']).toBe('https://x.com/');
        expect(node).not.toHaveProperty('logo');
        expect(node).not.toHaveProperty('sameAs');
        expect(node).not.toHaveProperty('address');
    });

    it('emits logo as ImageObject, filters non-URL sameAs, keeps free-text address', () => {
        const node = buildOrganization({
            name: 'Acme',
            url: 'https://x.com',
            logoUrl: 'https://x.com/logo.png',
            sameAs: ['https://twitter.com/acme', 'not a url', ''],
            address: '12 High St, Pune',
            contactEmail: 'hi@x.com',
        })!;
        expect(node['logo']).toEqual({ '@type': 'ImageObject', url: 'https://x.com/logo.png' });
        expect(node['image']).toBe('https://x.com/logo.png');
        expect(node['sameAs']).toEqual(['https://twitter.com/acme']);
        expect(node['address']).toEqual({ '@type': 'PostalAddress', description: '12 High St, Pune' });
        expect(node['email']).toBe('hi@x.com');
    });

    it('publishes a personal site as a Person with a plain image', () => {
        const node = buildOrganization({
            name: 'Jane',
            url: 'https://jane.dev',
            organizationType: 'Person',
            logoUrl: 'https://jane.dev/me.jpg',
        })!;
        expect(node['@type']).toBe('Person');
        expect(node['image']).toBe('https://jane.dev/me.jpg');
        expect(node).not.toHaveProperty('logo');
    });
});

describe('buildWebSite', () => {
    it('returns null without a name', () => {
        expect(buildWebSite({ name: '', url: 'https://x.com' })).toBeNull();
    });

    it('adds a SearchAction only for a template with the placeholder', () => {
        const withSearch = buildWebSite({
            name: 'Acme',
            url: 'https://x.com',
            searchUrlTemplate: 'https://x.com/search?q={search_term_string}',
        })!;
        expect(withSearch['@id']).toBe(webSiteId('https://x.com/'));
        const action = withSearch['potentialAction'] as Record<string, unknown>;
        expect(action['@type']).toBe('SearchAction');
        expect((action['target'] as Record<string, unknown>)['urlTemplate']).toContain('{search_term_string}');

        const broken = buildWebSite({ name: 'Acme', url: 'https://x.com', searchUrlTemplate: 'https://x.com/search' })!;
        expect(broken).not.toHaveProperty('potentialAction');
    });

    it('references the publisher by @id', () => {
        const node = buildWebSite({ name: 'Acme', url: 'https://x.com' }, organizationId('https://x.com'))!;
        expect(node['publisher']).toEqual({ '@id': 'https://x.com/#organization' });
    });
});

describe('buildBreadcrumbList', () => {
    it('needs at least two usable crumbs', () => {
        expect(buildBreadcrumbList([{ name: 'Home', url: 'https://x.com/' }])).toBeNull();
        expect(buildBreadcrumbList([{ name: 'Home', url: 'https://x.com/' }, { name: '', url: 'x' }])).toBeNull();
    });

    it('numbers positions from 1', () => {
        const node = buildBreadcrumbList([
            { name: 'Home', url: 'https://x.com/' },
            { name: 'Articles', url: 'https://x.com/articles' },
            { name: 'Hello', url: 'https://x.com/articles/hello' },
        ])!;
        const items = node['itemListElement'] as Array<Record<string, unknown>>;
        expect(items.map(i => i['position'])).toEqual([1, 2, 3]);
        expect(items[2]['item']).toBe('https://x.com/articles/hello');
    });
});

describe('buildArticle', () => {
    const base = {
        url: 'https://x.com/articles/hello',
        headline: 'Hello world',
    };

    it('returns null without headline or url', () => {
        expect(buildArticle({ ...base, headline: '' })).toBeNull();
        expect(buildArticle({ ...base, url: '' })).toBeNull();
    });

    it('omits everything it cannot fill truthfully', () => {
        const node = buildArticle(base)!;
        expect(node['@type']).toBe('Article');
        expect(node['mainEntityOfPage']).toEqual({ '@type': 'WebPage', '@id': base.url });
        for (const key of ['description', 'image', 'datePublished', 'dateModified', 'author', 'publisher', 'keywords', 'wordCount', 'citation']) {
            expect(node, key).not.toHaveProperty(key);
        }
    });

    it('falls dateModified back to datePublished', () => {
        const node = buildArticle({ ...base, datePublished: '2024-01-15T00:00:00.000Z' })!;
        expect(node['dateModified']).toBe('2024-01-15T00:00:00.000Z');
    });

    it('keeps an explicit dateModified', () => {
        const node = buildArticle({
            ...base,
            datePublished: '2024-01-15T00:00:00.000Z',
            dateModified: '2025-03-01T00:00:00.000Z',
        })!;
        expect(node['dateModified']).toBe('2025-03-01T00:00:00.000Z');
    });

    it('joins keywords, counts words from body text, nests author and cites sources', () => {
        const node = buildArticle({
            ...base,
            keywords: ['a', ' b ', ''],
            bodyText: '<p>one two <b>three</b>&nbsp;four</p>',
            articleSection: 'News',
            inLanguage: 'hi',
            author: { name: 'Jane', url: 'https://jane.dev', sameAs: ['https://x.com/jane', 'nope'] },
            publisherId: organizationId('https://x.com'),
            citations: [{ title: 'Ref', url: 'https://ref.example' }, { url: '' }],
            type: 'BlogPosting',
        })!;
        expect(node['@type']).toBe('BlogPosting');
        expect(node['keywords']).toBe('a, b');
        expect(node['wordCount']).toBe(4);
        expect(node['articleSection']).toBe('News');
        expect(node['inLanguage']).toBe('hi');
        expect(node['author']).toEqual({
            '@type': 'Person',
            name: 'Jane',
            url: 'https://jane.dev',
            sameAs: ['https://x.com/jane'],
        });
        expect(node['publisher']).toEqual({ '@id': 'https://x.com/#organization' });
        expect(node['citation']).toEqual([{ '@type': 'CreativeWork', url: 'https://ref.example', name: 'Ref' }]);
    });
});

describe('buildCollectionPage', () => {
    it('lists items in order and skips blanks', () => {
        const node = buildCollectionPage({
            url: 'https://x.com/articles',
            name: 'Articles',
            items: [
                { name: 'A', url: 'https://x.com/articles/a' },
                { name: '', url: 'https://x.com/articles/blank' },
                { name: 'B', url: 'https://x.com/articles/b' },
            ],
        })!;
        const list = node['mainEntity'] as Record<string, unknown>;
        expect(list['numberOfItems']).toBe(2);
        expect((list['itemListElement'] as Array<Record<string, unknown>>)[1]['name']).toBe('B');
    });

    it('omits mainEntity for an empty list', () => {
        const node = buildCollectionPage({ url: 'https://x.com/articles', name: 'Articles', items: [] })!;
        expect(node).not.toHaveProperty('mainEntity');
    });
});

describe('buildPerson', () => {
    it('returns null without a name', () => {
        expect(buildPerson({ name: '' })).toBeNull();
    });
});

describe('serializeJsonLd / renderJsonLdScripts', () => {
    it('escapes < so a value cannot close the script element', () => {
        const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
        expect(out).not.toContain('</script');
        expect(out).toContain('\\u003c/script');
        expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
    });

    it('renders one script per node and skips nulls', () => {
        const html = renderJsonLdScripts([{ a: 1 }, null, undefined, { b: 2 }]);
        expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(2);
    });

    it('renders nothing for an empty list', () => {
        expect(renderJsonLdScripts([])).toBe('');
    });
});

describe('toIsoDate', () => {
    it('handles Timestamp-like, Date, string, number and junk', () => {
        expect(toIsoDate({ seconds: 1705334400, nanoseconds: 0 })).toBe('2024-01-15T16:00:00.000Z');
        expect(toIsoDate(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01T00:00:00.000Z');
        expect(toIsoDate('2024-01-01')).toBe('2024-01-01T00:00:00.000Z');
        expect(toIsoDate(1704067200000)).toBe('2024-01-01T00:00:00.000Z');
        expect(toIsoDate({ toDate: () => new Date('2024-02-02T00:00:00Z') })).toBe('2024-02-02T00:00:00.000Z');
        expect(toIsoDate(null)).toBeUndefined();
        expect(toIsoDate('not a date')).toBeUndefined();
        expect(toIsoDate({})).toBeUndefined();
    });
});

describe('countWords', () => {
    it('strips tags and entities', () => {
        expect(countWords('<h1>Hi</h1><p>there &amp; you</p>')).toBe(3);
        expect(countWords('')).toBe(0);
    });
});
