import { describe, it, expect } from 'vitest';
import {
    buildHtmlDocument,
    toOgLocale,
    replaceArcComponents,
    extractStylesAndScripts,
    injectSeoMetadata,
    fixPartialHashLinks,
    PageMeta,
} from '../shared/html-document.js';

const baseMeta: PageMeta = {
    title: 'Test Page',
    metaDescription: 'A test page description',
    canonicalUrl: 'https://example.com/test',
    ogImage: 'https://example.com/image.jpg',
    ogType: 'article',
    siteName: 'Test Site',
    cssUrls: ['/assets/css/main.css'],
};

describe('buildHtmlDocument', () => {
    it('should produce valid <!DOCTYPE html> output', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toMatch(/^<!DOCTYPE html>/);
        expect(result).toContain('<html lang="en">');
        expect(result).toContain('</html>');
    });

    it('should include charset and viewport meta tags', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('<meta charset="UTF-8">');
        expect(result).toContain('<meta name="viewport"');
    });

    it('should set <title> from meta.title', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('<title>Test Page</title>');
    });

    it('should include OG tags', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('property="og:title" content="Test Page"');
        expect(result).toContain('property="og:description" content="A test page description"');
        expect(result).toContain('property="og:type" content="article"');
        expect(result).toContain('property="og:site_name" content="Test Site"');
        expect(result).toContain('property="og:image" content="https://example.com/image.jpg"');
        expect(result).toContain('property="og:url" content="https://example.com/test"');
    });

    it('should include Twitter Card tags', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('name="twitter:card" content="summary_large_image"');
        expect(result).toContain('name="twitter:title" content="Test Page"');
        expect(result).toContain('name="twitter:description" content="A test page description"');
        expect(result).toContain('name="twitter:image" content="https://example.com/image.jpg"');
    });

    it('should include canonical link', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('rel="canonical" href="https://example.com/test"');
    });

    it('should include CSS link tags from meta.cssUrls', () => {
        const meta = { ...baseMeta, cssUrls: ['/a.css', '/b.css'] };
        const result = buildHtmlDocument('<p>Body</p>', meta, '', '');
        expect(result).toContain('rel="stylesheet" href="/a.css"');
        expect(result).toContain('rel="stylesheet" href="/b.css"');
    });

    it('should include robots meta tag', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('name="robots" content="index, follow"');
    });

    it('should include arc-served-by verification meta tag', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        expect(result).toContain('name="arc-served-by" content="firebase-hosting"');
    });

    it('should include arc-deployed-at meta tag with ISO timestamp', () => {
        const result = buildHtmlDocument('<p>Body</p>', baseMeta, '', '');
        const match = result.match(/name="arc-deployed-at" content="([^"]+)"/);
        expect(match).toBeTruthy();
        // Verify it parses as a valid ISO date
        const date = new Date(match![1]);
        expect(date.getTime()).not.toBeNaN();
    });

    it('should place headerHtml before bodyHtml and footerHtml after', () => {
        const result = buildHtmlDocument(
            '<main>Content</main>',
            baseMeta,
            '<header>H</header>',
            '<footer>F</footer>',
        );
        const headerIdx = result.indexOf('<header>H</header>');
        const bodyIdx = result.indexOf('<main>Content</main>');
        const footerIdx = result.indexOf('<footer>F</footer>');
        expect(headerIdx).toBeLessThan(bodyIdx);
        expect(bodyIdx).toBeLessThan(footerIdx);
    });

    it('should include inline styles and scripts when provided', () => {
        const result = buildHtmlDocument(
            '<p>Body</p>',
            baseMeta,
            '',
            '',
            '<style>.test { color: red; }</style>',
            '<script>console.log("hi")</script>',
        );
        expect(result).toContain('<style>.test { color: red; }</style>');
        expect(result).toContain('<script>console.log("hi")</script>');
    });

    it('should omit og:image tags when ogImage is empty', () => {
        const meta = { ...baseMeta, ogImage: '' };
        const result = buildHtmlDocument('<p>Body</p>', meta, '', '');
        expect(result).not.toContain('og:image');
        expect(result).not.toContain('twitter:image');
    });

    it('should escape HTML entities in title and description', () => {
        const meta = {
            ...baseMeta,
            title: 'Test & "Title" <script>',
            metaDescription: 'Desc & "quotes"',
        };
        const result = buildHtmlDocument('<p>Body</p>', meta, '', '');
        // Title uses escapeHtml (& < >) not escapeAttr (& " < >)
        expect(result).toContain('<title>Test &amp; "Title" &lt;script&gt;</title>');
        // Attributes use escapeAttr which also escapes quotes
        expect(result).toContain('content="Desc &amp; &quot;quotes&quot;"');
    });
});

