/**
 * Page text (specs/visual-editing-spec.md, VE-D41 to VE-D43): this file is the
 * source and functions/src/shared/page-text.ts its mirror. Every case runs on
 * both, and both must give the same page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as app from './page-text';
import * as published from '../../../../functions/src/shared/page-text';
import type { PageTextOptions, PageTextValues } from './page-text';
import { TemplateHydrationService as AppHydration } from '../services/template-hydration.service';
import { TemplateHydrationService as PublishHydration } from '../../../../functions/src/shared/template-hydration';

const copies: Array<[string, typeof app.applyPageText]> = [
    ['app', app.applyPageText],
    ['publish', published.applyPageText as typeof app.applyPageText],
];

const EN: PageTextOptions = { lang: 'en', defaultLang: 'en', ownFile: true };
const HI: PageTextOptions = { lang: 'hi', defaultLang: 'en', ownFile: false };
const HI_OWN: PageTextOptions = { lang: 'hi', defaultLang: 'en', ownFile: true };

const page = (body: string, head = '<title>Home</title>') =>
    `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

/** Runs a case on both copies, checks they agree, and returns the page. */
function both(html: string, values: PageTextValues | null, options: PageTextOptions): string {
    const outs = copies.map(([, apply]) => apply(html, values, options));
    expect(outs[1]).toBe(outs[0]);
    return outs[0];
}

const text = (lang: string, key: string, value: string): PageTextValues => ({ text: { [lang]: { [key]: { value } } } });

