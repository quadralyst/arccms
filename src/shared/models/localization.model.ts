/**
 * Localization Settings Model
 *
 * Backs the `Settings/localization` document — the single registry of which
 * languages this site publishes in. Everything downstream (the editor's
 * translation tabs, the per-language publish loop, the public language
 * switcher) reads its language list from here.
 *
 * Spec: docs/multilingual-spec.md — Phase M1, decision M-D3.
 */

/** A language the site can publish in. `code` is a BCP-47 primary subtag. */
export interface ILanguage {
    /** BCP-47 primary subtag, e.g. 'en', 'hi', 'fr'. Doubles as the URL prefix. */
    code: string;
    /** English name, e.g. 'Hindi'. Used in admin UI. */
    label: string;
    /** Endonym, e.g. 'हिन्दी'. Used in the public language switcher. */
    nativeLabel: string;
    /** Right-to-left script. Drives `dir="rtl"` on published pages. */
    rtl?: boolean;
}

export interface ILocalizationSettings {
    /** Code of the language stored in the base content document. */
    defaultLanguage: string;
    /** Every language the site publishes, including the default. */
    enabledLanguages: ILanguage[];
}

export const DEFAULT_LANGUAGE_CODE = 'en';

export const ENGLISH: ILanguage = {
    code: DEFAULT_LANGUAGE_CODE,
    label: 'English',
    nativeLabel: 'English',
};

export const DEFAULT_LOCALIZATION_SETTINGS: ILocalizationSettings = {
    defaultLanguage: DEFAULT_LANGUAGE_CODE,
    enabledLanguages: [ENGLISH],
};

/**
 * Coerces whatever is in Firestore into settings that are safe to render and
 * publish from. The document is admin-editable and may predate any field we
 * add later, so every consumer normalizes rather than trusting the raw shape.
 *
 * Guarantees: at least one enabled language; no duplicate codes; the default
 * language is always present in `enabledLanguages` and always listed first.
 */
export function normalizeLocalizationSettings(raw: unknown): ILocalizationSettings {
    const data = (raw ?? {}) as Partial<ILocalizationSettings>;

    const seen = new Set<string>();
    const languages: ILanguage[] = [];
    for (const entry of Array.isArray(data.enabledLanguages) ? data.enabledLanguages : []) {
        const code = typeof entry?.code === 'string' ? entry.code.trim().toLowerCase() : '';
        if (!code || seen.has(code)) continue;
        seen.add(code);
        languages.push({
            code,
            label: entry.label?.trim() || code,
            nativeLabel: entry.nativeLabel?.trim() || entry.label?.trim() || code,
            ...(entry.rtl ? { rtl: true } : {}),
        });
    }

    const requestedDefault =
        typeof data.defaultLanguage === 'string' ? data.defaultLanguage.trim().toLowerCase() : '';

    // Only an *absent* default is inferred, from the first enabled language.
    // A stored default missing from the list is honoured and re-added instead:
    // it says which language the base content is written in, so silently
    // switching it would mislabel every existing document.
    const defaultLanguage = requestedDefault || languages[0]?.code || DEFAULT_LANGUAGE_CODE;
    if (!seen.has(defaultLanguage)) {
        languages.unshift(
            defaultLanguage === DEFAULT_LANGUAGE_CODE
                ? { ...ENGLISH }
                : { code: defaultLanguage, label: defaultLanguage, nativeLabel: defaultLanguage },
        );
    }

    // Default first, remaining languages in their configured order.
    const ordered = [
        languages.find((l) => l.code === defaultLanguage)!,
        ...languages.filter((l) => l.code !== defaultLanguage),
    ];

    return { defaultLanguage, enabledLanguages: ordered };
}

/** Languages other than the default — i.e. the ones that need translations. */
export function extraLanguages(settings: ILocalizationSettings): ILanguage[] {
    return settings.enabledLanguages.filter((l) => l.code !== settings.defaultLanguage);
}

export function isLanguageEnabled(settings: ILocalizationSettings, code: string): boolean {
    return settings.enabledLanguages.some((l) => l.code === code);
}

export function findLanguage(settings: ILocalizationSettings, code: string): ILanguage | undefined {
    return settings.enabledLanguages.find((l) => l.code === code);
}

/** True when the site publishes more than one language. */
export function isMultilingual(settings: ILocalizationSettings): boolean {
    return settings.enabledLanguages.length > 1;
}

/**
 * URL prefix for a language: '' for the default language (its URLs are
 * unchanged — decision M-D2), '/{code}' for every other language.
 */
export function languagePathPrefix(settings: ILocalizationSettings, code: string): string {
    return code && code !== settings.defaultLanguage ? `/${code}` : '';
}
