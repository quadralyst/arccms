import { appHasPage } from '../../app/core/site/site';
import { noticeParts, noticeText, type NoticeKind, type SiteNotices } from '../utils/notice-text';
import { CUSTOM_NOTICES } from '../../custom/notices';

/**
 * The app's own notices (src/custom/notices.ts, docs/app/sign-up-notice.html): when
 * it has a text for the page, it replaces Arc CMS's own, here and when publishing.
 */
export const APP_NOTICES: SiteNotices = CUSTOM_NOTICES;

/**
 * The static pages the notice links to, at /p/{name}, when the app supplies them
 * (src/custom/site/pages/terms.html, privacy-policy.html). Arc CMS's own sample
 * policy is never linked from someone else's site.
 */
export const LEGAL_PAGES = { terms: 'terms', privacy: 'privacy-policy' } as const;

/** The notice's links: a page the app supplies, else none. */
export function legalNoticeUrls(hasPage: (name: string) => boolean = appHasPage): { termsUrl: string; privacyUrl: string } {
    return {
        termsUrl: hasPage(LEGAL_PAGES.terms) ? `/p/${LEGAL_PAGES.terms}` : '',
        privacyUrl: hasPage(LEGAL_PAGES.privacy) ? `/p/${LEGAL_PAGES.privacy}` : '',
    };
}

/**
 * The notice shown on every signup form: waitlist and landing-page forms, the
 * account sign-up page and the onboarding wizard (decided 2026-09-23). Plain
 * text for now, no checkbox; signing up is agreeing to it, marketing email
 * included.
 *
 * Its links come from the site's pages (legalNoticeUrls). A link is drawn only
 * when its URL is set; with an empty URL the label reads as plain text.
 */
export const LEGAL_NOTICE = {
    ...legalNoticeUrls(),
    /** `{terms}` and `{privacy}` mark where the two labels go. */
    text: {
        en: {
            sentence: 'By signing up, you agree to our {terms} and {privacy}, and to receive emails from us.',
            terms: 'Terms of Service',
            privacy: 'Privacy Policy',
        },
        hi: {
            sentence: 'साइन अप करके, आप हमारी {terms} और {privacy} से, और हमसे ईमेल प्राप्त करने से सहमत होते हैं।',
            terms: 'सेवा की शर्तें',
            privacy: 'गोपनीयता नीति',
        },
    },
} as const;

export type LegalNoticeLang = keyof typeof LEGAL_NOTICE.text;

/** A notice's links: the terms and privacy pages, '' for none. */
export type LegalNotice = Omit<typeof LEGAL_NOTICE, 'termsUrl' | 'privacyUrl'> & { termsUrl: string; privacyUrl: string };

/**
 * The notice linking the published standard pages (/info/terms,
 * /info/privacy-policy; specs/site-sections-spec.md, SS6) when the site has
 * them, else the app's static pages as before. Publishing does the same
 * (noticePageUrl in functions/src/shared/live-parts.ts).
 */
export function legalNoticeWithPages(pages: readonly { url: string }[], notice: LegalNotice = LEGAL_NOTICE): LegalNotice {
    const find = (page: string) => pages.find((p) => p.url.split('/').pop() === page)?.url;
    return { ...notice, termsUrl: find('terms') || notice.termsUrl, privacyUrl: find('privacy-policy') || notice.privacyUrl };
}

/** One run of the notice: plain text, or a label with a link when its URL is set. */
export interface LegalNoticePart {
    text: string;
    href?: string;
}

/** The notice's language for a page language such as `hi` or `en-US`; English by default. */
export function legalNoticeLang(pageLang: string | null | undefined): LegalNoticeLang {
    const base = (pageLang || '').toLowerCase().split('-')[0];
    return base in LEGAL_NOTICE.text ? (base as LegalNoticeLang) : 'en';
}

/** Arc CMS's own notice split into runs, in the given language. */
export function legalNoticeParts(lang: LegalNoticeLang = 'en', notice: LegalNotice = LEGAL_NOTICE): LegalNoticePart[] {
    const t = notice.text[lang] ?? notice.text.en;
    const links: Record<string, LegalNoticePart> = {
        terms: { text: t.terms, ...(notice.termsUrl ? { href: notice.termsUrl } : {}) },
        privacy: { text: t.privacy, ...(notice.privacyUrl ? { href: notice.privacyUrl } : {}) },
    };
    return t.sentence
        .split(/(\{terms\}|\{privacy\})/)
        .filter(Boolean)
        .map((piece) => links[piece.slice(1, -1)] ?? { text: piece });
}

/**
 * The privacy line under a contact form (specs/site-sections-spec.md, SS5), as
 * publishing writes it (functions/src/shared/live-parts.ts, contact_notice): "We
 * use your details only to reply." and the privacy page's link when the site
 * has one.
 */
