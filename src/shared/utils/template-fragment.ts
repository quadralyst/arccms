/**
 * Is this string a page template fragment, as opposed to a whole HTML
 * document?
 *
 * A template lives at /templates/{folder}/detail.html. When the folder does
 * not exist, Hosting (and the dev server) answer that URL with the SPA
 * shell, HTTP 200, whose SSR output for the path is the 404 page. Both
 * renderers used to hydrate that page as if it were the template, so a
 * content type pointing at a missing folder showed "404 Page Not Found"
 * inside a perfectly good content page. A real template is a fragment
 * and never carries <html>, <head> or a doctype.
 *
 * Mirrored server-side in functions/src/shared/template-fragment.ts.
 */
export function isTemplateFragment(html: string | null | undefined): boolean {
    if (!html || !html.trim()) return false;
    const head = html.slice(0, 2000).toLowerCase();
    if (/<!doctype\s/i.test(head)) return false;
    if (/<html[\s>]/.test(head) || /<head[\s>]/.test(head) || /<body[\s>]/.test(head)) return false;
    if (html.includes('<arc-not-found') || html.includes('<arc-root')) return false;
    return true;
}
