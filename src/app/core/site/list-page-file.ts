import * as cheerio from 'cheerio';
import type { SiteInfoSource } from '../../../shared/utils/site-info';
import { contentTypeDescription, contentTypeName, type ContentType } from '../../pages/admin/contents/content-types/content-types.model';
import { TemplateHydrationService } from '../services/template-hydration.service';
import { LIST_LOOPS, fillListPage, holdListMarks, type ListPageTextOptions } from '../utils/page-text';
import { readPageFile, type PageFile } from '../utils/page-text-areas';

/**
 * A list page's file as its editors read it (specs/visual-editing-spec.md, VE-D60,
 * VE-D61): the file's text of an area is what the page shows with nothing edited,
 * so it is read after the template's strings and bindings (the type's name and
 * description in that language), in the order the page is drawn and published.
 */

/**
 * What a list template's own bindings show, in one language ('' for the default one). The
 * type's name and description are the ones it has in that language, the default one too,
 * as published (deployContentListPage.ts).
 */
export function listPageData(type: ContentType, lang: string, defaultLang: string): Record<string, unknown> {
    const language = lang || defaultLang;
    const description = contentTypeDescription(type, language);
    return {
        contentType: contentTypeName(type, language),
        contentTypeSlug: type.slug,
        contentTypeDescription: description,
        description, // Keep for backward compatibility
        // The page's language and URL prefix, as when published.
        lang: language,
        langPrefix: lang ? `/${lang}` : '',
    };
}

/** Whether the type has its own name and description in a language: they are the file's text there (VE-D60). */
export function listPageNamed(type: ContentType, lang: string): ListPageTextOptions['named'] {
    const own = type.nameTranslations?.[lang];
    return { title: !!own?.name?.trim(), intro: !!own?.description?.trim() };
}

/**
 * On the Visual Editor every marked area shows, whatever its `data-arc-if` says: an
 * intro of a type with no description is typed on the page, and it shows on the
 * site once it has words (holdListMarks).
 */
export function showEveryArea(html: string): string {
    if (!html.includes('data-arc-if') || !html.includes('data-arc-edit')) return html;
    const $ = cheerio.load(html, { xmlMode: false });
    $('[data-arc-edit][data-arc-if]').each((_, element) => {
        const $el = $(element);
        if (!$el.closest(LIST_LOOPS).length) $el.removeAttr('data-arc-if');
    });
    return $.html();
}

/** The opening tag of the list's own loop. */
const ITEMS_TAG = /<[a-z][^<>]*\sdata-arc-loop=["']items["'][^<>]*>/i;
/** The most cards a list page shows, as published (deployContentListPage.ts). */
export const LIST_LIMIT = 100;

/** How many cards the template shows: its `data-limit`, at most 100. */
export function listLimit(template: string): number {
    const limit = parseInt(/\sdata-limit=["']?(\d+)/i.exec(ITEMS_TAG.exec(template)?.[0] ?? '')?.[1] ?? '', 10);
    return Number.isFinite(limit) && limit > 0 ? Math.min(limit, LIST_LIMIT) : LIST_LIMIT;
}

/** The template without the list's own `data-limit`: the Visual Editor cuts the cards itself, and shows the ones leaving after them. */
export function withoutListLimit(template: string): string {
    return template.replace(ITEMS_TAG, (tag) => tag.replace(/\sdata-limit=(["'])\d*\1|\sdata-limit=\d+/i, ''));
}

export interface ListPageSource {
    /** The type's list template, its folder's or the default. */
    template: string;
    type: ContentType;
    lang: string;
    defaultLang: string;
    /** The language's strings. */
    strings: Record<string, string>;
    siteInfo: SiteInfoSource;
}

/** The list page's marked areas in one language, with what each shows when nothing is edited. */
export function listPageFile(source: ListPageSource): PageFile {
    const { template, type, lang, defaultLang, strings } = source;
    const prefix = lang === defaultLang ? '' : lang;
    const options: ListPageTextOptions = { lang, defaultLang, named: listPageNamed(type, lang), strings, keepMarks: true };
    const data = listPageData(type, prefix, defaultLang);
    const held = holdListMarks(showEveryArea(template), null, options);
    let html = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(held.html, strings), source.siteInfo);
    html = TemplateHydrationService.processLoops(html, { items: [] });
    html = TemplateHydrationService.hydrateTemplate(html, data);
    html = fillListPage(html, held.token, null, options);

    const file = readPageFile(html);
    // The strings' keys are gone from the page they filled: they are read from the template.
    const keys = stringKeys(template);
    const limit = ITEMS_TAG.test(template) ? listLimit(template) : 0;
    return {
        ...file,
        areas: file.areas.map((area) => ({ ...area, stringKey: keys.get(area.key) ?? '' })),
        cardBlocks: limit
            ? [...file.cardBlocks, { type: type.slug, count: limit, fileTitle: '', titleKey: '', section: { index: -1, label: '' } }]
            : file.cardBlocks,
        title: String(data['contentType'] ?? ''),
        description: String(data['contentTypeDescription'] ?? ''),
        titleStringKey: '', descriptionStringKey: '',
    };
}

/** Each area's `data-arc-t` key as the template has it. */
function stringKeys(template: string): Map<string, string> {
    const doc = new DOMParser().parseFromString(template, 'text/html');
    for (const loop of Array.from(doc.querySelectorAll(LIST_LOOPS))) loop.innerHTML = '';
    return new Map(readPageFile(doc.documentElement.outerHTML).areas.map((area) => [area.key, area.stringKey]));
}
