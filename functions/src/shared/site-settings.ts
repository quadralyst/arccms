import { db } from '../init.js';
import { arcHostingOrigin, arcHostingSite } from '../arc-config.js';
import { clearSiteFilesCache, getSiteFile } from './site-files.js';
import { DEFAULT_MAX_IMAGE_SIZE } from './image-sizes.js';

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
    /** The longest side of the largest image size (Settings, Misc); image size bindings fit to it. */
    mediaMaxSize: number;
}

/**
 * Site identity from Settings/about. The first three fields predate the
 * discoverability work; the rest feed the Organization node every public page
 * carries (specs/discoverability-spec.md, D-D4). Mirrors IAboutSettings in
 * src/app/pages/admin/(settings)/about/about-settings.model.ts.
 */
export interface AboutConfig {
    name: string;
    finalUrl: string;
    address: string;
    /** Absolute URL of a square-ish logo (Organization.logo). */
    logoUrl: string;
    /** One or two sentences on what the site or organisation is. */
    description: string;
    /** Profile URLs that are the same entity: social accounts, Wikipedia, Crunchbase, GitHub. */
    sameAs: string[];
    /** Public contact address; leave empty to publish none. */
    contactEmail: string;
    /** Public phone, as typed; printed by data-arc-site="phone" and published as telephone (SS3). */
    phone: string;
    /** A personal site publishes as a Person rather than an Organization. */
    organizationType: 'Organization' | 'Person';
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

let siteConfigCache: { data: SiteConfig; timestamp: number } | null = null;
let aboutConfigCache: { data: AboutConfig; timestamp: number } | null = null;
let miscSettingsCache: { data: MiscSettings; timestamp: number } | null = null;
let localizationCache: { data: LocalizationSettings; timestamp: number } | null = null;

function isCacheValid(cache: { timestamp: number } | null): boolean {
    if (!cache) return false;
    return Date.now() - cache.timestamp < CACHE_TTL_MS;
}

/**
 * The site header and footer: the live site's /_site/header.html and
 * /_site/footer.html, the same files the app renders (src/custom/site/ over
 * public/_site/, scripts/arc-site.mjs). Empty strings when the live site has
 * none (hosting off, or not yet deployed with /_site/).
 *
 * Not cached here: getSiteFile keeps each file until a deploy changes it.
 */
export async function getPartials(): Promise<Partials> {
    const [header, footer] = await Promise.all([getSiteFile('header.html'), getSiteFile('footer.html')]);
    return { headerHtml: (header ?? '').trim(), footerHtml: (footer ?? '').trim() };
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
        logoUrl: data?.logoUrl || '',
        description: data?.description || '',
        sameAs: Array.isArray(data?.sameAs) ? data.sameAs.filter((u: unknown) => typeof u === 'string') : [],
        contactEmail: data?.contactEmail || '',
        phone: typeof data?.phone === 'string' ? data.phone : '',
        organizationType: data?.organizationType === 'Person' ? 'Person' : 'Organization',
    };

    aboutConfigCache = { data: about, timestamp: Date.now() };
    return about;
}

/**
 * Reads site configuration, merging Settings/about and Settings/site.
 *
 * Priority chain:
 *  - siteName: Settings/about.name → Settings/site.siteName → ''
 *  - baseUrl:  Settings/about.finalUrl → Settings/site.baseUrl → https://{hosting site}.web.app
 *  - cssUrls:  Settings/site.cssUrls → Bootstrap, Font Awesome, main.css
 *              (a published page links them through pageStylesheets in site-files.ts)
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

    // Fallback: the hosting site's own origin if still empty
    if (!baseUrl && arcHostingSite()) {
        baseUrl = arcHostingOrigin();
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
        mediaMaxSize: Number(data?.mediaMaxSize) || DEFAULT_MAX_IMAGE_SIZE,
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

/**
 * Static UI strings for a language, used by `data-arc-t` in templates and
 * partials: the live site's /_site/strings/{lang}.json (the app's
 * src/custom/site/strings/ merged over public/_site/strings/). They ship with the
 * templates and must exist at publish time (decision M-D18).
 *
 * The default language has no file: its text is the English authored into the
 * templates, which doubles as the fallback for any missing key.
 *
 * Not cached here, like the partials.
 */
export async function getUiStrings(lang: string): Promise<Record<string, string>> {
    if (!lang) return {};

    let strings: Record<string, string> = {};

    {
        try {
            const text = await getSiteFile(`strings/${lang}.json`);
            if (text) {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    strings = parsed as Record<string, string>;
                }
            }
        } catch (error) {
            // A missing or malformed file leaves the authored English in place,
            // which is the designed fallback — never fail a publish over it.
            console.warn(`Could not load UI strings for "${lang}":`, error);
        }
    }

    return strings;
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
    siteConfigCache = null;
    aboutConfigCache = null;
    miscSettingsCache = null;
    localizationCache = null;
    clearSiteFilesCache();
}
