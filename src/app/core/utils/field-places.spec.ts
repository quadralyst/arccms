/**
 * Custom fields placed in the text (specs/visual-editing-spec.md, VE-D28): this
 * file is the source and functions/src/shared/field-places.ts its mirror; both are
 * run through the same cases so they cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import * as app from './field-places';
import * as published from '../../../../functions/src/shared/field-places';
import { TemplateHydrationService } from '../services/template-hydration.service';

const TEMPLATE = `<!doctype html><html><head><title>{{ title }}</title></head><body>
<main><div class="body" data-arc-bind="content"></div>
<section class="arc-faq" data-arc-if="faq"><h3 data-arc-if="faq_heading" data-arc-bind="faq_heading">Questions</h3>
<div class="arc-faq-list" data-arc-loop="faq"><details><summary data-arc-bind="question">Q</summary></details></div></section>
<footer class="end">End</footer></main></body></html>`;

const ROWS = [{ question: 'One?', answer: 'Yes.', position: 0 }, { question: 'Two?', answer: 'No.', position: 1 }];

/** Fills the template as the detail page does: tag, loops, bindings, move. */
function render(impl: typeof app, body: string, fields: { key: string; type: string }[], data: Record<string, unknown> = {}) {
    const placed = impl.placedFields(body, fields);
    let html = impl.prepareFieldPlaces(TEMPLATE, placed, 'articles');
    html = TemplateHydrationService.processLoops(html, { 'articles-faq': ROWS, faq: ROWS });
    html = TemplateHydrationService.hydrateTemplate(html, {
        title: 'T', contentTypeSlug: 'articles', content: body, 'articles-faq': ROWS, 'articles-faq_heading': 'Good to know', ...data,
    });
    return placed.length ? impl.moveFieldBlocks(html) : html;
}

const FIELDS = [{ key: 'articles-faq', type: 'faq' }, { key: 'articles-gallery', type: 'gallery' }, { key: 'articles-price', type: 'number' }];

for (const [name, impl] of [['app', app], ['published', published]] as const) {
    describe(`field places (${name})`, () => {
        it('reads the placed keys in order, each once', () => {
            const body = '<p>a</p><div data-arc-place="b"></div><div data-arc-place="a"></div><div data-arc-place="b"></div>';
            expect(impl.placedFieldKeys(body)).toEqual(['b', 'a']);
            expect(impl.placedFieldKeys(null)).toEqual([]);
        });

        it('keeps only fields the type has and can place', () => {
            const body = '<div data-arc-place="articles-faq"></div><div data-arc-place="articles-price"></div><div data-arc-place="gone"></div>';
            expect(impl.placedFields(body, FIELDS)).toEqual([{ key: 'articles-faq', type: 'faq' }]);
        });

        it('moves the template\'s own block into the marker, and only there', () => {
            const html = render(impl, '<p>Before</p><div data-arc-place="articles-faq"></div><p>After</p>', FIELDS);
            const at = (s: string) => html.indexOf(s);
            expect(at('Before')).toBeLessThan(at('class="arc-faq"'));
            expect(at('class="arc-faq"')).toBeLessThan(at('After'));
            expect(html.match(/class="arc-faq"/g)).toHaveLength(1);
            expect(html).toContain('<summary>Two?</summary>');
            expect(html).toContain('Good to know');
            expect(html).not.toContain('data-arc-block-of');
        });

        it('leaves the page as it is without a marker', () => {
            const html = render(impl, '<p>Body</p>', FIELDS);
            expect(html.indexOf('class="arc-faq"')).toBeGreaterThan(html.indexOf('Body'));
            expect(html).not.toContain('data-arc-place');
        });

        it('draws a plain block for a field the template does not lay out', () => {
            const rows = [{ image: '/a.jpg', caption: 'A cat', position: 0 }];
            const placed = impl.placedFields('<div data-arc-place="articles-gallery"></div>', FIELDS);
            let html = impl.prepareFieldPlaces(TEMPLATE, placed, 'articles');
            html = TemplateHydrationService.processLoops(html, { 'articles-gallery': rows });
            html = TemplateHydrationService.hydrateTemplate(html, {
                contentTypeSlug: 'articles', content: '<div data-arc-place="articles-gallery"></div>', 'articles-gallery': rows,
            });
            html = impl.moveFieldBlocks(html);
            expect(html).toMatch(/<div data-arc-place="articles-gallery"><div class="arc-gallery">/);
            expect(html).toContain('A cat');
        });

        it('drops a marker whose field the template drops, as for a field with no value', () => {
            const html = render(impl, '<div data-arc-place="articles-faq"></div>', FIELDS, { 'articles-faq': undefined });
            expect(html).not.toContain('data-arc-place');
        });

        it('shows a field once when the text holds two markers for it', () => {
            const html = render(impl, '<div data-arc-place="articles-faq"></div><p>Mid</p><div data-arc-place="articles-faq"></div>', FIELDS);
            expect(html.match(/class="arc-faq"/g)).toHaveLength(1);
            expect(html.match(/data-arc-place/g)).toHaveLength(1);
        });
    });
}
