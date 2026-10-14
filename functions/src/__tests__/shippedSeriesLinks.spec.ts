import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TemplateHydrationService } from '../shared/template-hydration.js';

/**
 * The detail templates Arc CMS ships link Previous and Next the way a published
 * page can: from langPrefix, contentTypeSlug and the other entry's slug.
 * `previousContent.url` and `nextContent.url` exist only when the app draws the
 * page, so a template built on them published empty links.
 */
const SHIPPED = ['articles', 'manuals'];
const read = (folder: string) =>
    readFileSync(resolve(__dirname, `../../../public/_site/templates/${folder}/detail.html`), 'utf8');

/** The href of every Previous and Next link on the page. */
const navLinks = (html: string) => [...html.matchAll(/<a href="([^"]*)" class="nav-link">/g)].map(m => m[1]);

const data = (langPrefix: string) => ({
    title: 'Part two',
    langPrefix,
    contentTypeSlug: 'guides',
    previousContent: { id: 'p1', title: 'Part one', summary: '', slug: 'part-one' },
    nextContent: { id: 'n1', title: 'Part three', summary: '', slug: 'part-three' },
});

describe('shipped detail templates: Previous and Next links', () => {
    for (const folder of SHIPPED) {
        describe(folder, () => {
            it('never reads the app-only .url of the linked entries', () => {
                expect(read(folder)).not.toMatch(/(previous|next)Content\.url/);
            });

            it('links both entries on a published page, in the default language', () => {
                const html = TemplateHydrationService.hydrateTemplate(read(folder), data(''));
                expect(navLinks(html)).toEqual(['/guides/part-one', '/guides/part-three']);
            });

            it('keeps the language prefix in a translated page', () => {
                const html = TemplateHydrationService.hydrateTemplate(read(folder), data('/hi'));
                expect(navLinks(html)).toEqual(['/hi/guides/part-one', '/hi/guides/part-three']);
            });

            it('translates the labels and keeps the arrows', () => {
                const hydrated = TemplateHydrationService.hydrateTemplate(read(folder), data('/hi'));
                const html = TemplateHydrationService.applyStrings(hydrated, { previous: 'पिछला', next: 'अगला' });
                expect(html).toMatch(/fa-chevron-left"><\/i> <span>पिछला<\/span>/);
                expect(html).toMatch(/<span>अगला<\/span> <i class="fas fa-chevron-right">/);
            });

            it('leaves the links out when the entry has no neighbours', () => {
                const html = TemplateHydrationService.hydrateTemplate(read(folder), { title: 'Alone', langPrefix: '', contentTypeSlug: 'guides' });
                expect(navLinks(html)).toEqual([]);
            });
        });
    }
});
