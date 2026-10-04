/**
 * Tests for the language-aware link rewrite.
 *
 * Only addresses that exist in every language take the prefix: the home page,
 * search and public content types. A wrong rewrite breaks a link on every page
 * of the site (/hi/signup is no page), while a missed one only leaves it in the
 * default language, which is where it already was.
 */

import { describe, it, expect } from 'vitest';
import { isLocalizedPath, prefixAnchorHrefs, withLangPrefix } from './language-links';
import {
    isLocalizedPath as isLocalizedPathServer,
    prefixAnchorHrefs as prefixAnchorHrefsServer,
    withLangPrefix as withLangPrefixServer,
} from '../../../../functions/src/shared/language-links';

const TYPES: ReadonlySet<string> = new Set(['articles', 'manuals']);

describe('isLocalizedPath', () => {
    it('is the home page, search and public content types only', () => {
        for (const href of ['/', '/#features', '/?ref=x', '/search', '/search?q=x', '/articles', '/articles/my-post', '/manuals/setup#step-2']) {
            expect(isLocalizedPath(href, TYPES)).toBe(true);
            expect(isLocalizedPathServer(href, TYPES)).toBe(true);
        }
    });

    it('is not an app page, the admin, sign-in, a static page or a file', () => {
        for (const href of ['/signup', '/learn', '/learn/lesson-1', '/admin/dashboard', '/user/dashboard', '/leaderboard/w/1',
            '/p/terms', '/pages/privacy-policy', '/site/brochure.pdf', '/assets/img/logo.png', '/_site/site.json']) {
            expect(isLocalizedPath(href, TYPES)).toBe(false);
            expect(isLocalizedPathServer(href, TYPES)).toBe(false);
        }
    });

    it('treats a content type it does not know as a page that exists once', () => {
        expect(isLocalizedPath('/articles')).toBe(false);
        expect(isLocalizedPath('/events', TYPES)).toBe(false);
    });
});

describe('withLangPrefix', () => {
    it('prefixes a public content type\'s pages', () => {
        expect(withLangPrefix('/articles', '/hi', TYPES)).toBe('/hi/articles');
        expect(withLangPrefix('/articles/my-post', '/hi', TYPES)).toBe('/hi/articles/my-post');
        expect(withLangPrefix('/search?q=yoga', '/hi', TYPES)).toBe('/hi/search?q=yoga');
    });

    it('leaves an app\'s own pages, sign-in and the member area alone', () => {
        for (const href of ['/signup', '/learn', '/learn/lesson-1', '/user/dashboard', '/admin', '/press', '/hindi-guide']) {
            expect(withLangPrefix(href, '/hi', TYPES)).toBe(href);
            expect(withLangPrefixServer(href, '/hi', TYPES)).toBe(href);
        }
    });

    it('maps the home page to the language root, without a trailing slash', () => {
        expect(withLangPrefix('/', '/hi')).toBe('/hi');
    });

    it('keeps a home-page anchor and query on the home page', () => {
        // '/hi/#features' would be a different URL from the page it targets.
        expect(withLangPrefix('/#features', '/hi')).toBe('/hi#features');
        expect(withLangPrefix('/?ref=ABC', '/hi')).toBe('/hi?ref=ABC');
    });

    it('leaves everything alone for the default language', () => {
        expect(withLangPrefix('/articles', '', TYPES)).toBe('/articles');
        expect(withLangPrefix('/', '')).toBe('/');
    });

    it('leaves links that are not root-relative', () => {
        expect(withLangPrefix('https://example.com/articles', '/hi', TYPES)).toBe('https://example.com/articles');
        expect(withLangPrefix('//cdn.example.com/x.js', '/hi')).toBe('//cdn.example.com/x.js');
        expect(withLangPrefix('mailto:hi@example.com', '/hi')).toBe('mailto:hi@example.com');
        expect(withLangPrefix('tel:+911234567890', '/hi')).toBe('tel:+911234567890');
        expect(withLangPrefix('#features', '/hi')).toBe('#features');
        expect(withLangPrefix('articles/my-post', '/hi', TYPES)).toBe('articles/my-post');
    });

    it('is idempotent', () => {
        // The app re-applies it whenever the language or the content types change.
        expect(withLangPrefix('/hi/articles', '/hi', TYPES)).toBe('/hi/articles');
        expect(withLangPrefix(withLangPrefix('/articles', '/hi', TYPES), '/hi', TYPES)).toBe('/hi/articles');
        expect(withLangPrefix(withLangPrefix('/', '/hi'), '/hi')).toBe('/hi');
        expect(withLangPrefix(withLangPrefix('/#features', '/hi'), '/hi')).toBe('/hi#features');
    });

    it('never prefixes a file, even under a content type\'s name', () => {
        const sharedNames = new Set(['site', 'assets']);
        for (const href of ['/site/brochure.pdf', '/assets/img/logo.png', '/_site/site.json', '/site']) {
            expect(withLangPrefix(href, '/hi', sharedNames)).toBe(href);
            expect(withLangPrefixServer(href, '/hi', sharedNames)).toBe(href);
        }
    });

    it('copes with empty input', () => {
        expect(withLangPrefix('', '/hi')).toBe('');
    });
});

