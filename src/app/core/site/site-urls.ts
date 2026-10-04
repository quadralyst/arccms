/**
 * Versioned links to the site's files, for the app's preview of site pages
 * (specs/own-website-spec.md). Mirrored in functions/src/shared/site-urls.ts: a
 * published page and its preview in the app must link the same versions.
 */

/** A link attribute: `src`, `href`, `poster` or `srcset`, with its quote. */
const LINK_ATTRIBUTE = /(\s(?:src|href|poster|srcset)\s*=\s*)(["'])(.*?)\2/gi;

/** One root-relative URL with the file's version added, when the site lists that file. */
function versioned(url: string, files: Readonly<Record<string, string>>): string {
    if (!url.startsWith('/') || url.startsWith('//') || url.includes('?')) return url;
    const [path, fragment] = url.split('#');
    const hash = files[path.slice(1)];
    if (!hash) return url;
    return `${path}?v=${hash}${fragment !== undefined ? `#${fragment}` : ''}`;
}

/**
 * Adds `?v={hash}` to every link in a page to a file the site serves and lists
 * in /_site/site.json (`files`): the app's own files in src/custom/site/assets/
 * (/site/...) and Arc CMS's stylesheets. Hosting lets browsers keep CSS, scripts
 * and images for a year, so without a version a changed file never reaches
 * returning visitors. `src`, `href`, `poster` and every URL of a `srcset`; a URL
 * that already has a query, or names a file the site does not list, is left as written.
 */
export function versionSiteUrls(html: string, files: Readonly<Record<string, string>> | null | undefined): string {
    if (!html || !files) return html;
    return html.replace(LINK_ATTRIBUTE, (match, before: string, quote: string, value: string) => {
        const rewritten = /srcset/i.test(before)
            ? value.split(',').map((candidate) => {
                const [url, ...descriptor] = candidate.trim().split(/\s+/);
                return [versioned(url, files), ...descriptor].join(' ');
            }).join(', ')
            : versioned(value, files);
        return rewritten === value ? match : `${before}${quote}${rewritten}${quote}`;
    });
}
