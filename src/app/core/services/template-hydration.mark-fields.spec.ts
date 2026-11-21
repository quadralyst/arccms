/**
 * The renderer's markFields option (specs/visual-editing-spec.md, VE-D7, VE1.2):
 * off, every shipped template comes out exactly as before, the same bytes as the
 * publish pipeline's copy, which has no such option; on, each element a value
 * filled names its key.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TemplateHydrationService as App } from './template-hydration.service';
import { TemplateHydrationService as Publish } from '../../../../functions/src/shared/template-hydration';

const root = resolve(__dirname, '../../../..');

/** Every template file Arc CMS ships, and the examples in the docs. */
function shippedTemplates(): { name: string; html: string }[] {
    const dirs = [resolve(root, 'public/_site/templates'), resolve(root, 'docs/examples/blog/site/templates'), resolve(root, 'docs/examples/sections/templates')];
    const files: { name: string; html: string }[] = [];
    for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        for (const folder of readdirSync(dir)) {
            for (const file of ['detail.html', 'list.html', 'partials.html']) {
                const path = resolve(dir, folder, file);
                if (existsSync(path)) files.push({ name: `${folder}/${file}`, html: readFileSync(path, 'utf8') });
            }
        }
    }
    return files;
}

/** One value of every kind a template binds: text, HTML, images, links, rows, colours, icons, video. */
const DATA: Record<string, any> = {
    title: 'A & B <title>',
    content: '<p>Body <strong>text</strong></p>',
    summary: 'Short "summary"',
    coverImage: 'https://images.unsplash.com/photo-1?w=800',
    contentType: 'Articles',
    contentTypeSlug: 'articles',
    publishedOn: 'January 5, 2026',
    date: 'January 5, 2026',
    readingTime: '3 min read',
    lang: 'en',
    langPrefix: '',
    authorName: 'Sam',
    author: { name: 'Sam', bio: 'Writes', photoUrl: '', jobTitle: '', url: '' },
    share: { twitter: 'https://twitter.com/x', facebook: 'https://facebook.com/x' },
    sectionTitle: 'Latest',
    listUrl: '/articles',
    hasItems: true,
    url: '/articles/a',
    brand: '#1a73e8',
    'articles-price': '20',
    video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};
const LOOPS: Record<string, any[]> = {
    items: [{ title: 'One', url: '/a/1', summary: 'S1', coverImage: '' }, { title: 'Two', url: '/a/2', summary: 'S2', coverImage: '' }],
    tags: [{ name: 'news', color: '#f00' }],
    faq: [{ question: 'Why?', answer: 'Because.' }],
    references: [],
    related: [],
};

function render(service: typeof App | typeof Publish, html: string, options?: { markFields?: boolean }): string {
    const looped = options ? (service as typeof App).processLoops(html, LOOPS, options) : service.processLoops(html, LOOPS);
    return options ? (service as typeof App).hydrateTemplate(looped, DATA, options) : service.hydrateTemplate(looped, DATA);
}

describe('markFields off (VE-D7)', () => {
    const templates = shippedTemplates();

    it('finds the shipped templates', () => {
        expect(templates.length).toBeGreaterThanOrEqual(10);
    });

    for (const template of shippedTemplates()) {
        it(`${template.name}: the same bytes as the publish pipeline, and as without the option`, () => {
            const published = render(Publish, template.html);
            expect(render(App, template.html)).toBe(published);
            expect(render(App, template.html, { markFields: false })).toBe(published);
            expect(render(App, template.html, {})).toBe(published);
        });
    }

    it('a fixture of each binding kind: no marker without the option', () => {
        const html = '<h1 data-arc-bind="title">x</h1><div [innerHTML]="content"></div><img [src]="coverImage"><a href="{{ url }}">{{ title }}</a><ul data-arc-loop="faq"><li>{{ question }}</li></ul>';
        const out = render(App, html);
        expect(out).toBe(render(Publish, html));
        expect(out).not.toContain('data-arc-field');
        expect(out).not.toContain('data-arc-row');
    });
});

