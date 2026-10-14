/**
 * Card blocks in the site's header and footer (pages/card-blocks.ts): filled on
 * every published page as on the home page, read once per release and language,
 * and the signature the publish queue compares to keep every page's copy fresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollection, mockGetPartials, mockLoadSiteTemplate, mockLocalization } = vi.hoisted(() => ({
    mockCollection: vi.fn(),
    mockGetPartials: vi.fn(),
    mockLoadSiteTemplate: vi.fn(),
    mockLocalization: vi.fn(),
}));

vi.mock('../init', () => ({ db: { collection: (...args: unknown[]) => mockCollection(...args) } }));
vi.mock('../shared/site-settings', () => ({
    getPartials: (...a: unknown[]) => mockGetPartials(...a),
    getLocalizationSettings: (...a: unknown[]) => mockLocalization(...a),
    getUiStrings: async (lang: string) => (lang === 'hi' ? { latest_of_type: 'नवीनतम {{ contentType }}', more: 'और' } : {}),
}));
vi.mock('../shared/site-files', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../shared/site-files.js')>()),
    loadSiteTemplate: (...a: unknown[]) => mockLoadSiteTemplate(...a),
}));
vi.mock('../shared/site-info-source', () => ({ siteInfoFor: async () => ({ name: 'Example Site', sameAs: [], year: 2026, pages: [] }) }));

import { cardBlockCount, cardBlockTypes, chromeCardsSignature, chromeShowsType, renderCardBlocks, siteChrome } from '../pages/card-blocks.js';
import { MissingTemplateFolderError } from '../shared/site-files.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import { HostingBatch } from '../pages/deployToHosting.js';

const FOOTER = '<footer><h3 data-arc-t="more">More</h3>'
    + '<arc-content-partials content-type="services" count="2" section-title="Services" template-folder="footer-links"></arc-content-partials>'
    + '<p data-arc-site="name"></p></footer>';
const HEADER = '<nav><a href="/">Home</a></nav>';
const TEMPLATE = '<ul class="links" data-arc-if="hasItems" data-arc-loop="items"><li><a href="{{ url }}">{{ title }}</a></li></ul><p class="head">{{ sectionTitle }}</p>';

/** The published services, newest first; changed by the tests. */
let services: { id: string; title: string; urlSlug: string }[];
let entryReads: number;
/** The limit of each entry read. */
let limits: number[];

function wireDb(): void {
    mockCollection.mockImplementation((name: string) => {
        if (name === 'ContentTypes') {
            return {
                where: (_f: string, _op: string, slug: string) => ({ limit: () => ({ get: async () => (slug === 'services'
                    ? { empty: false, docs: [{ data: () => ({ slug: 'services', name: 'Services', templateFolder: 'services' }) }] }
                    : { empty: true, docs: [] }) }) }),
            };
        }
        return {
            orderBy: () => ({ limit: (n: number) => ({ get: async () => {
                // Firestore refuses a limit that is not a whole number.
                if (!Number.isInteger(n)) throw new Error(`limit(${n}) is not an integer`);
                entryReads++;
                limits.push(n);
                return { docs: services.slice(0, n).map((p) => ({ id: p.id, data: () => ({ ...p, publishedOn: { seconds: 1705334400 } }) })) };
            } }) }),
            doc: (id: string) => ({ collection: () => ({ doc: () => ({ get: async () => ({
                exists: id === 'consulting', data: () => ({ title: 'परामर्श' }),
            }) }) }) }),
        };
    });
}

