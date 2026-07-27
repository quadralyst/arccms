import { db } from '../init.js';

export interface Partials {
    headerHtml: string;
    footerHtml: string;
}

export interface SiteConfig {
    siteName: string;
    baseUrl: string;
    cssUrls: string[];
}

export interface MiscSettings {
    showPoweredBy: boolean;
}

export interface AboutConfig {
    name: string;
    finalUrl: string;
    address: string;
}

/**
 * A language this site publishes in. `code` is a BCP-47 primary subtag and
 * doubles as the URL prefix for non-default languages.
 * Mirrors `ILanguage` in src/shared/models/localization.model.ts.
 */
export interface Language {
    code: string;
    label: string;
    nativeLabel: string;
    rtl?: boolean;
}

export interface LocalizationSettings {
    defaultLanguage: string;
    enabledLanguages: Language[];
}

const DEFAULT_LANGUAGE_CODE = 'en';

const DEFAULT_LOCALIZATION: LocalizationSettings = {
    defaultLanguage: DEFAULT_LANGUAGE_CODE,
    enabledLanguages: [{ code: DEFAULT_LANGUAGE_CODE, label: 'English', nativeLabel: 'English' }],
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let partialsCache: { data: Partials; timestamp: number } | null = null;
let siteConfigCache: { data: SiteConfig; timestamp: number } | null = null;
let aboutConfigCache: { data: AboutConfig; timestamp: number } | null = null;
let miscSettingsCache: { data: MiscSettings; timestamp: number } | null = null;
let localizationCache: { data: LocalizationSettings; timestamp: number } | null = null;

function isCacheValid(cache: { timestamp: number } | null): boolean {
    if (!cache) return false;
    return Date.now() - cache.timestamp < CACHE_TTL_MS;
}

/**
 * Fetches a partial HTML file from the deployed hosting site.
 * Used as fallback when Firestore Settings/partials is empty.
 */
async function fetchPartialFromHosting(filename: string): Promise<string> {
    const projectId = process.env.GCLOUD_PROJECT || '';
    if (!projectId) return '';

    const url = `https://${projectId}.web.app/_partials/${filename}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return '';
        return (await response.text()).trim();
    } catch {
        return '';
    }
}

/**
 * Reads header and footer HTML.
 *
 * Priority:
 *  1. Firestore Settings/partials document (admin-configured overrides)
 *  2. Hosting fallback: /_partials/_header.html and /_partials/_footer.html
 *
 * Cached for 5 minutes per Cloud Function instance.
 */
export async function getPartials(): Promise<Partials> {
    if (isCacheValid(partialsCache)) {
        return partialsCache!.data;
    }

    const doc = await db.doc('Settings/partials').get();
    const data = doc.data();

    let headerHtml = data?.headerHtml || '';
    let footerHtml = data?.footerHtml || '';

    // Fallback: fetch from hosting if Firestore is empty
    if (!headerHtml || !footerHtml) {
        const [hostingHeader, hostingFooter] = await Promise.all([
            !headerHtml ? fetchPartialFromHosting('_header.html') : Promise.resolve(headerHtml),
            !footerHtml ? fetchPartialFromHosting('_footer.html') : Promise.resolve(footerHtml),
        ]);
        headerHtml = headerHtml || hostingHeader;
        footerHtml = footerHtml || hostingFooter;
    }

    const partials: Partials = { headerHtml, footerHtml };

    partialsCache = { data: partials, timestamp: Date.now() };
    return partials;
}

/**
 * Reads about/branding configuration from Settings/about.
 * Contains the site name, production URL, and address for email footers.
 * Cached for 5 minutes per Cloud Function instance.
 */
export async function getAboutConfig(): Promise<AboutConfig> {
    if (isCacheValid(aboutConfigCache)) {
        return aboutConfigCache!.data;
    }

    const doc = await db.doc('Settings/about').get();
    const data = doc.data();

    const about: AboutConfig = {
        name: data?.name || '',
        finalUrl: data?.finalUrl || '',
        address: data?.address || '',
    };

    aboutConfigCache = { data: about, timestamp: Date.now() };
    return about;
}

/**
 * Reads site configuration, merging Settings/about and Settings/site.
 *
 * Priority chain:
 *  - siteName: Settings/about.name → Settings/site.siteName → ''
 *  - baseUrl:  Settings/about.finalUrl → Settings/site.baseUrl → https://{GCLOUD_PROJECT}.web.app
 *  - cssUrls:  Settings/site.cssUrls → ['/assets/css/main.css']
 *
 * Cached for 5 minutes per Cloud Function instance.
 */
export async function getSiteConfig(): Promise<SiteConfig> {
    if (isCacheValid(siteConfigCache)) {
        return siteConfigCache!.data;
    }

    // Read both Settings/about and Settings/site
    const [aboutConfig, siteDoc] = await Promise.all([
        getAboutConfig(),
        db.doc('Settings/site').get(),
    ]);
    const siteData = siteDoc.data();

    // Merge: About values take priority over Site values
    let siteName = aboutConfig.name || siteData?.siteName || '';
    let baseUrl = aboutConfig.finalUrl || siteData?.baseUrl || '';

    // Fallback: derive baseUrl from project ID if still empty
    if (!baseUrl) {
        const projectId = process.env.GCLOUD_PROJECT || '';
        if (projectId) {
            baseUrl = `https://${projectId}.web.app`;
        }
    }

    const config: SiteConfig = {
        siteName,
        baseUrl,
        cssUrls: siteData?.cssUrls || [
            'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css',
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
            '/assets/css/main.css',
        ],
    };

    siteConfigCache = { data: config, timestamp: Date.now() };
    return config;
}

