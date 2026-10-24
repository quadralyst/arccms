import { calculateReadingTime } from './reading-time.js';

/**
 * One content item as a card: what a list page's `items` loop and a partials
 * template's `items` loop bind (title, url, excerpt, coverImage, publishedOn,
 * readTime, tags...). Shared by the list pages and the home page's
 * <arc-content-partials>, so a card reads the same everywhere.
 *
 * Source of truth: src/app/core/utils/content-cards.ts (the app renders the same
 * cards). Keep in sync manually; src/app/core/utils/content-cards.spec.ts checks it.
 */

/**
 * "Jan 15, 2024" in the page's language and the site's time zone (docs/app/clock-and-zones.html);
 * English when the locale is unknown, UTC when the zone is.
 */
export function formatContentDateShort(date: any, lang = 'en', timeZone = 'UTC'): string {
    if (!date) return '';
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    const options = { year: 'numeric', month: 'short', day: 'numeric' } as const;
    // An unknown locale or zone must not abort a deploy: English, then UTC.
    for (const [locale, zone] of [[lang, timeZone], ['en-US', timeZone], ['en-US', 'UTC']]) {
        try {
            return dateObj.toLocaleDateString(locale, { ...options, timeZone: zone });
        } catch {
            // try the next
        }
    }
    return '';
}

/** The first 25 words of the meta description or the body, without markup. */
export function getExcerpt(content: Record<string, any>): string {
    const text = content['metaDescription'] || content['content'] || '';
    const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanText.split(' ').slice(0, 25);
    return words.length >= 25 ? words.join(' ') + '...' : cleanText;
}

/**
 * A (translated) item's card data; `prefix` is '' or '/{lang}'. A type without
 * public pages (Generate public pages off) has no page to link to, so its cards'
 * `url` is empty and templates hide their links with data-arc-if="url".
 */
export function cardData(
    localized: Record<string, any>,
    typeSlug: string,
    typeName: string,
    lang: string,
    prefix: string,
    hasPublicPages = true,
    timeZone = 'UTC',
): Record<string, any> {
    const tagsData = localized['tagsWithColors'] ||
        (localized['tags'] || []).map((t: string) => ({ name: t, color: '#6b7280' }));
    // Pre-rendered tag pills: nested loops are not supported.
    const tagsHtml = tagsData.slice(0, 3).map((tag: { name: string; color: string }) =>
        `<span class="tag-pill" style="background-color: ${tag.color}; color: #333;">${tag.name}</span>`,
    ).join('');

    return {
        id: localized['id'],
        title: localized['title'] || '',
        urlSlug: localized['urlSlug'] || '',
        url: hasPublicPages ? `${prefix}/${typeSlug}/${localized['urlSlug']}` : '',
        coverImage: localized['coverImage'] || '',
        excerpt: getExcerpt(localized),
        content: localized['content'] || '',
        publishedOn: formatContentDateShort(localized['publishedOn'], lang, timeZone),
        readTime: localized['readTime'] || calculateReadingTime(localized['content'] || ''),
        // The credited author's name (D2); falls back to a legacy `author` custom field.
        authorName: localized['authorName'] || '',
        author: localized['authorName'] || localized['author'] || '',
        tags: tagsData,
        tagsHtml,
        tagsDisplay: (localized['tags'] || []).slice(0, 3).join(', '),
        contentType: typeName,
        cat: typeName,
        // Lets a custom field answer to its short key in a card, as on the
        // detail page (TemplateHydrationService.aliasCustomFields).
        contentTypeSlug: typeSlug,
        ...((localized['customFields'] as Record<string, any>) || {}),
    };
}