describe('replaceArcComponents', () => {
    it('should replace <arc-header> with headerHtml', () => {
        const html = '<div><arc-header></arc-header><p>Content</p></div>';
        const result = replaceArcComponents(html, '<header>Real Header</header>', '');
        expect(result).toContain('<header>Real Header</header>');
        expect(result).not.toContain('arc-header');
    });

    it('should replace <arc-footer> with footerHtml', () => {
        const html = '<div><p>Content</p><arc-footer></arc-footer></div>';
        const result = replaceArcComponents(html, '', '<footer>Real Footer</footer>');
        expect(result).toContain('<footer>Real Footer</footer>');
        expect(result).not.toContain('arc-footer');
    });

    it('should strip <arc-admin-edit-button> elements', () => {
        const html = '<div><arc-admin-edit-button></arc-admin-edit-button><p>Content</p></div>';
        const result = replaceArcComponents(html, '', '');
        expect(result).not.toContain('arc-admin-edit-button');
        expect(result).toContain('<p>Content</p>');
    });

    it('should strip <arc-content-partials> elements', () => {
        const html = '<div><arc-content-partials></arc-content-partials><p>Content</p></div>';
        const result = replaceArcComponents(html, '', '');
        expect(result).not.toContain('arc-content-partials');
        expect(result).toContain('<p>Content</p>');
    });

    it('should handle HTML with no arc components (passthrough)', () => {
        const html = '<div><p>Just content</p></div>';
        const result = replaceArcComponents(html, '<header>H</header>', '<footer>F</footer>');
        expect(result).toContain('<p>Just content</p>');
    });
});

describe('extractStylesAndScripts', () => {
    it('should extract <style> blocks from body HTML', () => {
        const html = '<style>.red { color: red; }</style><div>Content</div>';
        const result = extractStylesAndScripts(html);
        expect(result.styles).toContain('.red { color: red; }');
        expect(result.body).not.toContain('<style>');
    });

    it('should extract <script> blocks from body HTML', () => {
        const html = '<div>Content</div><script>alert("hi")</script>';
        const result = extractStylesAndScripts(html);
        expect(result.scripts).toContain('alert("hi")');
        expect(result.body).not.toContain('<script>');
    });

    it('should return body without extracted elements', () => {
        const html = '<style>s</style><div>Keep</div><script>j</script>';
        const result = extractStylesAndScripts(html);
        expect(result.body).toContain('<div>Keep</div>');
    });

    it('should handle HTML with no styles or scripts', () => {
        const html = '<div>Plain content</div>';
        const result = extractStylesAndScripts(html);
        expect(result.body).toContain('<div>Plain content</div>');
        expect(result.styles).toBe('');
        expect(result.scripts).toBe('');
    });

    it('should handle multiple style and script blocks', () => {
        const html = '<style>a</style><style>b</style><div>C</div><script>x</script><script>y</script>';
        const result = extractStylesAndScripts(html);
        expect(result.styles).toContain('a');
        expect(result.styles).toContain('b');
        expect(result.scripts).toContain('x');
        expect(result.scripts).toContain('y');
    });
});

