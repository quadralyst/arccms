/**
 * The canonical URL an author set on an item, or '' when the stored value is
 * not one. Publishing then uses the page's own address on the site's public
 * URL (Settings/about.finalUrl).
 *
 * The editor used to fill the canonical field itself, from the address the
 * admin was open on. An item saved in a local admin connected to the live
 * project got `http://localhost:5173/{type}/{slug}` as its canonical and
 * og:url, and an item saved anywhere kept its old address after a slug
 * change. Those stored values are dropped here:
 *
 *  - any URL on a local development host (localhost, *.localhost, 127.x, ::1,
 *    0.0.0.0);
 *  - the page's own path (`/{type}/{slug}` or `/{slug}`) on one of the site's
 *    hosts or a Firebase default hosting domain, since that is the address
 *    publishing derives anyway, written by the old editor.
 *
 * A canonical to another site, or to another page, is kept. Mirrored for the
 * admin and the SPA in src/shared/utils/canonical-url.ts.
 */
export function authorCanonicalUrl(
    stored: string | null | undefined,
    typeSlug: string,
    urlSlug: string,
    siteHosts: string[] = [],
): string {
    const value = (stored || '').trim();
    if (!value) return '';

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return '';
    }

    const host = url.hostname.toLowerCase();
    if (isLocalHost(host)) return '';

    const path = url.pathname.replace(/\/+$/, '');
    const ownPaths = [`/${typeSlug}/${urlSlug}`, `/${urlSlug}`];
    const known = siteHosts.map(hostOf).filter(Boolean);
    const onSite = known.includes(host) || /\.(web\.app|firebaseapp\.com)$/.test(host);
    if (onSite && urlSlug && ownPaths.includes(path)) return '';

    return value;
}

/** The lower-cased host name of a URL or bare host, or '' when there is none. */
export function hostOf(urlOrHost: string | null | undefined): string {
    const value = (urlOrHost || '').trim();
    if (!value) return '';
    try {
        return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function isLocalHost(host: string): boolean {
    return host === 'localhost'
        || host.endsWith('.localhost')
        || host === '0.0.0.0'
        || host === '[::1]'
        || host === '::1'
        || /^127\.\d+\.\d+\.\d+$/.test(host);
}
