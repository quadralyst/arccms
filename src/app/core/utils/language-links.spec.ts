/**
 * Tests for the language-aware link rewrite.
 *
 * The rule is deliberately conservative — a wrong rewrite here breaks a link
 * on every page of the site, while a missed one only leaves it in the default
 * language, which is where it already was.
 */

import { describe, it, expect } from 'vitest';
import { prefixAnchorHrefs, withLangPrefix } from './language-links';
import {
    prefixAnchorHrefs as prefixAnchorHrefsServer,
    withLangPrefix as withLangPrefixServer,
} from '../../../../functions/src/shared/language-links';

describe('withLangPrefix', () => {
    it('prefixes a root-relative path', () => {
        expect(withLangPrefix('/articles', '/hi')).toBe('/hi/articles');
        expect(withLangPrefix('/articles/my-post', '/hi')).toBe('/hi/articles/my-post');
    });

    it('maps the home page to the language root, without a trailing slash', () => {
        expect(withLangPrefix('/', '/hi')).toBe('/hi');
    });

    it('keeps a home-page anchor on the home page', () => {
        // '/hi/#features' would be a different URL from the page it targets.
        expect(withLangPrefix('/#features', '/hi')).toBe('/hi#features');
    });

    it('leaves everything alone for the default language', () => {
        expect(withLangPrefix('/articles', '')).toBe('/articles');
        expect(withLangPrefix('/', '')).toBe('/');
    });

    it('leaves links that are not root-relative', () => {
        expect(withLangPrefix('https://example.com/articles', '/hi')).toBe('https://example.com/articles');
        expect(withLangPrefix('//cdn.example.com/x.js', '/hi')).toBe('//cdn.example.com/x.js');
        expect(withLangPrefix('mailto:hi@example.com', '/hi')).toBe('mailto:hi@example.com');
        expect(withLangPrefix('tel:+911234567890', '/hi')).toBe('tel:+911234567890');
        expect(withLangPrefix('#features', '/hi')).toBe('#features');
        expect(withLangPrefix('articles/my-post', '/hi')).toBe('articles/my-post');
    });

    it('is idempotent', () => {
        // The SPA directive re-applies whenever the language signal changes.
        expect(withLangPrefix('/hi/articles', '/hi')).toBe('/hi/articles');
        expect(withLangPrefix(withLangPrefix('/articles', '/hi'), '/hi')).toBe('/hi/articles');
        expect(withLangPrefix(withLangPrefix('/', '/hi'), '/hi')).toBe('/hi');
        expect(withLangPrefix(withLangPrefix('/#features', '/hi'), '/hi')).toBe('/hi#features');
    });

    it('does not confuse a path that merely starts with the code', () => {
        expect(withLangPrefix('/hindi-guide', '/hi')).toBe('/hi/hindi-guide');
    });

    it('copes with empty input', () => {
        expect(withLangPrefix('', '/hi')).toBe('');
    });
});

describe('prefixAnchorHrefs', () => {
    it('rewrites every anchor in a fragment', () => {
        const html = '<nav><a href="/">Home</a><a class="x" href="/articles">Articles</a></nav>';
        expect(prefixAnchorHrefs(html, '/hi'))
            .toBe('<nav><a href="/hi">Home</a><a class="x" href="/hi/articles">Articles</a></nav>');
    });

    it('preserves the quote style and the rest of the tag', () => {
        const html = `<a data-arc-t='nav_articles' href='/articles' target="_self">Articles</a>`;
        expect(prefixAnchorHrefs(html, '/hi'))
            .toBe(`<a data-arc-t='nav_articles' href='/hi/articles' target="_self">Articles</a>`);
    });

    it('leaves assets alone', () => {
        // Only <a> is rewritten: stylesheets and images are served from one
        // place whatever language the page is in.
        const html = '<link rel="stylesheet" href="/assets/css/main.css"><img src="/logo.png">';
        expect(prefixAnchorHrefs(html, '/hi')).toBe(html);
    });

    it('leaves external and non-path links', () => {
        const html = '<a href="https://github.com/x">GitHub</a><a href="#top">Top</a>';
        expect(prefixAnchorHrefs(html, '/hi')).toBe(html);
    });

    it('is a no-op for the default language', () => {
        const html = '<a href="/articles">Articles</a>';
        expect(prefixAnchorHrefs(html, '')).toBe(html);
    });

    it('copes with empty input', () => {
        expect(prefixAnchorHrefs('', '/hi')).toBe('');
    });
});

describe('agrees with the publish pipeline', () => {
    // A statically published page and its SPA fallback are the same page; a
    // difference here means a link works in one and not the other.
    const hrefs = ['/', '/articles', '/#features', '#top', 'https://x.test/a', 'mailto:a@b.c', '/hi/articles', ''];

    it.each(hrefs)('matches for %j', (href) => {
        expect(withLangPrefix(href, '/hi')).toBe(withLangPrefixServer(href, '/hi'));
        expect(withLangPrefix(href, '')).toBe(withLangPrefixServer(href, ''));
    });

    it('matches on a whole partial', () => {
        const html = `
            <a class="navbar-brand" href="/">Arc CMS</a>
            <a class="nav-link" href="/#features" data-arc-t="nav_features">Features</a>
            <a class="nav-link" href="/articles" data-arc-t="nav_articles">Articles</a>
            <a href="https://github.com/arc">GitHub</a>`;
        expect(prefixAnchorHrefs(html, '/hi')).toBe(prefixAnchorHrefsServer(html, '/hi'));
    });
});
