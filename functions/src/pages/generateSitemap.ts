import { db } from '../init.js';
import { getSiteConfig, getLocalizationSettings } from '../shared/site-settings.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { deploySeoFileToHosting } from './deploySeoFile.js';
import { HostingBatch } from './deployToHosting.js';
import { detailUrl, listUrl } from '../shared/content-translation.js';

/** Known static pages to include in the sitemap. */
const STATIC_PAGES = ['privacy-policy', 'cookie-policy'];

/**
 * Escapes special XML characters in a string.
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Converts a Firestore Timestamp or date value to an ISO 8601 date string (YYYY-MM-DD).
 */
function toIsoDate(date: any): string {
    if (!date) return new Date().toISOString().split('T')[0];
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    if (isNaN(dateObj.getTime())) return new Date().toISOString().split('T')[0];
    return dateObj.toISOString().split('T')[0];
}

/**
 * Generates and deploys a sitemap.xml file to Firebase Hosting.
 *
 * Includes:
 *  - Home page (priority 1.0)
 *  - Content list pages for each content type (priority 0.6)
 *  - Individual published content pages (priority 0.8)
 *  - Known static pages (priority 0.4)
 */
export async function generateAndDeploySitemap(batch?: HostingBatch): Promise<void> {
    const siteConfig = await getSiteConfig();
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');

    const urls: string[] = [];

    // 1. Home page
    urls.push(buildUrlEntry(baseUrl, new Date().toISOString().split('T')[0], 'daily', '1.0'));

    // 2. Read all ContentTypes with public URLs
    const contentTypesSnap = await db.collection('ContentTypes').get();
    const contentTypes = contentTypesSnap.empty
        ? []
        : contentTypesSnap.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter((ct: any) => ct.slug && ct.hasPublicUrl !== false) as Array<{
              id: string;
              slug: string;
              name: string;
              [key: string]: any;
          }>;

    // 3. For each content type: add list page + individual content pages,
    //    one entry per language the page exists in.
    const localization = await getLocalizationSettings();
    const defaultLang = localization.defaultLanguage;
    const languages = localization.enabledLanguages;

    for (const contentType of contentTypes) {
        const slug = contentType.slug;
        const collectionName = getPublishedCollectionName(slug);

        // List pages exist in every enabled language.
        const listAlternates = languages.map(lang => ({
            lang: lang.code,
            url: listUrl(baseUrl, lang.code, defaultLang, slug),
        }));
        for (const alternate of listAlternates) {
            urls.push(buildUrlEntry(alternate.url, toIsoDate(null), 'daily', '0.6', listAlternates));
        }

        // Individual content pages
        const contentsSnap = await db
            .collection(collectionName)
            .orderBy('publishedOn', 'desc')
            .get();

        for (const doc of contentsSnap.docs) {
            const data = doc.data();
            if (!data.urlSlug) continue;

            // A detail page exists in the default language plus every language
            // it has been translated into — mirroring what the deploy does.
            let translatedLangs: string[] = [];
            try {
                const translationsSnap = await doc.ref.collection('translations').get();
                translatedLangs = translationsSnap.docs.map(t => t.id);
            } catch (error) {
                console.error(`Could not read translations for sitemap entry ${collectionName}/${doc.id}:`, error);
            }

            const detailAlternates = languages
                .filter(lang => lang.code === defaultLang || translatedLangs.includes(lang.code))
                .map(lang => ({
                    lang: lang.code,
                    url: detailUrl(baseUrl, lang.code, defaultLang, slug, data.urlSlug),
                }));

            for (const alternate of detailAlternates) {
                urls.push(
                    buildUrlEntry(
                        alternate.url,
                        toIsoDate(data.publishedOn || data.modifiedAt),
                        'weekly',
                        '0.8',
                        detailAlternates,
                    ),
                );
            }
        }
    }

    // 4. Static pages
    for (const pageSlug of STATIC_PAGES) {
        urls.push(buildUrlEntry(`${baseUrl}/pages/${pageSlug}`, toIsoDate(null), 'monthly', '0.4'));
    }

    // 5. Build XML
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        // xhtml namespace is required for the <xhtml:link> hreflang alternates
        // emitted by buildUrlEntry on multilingual pages.
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...urls,
        '</urlset>',
        '',
    ].join('\n');

    // 6. Deploy
    await deploySeoFileToHosting('/sitemap.xml', xml, batch);
}

function buildUrlEntry(
    loc: string,
    lastmod: string,
    changefreq: string,
    priority: string,
    alternates: { lang: string; url: string }[] = [],
): string {
    // Each language variant is listed inside every variant's <url> entry, per
    // the sitemap hreflang spec — search engines expect the set to be complete
    // and reciprocal. Omitted entirely for single-language pages.
    const alternateLinks = alternates.length > 1
        ? alternates.map(alt =>
            `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.lang)}" href="${escapeXml(alt.url)}"/>`)
        : [];

    return [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        ...alternateLinks,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
    ].join('\n');
}
