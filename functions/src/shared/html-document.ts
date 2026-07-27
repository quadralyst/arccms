import * as cheerio from 'cheerio';

/** Canonical branding text used in the powered-by footer (static pages & Angular component). */
export const POWERED_BY_LABEL = '\u26A1\uFE0F Powered by Arc CMS: an open source CMS for landing pages';

/**
 * "Powered by Arc CMS" footer HTML — matches the Angular component's styles.
 * Injected into static pages when Settings/misc.showPoweredBy is true.
 */
export const POWERED_BY_HTML = `<div style="text-align:center;padding:8px 16px;font-size:0.75rem;color:#6e6e73;background:#f5f5f7;border-top:1px solid #e8e8ed;"><a href="https://arccms.com" target="_blank" rel="dofollow noopener" title="Arc CMS: an open source CMS for landing pages" style="color:#0066cc;text-decoration:none;">${POWERED_BY_LABEL}</a></div>`;

/**
 * "Powered by Arc CMS" footer HTML for outgoing emails.
 * Uses table layout with inline styles for maximum email client
 * compatibility (Gmail, Outlook, Apple Mail, Yahoo).
 */
export const POWERED_BY_EMAIL_HTML = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:16px;"><tr><td align="center" style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#6e6e73;border-top:1px solid #e8e8ed;"><a href="https://arccms.com" target="_blank" rel="noopener" style="color:#0066cc;text-decoration:none;">&#9889;&#65039; Powered by Arc CMS</a></td></tr></table>`;

/** One language variant of a page, for hreflang annotation. */
export interface PageAlternate {
    /** BCP-47 code, e.g. 'en' or 'hi'. */
    lang: string;
    /** Absolute URL of that variant. */
    url: string;
}

export interface PageMeta {
    title: string;
    metaDescription: string;
    canonicalUrl: string;
    ogImage: string;
    ogType: string;        // 'article' | 'website'
    siteName: string;
    cssUrls: string[];
    /** Optional RSS feed URL for auto-discovery (list pages only). */
    rssUrl?: string;
    /** Optional title for the RSS feed link. */
    rssTitle?: string;
    /** BCP-47 language of this page. Drives <html lang> and og:locale. */
    lang?: string;
    /** Right-to-left script — adds dir="rtl" to <html>. */
    rtl?: boolean;
    /**
     * Every language this page exists in, including itself. Emitted as
     * `hreflang` alternates so search engines treat the variants as one page
     * in several languages rather than as duplicates.
     */
    alternates?: PageAlternate[];
    /**
     * Which alternate is the site's default language — emitted additionally as
     * `hreflang="x-default"`, the variant to serve when no language matches.
     */
    defaultLang?: string;
}

/**
 * Open Graph wants `language_TERRITORY`. We only know a territory when the
 * configured code carries one (`pt-br` → `pt_BR`); otherwise the bare language
 * subtag is emitted, which consumers accept.
 */
export function toOgLocale(lang: string): string {
    const [language, region] = (lang || 'en').trim().toLowerCase().split('-');
    return region ? `${language}_${region.toUpperCase()}` : language;
}

/**
 * Builds a complete <!DOCTYPE html> document with full <head> and <body>.
 * Injects arc-served-by and arc-deployed-at meta tags for hosting verification.
 */
export function buildHtmlDocument(
    bodyHtml: string,
    meta: PageMeta,
    headerHtml: string,
    footerHtml: string,
    inlineStyles?: string,
    inlineScripts?: string,
    poweredByHtml?: string,
): string {
    const deployedAt = new Date().toISOString();

    const cssLinks = (meta.cssUrls || [])
        .map(url => `    <link rel="stylesheet" href="${escapeAttr(url)}">`)
        .join('\n');

    const ogImageTags = meta.ogImage
        ? `    <meta property="og:image" content="${escapeAttr(meta.ogImage)}">\n    <meta name="twitter:image" content="${escapeAttr(meta.ogImage)}">`
        : '';

    const rssLink = meta.rssUrl
        ? `    <link rel="alternate" type="application/rss+xml" title="${escapeAttr(meta.rssTitle || meta.title)}" href="${escapeAttr(meta.rssUrl)}">`
        : '';

    const stylesBlock = inlineStyles ? `\n    ${inlineStyles}` : '';
    const scriptsBlock = inlineScripts ? `\n${inlineScripts}` : '';

    const poweredByBlock = poweredByHtml ? `\n${poweredByHtml}` : '';

    const lang = meta.lang || 'en';
    const dirAttr = meta.rtl ? ' dir="rtl"' : '';

    // hreflang alternates. Only emitted when the page actually exists in more
    // than one language — a lone self-referential alternate is noise.
    const alternates = meta.alternates || [];
    const hreflangLinks = alternates.length > 1
        ? alternates
            .map(alt => `    <link rel="alternate" hreflang="${escapeAttr(alt.lang)}" href="${escapeAttr(alt.url)}">`)
            .concat(
                (() => {
                    const fallback = alternates.find(alt => alt.lang === meta.defaultLang);
                    return fallback
                        ? [`    <link rel="alternate" hreflang="x-default" href="${escapeAttr(fallback.url)}">`]
                        : [];
                })(),
            )
            .join('\n')
        : '';

    return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}"${dirAttr}>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeAttr(meta.metaDescription)}">
    <meta property="og:title" content="${escapeAttr(meta.title)}">
    <meta property="og:description" content="${escapeAttr(meta.metaDescription)}">
    <meta property="og:type" content="${escapeAttr(meta.ogType)}">
    <meta property="og:site_name" content="${escapeAttr(meta.siteName)}">
    <meta property="og:locale" content="${escapeAttr(toOgLocale(lang))}">
