/**
 * The live parts of a website page in the app (specs/site-sections-spec.md, SS5):
 * what publishing does for arc-site.js (functions/src/shared/live-parts.ts), done
 * on the page the app draws, so a signup or contact form works in a preview
 * exactly as on the published page. Used by the home page, content pages, list
 * pages and static pages.
 */
import { ARC_FUNCTION_GROUP } from '../config/arc-functions';
import { arcConfig } from '../config/arc-config';
import { environment } from '../../../environments/environment';
import { isOn } from '../features/features';
import { siteManifest } from './site';
import { readStoredLocalization } from '../services/localization.service';
import { buildContactNoticeElement, buildLegalNoticeElement, legalNoticeWithPages } from '../../../shared/constants/legal-notice';
import type { SitePageLink } from '../../../shared/utils/site-info';

const SUBMIT = 'button[type="submit"], input[type="submit"], button:not([type])';

function beforeSubmit(form: HTMLFormElement, notice: HTMLElement): void {
    const submit = form.querySelector(SUBMIT);
    if (submit?.parentNode) submit.parentNode.insertBefore(notice, submit);
    else form.appendChild(notice);
}

/**
 * Contact forms only with the feature; the terms notice on signup forms and the
 * privacy line on contact forms that carry none, in the page's language (the
 * app's own text from src/custom/notices.ts when it has one, as publishing
 * does). Returns whether the page has any form left for arc-site.js to run.
 */
export function prepareLiveParts(
    root: ParentNode, doc: Document, pages: readonly SitePageLink[] = [], strings: Record<string, string> = {},
    defaultLang = readStoredLocalization()?.defaultLanguage,
): boolean {
    if (!isOn('contact')) root.querySelectorAll('form[data-arc-contact-form]').forEach((form) => form.remove());
    const lang = doc.documentElement.lang;
    const notice = legalNoticeWithPages(pages);
    // The placeholders' words from the page's strings file, as publishing reads them.
    const options = { defaultLang, labels: { terms: strings['legal_terms'], privacy: strings['legal_privacy'] } };
    for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form[data-waitlist-form]'))) {
        if (!form.querySelector('[data-legal-notice]')) beforeSubmit(form, buildLegalNoticeElement(doc, lang, notice, options));
    }
    for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form[data-arc-contact-form]'))) {
        if (!form.querySelector('[data-contact-notice]')) beforeSubmit(form, buildContactNoticeElement(doc, lang, notice, options));
    }
    return !!root.querySelector('form[data-waitlist-form], form[data-arc-contact-form]');
}

/**
 * The signup and contact panels' text in the page's language: the `signup_*` and
 * `contact_*` keys of its strings, as publishing puts them on the script tag.
 */
export function panelStrings(strings: Record<string, string> = {}): Record<string, string> {
    return Object.fromEntries(Object.entries(strings).filter(([key, value]) =>
        (key.startsWith('signup_') || key.startsWith('contact_')) && typeof value === 'string'));
}

/** arc-site.js with what the published page gives it (arcSiteScript in functions/src/shared/live-parts.ts). */
export function arcSiteScriptElement(doc: Document, strings: Record<string, string> = {}): HTMLScriptElement {
    const projectId = environment.firebaseConfig?.projectId ?? '';
    const version = siteManifest().files['assets/js/arc-site.js'];
    const script = doc.createElement('script');
    script.src = `/assets/js/arc-site.js${version ? `?v=${version}` : ''}`;
    script.setAttribute('data-functions', `https://${arcConfig.functionsRegion}-${projectId}.cloudfunctions.net`);
    script.setAttribute('data-group', ARC_FUNCTION_GROUP);
    script.setAttribute('data-project', projectId);
    script.setAttribute('data-database', arcConfig.databaseId);
    const panels = panelStrings(strings);
    if (Object.keys(panels).length) script.setAttribute('data-strings', JSON.stringify(panels));
    return script;
}

/**
 * Prepares the forms under `root` and, when it has any, runs arc-site.js for
 * them. Returns the script element so the page can remove it when it goes.
 */
export function attachLiveParts(
    root: ParentNode, doc: Document, pages: readonly SitePageLink[] = [], strings: Record<string, string> = {},
): HTMLScriptElement | null {
    if (!prepareLiveParts(root, doc, pages, strings)) return null;
    const script = arcSiteScriptElement(doc, strings);
    doc.body.appendChild(script);
    return script;
}
