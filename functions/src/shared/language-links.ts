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
 * Mirrored in src/app/core/utils/language-links.ts — the publish pipeline and
 * the SPA must produce the same href for the same page.
 *
 * Spec: docs/multilingual-spec.md — Phase M5.5.
 */

/** `<a … href="…">`, capturing the quote so either style round-trips. */
const ANCHOR_HREF = /(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi;

/**
 * Rewrites one root-relative href for a language.
 *
 * `prefix` is '' for the default language, '/{code}' otherwise — the same
 * value the templates get as `langPrefix`.
 *
 * Left alone: anything not starting with a single `/`, which covers external
 * URLs, `mailto:`/`tel:`, same-page `#anchors` and already-relative paths; and
 * anything already carrying this prefix, so applying it twice is harmless.
 */
export function withLangPrefix(href: string, prefix: string): string {
    if (!prefix || !href) return href;
    if (!href.startsWith('/') || href.startsWith('//')) return href;
    if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}#`)) {
        return href;
    }

    // '/' is the home page: '/hi', not '/hi/'.
    if (href === '/') return prefix;
    // '/#features' is the home page's anchor: '/hi#features', not '/hi/#features'.
    if (href.startsWith('/#')) return prefix + href.slice(1);

    return prefix + href;
}

/**
 * Rewrites every root-relative anchor in a fragment of HTML.
 *
 * Deliberately `<a>` only. `<link>` and `<img>` point at assets, which are
 * served from one place whatever the page's language.
 */
export function prefixAnchorHrefs(html: string, prefix: string): string {
    if (!prefix || !html) return html;
    return html.replace(
        ANCHOR_HREF,
        (match, before: string, quote: string, href: string) => {
            const rewritten = withLangPrefix(href, prefix);
            return rewritten === href ? match : `${before}${quote}${rewritten}${quote}`;
        },
    );
}