${ogImageTags ? ogImageTags + '\n' : ''}    <link rel="canonical" href="${escapeAttr(meta.canonicalUrl)}">
    <meta property="og:url" content="${escapeAttr(meta.canonicalUrl)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeAttr(meta.title)}">
    <meta name="twitter:description" content="${escapeAttr(meta.metaDescription)}">
    <meta name="robots" content="index, follow">
${hreflangLinks ? hreflangLinks + '\n' : ''}${rssLink ? rssLink + '\n' : ''}    <meta name="arc-served-by" content="firebase-hosting">
    <meta name="arc-deployed-at" content="${deployedAt}">
${cssLinks}${stylesBlock}
</head>
<body>
${headerHtml}
${bodyHtml}
${footerHtml}${poweredByBlock}${scriptsBlock}
</body>
</html>`;
}

/**
 * Fixes bare `href="#"` links in partial HTML by converting them to `href="/"`.
 *
 * Applied to header/footer partial HTML before injection into generated pages.
 * On the landing page, `href="#"` scrolls to the top, but on content pages like
 * `/articles/my-article.html`, it points nowhere useful.
 *
 * Only converts bare `href="#"` — does NOT convert `href="#section"` links.
 */
export function fixPartialHashLinks(partialHtml: string): string {
    if (!partialHtml) return partialHtml;
    return partialHtml
        .replace(/href="#"/g, 'href="/"')
        .replace(/href='#'/g, "href='/'");
}

/**
 * Replaces <arc-header> and <arc-footer> custom elements with real HTML.
 * Strips <arc-admin-edit-button> and <arc-content-partials> elements.
 * Fixes bare hash links in partials before injection.
 */
export function replaceArcComponents(
    html: string,
    headerHtml: string,
    footerHtml: string,
): string {
    const $ = cheerio.load(html, { xmlMode: false });

    $('arc-header').replaceWith(fixPartialHashLinks(headerHtml));
    $('arc-footer').replaceWith(fixPartialHashLinks(footerHtml));
    $('arc-admin-edit-button').remove();
    $('arc-content-partials').remove();

    return $.html();
}

/**
 * Extracts <style> and <script> blocks from template HTML.
 * Returns the body without those blocks, plus the extracted content.
 */
export function extractStylesAndScripts(html: string): {
    body: string;
    styles: string;
    scripts: string;
} {
    const $ = cheerio.load(html, { xmlMode: false });

    const styles: string[] = [];
    const scripts: string[] = [];

    $('style').each((_, el) => {
        styles.push($.html(el));
        $(el).remove();
    });

    $('script').each((_, el) => {
        scripts.push($.html(el));
        $(el).remove();
    });

    return {
        body: $.html(),
        styles: styles.join('\n'),
        scripts: scripts.join('\n'),
    };
}

/**
 * Injects or updates SEO metadata in an existing HTML document's <head>.
 * Used for pages that already have a full HTML structure (e.g., from page templates).
 */
export function injectSeoMetadata(
    html: string,
    seo: {
        title?: string;
        metaDescription?: string;
        ogImage?: string;
        canonicalUrl?: string;
    },
): string {
    const $ = cheerio.load(html, { xmlMode: false });

    if (seo.title) {
        if ($('title').length) {
            $('title').text(seo.title);
        } else {
            $('head').append(`<title>${escapeHtml(seo.title)}</title>`);
        }
        setMetaProperty($, 'og:title', seo.title);
        setMetaName($, 'twitter:title', seo.title);
    }

    if (seo.metaDescription) {
        setMetaName($, 'description', seo.metaDescription);
        setMetaProperty($, 'og:description', seo.metaDescription);
        setMetaName($, 'twitter:description', seo.metaDescription);
    }

    if (seo.ogImage) {
        setMetaProperty($, 'og:image', seo.ogImage);
        setMetaName($, 'twitter:image', seo.ogImage);
    }

    if (seo.canonicalUrl) {
        if ($('link[rel="canonical"]').length) {
            $('link[rel="canonical"]').attr('href', seo.canonicalUrl);
        } else {
            $('head').append(`<link rel="canonical" href="${escapeAttr(seo.canonicalUrl)}">`);
        }
        setMetaProperty($, 'og:url', seo.canonicalUrl);
    }

    // Ensure robots meta exists
    if (!$('meta[name="robots"]').length) {
        $('head').append('<meta name="robots" content="index, follow">');
    }

    // Inject arc-served-by verification tags
    if (!$('meta[name="arc-served-by"]').length) {
        $('head').append('<meta name="arc-served-by" content="firebase-hosting">');
    }
    if (!$('meta[name="arc-deployed-at"]').length) {
        $('head').append(`<meta name="arc-deployed-at" content="${new Date().toISOString()}">`);
    }

    return $.html();
}

// --- Helpers ---

function setMetaName($: cheerio.CheerioAPI, name: string, content: string): void {
    const selector = `meta[name="${name}"]`;
    if ($(selector).length) {
        $(selector).attr('content', content);
    } else {
        $('head').append(`<meta name="${name}" content="${escapeAttr(content)}">`);
    }
}

function setMetaProperty($: cheerio.CheerioAPI, property: string, content: string): void {
    const selector = `meta[property="${property}"]`;
    if ($(selector).length) {
        $(selector).attr('content', content);
    } else {
        $('head').append(`<meta property="${property}" content="${escapeAttr(content)}">`);
    }
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