describe('markFields on (VE-D7)', () => {
    const mark = (html: string, data: Record<string, any> = DATA) =>
        App.hydrateTemplate(App.processLoops(html, LOOPS, { markFields: true }), data, { markFields: true });

    it('marks an element filled by data-arc-bind with its key', () => {
        expect(mark('<h1 data-arc-bind="summary">x</h1>')).toContain('<h1 data-arc-field="summary">Short "summary"</h1>');
    });

    it('marks an element filled by [innerHTML]', () => {
        expect(mark('<div [innerHTML]="content"></div>')).toContain('<div data-arc-field="content"><p>Body <strong>text</strong></p></div>');
    });

    it('marks an [attr] binding and names the attribute', () => {
        const out = mark('<img [src]="coverImage">');
        expect(out).toContain('data-arc-field="coverImage"');
        expect(out).toContain('data-arc-field-attr="src"');
    });

    it('marks a {{ }} in an attribute with its first key and the attribute', () => {
        const out = mark('<a href="{{ url }}">Go</a>');
        expect(out).toContain('href="/articles/a"');
        expect(out).toContain('data-arc-field="url"');
        expect(out).toContain('data-arc-field-attr="href"');
    });

    it('prefers the whole element\'s binding to an attribute\'s, named by where it went', () => {
        const out = mark('<img alt="{{ summary }}" data-arc-bind="coverImage">');
        expect(out).toContain('data-arc-field="coverImage"');
        expect(out).toContain('data-arc-field-attr="src"');
    });

    it('marks data-arc-bind with the attribute it fills: a link, a form value, a date (review H1)', () => {
        expect(mark('<a data-arc-bind="url">Register</a>')).toContain('data-arc-field="url" data-arc-field-attr="href"');
        expect(mark('<input data-arc-bind="title">')).toContain('data-arc-field-attr="value"');
        expect(mark('<time data-arc-bind="url"></time>')).toContain('data-arc-field-attr="datetime"');
        expect(mark('<p data-arc-bind="summary">x</p>')).not.toContain('data-arc-field-attr');
    });

    it('marks a picture or a link by its address, whichever attribute comes first (review M7)', () => {
        const out = mark('<img alt="{{ title }}" src="{{ coverImage }}">');
        expect(out).toContain('data-arc-field="coverImage"');
        expect(out).toContain('data-arc-field-attr="src"');
        const link = mark('<a class="btn {{ summary }}" href="{{ url }}">Go</a>');
        expect(link).toContain('data-arc-field="url"');
        expect(link).toContain('data-arc-field-attr="href"');
        // An address first stays: another attribute after it does not take the mark.
        expect(mark('<img src="{{ coverImage }}" alt="{{ title }}">')).toContain('data-arc-field="coverImage"');
    });

    it('wraps each {{ key }} in text in a span naming it, escaping the value and keeping the text around', () => {
        expect(mark('<p>By {{ authorName }}, {{ title }}!</p>'))
            .toContain('<p>By <span data-arc-field="authorName">Sam</span>, <span data-arc-field="title">A &amp; B &lt;title&gt;</span>!</p>');
    });

    it('writes an empty value as an empty span, and a dotted key as it is', () => {
        expect(mark('<p>{{ missing }}{{ author.name }}</p>')).toContain('<span data-arc-field="missing"></span><span data-arc-field="author.name">Sam</span>');
    });

    it('never puts a span inside a title, textarea or option', () => {
        const out = mark('<textarea>{{ title }}</textarea><select><option>{{ title }}</option></select>');
        expect(out).not.toContain('<span');
    });

    it('marks each loop row with its loop and place, not the values inside it', () => {
        const out = mark('<ul data-arc-loop="faq"><li class="q">{{ question }}</li></ul><div data-arc-loop="items"><article>{{ title }}</article></div>');
        expect(out).toContain('<li class="q" data-arc-field="faq" data-arc-row="0">Why?</li>');
        expect(out).toContain('<article data-arc-field="items" data-arc-row="0">One</article>');
        expect(out).toContain('<article data-arc-field="items" data-arc-row="1">Two</article>');
    });

    it('a value can never close the marker or add markup', () => {
        const out = mark('<p>{{ title }}</p>', { title: '</span><script>alert(1)</script>' });
        expect(out).not.toContain('<script>');
        expect(out).toContain('&lt;/span&gt;&lt;script&gt;');
    });
});

describe('the Visual Editor\'s empty fields and template hints (VE-D18, VE-D19)', () => {
    const template = '<div data-arc-if="price" data-arc-label="Ticket price"><b>Price</b> <span>{{ price }}</span></div>'
        + '<p data-arc-if="related">Related</p><h1 data-arc-locked>{{ title }}</h1>';
    const data = { title: 'Concert', price: '' };

    it('keeps an empty field the editor fills, marked, and drops what the site works out', () => {
        const html = App.hydrateTemplate(template, data, { markFields: true, keepEmpty: (key) => key === 'price' });
        expect(html).toContain('<div data-arc-label="Ticket price" data-arc-empty="price">');
        expect(html).toContain('<span data-arc-field="price"></span>');
        expect(html).not.toContain('Related');
        // The hints stay for the editor's screen.
        expect(html).toContain('data-arc-locked');
    });

    it('removes the empty element and every hint anywhere else, as publishing does', () => {
        const app = App.hydrateTemplate(template, data);
        const published = Publish.hydrateTemplate(template, data);
        expect(app).toBe(published);
        expect(app).toContain('<h1>Concert</h1>');
        expect(app).not.toContain('Price');
        expect(App.hydrateTemplate(template, { ...data, price: '25' })).not.toMatch(/data-arc-(label|placeholder|locked|empty)/);
    });
});

