/**
 * The public search widget markup the publish pipeline injects for
 * `<arc-search>`, and its handling in replaceArcComponents.
 */
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import {
    buildSearchWidget,
    searchEndpoint,
    searchResultsPath,
    SEARCH_WIDGET_SCRIPT,
} from '../search/widget.js';
import { replaceArcComponents } from '../shared/html-document.js';

describe('buildSearchWidget', () => {
    it('builds a no-JavaScript form to the results page with the callable and strings in data attributes', () => {
        const html = buildSearchWidget({ projectId: 'demo', lang: 'hi', defaultLang: 'en', strings: { search_placeholder: 'खोजें' } });
        const $ = cheerio.load(html);
        const root = $('.arc-search');

        expect(root.attr('data-endpoint')).toBe('https://us-central1-demo.cloudfunctions.net/search');
        expect(root.attr('data-lang')).toBe('hi');
        expect(root.attr('data-results-url')).toBe('/hi/search');
        expect(root.attr('data-empty')).toBe('No results');
        expect($('form').attr('action')).toBe('/hi/search');
        expect($('form').attr('method')).toBe('get');
        expect($('input[name="q"]').attr('placeholder')).toBe('खोजें');
        expect($(`script[src="${SEARCH_WIDGET_SCRIPT}"]`).attr('defer')).toBeDefined();
        expect($('link[rel="stylesheet"]').attr('href')).toBe('/assets/css/arc-search.css');
    });

    it('uses the root results path for the default language', () => {
        const html = buildSearchWidget({ projectId: 'demo', lang: 'en', defaultLang: 'en' });
        expect(cheerio.load(html)('.arc-search').attr('data-results-url')).toBe('/search');
        expect(searchResultsPath('en', 'en')).toBe('/search');
        expect(searchResultsPath('hi', 'en')).toBe('/hi/search');
    });

    it('escapes attribute values', () => {
        const html = buildSearchWidget({ projectId: 'demo', lang: 'en', defaultLang: 'en', strings: { search_empty: '<b>"none"</b>' } });
        expect(html).toContain('data-empty="&lt;b&gt;&quot;none&quot;&lt;/b&gt;"');
    });

    it('returns nothing without a project or endpoint, and honours an endpoint override', () => {
        expect(buildSearchWidget({ projectId: '', lang: 'en', defaultLang: 'en' })).toBe('');
        const html = buildSearchWidget({ projectId: '', lang: 'en', defaultLang: 'en', endpoint: 'https://x.test/search' });
        expect(cheerio.load(html)('.arc-search').attr('data-endpoint')).toBe('https://x.test/search');
        expect(searchEndpoint('p', 'europe-west1')).toBe('https://europe-west1-p.cloudfunctions.net/search');
    });
});

describe('replaceArcComponents with <arc-search>', () => {
    const page = '<html><body><arc-header></arc-header><main>x</main></body></html>';
    const header = '<header><arc-language-switcher></arc-language-switcher><arc-search></arc-search></header>';

    it('replaces the element with the widget when given one', () => {
        const widget = buildSearchWidget({ projectId: 'demo', lang: 'en', defaultLang: 'en' });
        const out = replaceArcComponents(page, header, '', '', widget);
        expect(out).toContain('class="arc-search"');
        expect(out).not.toContain('<arc-search>');
    });

    it('removes the element when there is no widget', () => {
        const out = replaceArcComponents(page, header, '');
        expect(out).not.toContain('arc-search');
    });
});
