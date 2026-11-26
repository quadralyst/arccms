import { describe, expect, it } from 'vitest';
import { entrySitePath, pageSitePath, siteAddressOpenedFrom } from './site-address';

describe('siteAddressOpenedFrom, where Close goes back to', () => {
    const origin = 'https://example.org';

    it('is the site page the editor was opened from', () => {
        expect(siteAddressOpenedFrom('https://example.org/', origin)).toBe('/');
        expect(siteAddressOpenedFrom('https://example.org/pages/about?x=1', origin)).toBe('/pages/about?x=1');
    });

    it('is empty from an admin page, another site, no referrer or nonsense', () => {
        expect(siteAddressOpenedFrom('https://example.org/admin/more-pages', origin)).toBe('');
        expect(siteAddressOpenedFrom('https://example.org/admin', origin)).toBe('');
        expect(siteAddressOpenedFrom('https://other.org/', origin)).toBe('');
        expect(siteAddressOpenedFrom('', origin)).toBe('');
        expect(siteAddressOpenedFrom('not a url', origin)).toBe('');
    });
});

describe('the page being edited, on the site (VE-D86)', () => {
    it('is an entry\'s live page in the language on screen, and nothing before it has one', () => {
        expect(entrySitePath('articles', 'first-post', 'en', 'en')).toBe('/articles/first-post');
        expect(entrySitePath('articles', 'first-post', 'hi', 'en')).toBe('/hi/articles/first-post');
        expect(entrySitePath('our news', 'a b', 'en', 'en')).toBe('/our%20news/a%20b');
        expect(entrySitePath('articles', '', 'en', 'en')).toBe('');
    });

    it('is the home page, a list page or a static page (a static page in the default language only)', () => {
        expect(pageSitePath({ kind: 'home', name: '' }, 'en', 'en')).toBe('/');
        expect(pageSitePath({ kind: 'home', name: '' }, 'hi', 'en')).toBe('/hi');
        expect(pageSitePath({ kind: 'list', name: 'articles' }, 'en', 'en')).toBe('/articles');
        expect(pageSitePath({ kind: 'list', name: 'articles' }, 'hi', 'en')).toBe('/hi/articles');
        expect(pageSitePath({ kind: 'static', name: 'about us' }, 'hi', 'en')).toBe('/p/about%20us');
    });
});
