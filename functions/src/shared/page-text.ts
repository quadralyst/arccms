import type * as cheerio from 'cheerio';
import { loadHtml } from './lazy-cheerio.js';

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
 * Mirror of src/app/core/utils/page-text.ts and page-text-model.ts, the source of truth (the app draws
 * the same pages). Keep in sync by hand; src/app/core/utils/page-text.spec.ts
 * runs both on the same cases.
 */

/** One saved value: what the area shows, and what it was saved against. */
export interface PageTextEntry {
    /** The text, the rich text's HTML, or (in `urls` and `shareImage`) the address. */
    value: string;
    /** The file's text when it was saved, to tell the editor the file changed since (VE-D45). */
    fileText?: string;
    /** The default language's text a translation was made from (VE-D44). */
    sourceText?: string;
    /** Who saved it (an account id) and when. */
    by?: string;
    at?: unknown;
}

/** The SEO words of one language. */
export interface PageTextSeo {
    title?: PageTextEntry;
    description?: PageTextEntry;
}

/** A page's saved values, as kept in SitePageTextDrafts and SitePageText. */
export interface PageTextValues {
    /** Words, per language and key: plain text, rich text, alt text, link text, a section title. */
    text?: Record<string, Record<string, PageTextEntry>>;
    /** Addresses, the same in every language, per key: a picture, a link, a background. */
    urls?: Record<string, PageTextEntry>;
    /** The page's title and description, per language (the SEO tab). */
    seo?: Record<string, PageTextSeo>;
    /** The picture shown when the page is shared, the same in every language. */
    shareImage?: PageTextEntry;
}

export interface PageTextOptions {
    /** The language being built. */
    lang: string;
    /** The site's default language. */
    defaultLang: string;
    /**
     * Whether `lang` has a file of its own (`home.{lang}.html`), or is the default
     * language: its own words are then its edited values, else the file's.
     */
    ownFile: boolean;
    /** The language's `data-arc-t` strings: a translation wins over the default language's edited value. */
    strings?: Record<string, string> | null;
    /** Keep the `data-arc-edit*` marks, for the Visual Editor, which needs them to find the areas. */
    keepMarks?: boolean;
}

/** What an area is, from its tag and `data-arc-edit-kind` (VE-D41). */
export type PageTextKind = 'text' | 'rich' | 'picture' | 'link' | 'background' | 'section-title' | 'title' | 'description' | 'none';

/** The marks this feature reads, removed from published pages. */
export const PAGE_TEXT_MARKS = ['data-arc-edit', 'data-arc-edit-kind', 'data-arc-label', 'data-arc-placeholder'] as const;

/**
 * A lazy-loading script's copy of a picture's address (`data-src` and the like): a new
 * picture puts its own address there too, or the script brings the old one back.
 */
export const LAZY_PICTURE_SRC = ['data-src', 'data-lazy-src', 'data-original'] as const;

/** A lazy-loading script's other sizes of a picture: they belong to the old one and go. */
export const LAZY_PICTURE_SIZES = ['data-srcset', 'data-lazy-srcset', 'data-sizes'] as const;

/** A usable key: letters, digits, `_` and `-`, so it is a safe Firestore field name. */
export const PAGE_TEXT_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/** A page's id: `home`, `p-{name}` for the static page `/p/{name}`, or `list-{slug}` for a type's list page `/{slug}`. */
export const PAGE_TEXT_ID = /^(home|(p|list)-[A-Za-z0-9_-]{1,100})$/;

/** The id of a page's values: `home`, `p-{name}` for a static page, or `list-{slug}` for a list page. */
export const pageTextId = {
    home: (): string => 'home',
    staticPage: (name: string): string => `p-${name}`,
    listPage: (slug: string): string => `list-${slug}`,
};

/** The key of a list page's heading, which is its Title (VE-D60). */
export const LIST_TITLE_KEY = 'title';

/** The key of a list page's intro, which is its Summary (VE-D60). */
export const LIST_INTRO_KEY = 'intro';

/** Whether a file has any marked area. */
export function hasPageTextMarks(html: string | null | undefined): boolean {
    // The attribute itself, not the words "data-arc-edit" in the page's text or a comment.
    return !!html && /\sdata-arc-edit\s*=/i.test(html);
}

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

/**
 * An address an editor may put on the page (VE-D42): `http(s)://`, a root-relative
 * path, `mailto:`, `tel:`, or a place on the page (`#…`). Anything else, a
 * `javascript:` address included, comes back as ''.
 */
