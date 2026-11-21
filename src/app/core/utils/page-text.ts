import * as cheerio from 'cheerio';
import {
    PAGE_TEXT_KEY, PAGE_TEXT_MARKS, hasPageTextMarks, safePageTextUrl, sanitizeRichText,
    type PageTextEntry, type PageTextKind, type PageTextOptions, type PageTextValues,
} from './page-text-model';

/**
 * Page text (specs/visual-editing-spec.md, VE-D38 to VE-D43): the words, pictures
 * and links an editor changed on the home page or a static page, filled into the
 * areas the developer marked with `data-arc-edit="key"`.
 *
 * The developer's file owns the design and the starting text; the saved values
 * (SitePageText/{pageId}, a draft in SitePageTextDrafts/{pageId}) own only what
 * an editor changed, and are filled in every time the page is built. A file with
 * no marks and no values comes back byte for byte as it went in.
 *
 * Runs before the `data-arc-t` strings: an area whose value wins here loses its
 * `data-arc-t` (or the pair of its attribute in `data-arc-t-attr`), so the
 * strings cannot write over it, and an area left alone keeps it, so a
 * translation still fills it.
 *
 * Source of truth, with its data and names in page-text-model.ts (which pages
 * import without loading this file's HTML parser); functions/src/shared/page-text.ts
 * is the mirror of both for the Cloud Functions build, which cannot import from
 * src/. page-text.spec.ts runs both on the same cases.
 */

export * from './page-text-model';

/**
 * Elements never filled: void elements, which hold no words, and those whose
 * words are code or are not shown (an editor's words must never run).
 */
const NOT_EDITABLE = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'input', 'link', 'source', 'track', 'wbr', 'param',
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'textarea', 'select', 'option', 'head', 'html', 'body',
    // Raw text: what is written inside is never escaped.
    'xmp', 'noembed', 'noframes', 'plaintext',
]);

/** What an area is, from its tag and `data-arc-edit-kind` (VE-D41). */
export function pageTextKind(tag: string, kindAttr?: string | null, nameAttr?: string | null): PageTextKind {
    const name = (tag || '').toLowerCase();
    const kind = (kindAttr || '').trim().toLowerCase();
    if (name === 'title') return 'title';
    if (name === 'meta') return (nameAttr || '').trim().toLowerCase() === 'description' ? 'description' : 'none';
    if (name === 'arc-content-partials') return 'section-title';
    if (NOT_EDITABLE.has(name)) return 'none';
    if (kind === 'background') return 'background';
    if (name === 'img') return 'picture';
    if (kind === 'rich') return 'rich';
    if (name === 'a') return 'link';
    return 'text';
}

const escapeHtmlText = (text: string): string =>
    text
        .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const escapeAttr = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const usable = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** The `data-arc-t-attr` key of one attribute, or ''. */
function attrStringKey(spec: string | undefined, attr: string): string {
    for (const pair of (spec || '').split(',')) {
        const [name, key] = pair.split(':').map((part) => part.trim());
        if (name === attr && key) return key;
    }
    return '';
}

/** `data-arc-t-attr` without the pair of one attribute, so the strings leave it alone. */
function withoutAttrString($el: cheerio.Cheerio<any>, attr: string): void {
    const spec = $el.attr('data-arc-t-attr');
    if (spec === undefined) return;
    const rest = spec.split(',').filter((pair) => pair.split(':')[0].trim() !== attr);
    if (rest.length) $el.attr('data-arc-t-attr', rest.join(','));
    else $el.removeAttr('data-arc-t-attr');
}

/**
 * The words to show for one language (VE-D43), or undefined to leave the area as
 * it is. The language's own edited value; else, for a language with a file of its
 * own (or the default language), the file's text; else a translation of the area
 * (`stringKey` in `strings`), which the strings fill; else the default language's
 * edited value; else the file's text.
 */
export function pageTextWords(
    byLang: Record<string, PageTextEntry | undefined> | ((lang: string) => PageTextEntry | undefined),
    stringKey: string,
    options: PageTextOptions,
): string | undefined {
    const read = typeof byLang === 'function' ? byLang : (lang: string) => byLang[lang];
    const own = read(options.lang)?.value;
    if (usable(own)) return own;
    if (options.ownFile || options.lang === options.defaultLang) return undefined;
    if (stringKey && usable(options.strings?.[stringKey])) return undefined;
    const fallback = read(options.defaultLang)?.value;
    return usable(fallback) ? fallback : undefined;
}

