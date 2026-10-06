/**
 * Languages an app shows its members (specs/app-member-language-spec.md, L-D1, L-D2, L-D6).
 * Plain TypeScript with no imports, so scripts and tests can read it too.
 *
 * The admin keeps Arc CMS's own languages (ADMIN_LANGUAGES); members get English plus
 * what the app declares in src/custom/languages.ts, with the translations in
 * src/custom/i18n/<code>.json.
 */

export interface MemberLanguage {
    /** A short language code, also the name of src/custom/i18n/<code>.json: `de`, `pt-BR`. */
    code: string;
    /** Its name in itself: `Deutsch`. */
    label: string;
    /** The locale dates and numbers follow: `de-CH`. */
    locale: string;
    /** Angular's data for that locale: `() => import('@angular/common/locales/de-CH')`. Not needed for English. */
    localeData?: () => Promise<{ default: unknown }>;
    /** Still being translated: the parity test lists missing keys as a warning, not a failure. */
    partial?: boolean;
}

export const DEFAULT_MEMBER_LANGUAGE = 'en';
/** The member's choice on this device, kept before sign-in so a shared device shows it on the sign-in screen. */
export const MEMBER_LANGUAGE_CACHE_KEY = 'arc-member-lang';

export const ENGLISH: MemberLanguage = { code: 'en', label: 'English', locale: 'en-US' };

const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A declared list that cannot be used. The message says what to change. */
export class MemberLanguageError extends Error {
    constructor(problems: readonly string[]) {
        super(`src/custom/languages.ts:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        this.name = 'MemberLanguageError';
    }
}

/**
 * The member languages: English first (its label or locale may be changed by declaring
 * `en`), then the app's, in its order. Throws on a bad code, a missing label or locale,
 * or a code given twice.
 */
export function resolveMemberLanguages(declared: readonly MemberLanguage[] | undefined): MemberLanguage[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const language of declared ?? []) {
        const code = language?.code ?? '';
        if (!CODE.test(code)) problems.push(`"${code}" is not a language code, such as de or pt-BR.`);
        if (!language?.label?.trim()) problems.push(`${code}: give it a label, its name in itself (Deutsch).`);
        if (!language?.locale?.trim()) problems.push(`${code}: give it a locale for dates and numbers (de-CH).`);
        if (seen.has(code)) problems.push(`${code} is declared twice.`);
        seen.add(code);
    }
    if (problems.length) throw new MemberLanguageError(problems);
    const english = (declared ?? []).find((l) => l.code === 'en');
    return [english ? { ...ENGLISH, ...english } : ENGLISH, ...(declared ?? []).filter((l) => l.code !== 'en')];
}

/** The first browser language the app has (exact, then the part before `-`), else English. */
export function firstVisitLanguage(browser: readonly string[] | undefined, codes: readonly string[]): string {
    const lower = codes.map((c) => c.toLowerCase());
    for (const wanted of browser ?? []) {
        const exact = lower.indexOf(wanted.toLowerCase());
        if (exact >= 0) return codes[exact];
        const base = lower.indexOf(wanted.split('-')[0].toLowerCase());
        if (base >= 0) return codes[base];
    }
    return DEFAULT_MEMBER_LANGUAGE;
}

/** The language to show: a saved choice the app still has, else the first-visit rule. */
export function chooseMemberLanguage(saved: string | null | undefined, browser: readonly string[] | undefined, codes: readonly string[]): string {
    return saved && codes.includes(saved) ? saved : firstVisitLanguage(browser, codes);
}

/** Whether an address is in the admin area, which keeps the admin's own language (L-D3). */
export function isAdminUrl(url: string): boolean {
    const path = url.split(/[?#]/)[0];
    return path === '/admin' || path.startsWith('/admin/');
}