export function safePageTextUrl(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const url = raw.trim();
    if (!url || /[\s\u0000-\u001f\u007f\\]/.test(url)) return '';
    if (/^https?:\/\/[^/]/i.test(url)) return url;
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (/^(mailto|tel):./i.test(url)) return url;
    if (/^#[^#]*$/.test(url)) return url;
    return '';
}

const RICH_TAGS = new Set(['b', 'strong', 'i', 'em', 'br', 'a']);

const escapeHtmlText = (text: string): string =>
    text
        // An `&` that does not start an entity, so a value typed with entities keeps them.
        .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const escapeAttr = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const decodeAttr = (text: string): string =>
    text
        .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

/**
 * Rich text through its own allow-list (VE-D42): `b`, `strong`, `i`, `em`, `br`
 * and `a` with a safe `href`, no other attribute. Any other tag is dropped and its
 * words kept; every `<` and `>` that is not one of those tags becomes text. Works
 * on the string, so the output holds no tag it did not write itself.
 */
export function sanitizeRichText(html: string): string {
    if (!html) return '';
    const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;
    let out = '';
    let last = 0;
    for (let match = tag.exec(html); match; match = tag.exec(html)) {
        out += escapeHtmlText(html.slice(last, match.index));
        last = match.index + match[0].length;
        const name = match[2].toLowerCase();
        if (!RICH_TAGS.has(name)) continue;
        if (match[1]) {
            if (name !== 'br') out += `</${name}>`;
            continue;
        }
        if (name !== 'a') {
            out += `<${name}>`;
            continue;
        }
        const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(match[3]);
        const url = href ? safePageTextUrl(decodeAttr(href[1] ?? href[2] ?? href[3] ?? '')) : '';
        out += url ? `<a href="${escapeAttr(url)}">` : '<a>';
    }
    return out + escapeHtmlText(html.slice(last));
}

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
                for (const attr of LAZY_PICTURE_SRC) if ($el.attr(attr) !== undefined) $el.attr(attr, url);
                for (const attr of LAZY_PICTURE_SIZES) $el.removeAttr(attr);
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
    const $ = loadHtml(html, { xmlMode: false });
    const saved = values || {};
    if (marked) $('[data-arc-edit]').each((_, element) => applyArea($, element, saved, options));
    applySeo($, saved, options);
    if (marked && !options.keepMarks) {
        for (const mark of PAGE_TEXT_MARKS) $(`[${mark}]`).removeAttr(mark);
    }
    return $.html();
}

/** What a list page is filled for: its language, and what its type says in that language. */
export interface ListPageTextOptions {
    lang: string;
    defaultLang: string;
    /**
     * Whether the type has its own name and description in `lang`
     * (`nameTranslations`). Those are the file's text of that language (VE-D60),
     * so they win over words edited in the default language only.
     */
    named: { title: boolean; intro: boolean };
    /** The language's `data-arc-t` strings. */
    strings?: Record<string, string> | null;
    /** Keep the `data-arc-edit*` marks, for the Visual Editor. */
    keepMarks?: boolean;
}

/** A list page's own words, as published: undefined where the type's name or description stands. */
export interface ListPageWords {
    /** The heading, and the collection's name. */
    title?: string;
    /** The line under the heading. */
    intro?: string;
    /** The browser tab, search engines and shares. */
    seoTitle?: string;
    seoDescription?: string;
    /** The picture of a share, or ''. */
    shareImage: string;
}

/** Rich text as plain words, for the title, the description and the JSON-LD. */
function plainWords(value: string): string {
    if (!/<\/?(b|strong|i|em|br|a)\b[^<>]*>/i.test(value)) return value.trim();
    return decodeAttr(value.replace(/<\/?(b|strong|i|em|br|a)\b[^<>]*>/gi, (tag) => (/^<br/i.test(tag) ? ' ' : ''))).replace(/\s+/g, ' ').trim();
}

/**
 * The words a list page shows in one language beside its marked areas (VE-D60,
 * VE-D64): the Title and Summary are the heading and intro, and the browser tab
 * and description too unless the SEO tab has its own. A language with words of
 * its own, or a type named in it, never takes the default language's.
 */
export function listPageWords(values: PageTextValues | null | undefined, options: ListPageTextOptions): ListPageWords {
    const { lang, defaultLang, named } = options;
    const pick = (key: string, seo: 'title' | 'description', isNamed: boolean) => {
        const text = (code: string) => values?.text?.[code]?.[key]?.value;
        const search = (code: string) => values?.seo?.[code]?.[seo]?.value;
        const first = (...candidates: Array<string | undefined>) => {
            const found = candidates.find((value) => typeof value === 'string' && value.trim() !== '');
            return found === undefined ? undefined : plainWords(found) || undefined;
        };
        const fallback = lang !== defaultLang && !isNamed;
        return {
            shown: first(text(lang), fallback ? text(defaultLang) : undefined),
            search: first(search(lang), text(lang), fallback ? search(defaultLang) : undefined, fallback ? text(defaultLang) : undefined),
        };
    };
    const title = pick(LIST_TITLE_KEY, 'title', named.title);
    const intro = pick(LIST_INTRO_KEY, 'description', named.intro);
    return {
        title: title.shown, intro: intro.shown, seoTitle: title.search, seoDescription: intro.search,
        shareImage: safePageTextUrl(values?.shareImage?.value),
    };
}

// ─── List pages (VE-D59 to VE-D61, VE-D64) ──────────────────────────────────
//
// A list page is a template: its marked areas may hold bindings ({{ contentType }}),
// so it is filled after them, and an editor's words are never read as a binding.
// holdListMarks runs on the file before its strings, loops and bindings;
// fillListPage runs on the page they made.

