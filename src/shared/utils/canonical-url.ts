/**
 * Client mirror of functions/src/shared/canonical-url.ts for the editor and
 * the SPA. Keep the two in step; canonical-url.spec.ts runs both on the same
 * cases.
 *
 * The canonical URL an author set on an item, or '' when the stored value is
 * not one: a URL on a local development host, or the page's own path on one
 * of the site's hosts (what the old editor wrote from the address the admin
 * was open on). Publishing then uses the page's own address on the site's
 * public URL.
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