describe('prefixAnchorHrefs', () => {
    it('rewrites the anchors to pages that exist in every language', () => {
        const html = '<nav><a href="/">Home</a><a class="x" href="/articles">Articles</a><a href="/signup">Sign in</a></nav>';
        expect(prefixAnchorHrefs(html, '/hi', TYPES))
            .toBe('<nav><a href="/hi">Home</a><a class="x" href="/hi/articles">Articles</a><a href="/signup">Sign in</a></nav>');
    });

    it('preserves the quote style and the rest of the tag', () => {
        const html = `<a data-arc-t='nav_articles' href='/articles' target="_self">Articles</a>`;
        expect(prefixAnchorHrefs(html, '/hi', TYPES))
            .toBe(`<a data-arc-t='nav_articles' href='/hi/articles' target="_self">Articles</a>`);
    });

    it('leaves assets alone', () => {
        // Only <a> is rewritten: stylesheets and images are served from one
        // place whatever language the page is in.
        const html = '<link rel="stylesheet" href="/assets/css/main.css"><img src="/logo.png">';
        expect(prefixAnchorHrefs(html, '/hi', TYPES)).toBe(html);
    });

    it('leaves external and non-path links', () => {
        const html = '<a href="https://github.com/x">GitHub</a><a href="#top">Top</a>';
        expect(prefixAnchorHrefs(html, '/hi', TYPES)).toBe(html);
    });

    it('is a no-op for the default language', () => {
        const html = '<a href="/articles">Articles</a>';
        expect(prefixAnchorHrefs(html, '', TYPES)).toBe(html);
    });

    it('copes with empty input', () => {
        expect(prefixAnchorHrefs('', '/hi')).toBe('');
    });
});

describe('agrees with the publish pipeline', () => {
    // A statically published page and its app fallback are the same page; a
    // difference here means a link works in one and not the other.
    const hrefs = ['/', '/articles', '/articles/a', '/signup', '/learn/x', '/search', '/#features', '#top', 'https://x.test/a', 'mailto:a@b.c', '/hi/articles', '/p/terms', ''];

    it.each(hrefs)('matches for %j', (href) => {
        expect(withLangPrefix(href, '/hi', TYPES)).toBe(withLangPrefixServer(href, '/hi', TYPES));
        expect(withLangPrefix(href, '', TYPES)).toBe(withLangPrefixServer(href, '', TYPES));
    });

    it('matches on a whole partial', () => {
        const html = `
            <a class="navbar-brand" href="/">Arc CMS</a>
            <a class="nav-link" href="/#features" data-arc-t="nav_features">Features</a>
            <a class="nav-link" href="/articles" data-arc-t="nav_articles">Articles</a>
            <a class="nav-link" href="/signup">Sign in</a>
            <a href="https://github.com/arc">GitHub</a>`;
        expect(prefixAnchorHrefs(html, '/hi', TYPES)).toBe(prefixAnchorHrefsServer(html, '/hi', TYPES));
    });
});
