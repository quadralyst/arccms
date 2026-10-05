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
import { buildContactNoticeElement, buildLegalNoticeElement, legalNoticeLang } from '../../../shared/constants/legal-notice';

const SUBMIT = 'button[type="submit"], input[type="submit"], button:not([type])';

function beforeSubmit(form: HTMLFormElement, notice: HTMLElement): void {
    const submit = form.querySelector(SUBMIT);
    if (submit?.parentNode) submit.parentNode.insertBefore(notice, submit);
    else form.appendChild(notice);
}

/**
 * Contact forms only with the feature; the terms notice on signup forms and the
 * privacy line on contact forms that carry none. Returns whether the page has
 * any form left for arc-site.js to run.
 */
export function prepareLiveParts(root: ParentNode, doc: Document): boolean {
    if (!isOn('contact')) root.querySelectorAll('form[data-arc-contact-form]').forEach((form) => form.remove());
    const lang = legalNoticeLang(doc.documentElement.lang);
    for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form[data-waitlist-form]'))) {
        if (!form.querySelector('[data-legal-notice]')) beforeSubmit(form, buildLegalNoticeElement(doc, lang));
    }
    for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form[data-arc-contact-form]'))) {
        if (!form.querySelector('[data-contact-notice]')) beforeSubmit(form, buildContactNoticeElement(doc, lang));
    }
    return !!root.querySelector('form[data-waitlist-form], form[data-arc-contact-form]');
}

/** arc-site.js with what the published page gives it (arcSiteScript in functions/src/shared/live-parts.ts). */
export function arcSiteScriptElement(doc: Document): HTMLScriptElement {
    const projectId = environment.firebaseConfig?.projectId ?? '';
    const version = siteManifest().files['assets/js/arc-site.js'];
    const script = doc.createElement('script');
    script.src = `/assets/js/arc-site.js${version ? `?v=${version}` : ''}`;
    script.setAttribute('data-functions', `https://${arcConfig.functionsRegion}-${projectId}.cloudfunctions.net`);
    script.setAttribute('data-group', ARC_FUNCTION_GROUP);
    script.setAttribute('data-project', projectId);
    script.setAttribute('data-database', arcConfig.databaseId);
    return script;
}

/**
 * Prepares the forms under `root` and, when it has any, runs arc-site.js for
 * them. Returns the script element so the page can remove it when it goes.
 */
export function attachLiveParts(root: ParentNode, doc: Document): HTMLScriptElement | null {
    if (!prepareLiveParts(root, doc)) return null;
    const script = arcSiteScriptElement(doc);
    doc.body.appendChild(script);
    return script;
}