describe('injectSeoMetadata', () => {
    const baseHtml = `<!DOCTYPE html><html><head><title>Old Title</title></head><body><p>Content</p></body></html>`;

    it('should update existing title tag', () => {
        const result = injectSeoMetadata(baseHtml, { title: 'New Title' });
        expect(result).toContain('<title>New Title</title>');
        expect(result).not.toContain('Old Title');
    });

    it('should create title tag if missing', () => {
        const html = '<html><head></head><body></body></html>';
        const result = injectSeoMetadata(html, { title: 'Created Title' });
        expect(result).toContain('<title>Created Title</title>');
    });

    it('should update existing meta description', () => {
        const html = '<html><head><meta name="description" content="old"></head><body></body></html>';
        const result = injectSeoMetadata(html, { metaDescription: 'new desc' });
        expect(result).toContain('content="new desc"');
        expect(result).not.toContain('content="old"');
    });

    it('should add OG tags', () => {
        const result = injectSeoMetadata(baseHtml, { title: 'OG Test' });
        expect(result).toContain('og:title');
    });

    it('should inject arc-served-by verification meta tag', () => {
        const result = injectSeoMetadata(baseHtml, { title: 'Test' });
        expect(result).toContain('name="arc-served-by" content="firebase-hosting"');
    });

    it('should inject arc-deployed-at meta tag', () => {
        const result = injectSeoMetadata(baseHtml, { title: 'Test' });
        expect(result).toContain('name="arc-deployed-at"');
    });

    it('should add robots meta tag if missing', () => {
        const result = injectSeoMetadata(baseHtml, { title: 'Test' });
        expect(result).toContain('name="robots" content="index, follow"');
    });

    it('should set canonical URL', () => {
        const result = injectSeoMetadata(baseHtml, {
            canonicalUrl: 'https://example.com/page',
        });
        expect(result).toContain('href="https://example.com/page"');
    });
});

describe('fixPartialHashLinks', () => {
    it('should convert bare href="#" to href="/"', () => {
        const input = '<a href="#">Home</a>';
        expect(fixPartialHashLinks(input)).toBe('<a href="/">Home</a>');
    });

    it('should NOT convert href="#section" links', () => {
        const input = '<a href="#features">Features</a>';
        expect(fixPartialHashLinks(input)).toBe('<a href="#features">Features</a>');
    });

    it('should handle multiple bare hash links', () => {
        const input = '<a href="#">One</a><a href="#">Two</a>';
        expect(fixPartialHashLinks(input)).toBe('<a href="/">One</a><a href="/">Two</a>');
    });

    it('should pass through empty string', () => {
        expect(fixPartialHashLinks('')).toBe('');
    });

    it('should not modify HTML without hash links', () => {
        const input = '<a href="/about">About</a>';
        expect(fixPartialHashLinks(input)).toBe(input);
    });

    it('should handle single-quoted href', () => {
        const input = "<a href='#'>Link</a>";
        expect(fixPartialHashLinks(input)).toBe("<a href='/'>Link</a>");
    });
});

describe('replaceArcComponents – hash link fix', () => {
    it('should fix bare hash links in injected header partial', () => {
        const html = '<div><arc-header></arc-header><p>Content</p></div>';
        const header = '<nav><a href="#">Brand</a></nav>';
        const footer = '<footer>Footer</footer>';

        const result = replaceArcComponents(html, header, footer);
        expect(result).toContain('href="/"');
        expect(result).not.toContain('href="#"');
    });

    it('should fix bare hash links in injected footer partial', () => {
        const html = '<div><p>Content</p><arc-footer></arc-footer></div>';
        const header = '';
        const footer = '<footer><a href="#">Link</a></footer>';

        const result = replaceArcComponents(html, header, footer);
        expect(result).toContain('href="/"');
        expect(result).not.toContain('href="#"');
    });

    it('should NOT modify hash links in page body content', () => {
        const html = '<div><arc-header></arc-header><a href="#introduction">Intro</a></div>';
        const header = '<nav>Header</nav>';
        const footer = '';

        const result = replaceArcComponents(html, header, footer);
        expect(result).toContain('href="#introduction"');
    });

    it('should preserve href="#section" links in partials (only bare # is converted)', () => {
        const html = '<div><arc-header></arc-header></div>';
        const header = '<nav><a href="#">Brand</a><a href="#features">Features</a></nav>';
        const footer = '';

        const result = replaceArcComponents(html, header, footer);
        expect(result).toContain('href="/"');
        expect(result).toContain('href="#features"');
    });
});

