import { appHasPage } from '../../app/core/site/site';

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

/** The notice split into runs, in the given language. */
export function legalNoticeParts(lang: LegalNoticeLang = 'en', notice = LEGAL_NOTICE): LegalNoticePart[] {
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
 * The notice as a DOM element, for forms the app does not render itself (the
 * landing-page signup forms). Built with DOM calls, not innerHTML.
 */
export function buildLegalNoticeElement(doc: Document, lang: LegalNoticeLang, notice = LEGAL_NOTICE): HTMLElement {
    const p = doc.createElement('p');
    p.className = 'arc-legal-notice';
    p.setAttribute('data-legal-notice', '');
    p.style.cssText = 'font-size: 0.8rem; opacity: 0.75; margin: 0.5rem 0; line-height: 1.4;';
    for (const part of legalNoticeParts(lang, notice)) {
        if (part.href) {
            const a = doc.createElement('a');
            a.href = part.href;
            a.target = '_blank';
            a.rel = 'noopener';
            a.style.color = 'inherit';
            a.style.textDecoration = 'underline';
            a.textContent = part.text;
            p.appendChild(a);
        } else {
            p.appendChild(doc.createTextNode(part.text));
        }
    }
    return p;
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

export function buildContactNoticeElement(doc: Document, lang: LegalNoticeLang, notice = LEGAL_NOTICE): HTMLElement {
    const p = doc.createElement('p');
    p.className = 'arc-contact-notice';
    p.setAttribute('data-contact-notice', '');
    p.style.cssText = 'font-size: 0.8rem; opacity: 0.75; margin: 0.5rem 0; line-height: 1.4;';
    const privacy = (notice.text[lang] ?? notice.text.en).privacy;
    for (const piece of (CONTACT_NOTICE[lang] ?? CONTACT_NOTICE.en).split(/(\{privacy\})/).filter(Boolean)) {
        if (piece !== '{privacy}') {
            p.appendChild(doc.createTextNode(piece));
        } else if (notice.privacyUrl) {
            const a = doc.createElement('a');
            a.href = notice.privacyUrl;
            a.target = '_blank';
            a.rel = 'noopener';
            a.style.color = 'inherit';
            a.style.textDecoration = 'underline';
            a.textContent = privacy;
            p.appendChild(a);
        } else {
            p.appendChild(doc.createTextNode(privacy));
        }
    }
    return p;
}
