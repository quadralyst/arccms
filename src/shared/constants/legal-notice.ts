/**
 * The notice shown on every signup form: waitlist and landing-page forms, the
 * account sign-up page and the onboarding wizard (decided 2026-09-23). Plain
 * text for now, no checkbox; signing up is agreeing to it, marketing email
 * included.
 *
 * Edit the wording and the links here. A link is drawn only when its URL is
 * set; with an empty URL the label reads as plain text.
 */
export const LEGAL_NOTICE = {
    termsUrl: '',
    privacyUrl: '',
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
export function buildLegalNoticeElement(doc: Document, lang: LegalNoticeLang): HTMLElement {
    const p = doc.createElement('p');
    p.className = 'arc-legal-notice';
    p.setAttribute('data-legal-notice', '');
    p.style.cssText = 'font-size: 0.8rem; opacity: 0.75; margin: 0.5rem 0; line-height: 1.4;';
    for (const part of legalNoticeParts(lang)) {
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