describe('page text', () => {
    describe('a file with no marks', () => {
        const site = join(__dirname, '../../../../public/_site');
        const custom = join(__dirname, '../../../custom/site');
        const files = [
            join(site, 'home.html'),
            ...readdirSync(join(site, 'pages')).map((name) => join(site, 'pages', name)),
            ...[join(custom, 'home.html')].filter((path) => existsSync(path)),
        ].filter((path) => path.endsWith('.html'));

        it.each(files)('comes back byte for byte: %s', (path) => {
            const html = readFileSync(path, 'utf8');
            for (const [, apply] of copies) {
                expect(apply(html, null, EN)).toBe(html);
                expect(apply(html, {}, HI)).toBe(html);
                // Values for keys the file does not mark change nothing either.
                expect(apply(html, { ...text('en', 'hero', 'Hi'), urls: { hero: { value: '/x.png' } } }, EN)).toBe(html);
            }
        });
    });

    describe('areas whose words would delete what is inside them (review M2, M3)', () => {
        it('plain text holding elements keeps the file\'s words and elements', () => {
            const out = both(page('<h1 data-arc-edit="hero">Hello <span class="accent">world</span><br>again</h1>'), text('en', 'hero', 'Hi'), EN);
            expect(out).toContain('<h1>Hello <span class="accent">world</span><br>again</h1>');
        });

        it('an area holding another marked area keeps it, and the inner one is filled', () => {
            const values: PageTextValues = { text: { en: { outer: { value: 'Gone' }, inner: { value: 'Kept' } } } };
            const out = both(page('<div data-arc-edit="outer" data-arc-edit-kind="rich">Hi <span data-arc-edit="inner">in</span></div>'), values, EN);
            expect(out).toContain('<div>Hi <span>Kept</span></div>');
        });
    });

    describe('kinds of area', () => {
        it('plain text, escaped', () => {
            const out = both(page('<h1 data-arc-edit="hero">Welcome</h1>'), text('en', 'hero', '<script>alert(1)</script> & you'), EN);
            expect(out).toContain('<h1>&lt;script&gt;alert(1)&lt;/script&gt; &amp; you</h1>');
        });

        it('leaves an area with no value as the file has it', () => {
            const out = both(page('<h1 data-arc-edit="hero">Welcome</h1><p data-arc-edit="intro">Hello</p>'), text('en', 'intro', 'Hi there'), EN);
            expect(out).toContain('<h1>Welcome</h1>');
            expect(out).toContain('<p>Hi there</p>');
        });

        it('treats a blank value as no value', () => {
            const out = both(page('<h1 data-arc-edit="hero">Welcome</h1>'), text('en', 'hero', '   '), EN);
            expect(out).toContain('<h1>Welcome</h1>');
        });

        it('rich text keeps bold, italic, line breaks and safe links only', () => {
            const rich = '<b>Bold</b> <em class="x">it</em><br/><a href="/about" onclick="x()">About</a>'
                + '<a href="javascript:alert(1)">bad</a><script>alert(2)</script><img src=x onerror=alert(3)>'
                + '<div style="color:red">div</div> 1 < 2 &amp; &copy;';
            const out = both(page('<div data-arc-edit="body" data-arc-edit-kind="rich">Old</div>'), text('en', 'body', rich), EN);
            expect(out).toContain('<div><b>Bold</b> <em>it</em><br><a href="/about">About</a><a>bad</a>alert(2)div 1 &lt; 2 &amp; ©</div>');
            expect(out).not.toMatch(/onclick|onerror|javascript:|<script>alert|<img src="?x/);
        });

        it('a link: its words and its address', () => {
            const values: PageTextValues = { ...text('en', 'cta', 'Join us'), urls: { cta: { value: 'https://example.com/join?a=1&b=2' } } };
            const out = both(page('<a data-arc-edit="cta" href="/old" class="btn">Sign up</a>'), values, EN);
            expect(out).toContain('<a href="https://example.com/join?a=1&amp;b=2" class="btn">Join us</a>');
        });

        it('a link that holds elements changes only its address', () => {
            const values: PageTextValues = { ...text('en', 'social', 'ignored'), urls: { social: { value: 'mailto:hi@example.com' } } };
            const out = both(page('<a data-arc-edit="social" href="#"><svg aria-hidden="true"></svg></a>'), values, EN);
            expect(out).toContain('<a href="mailto:hi@example.com"><svg aria-hidden="true"></svg></a>');
        });

        it('a picture: a new address drops the old sizes and the <picture> sources; alt text', () => {
            const html = page('<picture><source srcset="/a.webp" type="image/webp"><img data-arc-edit="photo" src="/a.jpg" srcset="/a-2x.jpg 2x" sizes="100vw" width="800" height="600" alt="Old" class="hero"></picture>');
            const out = both(html, { ...text('en', 'photo', 'A "new" photo'), urls: { photo: { value: '/media/new.jpg' } } }, EN);
            expect(out).toContain('<picture><img src="/media/new.jpg" alt="A &quot;new&quot; photo" class="hero"></picture>');
        });

        it('a lazily loaded picture: its script\'s copy of the address takes the new one, its other sizes go (review L)', () => {
            const html = page('<img data-arc-edit="photo" src="/blank.gif" data-src="/a.jpg" data-srcset="/a-2x.jpg 2x" data-sizes="auto" class="lazyload" alt="Old">');
            const out = both(html, { ...text('en', 'photo', 'New'), urls: { photo: { value: '/media/new.jpg' } } }, EN);
            expect(out).toContain('<img src="/media/new.jpg" data-src="/media/new.jpg" class="lazyload" alt="New">');
            expect(out).not.toContain('/a.jpg');
        });

        it('a picture keeps its file when only the alt text changed', () => {
            const out = both(page('<img data-arc-edit="photo" src="/a.jpg" srcset="/a-2x.jpg 2x" alt="Old">'), text('en', 'photo', 'New'), EN);
            expect(out).toContain('<img src="/a.jpg" srcset="/a-2x.jpg 2x" alt="New">');
        });

        it('a background picture, quoted, the element\'s other styles kept', () => {
            const html = page('<section data-arc-edit="band" data-arc-edit-kind="background" style="color: red; background-image: url(/old.jpg)">x</section>');
            const out = both(html, { urls: { band: { value: '/media/a"b.jpg' } } }, EN);
            expect(out).toContain('<section style="color: red; background-image: url(&quot;/media/a\\&quot;b.jpg&quot;)">x</section>');
        });

        it('the section title of a card block', () => {
            const html = page('<arc-content-partials content-type="testimonials" section-title="Kind words" data-arc-edit="testimonials_title"></arc-content-partials>');
            const out = both(html, text('en', 'testimonials_title', 'What people say'), EN);
            expect(out).toContain('<arc-content-partials content-type="testimonials" section-title="What people say"></arc-content-partials>');
        });

        it('never fills a script, a style or anything else whose words are code', () => {
            const html = page('<script data-arc-edit="s">var a = 1;</script><style data-arc-edit="c" data-arc-edit-kind="rich">p{}</style>'
                + '<iframe data-arc-edit="f" data-arc-edit-kind="background" src="/x"></iframe>', '<title>Home</title><script data-arc-edit="h">1</script>');
            const values: PageTextValues = { text: { en: { s: { value: 'alert(1)' }, c: { value: 'body{display:none}' }, h: { value: 'alert(2)' } } }, urls: { f: { value: '/evil.jpg' } } };
            const out = both(html, values, EN);
            expect(out).not.toMatch(/alert|display:none|evil/);
            expect(out).toContain('<script>var a = 1;</script>');
        });

        it('never fills a void element or a key that is not a safe name', () => {
            const html = page('<input data-arc-edit="field" value="a"><p data-arc-edit="a.b">Dots</p>');
            const out = both(html, { text: { en: { field: { value: 'x' }, 'a.b': { value: 'y' } } } }, EN);
            expect(out).toContain('<input value="a">');
            expect(out).toContain('<p>Dots</p>');
        });
    });

    describe('addresses', () => {
        it.each([
            ['javascript:alert(1)', ''], ['JAVASCRIPT:x', ''], ['data:text/html,x', ''], ['//evil.example', ''],
            ['vbscript:x', ''], ['/a b', ''], ['relative.html', ''], [' /ok ', '/ok'], ['https://a.example/x', 'https://a.example/x'],
            ['http://a.example', 'http://a.example'], ['mailto:a@b.c', 'mailto:a@b.c'], ['tel:+911234', 'tel:+911234'],
            ['#contact', '#contact'], ['/\\evil', ''], ['https:///x', ''],
        ])('%s gives %j', (url, safe) => {
            expect(app.safePageTextUrl(url)).toBe(safe);
            expect(published.safePageTextUrl(url)).toBe(safe);
        });

        it('an unsafe address leaves the file\'s own', () => {
            const out = both(page('<a data-arc-edit="cta" href="/join">Join</a><img data-arc-edit="p" src="/a.jpg">'),
                { urls: { cta: { value: 'javascript:alert(1)' }, p: { value: 'data:image/png;base64,x' } } }, EN);
            expect(out).toContain('<a href="/join">Join</a><img src="/a.jpg">');
        });
    });

    describe('the title, description and share image', () => {
        const head = '<title data-arc-edit="title">Home</title><meta name="description" content="Old" data-arc-edit="description">'
            + '<meta property="og:title" content="Home"><meta name="twitter:description" content="Old">';

        it('come from the SEO values, with their social copies', () => {
            const values: PageTextValues = {
                seo: { en: { title: { value: 'Fresh <bread>' }, description: { value: 'Baked "daily"' } } },
                shareImage: { value: 'https://example.com/share.jpg' },
            };
            const out = both(page('', head), values, EN);
            expect(out).toContain('<title>Fresh &lt;bread&gt;</title>');
            expect(out).toContain('<meta name="description" content="Baked &quot;daily&quot;">');
            expect(out).toContain('<meta property="og:title" content="Fresh <bread>">');
            expect(out).toContain('<meta name="twitter:description" content="Baked &quot;daily&quot;">');
            expect(out).toContain('<meta property="og:image" content="https://example.com/share.jpg">');
        });

        it('keep the editor\'s title on a social tag the file translates', () => {
            const out = both(page('', '<title>Home</title><meta property="og:title" content="Home" data-arc-t-attr="content:home.title, data-x:y">'),
                { seo: { en: { title: { value: 'Fresh' } } } }, EN);
            expect(out).toContain('<meta property="og:title" content="Fresh" data-arc-t-attr=" data-x:y">');
        });

        it('work on a file that marks nothing, adding what it lacks', () => {
            const out = both('<!DOCTYPE html><html><head></head><body><p>Hi</p></body></html>',
                { seo: { en: { title: { value: 'T' }, description: { value: 'D' } } } }, EN);
            expect(out).toContain('<title>T</title>');
            expect(out).toContain('<meta name="description" content="D">');
            expect(out).toContain('<p>Hi</p>');
        });

        it('leave the file\'s own when there are none', () => {
            const out = both(page('<p data-arc-edit="x">a</p>', head), {}, EN);
            expect(out).toContain('<title>Home</title><meta name="description" content="Old">');
        });
    });

    describe('languages', () => {
        const html = page('<h1 data-arc-edit="hero" data-arc-t="home_hero">Welcome</h1><p data-arc-edit="intro">Hello</p>'
            + '<img data-arc-edit="photo" src="/a.jpg" alt="A cake" data-arc-t-attr="alt:cake_alt">');
        const values: PageTextValues = {
            text: { en: { hero: { value: 'Hi all' }, intro: { value: 'Hello friends' }, photo: { value: 'A big cake' } }, hi: { intro: { value: 'नमस्ते दोस्तों' } } },
            urls: { photo: { value: '/media/cake.jpg' } },
        };

        it('the default language uses its edited values and removes the string key it beat', () => {
            const out = both(html, values, { ...EN, strings: { home_hero: 'Ignored' } });
            expect(out).toContain('<h1>Hi all</h1>');
            expect(out).toContain('<p>Hello friends</p>');
            expect(out).toContain('<img src="/media/cake.jpg" alt="A big cake">');
        });

        it('another language: its own value, else a translation, else the default language\'s value', () => {
            const out = both(html, values, { ...HI, strings: { home_hero: 'स्वागत है' } });
            // A translation exists: the area is left for the strings to fill.
            expect(out).toContain('<h1 data-arc-t="home_hero">Welcome</h1>');
            expect(out).toContain('<p>नमस्ते दोस्तों</p>');
            // No translation of the alt text: the default language's edited value.
            expect(out).toContain('<img src="/media/cake.jpg" alt="A big cake">');
        });

        it('another language with no translation takes the default language\'s value', () => {
            const out = both(html, values, { ...HI, strings: {} });
            expect(out).toContain('<h1>Hi all</h1>');
        });

        it('a language with its own file keeps that file\'s words, but shares pictures and addresses', () => {
            const out = both(html, values, HI_OWN);
            expect(out).toContain('<h1 data-arc-t="home_hero">Welcome</h1>');
            expect(out).toContain('<p>नमस्ते दोस्तों</p>');
            expect(out).toContain('<img src="/media/cake.jpg" alt="A cake" data-arc-t-attr="alt:cake_alt">');
        });

        it('SEO words follow the same order', () => {
            const seo: PageTextValues = { seo: { en: { title: { value: 'Bakery' } } } };
            expect(both(page(''), seo, HI)).toContain('<title>Bakery</title>');
            expect(both(page(''), seo, HI_OWN)).toContain('<title>Home</title>');
            expect(both(page('', '<title data-arc-t="t">Home</title>'), seo, { ...HI, strings: { t: 'घर' } })).toContain('<title data-arc-t="t">Home</title>');
        });
    });

    describe('marks', () => {
        const html = page('<section data-arc-label="Welcome"><h1 data-arc-edit="hero" data-arc-placeholder="A headline">Welcome</h1></section>'
            + '<div data-arc-edit="b" data-arc-edit-kind="rich">x</div>');

        it('are removed from the page', () => {
            const out = both(html, text('en', 'hero', 'Hi'), EN);
            expect(out).not.toMatch(/data-arc-(edit|label|placeholder)/);
        });

        it('are kept for the Visual Editor', () => {
            const out = both(html, text('en', 'hero', 'Hi'), { ...EN, keepMarks: true });
            expect(out).toContain('<h1 data-arc-edit="hero" data-arc-placeholder="A headline">Hi</h1>');
            expect(out).toContain('data-arc-label="Welcome"');
        });
    });

    it('names areas by tag and kind', () => {
        for (const kinds of [app.pageTextKind, published.pageTextKind]) {
            expect(kinds('IMG', null)).toBe('picture');
            expect(kinds('a', '')).toBe('link');
            expect(kinds('div', 'rich')).toBe('rich');
            expect(kinds('section', 'background')).toBe('background');
            expect(kinds('img', 'background')).toBe('background');
            expect(kinds('arc-content-partials', '')).toBe('section-title');
            expect(kinds('title', '')).toBe('title');
            expect(kinds('meta', '', 'description')).toBe('description');
            expect(kinds('meta', '', 'robots')).toBe('none');
            expect(kinds('br', '')).toBe('none');
            expect(kinds('script', '')).toBe('none');
            expect(kinds('style', 'rich')).toBe('none');
            expect(kinds('iframe', 'background')).toBe('none');
            expect(kinds('h2', '')).toBe('text');
            for (const raw of ['xmp', 'noembed', 'noframes', 'plaintext']) expect(kinds(raw, '')).toBe('none');
        }
    });

    it('a file is marked by the attribute, not by the words', async () => {
        const { hasPageTextMarks } = await import('./page-text-model');
        for (const has of [hasPageTextMarks, published.hasPageTextMarks]) {
            expect(has('<h1 data-arc-edit="hero">Hi</h1>')).toBe(true);
            expect(has('<h1\n  data-arc-edit = "hero">Hi</h1>')).toBe(true);
            expect(has('<p>Mark areas with data-arc-edit.</p><!-- data-arc-edit -->')).toBe(false);
            expect(has('<div data-arc-edit-kind="rich"></div>')).toBe(false);
            expect(has(null)).toBe(false);
        }
    });

    it('page ids', () => {
        expect(app.pageTextId.home()).toBe('home');
        expect(app.pageTextId.staticPage('about-us')).toBe('p-about-us');
        expect(app.PAGE_TEXT_ID.test('p-about-us')).toBe(true);
        expect(app.PAGE_TEXT_ID.test('p-')).toBe(false);
        expect(app.PAGE_TEXT_ID.test('home2')).toBe(false);
        expect(app.pageTextId.listPage('articles')).toBe('list-articles');
        expect(published.pageTextId.listPage('articles')).toBe('list-articles');
        expect(app.PAGE_TEXT_ID.test('list-articles')).toBe(true);
        expect(app.PAGE_TEXT_ID.test('list-')).toBe(false);
        expect(app.PAGE_TEXT_ID.test('list-a/b')).toBe(false);
        expect([published.LIST_TITLE_KEY, published.LIST_INTRO_KEY]).toEqual([app.LIST_TITLE_KEY, app.LIST_INTRO_KEY]);
        expect(published.PAGE_TEXT_ID.source).toBe(app.PAGE_TEXT_ID.source);
        expect(published.PAGE_TEXT_KEY.source).toBe(app.PAGE_TEXT_KEY.source);
    });
});

// VE-D59 to VE-D61, VE-D64: a list page, filled after its bindings.
describe('list page text', () => {
    const site = join(__dirname, '../../../../public/_site/templates');
    const templates = readdirSync(site).filter((name) => existsSync(join(site, name, 'list.html')));
    const EN_LIST: app.ListPageTextOptions = { lang: 'en', defaultLang: 'en', named: { title: false, intro: false } };
    const HI_LIST: app.ListPageTextOptions = { lang: 'hi', defaultLang: 'en', named: { title: false, intro: false } };
    const ITEMS = [{ title: 'First', url: '/articles/first', excerpt: 'One' }, { title: 'Second', url: '/articles/second' }];
    const TYPE = { contentType: 'Articles', contentTypeDescription: 'Latest news', contentTypeSlug: 'articles', lang: 'en', langPrefix: '' };

    /** The page as the app and as publishing build it, checked to agree but for their hydrators' own differences. */
    function draw(html: string, values: PageTextValues | null, options = EN_LIST, data: Record<string, unknown> = TYPE, strings = {}) {
        const pages = [
            { text: app, hydrate: AppHydration }, { text: published as unknown as typeof app, hydrate: PublishHydration as unknown as typeof AppHydration },
        ].map(({ text, hydrate }) => {
            const held = text.holdListMarks(html, values, { ...options, strings });
            let out = hydrate.processLoops(hydrate.applyStrings(held.html, strings), { items: ITEMS });
            out = hydrate.hydrateTemplate(out, data);
            return text.fillListPage(out, held.token, values, { ...options, strings });
        });
        expect(pages[1]).toBe(pages[0]);
        return pages[0];
    }

    it.each(templates)('a page with nothing changed is, byte for byte, the one its file made without marks: %s', (name) => {
        const html = readFileSync(join(site, name, 'list.html'), 'utf8');
        const bare = html.replace(/ data-arc-edit="[^"]*"/g, '');
        expect(bare).not.toBe(html);
        expect(draw(html, null)).toBe(draw(bare, null));
        expect(draw(html, { seo: { en: { title: { value: 'T' } } }, shareImage: { value: '/s.jpg' } })).toBe(draw(bare, null));
        for (const copy of [app, published]) {
            // A file with no marks is not touched at all.
            expect(copy.holdListMarks(bare, text('en', 'title', 'X'), EN_LIST)).toEqual({ html: bare, token: '' });
            expect(copy.fillListPage(bare, '', text('en', 'title', 'X'), EN_LIST)).toBe(bare);
        }
    });

    it('an area shows the bound value until an editor changes it, and then their words', () => {
        const html = '<h1 data-arc-edit="title">{{ contentType }}</h1><h2>{{ contentType }}</h2>';
        expect(draw(html, null)).toContain('<h1>Articles</h1><h2>Articles</h2>');
        expect(draw(html, text('en', 'title', 'Our stories'))).toContain('<h1>Our stories</h1><h2>Articles</h2>');
    });

    it('an editor\'s words win over every way a template binds', () => {
        const values = text('en', 'title', 'Mine');
        expect(draw('<h1 data-arc-edit="title" data-arc-bind="contentType">x</h1>', values)).toContain('<h1>Mine</h1>');
        expect(draw('<h1 data-arc-edit="title" class="arc-skeleton">{{ contentType }}</h1>', values)).toContain('<h1>Mine</h1>');
        expect(draw('<h1 data-arc-edit="title" data-arc-if="nothing">{{ contentType }}</h1>', values)).toContain('<h1>Mine</h1>');
        expect(draw('<h1 data-arc-edit="title" data-arc-if="nothing">{{ contentType }}</h1>', null)).not.toContain('<h1');
    });

    it('never reads their words as a binding', () => {
        expect(draw('<h1 data-arc-edit="title">{{ contentType }}</h1>', text('en', 'title', '{{ contentTypeSlug }}'))).toContain('<h1>{{ contentTypeSlug }}</h1>');
        const link = draw('<a data-arc-edit="go" href="/x">Go</a>', { urls: { go: { value: 'https://x.test/{{contentTypeSlug}}' } } });
        expect(link).toContain('href="https://x.test/{{contentTypeSlug}}"');
    });

    it('marks inside a loop, or words marked over one, are not areas', () => {
        const values = { ...text('en', 'title', 'Mine'), text: { en: { title: { value: 'Mine' }, all: { value: 'Gone' } } } };
        const out = draw('<ul data-arc-loop="items"><li data-arc-edit="title" data-arc-label="Card">{{ title }}</li></ul>', values);
        expect(out).toContain('<li>First</li><li>Second</li>');
        const rich = draw('<div data-arc-edit="all" data-arc-edit-kind="rich"><ul data-arc-loop="items"><li>{{ title }}</li></ul></div>', values);
        expect(rich).toContain('<li>First</li>');
        expect(draw('<ul data-arc-edit="all" data-arc-edit-kind="rich" data-arc-loop="items"><li>{{ title }}</li></ul>', values)).toContain('<li>First</li>');
        // A background over the cards is still an area: it changes no words.
        expect(draw('<div data-arc-edit="bg" data-arc-edit-kind="background"><ul data-arc-loop="items"><li>{{ title }}</li></ul></div>', { urls: { bg: { value: '/b.jpg' } } }))
            .toContain('background-image');
    });

    it('every kind of area works, in and out of a loop\'s way', () => {
        const out = draw(
            '<img data-arc-edit="pic" src="/a.jpg" alt="A"><p data-arc-edit="note" data-arc-edit-kind="rich">x</p><ul data-arc-loop="items"><li>{{ title }}</li></ul>',
            { text: { en: { pic: { value: 'New' }, note: { value: '<b>Bold</b><script>x</script>' } } }, urls: { pic: { value: '/n.jpg' } } });
        expect(out).toContain('src="/n.jpg" alt="New"');
        expect(out).toContain('<p><b>Bold</b>x</p>');
    });

    it('keeps the marks for the Visual Editor, its label and placeholder with them, and nothing of its own', () => {
        const out = draw('<h1 data-arc-edit="title" data-arc-label="Heading" data-arc-placeholder="Add a heading" data-arc-t="k">{{ contentType }}</h1>', null, { ...EN_LIST, keepMarks: true });
        expect(out).toContain('<h1 data-arc-edit="title" data-arc-label="Heading" data-arc-placeholder="Add a heading">Articles</h1>');
        expect(out).not.toContain('data-arc-held');
    });

    it('a translation wins over the default language\'s words; a type named in the language wins for its heading', () => {
        const values: PageTextValues = { text: { en: { more: { value: 'See all' }, title: { value: 'Our stories' } } } };
        const html = '<h1 data-arc-edit="title">{{ contentType }}</h1><b data-arc-edit="more" data-arc-t="read_more">More</b>';
        expect(draw(html, values, HI_LIST)).toContain('<h1>Our stories</h1><b>See all</b>');
        expect(draw(html, values, HI_LIST, TYPE, { read_more: 'और' })).toContain('<b>और</b>');
        expect(draw(html, values, { ...HI_LIST, named: { title: true, intro: false } }, { ...TYPE, contentType: 'लेख' })).toContain('<h1>लेख</h1>');
    });

    describe('listPageWords', () => {
        const RICH = { rich: { title: false, intro: true } };
        const words = (values: PageTextValues | null, options: app.ListPageTextOptions = { ...EN_LIST, ...RICH }) => {
            const out = app.listPageWords(values, options);
            expect(published.listPageWords(values, options)).toEqual(out);
            return out;
        };
        const values: PageTextValues = {
            text: { en: { title: { value: 'Stories' }, intro: { value: 'By <b>us</b> &amp; you' } } },
            seo: { en: { title: { value: 'Stories | Site' } } },
            shareImage: { value: 'javascript:alert(1)' },
        };

        it('the title and intro, the SEO\'s own over them in the head, and only a safe share picture', () => {
            expect(words(null)).toEqual({ title: undefined, intro: undefined, seoTitle: undefined, seoDescription: undefined, shareImage: '' });
            expect(words(values)).toEqual({ title: 'Stories', intro: 'By us & you', seoTitle: 'Stories | Site', seoDescription: 'By us & you', shareImage: '' });
            expect(words({ ...values, shareImage: { value: '/s.jpg' } }).shareImage).toBe('/s.jpg');
            expect(words({ text: { en: { title: { value: '  ' } } } }).title).toBeUndefined();
        });

        it('another language takes the default\'s unless it has its own, or the type is named in it', () => {
            expect(words(values, { ...HI_LIST, ...RICH })).toMatchObject({ title: 'Stories', seoTitle: 'Stories | Site' });
            expect(words({ ...values, text: { ...values.text, hi: { title: { value: 'कहानियाँ' } } } }, { ...HI_LIST, ...RICH }))
                .toMatchObject({ title: 'कहानियाँ', seoTitle: 'कहानियाँ', intro: 'By us & you' });
            expect(words(values, { ...HI_LIST, named: { title: true, intro: true } }))
                .toMatchObject({ title: undefined, seoTitle: undefined, intro: undefined, seoDescription: undefined });
        });

        it('reads a rich area\'s value as its words, tags or none, and a plain one\'s as it is, by the area\'s kind', () => {
            const of = (value: string, rich: boolean) => words(text('en', 'intro', value), { ...EN_LIST, rich: { title: false, intro: rich } }).intro;
            expect(of('Tom &amp; Jerry\'s &lt;3', true)).toBe('Tom & Jerry\'s <3');
            expect(of('Tom &amp; <b>Jerry</b><br>and&nbsp;more<img src=x onerror=alert(1)>', true)).toBe('Tom & Jerry and more');
            // Typed as they are: an entity written out stays written out, once decoded only.
            expect(of('&amp;amp;', true)).toBe('&amp;');
            expect(of('Salt &amp; <b>pepper</b>', false)).toBe('Salt &amp; <b>pepper</b>');
            // The SEO tab's words are plain whatever the area is; an emptied tag is no words.
            expect(words({ ...text('en', 'intro', '<b></b>'), seo: { en: { description: { value: 'A &amp; B' } } } }, { ...EN_LIST, rich: { title: true, intro: true } }))
                .toMatchObject({ intro: undefined, seoDescription: 'A &amp; B' });
        });

        it('knows from the template which of its two areas are rich, never one inside or over a loop', () => {
            const rich = (html: string) => {
                const out = app.listRichAreas(html);
                expect(published.listRichAreas(html)).toEqual(out);
                return out;
            };
            expect(rich('<h1>None</h1>')).toEqual({ title: false, intro: false });
            expect(rich('<div data-arc-loop="items"><p data-arc-edit="title" data-arc-edit-kind="rich">x</p></div><h1 data-arc-edit="title">T</h1><p data-arc-edit="intro" data-arc-edit-kind="rich">I</p>'))
                .toEqual({ title: false, intro: true });
            expect(rich('<div data-arc-edit="intro" data-arc-edit-kind="rich"><i data-arc-loop="items"></i></div>')).toEqual({ title: false, intro: false });
        });
    });
});
