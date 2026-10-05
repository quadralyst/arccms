/**
 * The site's own details on its pages (specs/site-sections-spec.md, SS3):
 * `data-arc-site="phone"` and friends print what Settings, About holds, so the
 * contact details are typed once in the admin, not into every template.
 *
 * Pure data: which values exist, the links they make and the social links read
 * from the profile URLs. Two appliers use it, both written to give the same
 * output: TemplateHydrationService.applySiteInfo on an HTML string (the app and
 * publishing, each with its own copy) and applySiteInfoToElement on live DOM
 * (the app's header and footer).
 *
 * Source of truth; functions/src/shared/site-info.ts is a mirror for the Cloud
 * Functions build, which cannot import from src/. site-info.spec.ts checks
 * that every copy agrees.
 */

/** What Settings, About holds that a page can print. */
export interface SiteInfoSource {
    name?: string;
    description?: string;
    contactEmail?: string;
    phone?: string;
    address?: string;
    logoUrl?: string;
    sameAs?: string[];
    /** The year a copyright line prints; this year when missing. */
    year?: string | number;
    /** The published standard pages, in their order, for the footer (SS6). */
    pages?: SitePageLink[];
}

/** One published standard page: its title in the page's language and its address. */
export interface SitePageLink {
    title: string;
    url: string;
}

/** The values `data-arc-site` and `data-arc-site-if` accept; `social` is for -if and -loop. */
export const SITE_INFO_KEYS = ['name', 'description', 'email', 'phone', 'address', 'logo', 'year', 'social', 'pages', 'contact'] as const;
export type SiteInfoKey = (typeof SITE_INFO_KEYS)[number];

export interface SocialLink {
    url: string;
    /** A short id: `instagram`, `x`, `linkedin`; `link` for a site it does not know. */
    platform: string;
    /** The name to show: `Instagram`; the host name for an unknown site. */
    label: string;
    /** Font Awesome classes for the platform's icon. */
    icon: string;
}

/** Known sites, by host (and its subdomains). */
const PLATFORMS: { hosts: string[]; platform: string; label: string; icon: string }[] = [
    { hosts: ['facebook.com', 'fb.com'], platform: 'facebook', label: 'Facebook', icon: 'fa-brands fa-facebook' },
    { hosts: ['instagram.com'], platform: 'instagram', label: 'Instagram', icon: 'fa-brands fa-instagram' },
    { hosts: ['x.com', 'twitter.com'], platform: 'x', label: 'X', icon: 'fa-brands fa-x-twitter' },
    { hosts: ['linkedin.com'], platform: 'linkedin', label: 'LinkedIn', icon: 'fa-brands fa-linkedin' },
    { hosts: ['youtube.com', 'youtu.be'], platform: 'youtube', label: 'YouTube', icon: 'fa-brands fa-youtube' },
    { hosts: ['github.com'], platform: 'github', label: 'GitHub', icon: 'fa-brands fa-github' },
    { hosts: ['tiktok.com'], platform: 'tiktok', label: 'TikTok', icon: 'fa-brands fa-tiktok' },
    { hosts: ['pinterest.com'], platform: 'pinterest', label: 'Pinterest', icon: 'fa-brands fa-pinterest' },
    { hosts: ['threads.net', 'threads.com'], platform: 'threads', label: 'Threads', icon: 'fa-brands fa-threads' },
    { hosts: ['wa.me', 'whatsapp.com'], platform: 'whatsapp', label: 'WhatsApp', icon: 'fa-brands fa-whatsapp' },
    { hosts: ['t.me', 'telegram.me'], platform: 'telegram', label: 'Telegram', icon: 'fa-brands fa-telegram' },
    { hosts: ['medium.com'], platform: 'medium', label: 'Medium', icon: 'fa-brands fa-medium' },
];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The profile URLs as social links, in the order they were typed; anything not http(s) is left out. */
export function socialLinks(urls: readonly unknown[] | undefined): SocialLink[] {
    const links: SocialLink[] = [];
    for (const raw of urls || []) {
        const url = text(raw);
        let host: string;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
            host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        } catch {
            continue;
        }
        const known = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
        links.push(known
            ? { url, platform: known.platform, label: known.label, icon: known.icon }
            : { url, platform: 'link', label: host, icon: 'fa-solid fa-link' });
    }
    return links;
}

/** The text a key prints; '' when the site has none. `social` is never printed as text. */
export function siteInfoValue(source: SiteInfoSource | null | undefined, key: string): string {
    switch (key) {
        case 'name': return text(source?.name);
        case 'description': return text(source?.description);
        case 'email': return text(source?.contactEmail);
        case 'phone': return text(source?.phone);
        case 'address': return text(source?.address);
        case 'logo': return text(source?.logoUrl);
        case 'year': return String(source?.year || new Date().getFullYear());
        default: return '';
    }
}

/**
 * Whether the site has this value; `social` and `pages` have one when their list
 * is not empty, and `contact` when the site has any way to reach it (an email,
 * phone, address or social link), for a "How to reach us" block.
 */
export function hasSiteInfo(source: SiteInfoSource | null | undefined, key: string): boolean {
    if (key === 'contact') return ['email', 'phone', 'address', 'social'].some((k) => hasSiteInfo(source, k));
    if (key === 'social') return socialLinks(source?.sameAs).length > 0;
    if (key === 'pages') return sitePages(source).length > 0;
    return siteInfoValue(source, key) !== '';
}

/** The standard pages to list, without any missing a title or an address. */
export function sitePages(source: SiteInfoSource | null | undefined): SitePageLink[] {
    return (source?.pages || []).filter((page) => text(page?.title) && text(page?.url));
}

/** A loop's rows: one per social link (`social`) or published standard page (`pages`); none for any other name. */
export function siteLoopRows(rowHtml: string, name: string | null | undefined, source: SiteInfoSource | null | undefined): string {
    if (name === 'social') return socialLinks(source?.sameAs).map((link) => fillSocialRow(rowHtml, link)).join('');
    if (name === 'pages') {
        return sitePages(source).map((page) => rowHtml.replace(/\{\{\s*(url|title)\s*\}\}/g,
            (_match, key: 'url' | 'title') => escapeSiteInfo(text(page[key])))).join('');
    }
    return '';
}

/** `tel:` link for a phone number as typed: digits and a leading +; '' without digits. */
export function telHref(phone: string): string {
    const trimmed = text(phone);
    const digits = trimmed.replace(/\D/g, '');
    return digits ? `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}` : '';
}

/** `mailto:` link for an email address; '' for none. */
export function mailHref(email: string): string {
    const trimmed = text(email);
    return trimmed ? `mailto:${trimmed}` : '';
}

/** Escapes a value for HTML text or a quoted attribute. */
export function escapeSiteInfo(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One social link's copy of a loop row: `{{ url }}`, `{{ platform }}`, `{{ label }}`, `{{ icon }}` filled, escaped. */
export function fillSocialRow(rowHtml: string, link: SocialLink): string {
    return rowHtml.replace(/\{\{\s*(url|platform|label|icon)\s*\}\}/g, (_match, key: keyof SocialLink) => escapeSiteInfo(link[key]));
}

/** The address as HTML: escaped, its line breaks kept. */
export function addressHtml(address: string): string {
    return text(address).split(/\r?\n/).map((line) => escapeSiteInfo(line.trim())).filter(Boolean).join('<br>');
}
