/**
 * The app's own notices (docs/app/sign-up-notice.html):
 * the sign-up notice and the contact form's line, one text per language, in
 * src/custom/notices.ts. The app reads them in its bundle; the build serves them
 * at /_site/notices.json, where publishing reads them, so both say the same words.
 *
 * A text is plain words with links written inside it, `[Terms of Service](/p/terms)`,
 * and the placeholders `{terms}` and `{privacy}`: alone, the page's own label linked
 * to the site's terms or privacy page; as a link's target, `[AGB]({terms})`, that page.
 * A link goes only to a path on the site, an https: address or a mailto: address;
 * anything else reads as plain text. Nothing in a text is HTML.
 *
 * Mirror of src/shared/utils/notice-text.ts, the source of truth, for the Cloud
 * Functions build, which cannot import from src/. Change both together;
 * src/shared/utils/notice-text.spec.ts checks that they agree.
 */

/** What CUSTOM_NOTICES holds (src/custom/notices.ts): each notice's text by language code. */
export interface SiteNotices {
    /** The sign-up notice, on every sign-up page and signup form. */
    signup?: Record<string, string>;
    /** The line under a contact form. */
    contact?: Record<string, string>;
}

/** The type of CUSTOM_NOTICES in src/custom/notices.ts. */
export type CustomNotices = SiteNotices;

export type NoticeKind = 'signup' | 'contact';

export const NOTICE_KINDS: readonly NoticeKind[] = ['signup', 'contact'];

/** The placeholders a text may use. */
export const NOTICE_PLACEHOLDERS = ['terms', 'privacy'] as const;
export type NoticePlaceholder = (typeof NOTICE_PLACEHOLDERS)[number];

/** What a placeholder reads and where it links ('' when the site has no such page). */
export type NoticePlaceholderValues = Record<NoticePlaceholder, { label: string; url: string }>;

/** One run of a notice: plain text, or text with a link. */
export interface NoticePart {
    text: string;
    href?: string;
}

/** A language code as the file keys it: `de`, `pt-br`, `de-ch`. */
const LANG_KEY = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/** `[label](target)` or `{name}`. */
const TOKEN = /\[([^\]]*)\]\(([^)]*)\)|\{([A-Za-z0-9_-]*)\}/g;

const isPlaceholder = (name: string): name is NoticePlaceholder => (NOTICE_PLACEHOLDERS as readonly string[]).includes(name);

/**
 * A link target a notice may use, or null: a path on the site (`/p/terms`, not
 * `//host`), an https: address or a mailto: address. No spaces, no control characters.
 */
export function safeNoticeHref(target: string): string | null {
    const t = target.trim();
    if (!t || /[\s\u0000-\u001f\u007f\\]/.test(t)) return null;
    if (t.startsWith('/') && !t.startsWith('//')) return t;
    if (/^https:\/\/[^/]/i.test(t)) return t;
    if (/^mailto:[^/]/i.test(t)) return t;
    return null;
}

/**
 * A text split into runs, links resolved. A placeholder's link is drawn only when
 * the site has that page; a target that is not allowed, or a placeholder the
 * file may not use, leaves the label as plain text (an unknown `{name}` alone is
 * left out). noticeProblems finds all of these before a visitor does.
 */
export function noticeParts(text: string, values: NoticePlaceholderValues): NoticePart[] {
    const parts: NoticePart[] = [];
    const plain = (s: string) => {
        if (!s) return;
        const last = parts[parts.length - 1];
        if (last && last.href === undefined) last.text += s;
        else parts.push({ text: s });
    };
    let at = 0;
    for (const match of text.matchAll(TOKEN)) {
        plain(text.slice(at, match.index));
        at = match.index + match[0].length;
        const [, label, target, name] = match;
        if (name !== undefined) {
            if (!isPlaceholder(name)) continue;
            const { label: own, url } = values[name];
            if (url) parts.push({ text: own, href: url });
            else plain(own);
        } else if (label) {
            const placeholder = /^\{([A-Za-z0-9_-]*)\}$/.exec(target.trim())?.[1];
            const href = placeholder !== undefined
                ? (isPlaceholder(placeholder) ? values[placeholder].url : '')
                : safeNoticeHref(target);
            if (href) parts.push({ text: label, href });
            else plain(label);
        }
    }
    plain(text.slice(at));
    return parts;
}

