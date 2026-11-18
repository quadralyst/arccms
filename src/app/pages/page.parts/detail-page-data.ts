/**
 * The data a content page's template is filled with, and the filling itself
 * (specs/visual-editing-spec.md, VE-D4). Pure: the detail page and the live
 * preview call the same code, so the preview can never draw a page the site
 * would not.
 *
 * Mirrors functions/src/pages/deployContentPage.ts, which builds the same data
 * for the published page.
 */
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { calculateReadingTime } from '../../core/utils/reading-time.util';
import { interpolate } from '../../core/i18n/interpolate';
import { ItemsFromTypeLoop, nameItemsFromTypeLoops } from '../../core/utils/items-from-type';
import { ContentType, contentTypeName } from '../admin/contents/content-types/content-types.model';
import { IContents } from '../admin/contents/content-store/published-contents.model';
import { resolveContentDates } from '../../../shared/utils/structured-data';
import { SiteInfoSource } from '../../../shared/utils/site-info';
import { RelatedItem } from '../../../shared/utils/related-content';

/** Everything the page's data is built from. */
export interface DetailPageInput {
    contentType: ContentType;
    /** The entry, already merged with the page language's translation. */
    content: IContents;
    /** The page's language prefix, '' on the default-language routes. */
    pageLang: string;
    defaultLang: string;
    /** The site's strings in the page's language. */
    strings: Record<string, string>;
    /** "January 5, 2026" in the page's language and the site's zone. */
    formatDate: (date: unknown) => string;
    /** The page's own address (or the author's canonical), for the share links. */
    shareUrl: string;
    /** The title shared: the SEO title unless it is in another language (localizedPageTitle). */
    shareTitle: string;
    /** `author.*` and `authorName`. */
    author: { author: Record<string, string>; authorName: string };
    references: unknown[];
    related: RelatedItem[];
}

/** The template's data and its named loops, other types' entries aside. */
export interface DetailPageData {
    templateData: Record<string, any>;
    loops: Record<string, any[]>;
}

/** "Updated {date}" or '' unless updatedOn is later than the publish date (D-D3). */
export function updatedOnText(content: IContents, formatDate: (date: unknown) => string): string {
    return resolveContentDates(content).isUpdated ? formatDate(content.updatedOn) : '';
}

/** The entry's reading time in minutes: the stored one, else worked out from the body. */
export function readTimeOf(content: IContents): number {
    return content.readTime || calculateReadingTime(content.content);
}

export function detailPageData(input: DetailPageInput): DetailPageData {
    const { contentType, content, pageLang } = input;
    const nextContent = content.nextContent ? {
        ...content.nextContent,
        url: `/${contentType.slug}/${content.nextContent.slug}`,
    } : null;
    const previousContent = content.previousContent ? {
        ...content.previousContent,
        url: `/${contentType.slug}/${content.previousContent.slug}`,
    } : null;

    // Share links: the same address and title as og:url and og:title.
    const shareUrl = input.shareUrl;
    const shareTitle = input.shareTitle;
    const shareSummary = content.summary || content.metaDescription || '';
    const share = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareSummary)}`,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(shareTitle + ' ' + shareUrl)}`,
        email: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareUrl)}`,
    };

    // Field aliases let templates written another way (e.g. {{ date }} instead
    // of {{ publishedOn }}) fill in.
    const typeName = contentTypeName(contentType, pageLang);
    const readTime = readTimeOf(content);
    const updatedOn = updatedOnText(content, input.formatDate);
    const references = input.references;
    const templateData: Record<string, any> = {
        contentType: typeName,             // in the page's language, as when published
        cat: typeName,                     // alias: {{ cat }} is the content type name
        contentTypeSlug: contentType.slug,
        ...content,
        publishedOn: input.formatDate(content.publishedOn),
        date: input.formatDate(content.publishedOn),    // alias: {{ date }}
        // Mirrors deployContentPage.ts: shown only for a real revision (D-D3).
        updatedOn,
        updatedOnDisplay: updatedOn,
        // The page's language and URL prefix, as when published.
        lang: pageLang || input.defaultLang,
        langPrefix: pageLang ? `/${pageLang}` : '',
        readTime,
        // "5 min read" in the page's language, from its min_read string, as when published.
        readingTime: input.strings['min_read']
            ? interpolate(input.strings['min_read'], { readTime })
            : `${readTime} min read`,
        ...((content as any).customFields || {}),
        // After custom fields, mirroring deployContentPage.ts (D2, D-D11).
        ...input.author,
        references,
        hasReferences: references.length > 0,
        related: input.related,
        hasRelated: input.related.length > 0,
    };
    templateData['share'] = share;
    if (nextContent) templateData['nextContent'] = nextContent;
    if (previousContent) templateData['previousContent'] = previousContent;

    const tags = (content as any).tagsWithColors ||
        (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));
    const loops: Record<string, any[]> = {
        // Repeating custom fields become named loops, as when published.
        ...TemplateHydrationService.arrayLoopData((content as any).customFields, ['tags', 'items'], contentType.slug),
        references,
        related: input.related,
        tags,
    };
    return { templateData, loops };
}

/** What the page is filled with besides its own data. */
export interface DetailRenderContext {
    strings: Record<string, string>;
    siteInfo: SiteInfoSource | null;
    /** The rows of each data-arc-items-src loop, by loop name; may start loading them. */
    itemsFromTypeRows: (loops: ItemsFromTypeLoop[]) => Record<string, Record<string, any>[]>;
    /** Marks each element a value filled, for the live preview (VE-D7). Off on the site. */
    markFields?: boolean;
}

/**
 * Fills a detail template, in the publish pipeline's order: static strings
 * first (so a translated string may carry its own {{ }}), then the site's own
 * details, then loops, then the bindings.
 */
export function renderDetailPage(templateHtml: string, page: DetailPageData, context: DetailRenderContext): string {
    const options = { markFields: !!context.markFields };
    let html = TemplateHydrationService.applyStrings(templateHtml, context.strings);
    html = TemplateHydrationService.applySiteInfo(html, context.siteInfo);
    // Each loop of another type's entries (data-arc-items-src) becomes a loop
    // of its own, as when published (core/utils/items-from-type.ts).
    const fromTypes = nameItemsFromTypeLoops(html);
    html = TemplateHydrationService.processLoops(fromTypes.html, {
        ...page.loops,
        ...context.itemsFromTypeRows(fromTypes.loops),
    }, options);
    return TemplateHydrationService.hydrateTemplate(html, page.templateData, options);
}
