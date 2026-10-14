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
vi.mock('../shared/site-info-source', () => ({ siteInfoFor: async () => ({ name: 'GoWow', sameAs: [], year: 2026, pages: [] }) }));

import { cardBlockCount, cardBlockTypes, chromeCardsSignature, chromeShowsType, renderCardBlocks, siteChrome } from '../pages/card-blocks.js';
import { MissingTemplateFolderError } from '../shared/site-files.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import { HostingBatch } from '../pages/deployToHosting.js';

const FOOTER = '<footer><h3 data-arc-t="more">More</h3>'
    + '<arc-content-partials content-type="programs" count="2" section-title="Programs" template-folder="footer-links"></arc-content-partials>'
    + '<p data-arc-site="name"></p></footer>';
const HEADER = '<nav><a href="/">Home</a></nav>';
const TEMPLATE = '<ul class="links" data-arc-if="hasItems" data-arc-loop="items"><li><a href="{{ url }}">{{ title }}</a></li></ul><p class="head">{{ sectionTitle }}</p>';

/** The published programs, newest first; changed by the tests. */
let programs: { id: string; title: string; urlSlug: string }[];
let entryReads: number;
/** The limit of each entry read. */
let limits: number[];

function wireDb(): void {
    mockCollection.mockImplementation((name: string) => {
        if (name === 'ContentTypes') {
            return {
                where: (_f: string, _op: string, slug: string) => ({ limit: () => ({ get: async () => (slug === 'programs'
                    ? { empty: false, docs: [{ data: () => ({ slug: 'programs', name: 'Programs', templateFolder: 'programs' }) }] }
                    : { empty: true, docs: [] }) }) }),
            };
        }
        return {
            orderBy: () => ({ limit: (n: number) => ({ get: async () => {
                // Firestore refuses a limit that is not a whole number.
                if (!Number.isInteger(n)) throw new Error(`limit(${n}) is not an integer`);
                entryReads++;
                limits.push(n);
                return { docs: programs.slice(0, n).map((p) => ({ id: p.id, data: () => ({ ...p, publishedOn: { seconds: 1705334400 } }) })) };
            } }) }),
            doc: (id: string) => ({ collection: () => ({ doc: () => ({ get: async () => ({
                exists: id === 'kpl', data: () => ({ title: 'कर्म प्रीमियर लीग' }),
            }) }) }) }),
        };
    });
}

