import type * as cheerio from 'cheerio';
import { db } from '../init.js';
import { getLocalizationSettings, getPartials, getUiStrings, type Partials } from '../shared/site-settings.js';
import { siteTimeZone } from '../shared/time-zone.js';
import { loadSiteTemplate } from '../shared/site-files.js';
import { langPrefix, mergeTranslation, type ContentTranslation } from '../shared/content-translation.js';
import { contentTypeDescription, contentTypeName } from '../shared/content-type-names.js';
import { interpolate } from '../shared/interpolate.js';
import { cardData } from '../shared/content-cards.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import { siteInfoFor } from '../shared/site-info-source.js';
import type { SiteInfoSource } from '../shared/site-info.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { readPublishedInDisplayOrder } from './published-entries.js';
import type { HostingBatch } from './deployToHosting.js';
import { arcHostingSite } from '../arc-config.js';

/**
 * Card blocks: `<arc-content-partials content-type="…" count="…" section-title="…"
 * template-folder="…">`, filled with cards of a content type laid out by its
 * partials.html. The home page has them in its body; the site's header and footer
 * can have them too, and then every published page shows them (the content and
 * list pages, the static pages and the home page). The app draws the same cards
 * with ContentPartialsComponent, in the home page, the header and the footer.
 */

/**
 * The content types a piece of the site's HTML shows cards of, from its
 * <arc-content-partials content-type="…">. A block in an HTML comment shows
 * nothing, so it does not count.
 */
export function cardBlockTypes(html: string): string[] {
    const types = new Set<string>();
    for (const match of (html || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/<arc-content-partials\b[^>]*\bcontent-type\s*=\s*["']([^"']+)["']/gi)) {
        types.add(match[1].trim());
    }
    return [...types];
}

/**
 * What partials.html binds outside the items loop. The default heading is the
 * page's `latest_of_type` string, else "Latest {type}". A type without public
 * pages has no list page, so `listUrl` is empty. Pure; the admin's Template
 * Reference is checked against it.
 */
export function partialPageData(
    type: Record<string, any>, lang: string, prefix: string, sectionTitle: string, itemCount: number,
    strings: Record<string, string> = {},
): Record<string, any> {
    const typeName = contentTypeName(type, lang);
    const latest = strings['latest_of_type'] ? interpolate(strings['latest_of_type'], { contentType: typeName }) : `Latest ${typeName}`;
    return {
        contentType: typeName,
        contentTypeSlug: type.slug,
        contentTypeDescription: contentTypeDescription(type, lang),
        sectionTitle: sectionTitle.trim() || latest,
        listUrl: type.hasPublicUrl === false ? '' : `${prefix}/${type.slug}`,
        hasItems: itemCount > 0,
        lang,
        langPrefix: prefix,
    };
}

/** The most cards a block shows. */
export const CARD_BLOCK_MAX = 50;

/**
 * A block's count attribute as a number of cards: 4 when it is not a number (or
 * 0), else rounded down and kept from 1 to CARD_BLOCK_MAX. A Firestore limit
 * takes only a whole number: count="3.5" would stop the read.
 */
export function cardBlockCount(value: string | null | undefined): number {
    return Math.max(1, Math.min(CARD_BLOCK_MAX, Math.floor(Number(value) || 4)));
}

/**
 * Replaces each card block in `$` with cards of its type, as the app's
 * content-partials component draws them. A type without public pages shows its
 * cards too, without links (specs/site-sections-spec.md, SS1); only a type that
 * does not exist is removed.
 *
 * A block that cannot be filled (a template folder the live site does not have,
 * MissingTemplateFolderError, or a failed read) stops the page, as for a content
 * page: the home page's own blocks. With `dropFailing` (the header's and
 * footer's blocks, which are on every page) the block is logged, naming its
 * content type and template folder, and left out, and the page goes on: one
 * broken block must not stop every page of the site from publishing.
 */
export async function renderCardBlocks(
    $: cheerio.CheerioAPI,
    lang: string,
    defaultLang: string,
    strings: Record<string, string>,
    about: SiteInfoSource | null = null,
    dropFailing = false,
): Promise<void> {
    for (const element of $('arc-content-partials').toArray()) {
        const $el = $(element);
        try {
            await renderCardBlock($el, lang, defaultLang, strings, about);
        } catch (error) {
            if (!dropFailing) throw error;
            const slug = ($el.attr('content-type') || '').trim();
            const folder = ($el.attr('template-folder') || '').trim();
            console.error(`Left out a card block in the header or footer (content-type="${slug}"`
                + `${folder ? `, template-folder="${folder}"` : ''}): it could not be filled, so pages publish without it:`, error);
            $el.remove();
        }
    }
}

