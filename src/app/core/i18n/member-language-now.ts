/**
 * The member's language right now, for code that must not depend on Angular services
 * (it would close an import cycle through the auth store): read from the device, as
 * MemberLanguageService keeps it. Null when the app declares no member languages, so
 * callers change nothing then (specs/app-member-language-spec.md, L-D2, L-D13).
 */
import { MEMBER_LANGUAGES } from '../../../custom/languages';
import { MEMBER_LANGUAGE_CACHE_KEY, chooseMemberLanguage, resolveMemberLanguages } from './member-languages';

export function memberLanguageNow(): string | null {
    if (!MEMBER_LANGUAGES.length) return null;
    let saved: string | null = null;
    try {
        saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(MEMBER_LANGUAGE_CACHE_KEY);
    } catch {
        saved = null;
    }
    const browser = typeof navigator === 'undefined' ? [] : navigator.languages ?? [];
    return chooseMemberLanguage(saved, browser, resolveMemberLanguages(MEMBER_LANGUAGES).map((l) => l.code));
}

/**
 * The member's locale right now, for dates and numbers formatted in code
 * (`toLocaleString(memberLocaleNow())`): undefined when the app declares no member
 * languages, which keeps the browser's own, as before (L-D7).
 */
export function memberLocaleNow(): string | undefined {
    const code = memberLanguageNow();
    if (!code) return undefined;
    return resolveMemberLanguages(MEMBER_LANGUAGES).find((l) => l.code === code)?.locale;
}
