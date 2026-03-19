import { db } from '../init.js';
import { getSiteConfig } from '../shared/site-settings.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { deploySeoFileToHosting } from './deploySeoFile.js';

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
export async function generateAndDeploySitemap(): Promise<void> {
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

    // 3. For each content type: add list page + individual content pages
    for (const contentType of contentTypes) {
        const slug = contentType.slug;
        const collectionName = getPublishedCollectionName(slug);

        // List page
        urls.push(buildUrlEntry(`${baseUrl}/${slug}`, toIsoDate(null), 'daily', '0.6'));

        // Individual content pages
        const contentsSnap = await db
            .collection(collectionName)
            .orderBy('publishedOn', 'desc')
            .get();

        for (const doc of contentsSnap.docs) {
            const data = doc.data();
            if (data.urlSlug) {
                urls.push(
                    buildUrlEntry(
                        `${baseUrl}/${slug}/${data.urlSlug}`,
                        toIsoDate(data.publishedOn || data.modifiedAt),
                        'weekly',
                        '0.8',
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
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
        '',
    ].join('\n');

    // 6. Deploy
    await deploySeoFileToHosting('/sitemap.xml', xml);
}

function buildUrlEntry(
    loc: string,
    lastmod: string,
    changefreq: string,
    priority: string,
): string {
    return [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
    ].join('\n');
}