/**
 * Reads misc settings from Settings/misc.
 * Returns { showPoweredBy } — defaults to true if not set.
 * Cached for 5 minutes per Cloud Function instance.
 */
export async function getMiscSettings(): Promise<MiscSettings> {
    if (isCacheValid(miscSettingsCache)) {
        return miscSettingsCache!.data;
    }

    const snap = await db.doc('Settings/misc').get();
    const data = snap.data();

    const settings: MiscSettings = {
        showPoweredBy: data?.showPoweredBy ?? true,
    };

    miscSettingsCache = { data: settings, timestamp: Date.now() };
    return settings;
}

/**
 * Normalizes the raw `Settings/localization` document.
 *
 * Guarantees: at least one enabled language; no duplicate codes; the default
 * language is always present and always listed first. The publish pipeline
 * relies on these invariants, so an admin-mangled document degrades to a
 * single-language site rather than deploying broken URLs.
 *
 * Mirrors `normalizeLocalizationSettings` in
 * src/shared/models/localization.model.ts — keep the two in step.
 */
export function normalizeLocalization(raw: unknown): LocalizationSettings {
    const data = (raw ?? {}) as Partial<LocalizationSettings>;

    const seen = new Set<string>();
    const languages: Language[] = [];
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

    const requested =
        typeof data.defaultLanguage === 'string' ? data.defaultLanguage.trim().toLowerCase() : '';

    // Only an *absent* default is inferred, from the first enabled language.
    // A stored default missing from the list is honoured and re-added instead:
    // it says which language the base content is written in, so silently
    // switching it would mislabel every existing document.
    const defaultLanguage = requested || languages[0]?.code || DEFAULT_LANGUAGE_CODE;
    if (!seen.has(defaultLanguage)) {
        languages.unshift(
            defaultLanguage === DEFAULT_LANGUAGE_CODE
                ? { ...DEFAULT_LOCALIZATION.enabledLanguages[0] }
                : { code: defaultLanguage, label: defaultLanguage, nativeLabel: defaultLanguage },
        );
    }

    const ordered = [
        languages.find((l) => l.code === defaultLanguage)!,
        ...languages.filter((l) => l.code !== defaultLanguage),
    ];

    return { defaultLanguage, enabledLanguages: ordered };
}

/**
 * Reads the site's language registry from Settings/localization.
 * Falls back to a single-language (English) site when the doc is absent.
 * Cached for 5 minutes per Cloud Function instance.
 */
export async function getLocalizationSettings(): Promise<LocalizationSettings> {
    if (isCacheValid(localizationCache)) {
        return localizationCache!.data;
    }

    let settings: LocalizationSettings;
    try {
        const snap = await db.doc('Settings/localization').get();
        settings = normalizeLocalization(snap.exists ? snap.data() : null);
    } catch (error) {
        // Never let a settings read failure abort a publish — a single-language
        // deploy is the safe degradation.
        console.error('Error reading Settings/localization:', error);
        settings = DEFAULT_LOCALIZATION;
    }

    localizationCache = { data: settings, timestamp: Date.now() };
    return settings;
}

/** Languages other than the default — the ones that need translations. */
export function getExtraLanguages(settings: LocalizationSettings): Language[] {
    return settings.enabledLanguages.filter((l) => l.code !== settings.defaultLanguage);
}

/**
 * URL prefix for a language: '' for the default language (its URLs are
 * unchanged), '/{code}' for every other language.
 */
export function languagePathPrefix(settings: LocalizationSettings, code: string): string {
    return code && code !== settings.defaultLanguage ? `/${code}` : '';
}

/**
 * Clears the in-memory cache. Call before operations
 * that need guaranteed fresh data (e.g., seed function).
 */
export function clearSettingsCache(): void {
    partialsCache = null;
    siteConfigCache = null;
    aboutConfigCache = null;
    miscSettingsCache = null;
    localizationCache = null;
}