describe('card blocks in the header and footer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GCLOUD_PROJECT = 'gowow-test';
        delete process.env.ARC_HOSTING_SITE;
        programs = [
            { id: 'kpl', title: 'Karma Premier League', urlSlug: 'kpl' },
            { id: 'bogo', title: 'Buy One <Give> One', urlSlug: 'bogo' },
            { id: 'shc', title: 'Social Hero', urlSlug: 'shc' },
        ];
        entryReads = 0;
        limits = [];
        mockGetPartials.mockResolvedValue({ headerHtml: HEADER, footerHtml: FOOTER });
        mockLoadSiteTemplate.mockResolvedValue(TEMPLATE);
        mockLocalization.mockResolvedValue({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en' }, { code: 'hi' }] });
        wireDb();
    });

    describe('siteChrome', () => {
        const site = { name: 'GoWow', sameAs: [], year: 2026, pages: [] } as never;

        it('fills a footer block with cards, laid out by the folder it names, and its words and site details', async () => {
            const { headerHtml, footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: FOOTER }, 'en', 'en', {}, site);
            expect(headerHtml).toContain(HEADER);
            expect(mockLoadSiteTemplate).toHaveBeenCalledWith('footer-links', 'partials');
            expect(footerHtml).toContain('<a href="/programs/kpl">Karma Premier League</a>');
            expect(footerHtml).toContain('<p class="head">Programs</p>');
            expect(footerHtml).toContain('<p>GoWow</p>');
            expect(footerHtml).not.toContain('arc-content-partials');
            expect(footerHtml).not.toContain('Social Hero'); // count="2"
            // One <li> per card: the loop on the list repeats its first child.
            expect(footerHtml.match(/<li>/g)).toHaveLength(2);
        });

        it('escapes entry text as the home page\'s blocks do', async () => {
            const { footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: FOOTER }, 'en', 'en', {}, site);
            expect(footerHtml).toContain('Buy One &lt;Give&gt; One');
        });

        it('shows a language\'s translation, links and heading', async () => {
            const { footerHtml } = await siteChrome(
                { headerHtml: HEADER, footerHtml: FOOTER.replace(' section-title="Programs"', '') }, 'hi', 'en',
                { latest_of_type: 'नवीनतम {{ contentType }}', more: 'और' }, site);
            expect(footerHtml).toContain('<a href="/hi/programs/kpl">कर्म प्रीमियर लीग</a>');
            expect(footerHtml).toContain('नवीनतम Programs');
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
            const footer = FOOTER.replace('</footer>', '<arc-content-partials content-type="programs" count="1" template-folder="programs"></arc-content-partials></footer>');
            const { headerHtml, footerHtml } = await siteChrome({ headerHtml: HEADER, footerHtml: footer }, 'en', 'en', {}, site, new HostingBatch());
            expect(headerHtml).toContain(HEADER);
            expect(footerHtml).not.toContain('arc-content-partials');
            expect(footerHtml).toContain('<h3>More</h3>');
            expect(footerHtml).toContain('<p>GoWow</p>');
            // The block that works is still filled.
            expect(footerHtml).toContain('<a href="/programs/kpl">Karma Premier League</a>');
            expect(footerHtml).not.toContain('Buy One');
            expect(errors.mock.calls.some(([message]) => /content-type="programs", template-folder="footer-links"/.test(String(message)))).toBe(true);
            errors.mockRestore();
        });

        it('still stops the home page for a block in its own body that cannot be filled', async () => {
            mockLoadSiteTemplate.mockRejectedValue(new MissingTemplateFolderError('footer-links', true));
            const $ = loadHtml(`<main>${FOOTER}</main>`, { xmlMode: false }, false);
            await expect(renderCardBlocks($, 'en', 'en', {})).rejects.toBeInstanceOf(MissingTemplateFolderError);
        });

        it('reads a whole number of cards, whatever the count says', async () => {
            const block = (count: string) => `<arc-content-partials content-type="programs" count="${count}"></arc-content-partials>`;
            for (const count of ['3.5', '0.5', '-2', '999', 'many', '0']) {
                await siteChrome({ headerHtml: HEADER, footerHtml: block(count) }, 'en', 'en', {}, site);
            }
            expect(limits).toEqual([3, 1, 1, 50, 4, 4]);
            expect([cardBlockCount('3.5'), cardBlockCount(undefined), cardBlockCount('7')]).toEqual([3, 4, 7]);
        });
    });

    describe('what the publish queue compares', () => {
        it('knows which types the header and footer show', async () => {
            expect(cardBlockTypes(FOOTER)).toEqual(['programs']);
            // A block in an HTML comment shows nothing.
            expect(cardBlockTypes(`<!-- <arc-content-partials content-type="news"></arc-content-partials> -->${FOOTER}`)).toEqual(['programs']);
            expect(await chromeShowsType('programs')).toBe(true);
            expect(await chromeShowsType('articles')).toBe(false);
        });

        it('shows nothing with hosting off', async () => {
            process.env.ARC_HOSTING_SITE = 'none';
            expect(await chromeShowsType('programs')).toBe(false);
            expect(await chromeCardsSignature('programs')).toBe('');
        });

        it('is empty for a type no block shows, so the queue skips it', async () => {
            expect(await chromeCardsSignature('articles')).toBe('');
            expect(mockLoadSiteTemplate).not.toHaveBeenCalled();
        });

        it('changes with what a block shows, in any language, and only then', async () => {
            const before = await chromeCardsSignature('programs');
            expect(before).toContain('en:');
            expect(before).toContain('hi:');
            expect(await chromeCardsSignature('programs')).toBe(before);

            // A program below the two shown changes: the footer does not show it.
            programs[2].title = 'Social Heroes';
            expect(await chromeCardsSignature('programs')).toBe(before);

            // A new program goes to the top.
            programs.unshift({ id: 'new', title: 'Sociothon', urlSlug: 'sociothon' });
            expect(await chromeCardsSignature('programs')).not.toBe(before);
        });
    });
});