export const CONTACT_NOTICE = {
    en: 'We use your details only to reply. {privacy}',
    hi: 'हम आपकी जानकारी सिर्फ़ जवाब देने के लिए इस्तेमाल करते हैं। {privacy}',
} as const;

/** Where a page's notice is read from: its language, the site's default language, the app's notices. */
export interface NoticeOptions {
    /** The site's default language, tried after the page's own. */
    defaultLang?: string | null;
    /** The app's notices; the file's by default. */
    notices?: SiteNotices;
    /**
     * What `{terms}` and `{privacy}` read on a website page: its strings file's
     * `legal_terms` and `legal_privacy`, as publishing reads them. Arc CMS's own otherwise.
     */
    labels?: { terms?: string; privacy?: string };
}

/** The app's text for a notice, split into runs, or null when it has none for the page. */
function appNoticeParts(kind: NoticeKind, pageLang: string | null | undefined, notice: LegalNotice, options: NoticeOptions): LegalNoticePart[] | null {
    const text = noticeText(options.notices ?? APP_NOTICES, kind, pageLang, options.defaultLang);
    if (text === null) return null;
    const t = notice.text[legalNoticeLang(pageLang)];
    const label = (own: string | undefined, core: string) => (own?.trim() ? own : core);
    return noticeParts(text, {
        terms: { label: label(options.labels?.terms, t.terms), url: notice.termsUrl },
        privacy: { label: label(options.labels?.privacy, t.privacy), url: notice.privacyUrl },
    });
}

/**
 * The sign-up notice for a page in the given language (`de-CH`, `hi`): the app's
 * own text when it has one for the page (src/custom/notices.ts: the page's
 * language, then the site's default, then English), else Arc CMS's own.
 */
export function signupNoticeParts(pageLang: string | null | undefined, notice: LegalNotice = LEGAL_NOTICE, options: NoticeOptions = {}): LegalNoticePart[] {
    return appNoticeParts('signup', pageLang, notice, options) ?? legalNoticeParts(legalNoticeLang(pageLang), notice);
}

/** The contact form's line for a page, chosen as the sign-up notice is. */
export function contactNoticeParts(pageLang: string | null | undefined, notice: LegalNotice = LEGAL_NOTICE, options: NoticeOptions = {}): LegalNoticePart[] {
    const own = appNoticeParts('contact', pageLang, notice, options);
    if (own) return own;
    const lang = legalNoticeLang(pageLang);
    const privacy: LegalNoticePart = { text: notice.text[lang].privacy, ...(notice.privacyUrl ? { href: notice.privacyUrl } : {}) };
    return CONTACT_NOTICE[lang].split(/(\{privacy\})/).filter(Boolean).map((piece) => (piece === '{privacy}' ? privacy : { text: piece }));
}

/**
 * The notices' look, each value a CSS variable an app can set in its site.css
 * (docs/app/sign-up-notice.html#style-it), with Arc CMS's look as the fallback. The
 * same as publishing writes (NOTICE_STYLE in functions/src/shared/live-parts.ts).
 */
export const NOTICE_STYLE = 'font-size: var(--arc-notice-font-size, 0.8rem); opacity: var(--arc-notice-opacity, 0.75); '
    + 'margin: var(--arc-notice-margin, 0.5rem 0); line-height: var(--arc-notice-line-height, 1.4);';
export const NOTICE_LINK_STYLE = 'color: var(--arc-notice-link-color, inherit); text-decoration: var(--arc-notice-link-decoration, underline);';

/** A notice paragraph, built with DOM calls, never innerHTML. */
function noticeElement(doc: Document, className: string, marker: string, parts: LegalNoticePart[]): HTMLElement {
    const p = doc.createElement('p');
    p.className = className;
    p.setAttribute(marker, '');
    p.setAttribute('style', NOTICE_STYLE);
    for (const part of parts) {
        if (part.href) {
            const a = doc.createElement('a');
            a.href = part.href;
            a.target = '_blank';
            a.rel = 'noopener';
            a.setAttribute('style', NOTICE_LINK_STYLE);
            a.textContent = part.text;
            p.appendChild(a);
        } else {
            p.appendChild(doc.createTextNode(part.text));
        }
    }
    return p;
}

/**
 * The sign-up notice as a DOM element, for forms the app does not render itself
 * (the landing-page signup forms).
 */
export function buildLegalNoticeElement(doc: Document, pageLang: string, notice: LegalNotice = LEGAL_NOTICE, options: NoticeOptions = {}): HTMLElement {
    return noticeElement(doc, 'arc-legal-notice', 'data-legal-notice', signupNoticeParts(pageLang, notice, options));
}

/** The contact form's line as a DOM element. */
export function buildContactNoticeElement(doc: Document, pageLang: string, notice: LegalNotice = LEGAL_NOTICE, options: NoticeOptions = {}): HTMLElement {
    return noticeElement(doc, 'arc-contact-notice', 'data-contact-notice', contactNoticeParts(pageLang, notice, options));
}
