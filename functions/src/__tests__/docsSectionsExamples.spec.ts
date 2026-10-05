import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { cardData } from '../shared/content-cards.js';
import { partialPageData } from '../pages/deployHomePage.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import type { SiteInfoSource } from '../shared/site-info.js';

/**
 * The example files of docs/website/editable-sections.html (docs/examples/sections),
 * filled the way publishing fills them: a card block of a type without public
 * pages, and a footer with the site's details. If these break, the docs page
 * teaches something that no longer works.
 */
const EXAMPLES = resolve(__dirname, '../../../docs/examples/sections');
const read = (path: string) => readFileSync(resolve(EXAMPLES, path), 'utf8');

/** One card block, as deployHomePage renders it. */
function renderBlock(folder: string, slug: string, entries: Record<string, any>[], sectionTitle = ''): ReturnType<typeof loadHtml> {
    const type = { slug, name: slug, hasPublicUrl: false };
    const items = entries.map((entry) => cardData(entry, slug, slug, 'en', '', false));
    let html = TemplateHydrationService.processLoops(read(`templates/${folder}/partials.html`), { items });
    html = TemplateHydrationService.hydrateTemplate(html, partialPageData(type, 'en', '', sectionTitle, items.length));
    return loadHtml(html, { xmlMode: false });
}

describe('docs/examples/sections', () => {
    it('services: cards with their custom fields by short key, and no page links', () => {
        const $ = renderBlock('services', 'services', [
            { id: 'a', title: 'Design', urlSlug: 'design', customFields: { 'services-icon': 'fa-solid fa-pen', 'services-short-description': 'We draw it.', 'services-link': '/contact' } },
            { id: 'b', title: 'Build', urlSlug: 'build', customFields: { 'services-short-description': 'We make it.' } },
        ], 'What we do');
        expect($('h2').text()).toBe('What we do');
        expect($('.service h3').map((_, el) => $(el).text()).get()).toEqual(['Design', 'Build']);
        expect($('.service').first().find('i').attr('class')).toBe('fa-solid fa-pen');
        expect($('.service').first().find('p').text()).toBe('We draw it.');
        expect($('.service').first().find('a').attr('href')).toBe('/contact');
        expect($('.service').last().find('a').length).toBe(0); // no Link, no button
        expect($('.service').last().find('i').length).toBe(0);
    });

    it('hero: one entry with its subtitle and button', () => {
        const $ = renderBlock('hero', 'hero', [
            { id: 'h', title: 'Fresh bread daily', urlSlug: 'main', customFields: { 'hero-subtitle': 'Baked at dawn.', 'hero-button-text': 'Order', 'hero-button-link': '/info/contact' } },
        ]);
        expect($('h1').text()).toBe('Fresh bread daily');
        expect($('.hero-subtitle').text()).toBe('Baked at dawn.');
        expect($('.hero-button').attr('href')).toBe('/info/contact');
        expect($('.hero-button').text()).toBe('Order');
    });

    it('questions: the body is the answer, as HTML', () => {
        const $ = renderBlock('questions', 'questions', [
            { id: 'q', title: 'Do you deliver?', urlSlug: 'deliver', content: '<p>Yes, <strong>daily</strong>.</p>' },
        ], 'Questions');
        expect($('summary').text()).toBe('Do you deliver?');
        expect($('.answer strong').text()).toBe('daily');
    });

    it('a block with nothing published shows nothing', () => {
        const $ = renderBlock('services', 'services', []);
        expect($('section').length).toBe(0);
    });

    it('footer: the site details that exist, the social links and the pages', () => {
        const source: SiteInfoSource = {
            name: 'Acme',
            contactEmail: 'hello@acme.example',
            phone: '+91 98765 43210',
            sameAs: ['https://www.instagram.com/acme'],
            year: 2026,
            pages: [{ title: 'About', url: '/info/about' }, { title: 'Contact', url: '/info/contact' }],
        };
        const $ = loadHtml(TemplateHydrationService.applySiteInfo(read('footer.html'), source), { xmlMode: false });
        expect($('.footer-name').text()).toBe('Acme');
        expect($('a[href="mailto:hello@acme.example"]').text()).toBe('hello@acme.example');
        expect($('a[href="tel:+919876543210"]').length).toBe(1);
        expect($('.footer-social a').attr('href')).toBe('https://www.instagram.com/acme');
        expect($('.footer-social i').attr('class')).toBe('fa-brands fa-instagram');
        expect($('.footer-pages a').map((_, el) => $(el).attr('href')).get()).toEqual(['/info/about', '/info/contact']);
        expect($('.footer-copyright').text().replace(/\s+/g, ' ')).toBe('© 2026 Acme');
        expect($.html()).not.toContain('data-arc-site');
        // No address in About: no address line.
        expect($('.footer-columns > div').first().find('p').length).toBe(1);
    });

    it('footer: a site with no contact details drops the whole contact column', () => {
        const $ = loadHtml(TemplateHydrationService.applySiteInfo(read('footer.html'), { name: 'Acme' }), { xmlMode: false });
        expect($('.fa-envelope').length).toBe(0);
        expect($('.footer-social').length).toBe(0);
        expect($('.footer-pages').length).toBe(0);
    });
});
