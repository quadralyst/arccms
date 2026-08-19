/**
 * Guards the shipped default detail template.
 *
 * `public/templates/default/detail.html` is the layout every content type gets
 * without a folder of its own, and it is plain HTML — nothing type-checks it
 * and no unit test renders it. A mistyped loop name or binding there fails
 * silently: the page publishes, just without the section.
 *
 * These run the real file through the real hydration pipeline, in the same
 * order the publish path uses (loops, then bindings).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateHydrationService } from '../app/core/services/template-hydration.service';

const TEMPLATE = readFileSync(
    join(__dirname, '../../public/templates/default/detail.html'),
    'utf8',
);

const ICON = { set: 'fa', name: 'star', style: 'solid', classes: 'fa-solid fa-star', label: 'Star' };

const INFO_CARDS = [
    { id: 'r_a', position: 1, image: '', icon: ICON, headline: 'First card', info: 'First body' },
    { id: 'r_b', position: 2, image: 'https://example.com/card.jpg', icon: null, headline: 'Second card', info: 'Second body' },
];

const DETAILS = [
    { id: 'r_e', position: 1, label: 'Minimum age', value: '16 years' },
    { id: 'r_f', position: 2, label: 'Cost', value: 'Free' },
];

const GALLERY = [
    { id: 'r_c', position: 1, image: 'https://example.com/photo.jpg', video: '', caption: 'A photo' },
    { id: 'r_d', position: 2, image: '', video: 'https://youtu.be/dQw4w9WgXcQ', caption: 'A video' },
];

const BASE = {
    title: 'A Page',
    content: '<p>Body</p>',
    contentType: 'Events',
    contentTypeSlug: 'events',
    langPrefix: '',
    date: '1 Jan 2026',
    readingTime: '3 min read',
    share: { twitter: '#', facebook: '#', linkedin: '#', email: '#' },
};

/**
 * The rendered markup with `<style>` and `<script>` stripped.
 *
 * The class names under test appear in the stylesheet and the click handler
 * too, so asserting against the whole file would count those and never notice
 * a row that failed to render.
 */
function markup(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
}

/** Renders the shipped template exactly the way the publish path does. */
function render(customFields: Record<string, unknown>, slug = 'events'): string {
    const loops = TemplateHydrationService.arrayLoopData(customFields, ['tags', 'items'], slug);
    const withLoops = TemplateHydrationService.processLoops(TEMPLATE, { ...loops, tags: [] });
    return TemplateHydrationService.hydrateTemplate(withLoops, { ...BASE, ...customFields });
}

describe('default detail template', () => {
    it('renders info cards from a slug-prefixed field', () => {
        const html = render({ events_info_cards: INFO_CARDS });

        expect(html).toContain('First card');
        expect(html).toContain('Second card');
        expect(html).toContain('First body');
        // The icon card keeps its <i>, the image card its <img>.
        expect(html).toContain('fa-solid fa-star');
        expect(html).toContain('https://example.com/card.jpg');
    });

    it('renders a gallery from a slug-prefixed field', () => {
        const html = render({ events_gallery: GALLERY });

        expect(html).toContain('https://example.com/photo.jpg');
        expect(html).toContain('A photo');
        expect(html).toContain('A video');
        // Derived, not stored.
        expect(html).toContain('img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    });

    it('renders a label/value list from a slug-prefixed field', () => {
        const html = render({
            events_details: DETAILS,
            events_details_heading: 'At a glance',
        });

        expect(html).toContain('Minimum age');
        expect(html).toContain('16 years');
        expect(html).toContain('Free');
    });

    it('renders the editable heading through the unprefixed alias', () => {
        // A shared template cannot name `events_details_heading`, so the
        // hydration aliases every custom field to its bare key.
        const html = render({
            events_details: DETAILS,
            events_details_heading: 'Key facts',
        });

        expect(html).toContain('Key facts');
        expect(html).not.toContain('>At a glance<');
    });

    it('drops the heading when the editor left it blank', () => {
        const html = markup(render({ events_details: DETAILS, events_details_heading: '' }));

        expect(html).not.toContain('arc-glance-heading');
        // The rows still render — only the title is optional.
        expect(html).toContain('Minimum age');
    });

    it('drops the whole facts card for a type without the field', () => {
        const html = markup(render({}));

        expect(html).not.toContain('arc-glance-row');
        expect(html).not.toContain('>Label<');
        expect(html).not.toContain('>Value<');
    });

    it('renders exactly one row per item', () => {
        const html = markup(render({ events_info_cards: INFO_CARDS, events_gallery: GALLERY }));

        expect(html.match(/class="arc-info-card"/g)).toHaveLength(2);
        expect(html.match(/class="arc-gallery-item"/g)).toHaveLength(2);
    });

    it('renders one facts row per pair', () => {
        const html = markup(render({ events_details: DETAILS, events_details_heading: 'At a glance' }));
        expect(html.match(/class="arc-glance-row"/g)).toHaveLength(2);
    });

    it('gives only the video row a play button', () => {
        const html = markup(render({ events_gallery: GALLERY }));
        expect(html.match(/arc-gallery-video/g)).toHaveLength(1);
    });

    it('drops the placeholder rows for a type with neither field', () => {
        const html = markup(render({}));

        // The container survives as an empty div — the stylesheet hides it with
        // :empty — but the placeholder rows inside must never reach a page.
        expect(html).not.toContain('class="arc-info-card"');
        expect(html).not.toContain('class="arc-gallery-item"');
        expect(html).not.toContain('>Headline<');
        expect(html).not.toContain('>Caption<');
    });

    it('drops the gallery rows when its field is an empty list', () => {
        const html = markup(render({ events_gallery: [] }));
        expect(html).not.toContain('class="arc-gallery-item"');
    });

    it('hides an empty container through the stylesheet', () => {
        // Without this the emptied div would still take its top margin, and
        // the bordered ones would publish as a stray horizontal rule.
        expect(TEMPLATE).toContain('.arc-gallery:empty');
        expect(TEMPLATE).toContain('.arc-info-cards:empty');
        expect(TEMPLATE).toContain('.article-tags:empty');
    });

    it('still renders the rest of the page when a repeating field is absent', () => {
        const html = render({});

        expect(html).toContain('A Page');
        expect(html).toContain('<p>Body</p>');
        expect(html).toContain('Back to');
    });

    it('leaves no unresolved bindings behind', () => {
        const html = render({ events_info_cards: INFO_CARDS, events_gallery: GALLERY });

        // `{{` surviving into the output is the signature of a mistyped key.
        const leftovers = markup(html).match(/\{\{[^}]*\}\}/g) ?? [];
        expect(leftovers).toEqual([]);
    });

    it('has no leftover Angular styles-array syntax', () => {
        // The file began life as a component's `styles: [\`...\`]` block.
        expect(TEMPLATE).not.toContain('`]');
    });
});
