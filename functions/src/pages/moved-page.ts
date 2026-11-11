/**
 * A published entry whose address changed (specs/dev-review-fixes-spec.md,
 * RF4 4.6). The page at the old address would otherwise stay on the site as it
 * was, out of date, and links to it would keep landing there.
 *
 * With "Send the old address to the new one" ticked in the editor (the
 * default), the old address gets a small page that sends visitors on at once
 * and tells search engines the page moved for good: a zero-second refresh,
 * which they treat as a permanent redirect, and a canonical link to the new
 * address. It is a published file like the page itself, so it stays through a
 * website deploy and a republish of every page. Unticked, the old address is
 * removed and answers as any unknown address does.
 *
 * The site's own redirects file (src/custom/site/redirects.json) is the app's
 * and goes live with a website deploy; publishing an entry never changes it.
 */
import { getLocalizationSettings, getSiteConfig } from '../shared/site-settings.js';
import { detailFilePath, langPrefix } from '../shared/content-translation.js';
import { markdownFilePath } from '../shared/markdown-twin.js';
import type { HostingBatch } from './deployToHosting.js';

const escapeAttr = (text: string) => text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * The page left at an old address: it sends the visitor to `path` at once,
 * keeping the query and the fragment, with a plain link for a browser that
 * does neither. `canonical` is the new page's full address.
 */
export function movedPageHtml(path: string, canonical: string, lang: string): string {
    const href = escapeAttr(path);
    return '<!doctype html>\n'
        + `<html lang="${escapeAttr(lang)}"><head><meta charset="utf-8">`
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<meta name="robots" content="noindex">'
        + `<link rel="canonical" href="${escapeAttr(canonical)}">`
        + `<meta http-equiv="refresh" content="0; url=${href}">`
        + `<script>location.replace(${JSON.stringify(path).replace(/</g, '\\u003c')} + location.search + location.hash);</script>`
        + '<title>Moved</title></head>'
        + `<body><p><a href="${href}">${escapeAttr(path)}</a></p></body></html>\n`;
}

export interface MovedEntry {
    contentTypeSlug: string;
    /** The address the live page had. */
    from: string;
    /** The address it has now. */
    to: string;
    /** Send the old address on (true), or take it down (false). */
    redirect: boolean;
    /** Every language the site publishes in, the default one included. */
    languages: string[];
    defaultLang: string;
    /** The site's public address, for the canonical link. */
    baseUrl: string;
}

/**
 * What the move changes on Hosting, in every language: the old page is
 * replaced by a moved page (or removed), and its Markdown twin is removed.
 */
export function movedPageFiles(entry: MovedEntry): { add: Array<{ path: string; content: string }>; remove: string[] } {
    const add: Array<{ path: string; content: string }> = [];
    const remove: string[] = [];
    if (!entry.from || !entry.to || entry.from === entry.to) return { add, remove };
    const base = entry.baseUrl.replace(/\/+$/, '');
    for (const lang of entry.languages) {
        const oldPage = detailFilePath(lang, entry.defaultLang, entry.contentTypeSlug, entry.from);
        remove.push(markdownFilePath(lang, entry.defaultLang, entry.contentTypeSlug, entry.from));
        if (entry.redirect) {
            const path = `${langPrefix(lang, entry.defaultLang)}/${entry.contentTypeSlug}/${entry.to}`;
            add.push({ path: oldPage, content: movedPageHtml(path, `${base}${path}`, lang) });
        } else {
            remove.push(oldPage);
        }
    }
    return { add, remove };
}

/**
 * Puts an entry's move into the release (see movedPageFiles), in the default
 * language and each language in `translated` that the site still publishes:
 * the languages the entry had a page in. Resolves to the paths of the pages
 * left at the old address.
 */
export async function moveContentPage(
    contentTypeSlug: string,
    from: string,
    to: string,
    redirect: boolean,
    batch: HostingBatch,
    translated: string[] = [],
): Promise<string[]> {
    const [localization, siteConfig] = await Promise.all([getLocalizationSettings(), getSiteConfig()]);
    const defaultLang = localization.defaultLanguage;
    const { add, remove } = movedPageFiles({
        contentTypeSlug,
        from,
        to,
        redirect,
        languages: localization.enabledLanguages
            .map((language) => language.code)
            .filter((code) => code === defaultLang || translated.includes(code)),
        defaultLang,
        baseUrl: siteConfig.baseUrl || '',
    });
    for (const path of remove) batch.remove(path);
    for (const file of add) batch.add(file.path, file.content);
    return add.map((file) => file.path);
}