// ── Multilingual document head (M3) ─────────────────────────────────────────

describe('buildHtmlDocument – language and hreflang', () => {
    const BASE_META = {
        title: 'T',
        metaDescription: 'D',
        canonicalUrl: 'https://example.com/articles/a',
        ogImage: '',
        ogType: 'article',
        siteName: 'Site',
        cssUrls: [],
    };

    it('should default to English when no language is given', () => {
        const html = buildHtmlDocument('<p>x</p>', { ...BASE_META }, '', '');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<meta property="og:locale" content="en">');
    });

    it('should use the page language', () => {
        const html = buildHtmlDocument('<p>x</p>', { ...BASE_META, lang: 'hi' }, '', '');
        expect(html).toContain('<html lang="hi">');
        expect(html).toContain('<meta property="og:locale" content="hi">');
    });

    it('should add dir="rtl" for right-to-left languages', () => {
        const html = buildHtmlDocument('<p>x</p>', { ...BASE_META, lang: 'ar', rtl: true }, '', '');
        expect(html).toContain('<html lang="ar" dir="rtl">');
    });

    it('should not add a dir attribute for left-to-right languages', () => {
        const html = buildHtmlDocument('<p>x</p>', { ...BASE_META, lang: 'hi' }, '', '');
        expect(html).not.toContain('dir="rtl"');
    });

    it('should emit an alternate for every language plus x-default', () => {
        const html = buildHtmlDocument('<p>x</p>', {
            ...BASE_META,
            lang: 'hi',
            defaultLang: 'en',
            alternates: [
                { lang: 'en', url: 'https://example.com/articles/a' },
                { lang: 'hi', url: 'https://example.com/hi/articles/a' },
            ],
        }, '', '');

        expect(html).toContain('<link rel="alternate" hreflang="en" href="https://example.com/articles/a">');
        expect(html).toContain('<link rel="alternate" hreflang="hi" href="https://example.com/hi/articles/a">');
        expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://example.com/articles/a">');
    });

    it('should omit hreflang when the page exists in one language only', () => {
        const html = buildHtmlDocument('<p>x</p>', {
            ...BASE_META,
            lang: 'en',
            defaultLang: 'en',
            alternates: [{ lang: 'en', url: 'https://example.com/articles/a' }],
        }, '', '');

        expect(html).not.toContain('hreflang');
    });

    it('should skip x-default when the default language has no variant', () => {
        const html = buildHtmlDocument('<p>x</p>', {
            ...BASE_META,
            lang: 'hi',
            defaultLang: 'fr',
            alternates: [
                { lang: 'en', url: 'https://example.com/articles/a' },
                { lang: 'hi', url: 'https://example.com/hi/articles/a' },
            ],
        }, '', '');

        expect(html).toContain('hreflang="en"');
        expect(html).not.toContain('x-default');
    });
});

describe('toOgLocale', () => {
    it('should pass through a bare language subtag', () => {
        expect(toOgLocale('hi')).toBe('hi');
    });

    it('should upper-case a region into the language_TERRITORY form', () => {
        expect(toOgLocale('pt-br')).toBe('pt_BR');
    });

    it('should normalize case and whitespace', () => {
        expect(toOgLocale('  EN-us ')).toBe('en_US');
    });

    it('should fall back to English for an empty value', () => {
        expect(toOgLocale('')).toBe('en');
    });
});