/**
 * The text to show for a page: the page's language (`de-ch`, then `de`), then the
 * site's default language, then English. null when the file has none of them,
 * and the caller shows Arc CMS's own notice.
 */
export function noticeText(
    notices: SiteNotices | null | undefined, kind: NoticeKind, pageLang: string | null | undefined, defaultLang?: string | null,
): string | null {
    const texts = notices?.[kind];
    if (!texts || typeof texts !== 'object') return null;
    const byLang = new Map(Object.entries(texts).map(([lang, text]) => [lang.toLowerCase(), text]));
    const tried = new Set<string>();
    for (const lang of [pageLang, defaultLang, 'en']) {
        const code = (lang || '').trim().toLowerCase();
        for (const candidate of [code, code.split('-')[0]]) {
            if (!candidate || tried.has(candidate)) continue;
            tried.add(candidate);
            const text = byLang.get(candidate);
            if (typeof text === 'string' && text.trim()) return text;
        }
    }
    return null;
}

/**
 * Every mistake in a notices file, one line each; empty when it is fine. The build
 * stops on any (vite.config.ts), so no visitor sees a broken link or a placeholder.
 */
export function noticeProblems(notices: unknown, file = 'src/custom/notices.ts'): string[] {
    if (!notices || typeof notices !== 'object' || Array.isArray(notices)) {
        return [`${file} must hold one object, such as { "signup": { "en": "..." }, "contact": { "en": "..." } }.`];
    }
    const problems: string[] = [];
    for (const [kind, texts] of Object.entries(notices)) {
        if (!(NOTICE_KINDS as readonly string[]).includes(kind)) {
            problems.push(`${file}: "${kind}" is not a notice; use ${NOTICE_KINDS.map((k) => `"${k}"`).join(' or ')}.`);
            continue;
        }
        if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
            problems.push(`${file}: "${kind}" must be an object of language codes and texts, such as { "en": "..." }.`);
            continue;
        }
        for (const [lang, text] of Object.entries(texts)) {
            const where = `${file}: ${kind}.${lang}`;
            if (!LANG_KEY.test(lang)) problems.push(`${where}: "${lang}" is not a language code, such as "de" or "pt-br".`);
            if (typeof text !== 'string' || !text.trim()) {
                problems.push(`${where} must be a text.`);
                continue;
            }
            problems.push(...textProblems(text).map((p) => `${where}: ${p}`));
        }
    }
    return problems;
}

/** The mistakes in one text. */
function textProblems(text: string): string[] {
    const problems: string[] = [];
    for (const match of text.matchAll(TOKEN)) {
        const [whole, label, target, name] = match;
        if (name !== undefined) {
            if (!isPlaceholder(name)) problems.push(`${whole} is not a placeholder; use {terms} or {privacy}.`);
            continue;
        }
        if (!label.trim()) problems.push(`${whole} has no words to show for the link.`);
        const placeholder = /^\{([A-Za-z0-9_-]*)\}$/.exec(target.trim())?.[1];
        if (placeholder !== undefined) {
            if (!isPlaceholder(placeholder)) problems.push(`${whole} links to {${placeholder}}; use {terms} or {privacy}.`);
        } else if (!safeNoticeHref(target)) {
            problems.push(`${whole} links to "${target}"; a link goes to a path on the site (/p/terms), an https: address or a mailto: address.`);
        }
    }
    const rest = text.replace(TOKEN, '');
    if (/\]\(|\{(terms|privacy)(?!\})/.test(rest)) {
        problems.push('has a link or placeholder that is not closed; write a link as [words](/path) and a placeholder as {terms}.');
    }
    return problems;
}