/** `background-image` set on an element's own style, any earlier one removed. */
function withBackground(style: string | undefined, url: string): string {
    // Only the earlier background-image goes; the rest of the style is kept as written.
    const kept = (style || '').replace(/(^|;)\s*background-image\s*:[^;]*/gi, '$1').trim().replace(/;+\s*$/, '');
    const quoted = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${kept ? `${kept}; ` : ''}background-image: url("${quoted}")`;
}

/** Whether the values hold any SEO words or share image this language would use. */
function hasSeo(values: PageTextValues | null | undefined): boolean {
    if (!values) return false;
    if (usable(values.shareImage?.value)) return true;
    return Object.values(values.seo || {}).some((seo) => usable(seo?.title?.value) || usable(seo?.description?.value));
}

/** Sets a meta tag's content when the page has it; the strings no longer translate it over the saved words. */
function setMetaContent($: cheerio.CheerioAPI, selector: string, content: string): void {
    $(selector).each((_, el) => {
        const $el = $(el);
        $el.attr('content', content);
        withoutAttrString($el, 'content');
    });
}

/** The title, description and share image (VE-D41, VE-D51), whether or not the file marks them. */
function applySeo($: cheerio.CheerioAPI, values: PageTextValues, options: PageTextOptions): void {
    const seo = (lang: string) => values.seo?.[lang];

    // The page's own title: an SVG's <title> in the body is not it.
    const $title = $('head > title').first();
    const title = pageTextWords((lang) => seo(lang)?.title, $title.attr('data-arc-t') || '', options);
    if (title !== undefined) {
        if ($title.length) $title.text(title).removeAttr('data-arc-t').removeAttr('data-arc-t-params');
        else $('head').append(`<title>${escapeHtmlText(title)}</title>\n`);
        setMetaContent($, 'meta[property="og:title"]', title);
        setMetaContent($, 'meta[name="twitter:title"]', title);
    }

    const $description = $('meta[name="description"]').first();
    const descriptionKey = attrStringKey($description.attr('data-arc-t-attr'), 'content');
    const description = pageTextWords((lang) => seo(lang)?.description, descriptionKey, options);
    if (description !== undefined) {
        if ($description.length) {
            $description.attr('content', description);
            withoutAttrString($description, 'content');
        } else {
            $('head').append(`<meta name="description" content="${escapeAttr(description)}">\n`);
        }
        setMetaContent($, 'meta[property="og:description"]', description);
        setMetaContent($, 'meta[name="twitter:description"]', description);
    }

    const image = safePageTextUrl(values.shareImage?.value);
    if (image) {
        if ($('meta[property="og:image"]').length) setMetaContent($, 'meta[property="og:image"]', image);
        else $('head').append(`<meta property="og:image" content="${escapeAttr(image)}">\n`);
        setMetaContent($, 'meta[name="twitter:image"]', image);
    }
}

/** Fills one marked area. */
function applyArea($: cheerio.CheerioAPI, element: any, values: PageTextValues, options: PageTextOptions): void {
    const $el = $(element);
    const key = ($el.attr('data-arc-edit') || '').trim();
    const kind = pageTextKind(element.tagName || element.name || '', $el.attr('data-arc-edit-kind'), $el.attr('name'));
    // The title and description are the SEO tab's (applySeo), marked or not.
    if (!PAGE_TEXT_KEY.test(key) || kind === 'none' || kind === 'title' || kind === 'description') return;

    const words = (attr: string | null) => pageTextWords(
        (lang) => values.text?.[lang]?.[key],
        attr === null ? $el.attr('data-arc-t') || '' : attrStringKey($el.attr('data-arc-t-attr'), attr),
        options,
    );
    const url = safePageTextUrl(values.urls?.[key]?.value);
    // Words over other marked areas, or over elements inside plain text (a styled word, an
    // icon, a line break), would delete them: such an area keeps the file's words (review M2, M3).
    const wordsKept = $el.find('[data-arc-edit]').length > 0 || (kind === 'text' && $el.children().length > 0);
    const setText = (text: string | undefined) => {
        if (text === undefined) return;
        $el.text(text).removeAttr('data-arc-t').removeAttr('data-arc-t-params');
    };
    const setAttr = (attr: string, text: string | undefined) => {
        if (text === undefined) return;
        $el.attr(attr, text);
        withoutAttrString($el, attr);
    };

    switch (kind) {
        case 'text':
            if (!wordsKept) setText(words(null));
            break;
        case 'rich': {
            const html = wordsKept ? undefined : words(null);
            if (html !== undefined) $el.html(sanitizeRichText(html)).removeAttr('data-arc-t').removeAttr('data-arc-t-params');
            break;
        }
        case 'section-title':
            setAttr('section-title', words('section-title'));
            break;
        case 'link':
            if (url) $el.attr('href', url);
            // A link that holds elements (an icon, a picture) keeps them: only its address changes.
            if (!$el.children().length) setText(words(null));
            break;
        case 'picture':
            if (url) {
                $el.attr('src', url);
                // The file's other sizes and its shape belong to the old picture.
                $el.removeAttr('srcset').removeAttr('sizes').removeAttr('width').removeAttr('height');
                const parent = $el.parent();
                if (parent.length && (parent.get(0) as any)?.tagName?.toLowerCase() === 'picture') parent.children('source').remove();
            }
            setAttr('alt', words('alt'));
            break;
        case 'background':
            if (url) $el.attr('style', withBackground($el.attr('style'), url));
            break;
    }
}

/**
 * Fills a page's marked areas, title, description and share image with its saved
 * values for one language (VE-D41 to VE-D43), and removes the marks unless
 * `keepMarks`. A file with no marks and no SEO values comes back unchanged, byte
 * for byte.
 */
export function applyPageText(html: string, values: PageTextValues | null | undefined, options: PageTextOptions): string {
    if (!html) return html;
    const marked = hasPageTextMarks(html);
    if (!marked && !hasSeo(values)) return html;
    const $ = cheerio.load(html, { xmlMode: false });
    const saved = values || {};
    if (marked) $('[data-arc-edit]').each((_, element) => applyArea($, element, saved, options));
    applySeo($, saved, options);
    if (marked && !options.keepMarks) {
        for (const mark of PAGE_TEXT_MARKS) $(`[${mark}]`).removeAttr(mark);
    }
    return $.html();
}
