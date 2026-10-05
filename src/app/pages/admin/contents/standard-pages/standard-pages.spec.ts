/**
 * The standard pages' definitions (specs/site-sections-spec.md, SS6).
 */
import { describe, it, expect } from 'vitest';
import { hasReplacePrompt, standardPages, standardPagesFields, standardPagesType } from './standard-pages';

describe('standard pages', () => {
    it('is an Info Pages type at /info, in its own order, published as web pages, marked as Arc CMS\'s', () => {
        const type = standardPagesType(true);
        expect(type).toMatchObject({
            name: 'Info Pages', singularName: 'Info Page', slug: 'info', templateFolder: 'info', hasPublicUrl: true,
            entryOrder: 'manual', standard: 'pages', schema: { type: 'WebPage', fields: {} },
        });
    });

    it('has the map, FAQ and contact switches, the form switch only with the contact form feature', () => {
        expect(standardPagesFields(true).map((f) => [f.key, f.type])).toEqual([
            ['info-locations', 'maplocation'], ['info-faq', 'faq'],
            ['info-show-contact-details', 'boolean'], ['info-show-contact-form', 'boolean'],
            ['info-info-boxes', 'infocard'],
        ]);
        expect(standardPagesFields(true).map((f) => f.order)).toEqual([0, 1, 2, 3, 4]);
        expect(standardPagesFields(false).map((f) => f.key)).not.toContain('info-show-contact-form');
    });

    it('starts six pages in footer order, each with text still to replace', () => {
        const pages = standardPages({}, true);
        expect(pages.map((p) => p.urlSlug)).toEqual(['about', 'contact', 'faq', 'privacy-policy', 'terms', 'cookie-policy']);
        for (const page of pages) expect(hasReplacePrompt(page)).toBe(true);
    });

    it('fills in the owner from Settings, About, escaped, and asks for it when About is empty', () => {
        const privacy = standardPages({ name: 'Kumar & Sons', contactEmail: 'hi@kumar.example', address: '12 MG Road\nBengaluru' }, true)
            .find((p) => p.urlSlug === 'privacy-policy')!;
        expect(privacy.content).toContain('<p>Kumar &amp; Sons, hi@kumar.example, 12 MG Road, Bengaluru</p>');
        const empty = standardPages({}, true).find((p) => p.urlSlug === 'terms')!;
        expect(empty.content).toContain('[Replace: your organisation\'s name, contact email and address]');
    });

    it('turns on the contact details and form on Contact, and gives FAQ three prompt rows', () => {
        const pages = standardPages({}, true);
        expect(pages[1].customFields).toMatchObject({ 'info-show-contact-details': true, 'info-show-contact-form': true });
        expect(standardPages({}, false)[1].customFields).not.toHaveProperty('info-show-contact-form');
        const rows = pages[2].customFields['info-faq'] as Record<string, unknown>[];
        expect(rows.map((r) => r['position'])).toEqual([0, 1, 2]);
        expect(rows.every((r) => typeof r['id'] === 'string' && String(r['question']).startsWith('[Replace:'))).toBe(true);
    });

    // SS8: the Contact layout, with an opening hours box to fill in.
    it('starts Contact in the Contact layout with an Opening hours box, and no other page with a layout', () => {
        const pages = standardPages({}, true);
        expect(pages.map((p) => p.layout ?? '')).toEqual(['', 'contact', '', '', '', '']);
        const boxes = pages[1].customFields['info-info-boxes'] as Record<string, any>[];
        expect(boxes).toHaveLength(1);
        expect(boxes[0]).toMatchObject({ position: 0, headline: 'Opening hours', icon: { classes: 'fa-regular fa-clock', name: 'clock' } });
        expect(String(boxes[0]['info'])).toMatch(/^\[Replace: /);
    });

    it('finds outline text anywhere in a draft', () => {
        expect(hasReplacePrompt({ content: '<p>Done</p>', customFields: { faq: [{ answer: '[Replace: x]' }] } })).toBe(true);
        expect(hasReplacePrompt({ content: '<p>Done [brackets]</p>' })).toBe(false);
        expect(hasReplacePrompt(undefined)).toBe(false);
    });
});