async function renderCardBlock(
    $el: cheerio.Cheerio<any>,
    lang: string,
    defaultLang: string,
    strings: Record<string, string>,
    about: SiteInfoSource | null,
): Promise<void> {
    const prefix = langPrefix(lang, defaultLang);
    const slug = ($el.attr('content-type') || '').trim();
    const count = cardBlockCount($el.attr('count'));
    const typeSnap = slug
        ? await db.collection('ContentTypes').where('slug', '==', slug).limit(1).get()
        : null;
    const type = typeSnap && !typeSnap.empty ? typeSnap.docs[0].data() : null;
    if (!type) {
        $el.remove();
        return;
    }

    const collectionName = getPublishedCollectionName(slug);
    // In the type's entry order: newest first, or the order an admin arranged (SS2).
    const entries = await readPublishedInDisplayOrder(slug, type, count);
    const typeName = contentTypeName(type, lang);
    // The cards' dates in the site's zone (docs/app/clock-and-zones.html); the settings read is cached.
    const timeZone = siteTimeZone(await getLocalizationSettings());
    const items = await Promise.all(entries.map(async (content) => {
        let translation: ContentTranslation | undefined;
        if (lang !== defaultLang) {
            const tr = await db.collection(collectionName).doc(content.id).collection('translations').doc(lang).get();
            if (tr.exists) translation = { ...(tr.data() as ContentTranslation), lang };
        }
        return cardData({ ...mergeTranslation(content, translation), id: content.id }, slug, typeName, lang, prefix, type.hasPublicUrl !== false, timeZone);
    }));

    const template = await loadSiteTemplate(($el.attr('template-folder') || '').trim() || type.templateFolder, 'partials');
    let html = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(template, strings), about);
    html = TemplateHydrationService.processLoops(html, { items });
    html = TemplateHydrationService.hydrateTemplate(html, partialPageData({ ...type, slug }, lang, prefix, $el.attr('section-title') || '', items.length, strings));
    $el.replaceWith(html);
}

/**
 * Fills the card blocks in a piece of HTML (a header or footer); returned as it
 * is when it has none. A block that cannot be filled is left out (renderCardBlocks).
 */
export async function fillCardBlocks(
    html: string,
    lang: string,
    defaultLang: string,
    strings: Record<string, string>,
    about: SiteInfoSource | null = null,
): Promise<string> {
    if (!/<arc-content-partials\b/i.test(html)) return html;
    const $ = loadHtml(html, { xmlMode: false }, false);
    await renderCardBlocks($, lang, defaultLang, strings, about, true);
    return $.html();
}

/** The header and footer of a page, ready to put in it. */
export interface SiteChrome {
    headerHtml: string;
    footerHtml: string;
}

/** The chrome built for each release, by language: a whole-site republish reads each card block once per language, not once per page. */
const chromeByBatch = new WeakMap<HostingBatch, Map<string, Promise<SiteChrome>>>();

/**
 * The site's header and footer for a page in `lang`: its words (`data-arc-t`),
 * the site's details (`data-arc-site`) and its card blocks filled, as on the home
 * page. Links are not yet pointed at the language; the caller does that, as it
 * does for the rest of the page.
 *
 * With a `batch`, the result is kept for the other pages of the same release in
 * that language, so the cards are read once per release. Never across releases:
 * a publish changes the cards, and the next release must show the change.
 */
export function siteChrome(
    partials: Partials,
    lang: string,
    defaultLang: string,
    strings: Record<string, string>,
    siteInfo: SiteInfoSource | null,
    batch?: HostingBatch,
): Promise<SiteChrome> {
    const build = async (): Promise<SiteChrome> => {
        const part = (html: string) => fillCardBlocks(
            TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(html, strings), siteInfo),
            lang, defaultLang, strings, siteInfo);
        const [headerHtml, footerHtml] = await Promise.all([part(partials.headerHtml), part(partials.footerHtml)]);
        return { headerHtml, footerHtml };
    };
    if (!batch) return build();
    let byLang = chromeByBatch.get(batch);
    if (!byLang) chromeByBatch.set(batch, byLang = new Map());
    const key = `${lang}\n${partials.headerHtml}\n${partials.footerHtml}`;
    let chrome = byLang.get(key);
    if (!chrome) {
        chrome = build();
        // A failed build is not kept: the next page tries again (and fails on its own).
        chrome.catch(() => byLang!.delete(key));
        byLang.set(key, chrome);
    }
    return chrome;
}

/** Whether the live site's header or footer shows cards of this content type. */
export async function chromeShowsType(slug: string): Promise<boolean> {
    if (!slug || !arcHostingSite()) return false;
    const partials = await getPartials();
    return cardBlockTypes(`${partials.headerHtml}\n${partials.footerHtml}`).includes(slug);
}

/**
 * What the header's and footer's card blocks of this type show, in every enabled
 * language: '' when they show none. The publish queue compares it before and
 * after a change to one of the type's entries, and republishes the whole site
 * only when it differs, so an edit the header and footer do not show costs
 * nothing more than reading the blocks twice.
 */
export async function chromeCardsSignature(slug: string): Promise<string> {
    if (!(await chromeShowsType(slug))) return '';
    const [partials, localization] = await Promise.all([getPartials(), getLocalizationSettings()]);
    const blocks = (html: string) => {
        const $ = loadHtml(html, { xmlMode: false }, false);
        return $('arc-content-partials').toArray()
            .filter((el) => ($(el).attr('content-type') || '').trim() === slug)
            .map((el) => $.html(el)).join('\n');
    };
    const ofType = `${blocks(partials.headerHtml)}\n${blocks(partials.footerHtml)}`;
    const defaultLang = localization.defaultLanguage;
    const shown: string[] = [];
    for (const { code } of localization.enabledLanguages) {
        const [strings, siteInfo] = await Promise.all([getUiStrings(code), siteInfoFor(code, defaultLang)]);
        shown.push(`${code}:${await fillCardBlocks(ofType, code, defaultLang, strings, siteInfo)}`);
    }
    return shown.join('\n');
}