describe('rows of a repeating field on the Visual Editor (VE-D30, VE-D33)', () => {
    const faq = [
        { id: 'r_a', position: 1, question: 'Why?', answer: 'Because.' },
        { id: 'r_b', position: 2, question: '', answer: '' },
    ];
    const cards = [{ id: 'r_c', position: 1, headline: 'Fast', info: 'Quick', image: '', icon: null }];
    const template = '<div data-arc-loop="faq"><details><summary data-arc-bind="question">Question</summary><div data-arc-bind="answer_html">Answer</div></details></div>'
        + '<div data-arc-loop="cards"><div class="card"><img data-arc-if="image" data-arc-bind="image" alt=""><i data-arc-if="icon" class="{{ icon }}"></i><h3 data-arc-bind="headline">Headline</h3></div></div>';
    const editRows = (loop: string) => (loop === 'faq' || loop === 'cards' ? { keepEmpty: (key: string, row: Record<string, any>) => (key === 'image' && !row['icon']) || key === 'question' } : null);
    const edit = (loops: Record<string, any[]>) => App.processLoops(template, loops, { markFields: true, editRows });

    it('marks each value in a row with the field, the row id and its own key, and the row with its id', () => {
        const out = edit({ faq, cards });
        expect(out).toContain('<details data-arc-field="faq" data-arc-row="0" data-arc-row-id="r_a">');
        expect(out).toContain('<summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_a">Why?</summary>');
        expect(out).toContain('data-arc-sub="answer_html" data-arc-row-id="r_a"><p>Because.</p>');
        expect(out).toContain('<h3 data-arc-field="cards" data-arc-sub="headline" data-arc-row-id="r_c">Fast</h3>');
    });

    it('draws a blank row with its values empty, never the template\'s sample words', () => {
        const out = edit({ faq, cards });
        expect(out).toContain('<summary data-arc-field="faq" data-arc-sub="question" data-arc-row-id="r_b"></summary>');
        expect(out).not.toContain('>Question<');
        expect(out).not.toContain('>Answer<');
    });

    it('keeps a row\'s empty picture to be filled in, and drops its other choices', () => {
        const out = edit({ faq, cards });
        expect(out).toMatch(/<img[^>]*data-arc-empty="image"[^>]*data-arc-sub="image"[^>]*data-arc-row-id="r_c"/);
        expect(out).not.toContain('<i ');
    });

    it('keeps an empty list\'s container, named, to add its first row', () => {
        const out = edit({ faq: [] });
        expect(out).toContain('<div data-arc-empty-loop="faq"></div>');
        // A loop with no data at all, too.
        expect(out).toContain('<div data-arc-empty-loop="cards"></div>');
    });

    it('leaves other loops as the live preview marks them', () => {
        const out = App.processLoops('<ul data-arc-loop="items"><li>{{ title }}</li></ul><ul data-arc-loop="tags"></ul>', { items: [{ id: 'x', title: 'One' }], tags: [] }, { markFields: true, editRows });
        expect(out).toContain('<li data-arc-field="items" data-arc-row="0">One</li>');
        expect(out).not.toContain('data-arc-row-id');
        expect(out).not.toContain('data-arc-empty-loop');
    });

    it('does nothing without markFields, and the preview window\'s rows are as before', () => {
        expect(App.processLoops(template, { faq, cards }, { editRows })).toBe(App.processLoops(template, { faq, cards }));
        expect(App.processLoops(template, { faq, cards }, { markFields: true })).not.toContain('data-arc-sub');
    });

    it('a kept empty value shows no sample text: the field\'s own placeholder does', () => {
        const html = App.hydrateTemplate('<h3 data-arc-if="faq_heading" data-arc-bind="faq_heading">Frequently asked questions</h3>', {}, { markFields: true, keepEmpty: () => true });
        expect(html).toContain('<h3 data-arc-empty="faq_heading"></h3>');
        // A link keeps its words: its binding fills the address, not the text.
        const link = App.hydrateTemplate('<a data-arc-if="site" data-arc-bind="site">Visit site</a>', {}, { markFields: true, keepEmpty: () => true });
        expect(link).toContain('Visit site');
    });
});
