/**
 * `data-arc-site` on live DOM: the site header and footer, which the app renders
 * from the site's HTML rather than compiling (src/app/pages/page.parts/site-fragment.ts).
 *
 * The same rules as TemplateHydrationService.applySiteInfo, in the app and in the
 * publish functions, so a footer reads the same in the app and on a published
 * page (src/shared/utils/site-info.spec.ts). Works on elements so the header
 * needs no HTML parser. See specs/site-sections-spec.md, SS3.
 */
import {
    addressHtml, hasSiteInfo, mailHref, siteInfoValue, SiteInfoSource, siteLoopRows, telHref,
} from '../../../shared/utils/site-info';

/** Fills the site's details under `root` from Settings, About. */
export function applySiteInfoToElement(root: ParentNode, source: SiteInfoSource | null | undefined): void {
    root.querySelectorAll<HTMLElement>('[data-arc-site-if]').forEach((element) => {
        if (hasSiteInfo(source, element.getAttribute('data-arc-site-if') || '')) element.removeAttribute('data-arc-site-if');
        else element.remove();
    });

    root.querySelectorAll<HTMLElement>('[data-arc-site-loop]').forEach((element) => {
        const name = element.getAttribute('data-arc-site-loop');
        const rowHtml = element.firstElementChild?.outerHTML || '';
        element.replaceChildren();
        element.removeAttribute('data-arc-site-loop');
        if (rowHtml) element.innerHTML = siteLoopRows(rowHtml, name, source);
    });

    root.querySelectorAll<HTMLElement>('[data-arc-site]').forEach((element) => {
        const key = element.getAttribute('data-arc-site') || '';
        const value = siteInfoValue(source, key);
        if (!value) {
            element.remove();
            return;
        }
        element.removeAttribute('data-arc-site');
        const tag = element.tagName.toLowerCase();
        if (key === 'logo') {
            if (tag === 'img') {
                element.setAttribute('src', value);
                if (!element.getAttribute('alt')) element.setAttribute('alt', siteInfoValue(source, 'name'));
            }
            return;
        }
        if (key === 'address') element.innerHTML = addressHtml(value);
        else element.textContent = value;
        if (tag === 'a' && key === 'email') element.setAttribute('href', mailHref(value));
        if (tag === 'a' && key === 'phone') {
            const href = telHref(value);
            if (href) element.setAttribute('href', href);
        }
    });
}

/**
 * The same on a whole page as text (the app's static pages, /p/{name}): parsed,
 * filled and written back. A page that does not use data-arc-site, or a run
 * without a DOM parser (the server), is returned as it was.
 */
export function applySiteInfoToHtml(html: string, source: SiteInfoSource | null | undefined): string {
    if (!html.includes('data-arc-site') || typeof DOMParser === 'undefined') return html;
    const page = new DOMParser().parseFromString(html, 'text/html');
    applySiteInfoToElement(page.documentElement, source);
    return page.documentElement.outerHTML;
}
