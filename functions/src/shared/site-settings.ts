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

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let partialsCache: { data: Partials; timestamp: number } | null = null;
let siteConfigCache: { data: SiteConfig; timestamp: number } | null = null;
let aboutConfigCache: { data: AboutConfig; timestamp: number } | null = null;
let miscSettingsCache: { data: MiscSettings; timestamp: number } | null = null;

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
 * Clears the in-memory cache. Call before operations
 * that need guaranteed fresh data (e.g., seed function).
 */
export function clearSettingsCache(): void {
    partialsCache = null;
    siteConfigCache = null;
    aboutConfigCache = null;
    miscSettingsCache = null;
}
