/**
 * The standard pages' template (public/_site/templates/info/, specs/site-sections-spec.md
 * SS6), run through the real pipeline in the publish order: strings, site
 * details, loops, then bindings. Each section shows only when its page has it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateHydrationService } from '../app/core/services/template-hydration.service';

const folder = join(__dirname, '../../public/_site/templates/info');
const DETAIL = readFileSync(join(folder, 'detail.html'), 'utf8');
const LIST = readFileSync(join(folder, 'list.html'), 'utf8');

const ABOUT = { name: 'Kumar Studio', contactEmail: 'hi@kumar.example', phone: '+91 98765 43210', address: '', sameAs: ['https://github.com/kumar'] };

function markup(html: string): string {
    return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
}

function render(customFields: Record<string, unknown>): string {
    const withSite = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(DETAIL, {}), ABOUT);
    const loops = TemplateHydrationService.arrayLoopData(customFields, ['tags', 'items'], 'info');
    const looped = TemplateHydrationService.processLoops(withSite, { ...loops, tags: [] });
    return markup(TemplateHydrationService.hydrateTemplate(looped, { title: 'Contact', content: '<p>We reply within a day.</p>', contentTypeSlug: 'info', customFields, ...customFields }));
}

describe('standard pages template', () => {
    it('shows only the title and body for a plain page, such as a policy', () => {
        const html = render({});
        expect(html).toContain('<h1 class="arc-page-title">Contact</h1>');
        expect(html).toContain('We reply within a day.');
        for (const section of ['arc-page-locations', 'arc-page-faq', 'arc-page-details', 'arc-page-form']) {
            expect(html).not.toContain(section);
        }
    });

    it('shows the site\'s contact details, from Settings, About, when switched on', () => {
        const html = render({ 'info-show-contact-details': true });
        expect(html).toContain('<a href="mailto:hi@kumar.example">hi@kumar.example</a>');
        expect(html).toContain('<a href="tel:+919876543210">+91 98765 43210</a>');
        expect(html).not.toContain('Address'); // the site has none
        expect(html).toContain('href="https://github.com/kumar"');
    });

    it('leaves out the contact details block on a site with no details at all', () => {
        const withSite = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(DETAIL, {}), { name: 'Kumar' });
        const html = markup(TemplateHydrationService.hydrateTemplate(withSite, { title: 'Contact', contentTypeSlug: 'info', 'info-show-contact-details': true }));
        expect(html).not.toContain('arc-page-details');
    });

    it('shows the contact form when switched on', () => {
        const html = render({ 'info-show-contact-form': true });
        expect(html).toContain('data-arc-contact-form');
        expect(html).toMatch(/<input name="email" type="email" required/);
    });

    it('shows the questions and the map when the page has them', () => {
        const html = render({
            'info-faq': [{ id: 'q1', position: 0, question: 'Parking?', answer: 'Yes.\n\nFree after 6.' }],
            'info-locations': [{ id: 'l1', position: 0, label: 'Studio', address: 'FC Road, Pune', lat: 18.52, lng: 73.85, zoom: 15 }],
        });
        expect(html).toContain('<summary>Parking?</summary>');
        expect(html).toContain('<p>Yes.</p><p>Free after 6.</p>');
        expect(html).toContain('<h3>Studio</h3>');
        expect(html).toMatch(/<iframe[^>]+src="https:\/\/www\.openstreetmap\.org/);
    });

    it('lists the published pages on /info', () => {
        const looped = TemplateHydrationService.processLoops(LIST, { items: [{ url: '/info/about', title: 'About' }, { url: '/info/terms', title: 'Terms' }] });
        const html = markup(TemplateHydrationService.hydrateTemplate(looped, { contentType: 'Pages' }));
        expect(html.match(/<li><a href="\/info\/[a-z]+">/g)).toHaveLength(2);
    });
});