/** Repeated elements: what is inside shows entries, or the site's details, never page text. */
const LIST_LOOPS = '[data-arc-loop], [data-arc-site-loop], [data-arc-repeat]';

/** A list template with its marks put by, and the name they were put by under ('' when it has none). */
export interface HeldListMarks {
    html: string;
    token: string;
}

/** The attributes put by: the marks, and the strings' keys, which the strings remove. */
const HELD = [...PAGE_TEXT_MARKS, 'data-arc-t', 'data-arc-t-attr'] as const;

const heldName = (token: string, attr: string): string => `data-arc-held-${token}-${attr.slice('data-arc-'.length)}`;

/** The values of a list page's marked areas in one language: no SEO (the page builder's), and no default words over a type named in the language. */
function listAreaValues(values: PageTextValues | null | undefined, options: ListPageTextOptions): PageTextValues {
    const text = { ...(values?.text || {}) };
    if (options.lang !== options.defaultLang && text[options.defaultLang]) {
        const fallback = { ...text[options.defaultLang] };
        if (options.named.title) delete fallback[LIST_TITLE_KEY];
        if (options.named.intro) delete fallback[LIST_INTRO_KEY];
        text[options.defaultLang] = fallback;
    }
    return { text, urls: values?.urls };
}

function areaOptions(options: ListPageTextOptions): PageTextOptions {
    return {
        lang: options.lang, defaultLang: options.defaultLang, ownFile: options.lang === options.defaultLang,
        strings: options.strings, keepMarks: options.keepMarks,
    };
}

/**
 * Puts a list template's marks by, before its strings, loops and bindings: under a
 * name made for this build, so nothing a card shows can pass for one of the file's
 * areas. Marks inside a loop, and words marked over one, are removed: cards are
 * their entries'. An area an editor filled shows whatever its `data-arc-if` says
 * (an intro of a type with no description). A file with no marks comes back as it is.
 */
export function holdListMarks(html: string, values: PageTextValues | null | undefined, options: ListPageTextOptions): HeldListMarks {
    if (!hasPageTextMarks(html)) return { html, token: '' };
    const token = Math.random().toString(36).slice(2, 10) || 'held';
    const $ = loadHtml(html, { xmlMode: false });
    for (const mark of PAGE_TEXT_MARKS) $(LIST_LOOPS).find(`[${mark}]`).removeAttr(mark);
    const saved = listAreaValues(values, options);
    $('[data-arc-edit]').each((_, element) => {
        const $el = $(element);
        const kind = pageTextKind((element as any).tagName || '', $el.attr('data-arc-edit-kind'), $el.attr('name'));
        if ((kind === 'text' || kind === 'rich') && ($el.is(LIST_LOOPS) || $el.find(LIST_LOOPS).length)) {
            $el.removeAttr('data-arc-edit').removeAttr('data-arc-edit-kind');
            return;
        }
        const key = ($el.attr('data-arc-edit') || '').trim();
        if (!PAGE_TEXT_KEY.test(key) || $el.attr('data-arc-if') === undefined) return;
        const words = pageTextWords((lang) => saved.text?.[lang]?.[key], $el.attr('data-arc-t') || '', areaOptions(options));
        if (words !== undefined || safePageTextUrl(saved.urls?.[key]?.value)) $el.removeAttr('data-arc-if');
    });
    $(PAGE_TEXT_MARKS.map((mark) => `[${mark}]`).join(', ')).each((_, element) => {
        const $el = $(element);
        for (const attr of HELD) {
            const value = $el.attr(attr);
            if (value === undefined) continue;
            $el.attr(heldName(token, attr), value);
            // The strings still need their keys.
            if (!attr.startsWith('data-arc-t')) $el.removeAttr(attr);
        }
    });
    return { html: $.html(), token };
}

/**
 * Fills the marked areas of a list page its bindings have made, with what was put
 * by (holdListMarks), and removes the marks unless `keepMarks`. Its title,
 * description and share picture are the page builder's (listPageWords).
 */
export function fillListPage(html: string, token: string, values: PageTextValues | null | undefined, options: ListPageTextOptions): string {
    if (!token) return html;
    const $ = loadHtml(html, { xmlMode: false });
    // Marks a card brought in (an entry's own HTML) are not the file's.
    for (const mark of PAGE_TEXT_MARKS) $(`[${mark}]`).removeAttr(mark);
    for (const attr of HELD) {
        const held = heldName(token, attr);
        $(`[${held}]`).each((_, element) => {
            const $el = $(element);
            $el.attr(attr, $el.attr(held) || '').removeAttr(held);
        });
    }
    const saved = listAreaValues(values, options);
    $('[data-arc-edit]').each((_, element) => applyArea($, element, saved, areaOptions(options)));
    // The strings ran before: what is left of their keys was put back for the rule above only.
    $(PAGE_TEXT_MARKS.map((mark) => `[${mark}]`).join(', ')).removeAttr('data-arc-t').removeAttr('data-arc-t-attr');
    if (!options.keepMarks) for (const mark of PAGE_TEXT_MARKS) $(`[${mark}]`).removeAttr(mark);
    return $.html();
}
