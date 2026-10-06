/**
 * Which core translation keys members see (specs/app-member-language-spec.md, L-D8):
 * the ones an app adding a language must translate. Plain TypeScript with no imports,
 * so `npm run i18n:member` reads it too.
 *
 * Existing groups keep their names (apps may already reword them): `user.*` is the
 * member area, `common.pwa.*` the install and update prompts, `common.feedback.*` the
 * feedback panel, `common.version.*` the reload message. `member.*` holds the member
 * screens' text that had none before. A test scans MEMBER_SCREEN_FILES and fails on a key
 * they use that this list does not cover, so a member screen cannot slip out of it.
 */

export const MEMBER_KEY_PREFIXES = ['member.', 'user.', 'common.pwa.', 'common.feedback.', 'common.version.'] as const;

/** Single shared keys member screens use. */
export const MEMBER_KEYS = ['common.actions.cancel', 'common.actions.close'] as const;

/** The files that make up member screens (and the templates they name). */
export const MEMBER_SCREEN_FILES = [
    'src/app/pages/user/user-shell.component.ts',
    'src/app/pages/user/(dashboard)/dashboard.page.ts',
    'src/app/pages/user/profile/user-profile.page.ts',
    'src/app/pages/user/premium/premium.page.ts',
    'src/app/pages/user/payments/payments.page.ts',
    'src/app/pages/account/account.page.ts',
    'src/shared/components/install-prompt/install-prompt.component.ts',
    'src/shared/components/install-prompt/update-bar.component.ts',
    'src/shared/components/feedback/feedback.component.ts',
    'src/app/core/version/stale-code-bar.component.ts',
    // Sign-in, sign-up, forgot password and verification; profile and its sign-in methods (A1b)
    'src/app/pages/(auth)/(signup)/signup.page.ts',
    'src/app/pages/(auth)/(profile)/profile.page.ts',
    'src/app/pages/(auth)/(profile)/sign-in-methods.component.ts',
    'src/app/pages/(auth)/auth.store.ts',
    'src/app/pages/(auth)/auth-messages.ts',
    'src/app/pages/(auth)/sign-in.service.ts',
    'src/shared/constants/common-constants.ts',
    // Not-found and no-access pages, the cookie banner (A1c)
    'src/app/pages/not-found.page.ts',
    'src/app/pages/admin/unauthorized.page.ts',
    'src/app/pages/page.parts/site-usage-banner.component.ts',
    // The language picker on the sign-in page
    'src/shared/components/member-language-picker/member-language-picker.component.ts',
] as const;

export function isMemberKey(key: string): boolean {
    return MEMBER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) || (MEMBER_KEYS as readonly string[]).includes(key);
}

/** Every leaf key of a translation file, dotted. `_conventions` is documentation. */
export function flattenKeys(node: unknown, prefix = ''): string[] {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return prefix ? [prefix] : [];
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return path.startsWith('_conventions') ? [] : flattenKeys(value, path);
    });
}

/**
 * What a language still lacks (L-D10): every member-facing core key, and every key in the
 * app's own English file, that is in none of the language's files.
 */
export function missingMemberKeys(input: { coreEnglish: unknown; customEnglish: unknown; translations: readonly unknown[] }): string[] {
    const required = new Set([...flattenKeys(input.coreEnglish).filter(isMemberKey), ...flattenKeys(input.customEnglish)]);
    const have = new Set(input.translations.flatMap((t) => flattenKeys(t)));
    return [...required].filter((key) => !have.has(key)).sort();
}

/** One declared language's state for the parity test and `npm run i18n:member`. */
export interface LanguageParity {
    code: string;
    partial: boolean;
    missing: string[];
}

/**
 * Parity for each declared language (L-D10): `core` and `custom` map a language code to
 * its parsed file (core: src/assets/i18n, the app's: src/custom/i18n).
 */
export function languageParity(
    languages: readonly { code: string; partial?: boolean }[],
    core: Record<string, unknown>,
    custom: Record<string, unknown>,
): LanguageParity[] {
    return languages.filter((l) => l.code !== 'en').map((l) => ({
        code: l.code,
        partial: !!l.partial,
        missing: missingMemberKeys({
            coreEnglish: core['en'],
            customEnglish: custom['en'] ?? {},
            translations: [core[l.code], custom[l.code]].filter((t) => t !== undefined),
        }),
    }));
}
