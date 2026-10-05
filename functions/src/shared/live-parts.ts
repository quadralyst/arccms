import type * as cheerio from 'cheerio';
import { db } from '../init.js';
import { arcDatabaseId, arcFunctionsRegion } from '../arc-config.js';
import { ARC_FUNCTION_GROUP } from '../function-names.js';
import { isFeatureOn } from '../feature-flags.js';
import { loadHtml } from './lazy-cheerio.js';
import { versionedUrl, type SiteManifest } from './site-files.js';
import type { SitePageLink } from './site-info.js';

/**
 * The live parts of every published page: what arc-site.js
 * (public/assets/js/arc-site.js) runs, and what publishing adds to the page for
 * it. Shared by the home, content, list and static page builders, so a signup
 * or contact form works on any of them (specs/site-sections-spec.md, SS5).
 */

/** The notices' words; translated through `strings/{lang}.json`. */
const NOTICE_DEFAULTS = {
    legal_notice: 'By signing up, you agree to our {terms} and {privacy}, and to receive emails from us.',
    legal_terms: 'Terms of Service',
    legal_privacy: 'Privacy Policy',
    contact_notice: 'We use your details only to reply. {privacy}',
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

const NOTICE_STYLE = 'font-size:0.8rem;opacity:0.75;margin:0.5rem 0;line-height:1.4';

function words(strings: Record<string, string>) {
    return (key: keyof typeof NOTICE_DEFAULTS) => (strings[key]?.trim() ? strings[key] : NOTICE_DEFAULTS[key]);
}

/**
 * Where a notice links for one of the site's pages (`terms`, `privacy-policy`):
 * the published standard page when there is one (/info/terms, SS6), else the
 * app's own static page (/p/terms), else nowhere. Arc CMS's sample policy is
 * never linked from someone else's site.
 */
export function noticePageUrl(page: string, manifest: SiteManifest | null, pages: readonly SitePageLink[] = []): string {
    const standard = pages.find((p) => p.url.split('/').pop() === page);
    if (standard) return standard.url;
    return manifest?.pages[page] === 'app' ? `/p/${page}` : '';
}

/** The label as a link to that page, or the label alone. */
function pageLink(label: string, page: string, manifest: SiteManifest | null, pages: readonly SitePageLink[]): string {
    const url = noticePageUrl(page, manifest, pages);
    return url
        ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${escapeHtml(label)}</a>`
        : escapeHtml(label);
}

/** Puts `notice` above the form's submit button, or at its end. */
function beforeSubmit($: cheerio.CheerioAPI, form: Parameters<cheerio.CheerioAPI>[0], notice: string): void {
    const $form = $(form);
    const submit = $form.find('button[type="submit"], input[type="submit"], button:not([type])').first();
    if (submit.length) submit.before(notice);
    else $form.append(notice);
}

/**
 * The terms notice on every signup form that does not carry one
 * ([data-legal-notice]), above its submit button: the same notice the app adds
 * to its forms (src/shared/constants/legal-notice.ts). Its links go to the app's
 * own terms and privacy pages, and only when the app has them.
 */
export function addLegalNotices(
    $: cheerio.CheerioAPI, strings: Record<string, string>, manifest: SiteManifest | null, pages: readonly SitePageLink[] = [],
): void {
    const t = words(strings);
    const sentence = escapeHtml(t('legal_notice'))
        .replace('{terms}', pageLink(t('legal_terms'), 'terms', manifest, pages))
        .replace('{privacy}', pageLink(t('legal_privacy'), 'privacy-policy', manifest, pages));
    const notice = `<p class="arc-legal-notice" data-legal-notice style="${NOTICE_STYLE}">${sentence}</p>`;
    $('form[data-waitlist-form]').each((_, form) => {
        if ($(form).find('[data-legal-notice]').length) return;
        beforeSubmit($, form, notice);
    });
}

/**
 * The privacy line on every contact form that does not carry one
 * ([data-contact-notice]): "We use your details only to reply.", with a link to
 * the app's privacy page when it has one.
 */
export function addContactNotices(
    $: cheerio.CheerioAPI, strings: Record<string, string>, manifest: SiteManifest | null, pages: readonly SitePageLink[] = [],
): void {
    const t = words(strings);
    const sentence = escapeHtml(t('contact_notice')).replace('{privacy}', pageLink(t('legal_privacy'), 'privacy-policy', manifest, pages));
    const notice = `<p class="arc-contact-notice" data-contact-notice style="${NOTICE_STYLE}">${sentence}</p>`;
    $('form[data-arc-contact-form]').each((_, form) => {
        if ($(form).find('[data-contact-notice]').length) return;
        beforeSubmit($, form, notice);
    });
}

/**
 * Everything publishing does for the live parts of a page's body: contact forms
 * are removed when the app has no contact form feature (so no dead form shows),
 * and signup and contact forms get their notices.
 */
export function prepareLiveParts(
    $: cheerio.CheerioAPI, strings: Record<string, string>, manifest: SiteManifest | null, pages: readonly SitePageLink[] = [],
): void {
    if (!isFeatureOn('contact')) $('form[data-arc-contact-form]').remove();
    addLegalNotices($, strings, manifest, pages);
    addContactNotices($, strings, manifest, pages);
}

/** The same on an HTML string; a page without forms is returned as it was. */
export function withLiveParts(
    html: string, strings: Record<string, string>, manifest: SiteManifest | null, pages: readonly SitePageLink[] = [],
): string {
    if (!html.includes('data-waitlist-form') && !html.includes('data-arc-contact-form')) return html;
    const $ = loadHtml(html, { xmlMode: false });
    prepareLiveParts($, strings, manifest, pages);
    return $.html();
}

/** Whether the setup wizard was still to do when the page was published. */
export type SetupState = '' | 'first-run' | 'in-progress';

/**
 * The setup wizard's state, decided as the app decides it (onboarding-setup.service.ts):
 * `Settings/onboarding_status` when it exists, otherwise an empty `email_lookup` means
 * a fresh install. A published page that was built during setup asks arc-site.js to
 * check again and send the owner to /onboarding; one built after setup costs nothing.
 */
export async function setupState(): Promise<SetupState> {
    try {
        const status = await db.collection('Settings').doc('onboarding_status').get();
        if (status.exists) return status.data()?.['completed'] === true ? '' : 'in-progress';
        const lookup = await db.collection('email_lookup').limit(1).get();
        return lookup.empty ? 'first-run' : '';
    } catch {
        return '';
    }
}

/**
 * The <script> for arc-site.js, with what it needs to reach the functions and
 * the public Firestore documents, and its panels' text in the page's language
 * (the `signup_*` and `contact_*` keys of its strings).
 */
export function arcSiteScript(src: string, setup: SetupState = '', strings: Record<string, string> = {}): string {
    const project = process.env.GCLOUD_PROJECT || '';
    const panels = Object.fromEntries(Object.entries(strings).filter(([key, value]) =>
        (key.startsWith('signup_') || key.startsWith('contact_')) && typeof value === 'string'));
    const attrs = [
        `src="${escapeAttr(src)}"`,
        `data-functions="${escapeAttr(`https://${arcFunctionsRegion()}-${project}.cloudfunctions.net`)}"`,
        `data-group="${ARC_FUNCTION_GROUP}"`,
        `data-project="${escapeAttr(project)}"`,
        `data-database="${escapeAttr(arcDatabaseId())}"`,
        ...(setup ? [`data-setup="${setup}"`] : []),
        ...(Object.keys(panels).length ? [`data-strings="${escapeAttr(JSON.stringify(panels))}"`] : []),
        'defer',
    ];
    return `<script ${attrs.join(' ')}></script>`;
}

/** arc-site.js for a page, versioned, with the setup state read now. */
export async function liveSiteScript(manifest: SiteManifest | null, strings: Record<string, string> = {}): Promise<string> {
    return arcSiteScript(versionedUrl('/assets/js/arc-site.js', manifest), await setupState(), strings);
}
