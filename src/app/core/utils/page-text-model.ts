/**
 * Page text's data, names and string-only helpers (specs/visual-editing-spec.md,
 * VE-D39 to VE-D42), apart from the code that fills a page (page-text.ts), so a
 * page or the admin's editor that only names a page, reads its values or checks
 * what an editor typed does not load an HTML parser.
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

/** A usable key: letters, digits, `_` and `-`, so it is a safe Firestore field name. */
export const PAGE_TEXT_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/** A page's id: `home`, or `p-{name}` for the static page `/p/{name}`. */
export const PAGE_TEXT_ID = /^(home|p-[A-Za-z0-9_-]{1,100})$/;

/** The id of a page's values: `home`, or `p-{name}` for a static page. */
export const pageTextId = {
    home: (): string => 'home',
    staticPage: (name: string): string => `p-${name}`,
};

/** Whether a file has any marked area. */
export function hasPageTextMarks(html: string | null | undefined): boolean {
    return !!html && html.includes('data-arc-edit');
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
