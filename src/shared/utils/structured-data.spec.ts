import { describe, it, expect } from 'vitest';
import {
    buildArticle,
    buildBreadcrumbList,
    buildOrganization,
    buildWebSite,
    organizationId,
    resolveContentDates,
    serializeJsonLd,
    setJsonLd,
} from './structured-data';

describe('structured-data (client mirror)', () => {
    it('builds an Organization with the same @id scheme as the server', () => {
        const node = buildOrganization({ name: 'Acme', url: 'https://x.com/', logoUrl: 'https://x.com/l.png' })!;
        expect(node['@id']).toBe('https://x.com/#organization');
        expect(node['logo']).toEqual({ '@type': 'ImageObject', url: 'https://x.com/l.png' });
        expect(buildOrganization({ name: '', url: 'https://x.com' })).toBeNull();
    });

    it('builds a WebSite with a SearchAction and publisher reference', () => {
        const node = buildWebSite(
            { name: 'Acme', url: 'https://x.com', searchUrlTemplate: 'https://x.com/search?q={search_term_string}' },
            organizationId('https://x.com'),
        )!;
        expect(node['publisher']).toEqual({ '@id': 'https://x.com/#organization' });
        expect((node['potentialAction'] as Record<string, unknown>)['@type']).toBe('SearchAction');
    });

    it('needs two crumbs for a BreadcrumbList', () => {
        expect(buildBreadcrumbList([{ name: 'Home', url: 'https://x.com/' }])).toBeNull();
        const node = buildBreadcrumbList([
            { name: 'Home', url: 'https://x.com/' },
            { name: 'Articles', url: 'https://x.com/articles' },
        ])!;
        expect((node['itemListElement'] as unknown[]).length).toBe(2);
    });

    it('omits unknown Article fields and falls dateModified back to datePublished', () => {
        const node = buildArticle({ url: 'https://x.com/a', headline: 'A', datePublished: '2024-01-15T00:00:00Z' })!;
        expect(node['dateModified']).toBe('2024-01-15T00:00:00.000Z');
        expect(node).not.toHaveProperty('author');
        expect(node).not.toHaveProperty('image');
    });

    it('resolves updatedOn only when it is after the publish date', () => {
        expect(resolveContentDates({ publishedOn: { seconds: 1705334400 }, updatedOn: { seconds: 1735689600 } })).toEqual({
            published: '2024-01-15T16:00:00.000Z',
            modified: '2025-01-01T00:00:00.000Z',
            isUpdated: true,
        });
        expect(resolveContentDates({ publishedOn: { seconds: 1705334400 }, updatedOn: { seconds: 1600000000 } }).isUpdated).toBe(false);
        expect(resolveContentDates({}).modified).toBeUndefined();
    });

    it('escapes < when serialising', () => {
        expect(serializeJsonLd({ a: '</script>' })).not.toContain('</script');
    });

    it('sets, replaces and removes a keyed ld+json script in <head>', () => {
        const doc = document.implementation.createHTMLDocument('t');
        setJsonLd(doc, 'arc-ld-test', { '@type': 'WebSite', name: 'One' });
        setJsonLd(doc, 'arc-ld-test', { '@type': 'WebSite', name: 'Two' });
        const scripts = doc.head.querySelectorAll('script[type="application/ld+json"]');
        expect(scripts.length).toBe(1);
        expect(scripts[0].textContent).toContain('"name":"Two"');
        setJsonLd(doc, 'arc-ld-test', null);
        expect(doc.getElementById('arc-ld-test')).toBeNull();
    });
});
