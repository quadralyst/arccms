/**
 * Language-aware links for the shared header and footer partials.
 *
 * The content templates already build their own prefixed links from
 * `{{ langPrefix }}` and `{{ url }}`. The partials cannot: one file is used by
 * every language, so its links are written root-relative (`/articles`) and
 * have to be rewritten for whichever language is rendering. Without that, a
 * Hindi page reads in Hindi and every link in its chrome drops the visitor
 * back into English.
 *
 * Only addresses that exist in every language are rewritten: the home page,
 * search and public content types (isLocalizedPath). A link to sign-in, the
 * member area or an app's own page stays as written.
 *
 * Mirrored in src/app/core/utils/language-links.ts — the publish pipeline and
 * the SPA must produce the same href for the same page.
 *
 * Spec: specs/multilingual-spec.md — Phase M5.5.
 */

/** `<a … href="…">`, capturing the quote so either style round-trips. */
const ANCHOR_HREF = /(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi;

/** Files and the site's source files: one copy, whatever the language, even if a content type shares the name. */
const FILES = /^\/(site|assets|_site)(\/|$)/;

const NO_TYPES: ReadonlySet<string> = new Set();

/**
 * Whether an address exists in every language: the home page, search, and a
 * public content type's list and item pages (the `:lang` routes in
 * src/app/app.routes.ts). Everything else exists once: sign-in, the admin, the
 * member area, an app's own pages, static pages (/p/, /pages/) and files.
 */
export function isLocalizedPath(href: string, contentTypes: ReadonlySet<string> = NO_TYPES): boolean {
    const path = href.split(/[?#]/)[0];
    if (path === '/' || path === '') return true;
    if (FILES.test(path)) return false;
    const first = path.split('/')[1] ?? '';
    return first === 'search' || contentTypes.has(first);
}

/**
 * Rewrites one root-relative href for a language.
 *
 * `prefix` is '' for the default language, '/{code}' otherwise, the same value
 * the templates get as `langPrefix`. `contentTypes` are the slugs of the public
 * content types; only their pages, the home page and search are prefixed.
 *
 * Left alone: anything not starting with a single `/`, which covers external
 * URLs, `mailto:`/`tel:`, same-page `#anchors` and already-relative paths; an
 * address that exists once; and anything already carrying this prefix, so
 * applying it twice is harmless.
 */
export function withLangPrefix(href: string, prefix: string, contentTypes: ReadonlySet<string> = NO_TYPES): string {
    if (!prefix || !href) return href;
    if (!href.startsWith('/') || href.startsWith('//')) return href;
    if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}#`) || href.startsWith(`${prefix}?`)) {
        return href;
    }
    if (!isLocalizedPath(href, contentTypes)) return href;

    // '/' is the home page: '/hi', not '/hi/'.
    if (href === '/') return prefix;
    // '/#features' and '/?ref=x' are the home page: '/hi#features', not '/hi/#features'.
    if (href.startsWith('/#') || href.startsWith('/?')) return prefix + href.slice(1);

    return prefix + href;
}

/**
 * Rewrites every root-relative anchor in a fragment of HTML.
 *
 * Deliberately `<a>` only. `<link>` and `<img>` point at assets, which are
 * served from one place whatever the page's language.
 */
export function prefixAnchorHrefs(html: string, prefix: string, contentTypes: ReadonlySet<string> = NO_TYPES): string {
    if (!prefix || !html) return html;
    return html.replace(
        ANCHOR_HREF,
        (match, before: string, quote: string, href: string) => {
            const rewritten = withLangPrefix(href, prefix, contentTypes);
            return rewritten === href ? match : `${before}${quote}${rewritten}${quote}`;
        },
    );
}
