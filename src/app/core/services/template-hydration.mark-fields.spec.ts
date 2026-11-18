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

    it('prefers the whole element\'s binding to an attribute\'s', () => {
        const out = mark('<img alt="{{ summary }}" data-arc-bind="coverImage">');
        expect(out).toContain('data-arc-field="coverImage"');
        expect(out).not.toContain('data-arc-field-attr');
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