describe('card blocks in the header and footer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GCLOUD_PROJECT = 'demo-test';
        delete process.env.ARC_HOSTING_SITE;
        services = [
            { id: 'consulting', title: 'Consulting', urlSlug: 'consulting' },
            { id: 'design', title: 'Design <and> Build', urlSlug: 'design' },
            { id: 'support', title: 'Support', urlSlug: 'support' },
        ];
        entryReads = 0;
        limits = [];
        mockGetPartials.mockResolvedValue({ headerHtml: HEADER, footerHtml: FOOTER });
        mockLoadSiteTemplate.mockResolvedValue(TEMPLATE);
        mockLocalization.mockResolvedValue({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en' }, { code: 'hi' }] });
        wireDb();
    });

    describe('siteChrome', () => {
        const site = { name: 'Example Site', sameAs: [], year: 2026, pages: [] } as never;

        it('fills a footer block with cards, laid out by the folder it names, and its words and site details', async () => {
            const { headerHtml, footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: FOOTER }, 'en', 'en', {}, site);
            expect(headerHtml).toContain(HEADER);
            expect(mockLoadSiteTemplate).toHaveBeenCalledWith('footer-links', 'partials');
            expect(footerHtml).toContain('<a href="/services/consulting">Consulting</a>');
            expect(footerHtml).toContain('<p class="head">Services</p>');
            expect(footerHtml).toContain('<p>Example Site</p>');
            expect(footerHtml).not.toContain('arc-content-partials');
            expect(footerHtml).not.toContain('Support'); // count="2"
            // One <li> per card: the loop on the list repeats its first child.
            expect(footerHtml.match(/<li>/g)).toHaveLength(2);
        });

        it('escapes entry text as the home page\'s blocks do', async () => {
            const { footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: FOOTER }, 'en', 'en', {}, site);
            expect(footerHtml).toContain('Design &lt;and&gt; Build');
        });

        it('shows a language\'s translation, links and heading', async () => {
            const { footerHtml } = await siteChrome(
                { headerHtml: HEADER, footerHtml: FOOTER.replace(' section-title="Services"', '') }, 'hi', 'en',
                { latest_of_type: 'नवीनतम {{ contentType }}', more: 'और' }, site);
            expect(footerHtml).toContain('<a href="/hi/services/consulting">परामर्श</a>');
            expect(footerHtml).toContain('नवीनतम Services');
            expect(footerHtml).toContain('<h3>और</h3>');
        });

        it('removes a block of a type that does not exist', async () => {
            const { footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: '<footer><arc-content-partials content-type="gone"></arc-content-partials></footer>' }, 'en', 'en', {}, site);
            expect(footerHtml).toBe('<footer></footer>');
        });

        it('reads the cards once per release and language, and again for the next release', async () => {
            const partials = { headerHtml: HEADER, footerHtml: FOOTER };
            const batch = new HostingBatch();
            await siteChrome(partials, 'en', 'en', {}, site, batch);
            await siteChrome(partials, 'en', 'en', {}, site, batch);
            expect(entryReads).toBe(1);
            await siteChrome(partials, 'hi', 'en', {}, site, batch);
            expect(entryReads).toBe(2);
            await siteChrome(partials, 'en', 'en', {}, site, new HostingBatch());
            await siteChrome(partials, 'en', 'en', {}, site);
            expect(entryReads).toBe(4);
        });

        it('leaves out a block that names a folder the live site does not have, logs it, and keeps the rest of the page', async () => {
            const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockLoadSiteTemplate.mockImplementation(async (folder: string) => {
                if (folder === 'footer-links') throw new MissingTemplateFolderError('footer-links', true);
                return TEMPLATE;
            });
            const footer = FOOTER.replace('</footer>', '<arc-content-partials content-type="services" count="1" template-folder="services"></arc-content-partials></footer>');
            const { headerHtml, footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: footer }, 'en', 'en', {}, site, new HostingBatch());
            expect(headerHtml).toContain(HEADER);
            expect(footerHtml).not.toContain('arc-content-partials');
            expect(footerHtml).toContain('<h3>More</h3>');
            expect(footerHtml).toContain('<p>Example Site</p>');
            // The block that works is still filled.
            expect(footerHtml).toContain('<a href="/services/consulting">Consulting</a>');
            expect(footerHtml).not.toContain('Design');
            expect(errors.mock.calls.some(([message]) => /content-type="services", template-folder="footer-links"/.test(String(message)))).toBe(true);
            errors.mockRestore();
        });

        it('still stops the home page for a block in its own body that cannot be filled', async () => {
            mockLoadSiteTemplate.mockRejectedValue(new MissingTemplateFolderError('footer-links', true));
            const $ = loadHtml(`<main>${FOOTER}</main>`, { xmlMode: false }, false);
            await expect(renderCardBlocks($, 'en', 'en', {})).rejects.toBeInstanceOf(MissingTemplateFolderError);
        });

        it('reads a whole number of cards, whatever the count says', async () => {
            const block = (count: string) => `<arc-content-partials content-type="services" count="${count}"></arc-content-partials>`;
            for (const count of ['3.5', '0.5', '-2', '999', 'many', '0']) {
                await siteChrome({ headerHtml: HEADER, footerHtml: block(count) }, 'en', 'en', {}, site);
            }
            expect(limits).toEqual([3, 1, 1, 50, 4, 4]);
            expect([cardBlockCount('3.5'), cardBlockCount(undefined), cardBlockCount('7')]).toEqual([3, 4, 7]);
        });
    });

    describe('what the publish queue compares', () => {
        it('knows which types the header and footer show', async () => {
            expect(cardBlockTypes(FOOTER)).toEqual(['services']);
            // A block in an HTML comment shows nothing.
            expect(cardBlockTypes(`<!-- <arc-content-partials content-type="news"></arc-content-partials> -->${FOOTER}`)).toEqual(['services']);
            expect(await chromeShowsType('services')).toBe(true);
            expect(await chromeShowsType('articles')).toBe(false);
        });

        it('shows nothing with hosting off', async () => {
            process.env.ARC_HOSTING_SITE = 'none';
            expect(await chromeShowsType('services')).toBe(false);
            expect(await chromeCardsSignature('services')).toBe('');
        });

        it('is empty for a type no block shows, so the queue skips it', async () => {
            expect(await chromeCardsSignature('articles')).toBe('');
            expect(mockLoadSiteTemplate).not.toHaveBeenCalled();
        });

        it('changes with what a block shows, in any language, and only then', async () => {
            const before = await chromeCardsSignature('services');
            expect(before).toContain('en:');
            expect(before).toContain('hi:');
            expect(await chromeCardsSignature('services')).toBe(before);

            // A service below the two shown changes: the footer does not show it.
            services[2].title = 'Support plans';
            expect(await chromeCardsSignature('services')).toBe(before);

            // A new service goes to the top.
            services.unshift({ id: 'new', title: 'Training', urlSlug: 'training' });
            expect(await chromeCardsSignature('services')).not.toBe(before);
        });
    });
});
