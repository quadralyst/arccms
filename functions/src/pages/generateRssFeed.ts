import { db } from '../init.js';
import { getSiteConfig } from '../shared/site-settings.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { deploySeoFileToHosting } from './deploySeoFile.js';

/** Maximum number of items per RSS feed. */
const RSS_ITEM_LIMIT = 20;

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
 * Converts a Firestore Timestamp or date value to an RFC 822 date string.
 * (Required format for RSS <pubDate>.)
 */
function toRfc822(date: any): string {
    if (!date) return new Date().toUTCString();
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    if (isNaN(dateObj.getTime())) return new Date().toUTCString();
    return dateObj.toUTCString();
}

/**
 * Generates a plain-text excerpt from HTML content.
 * Strips tags, collapses whitespace, and caps at 200 characters.
 */
function getExcerpt(content: Record<string, any>): string {
    const text = content.metaDescription || content.summary || content.content || '';
    const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanText.length <= 200) return cleanText;
    return cleanText.substring(0, 197) + '...';
}

/**
 * Generates and deploys per-content-type RSS 2.0 feeds to Firebase Hosting.
 *
 * Deploys one feed per content type at `/{slug}/feed.xml`.
 * Each feed contains the 20 most recent published items.
 */
export async function generateAndDeployRssFeeds(): Promise<void> {
    const siteConfig = await getSiteConfig();
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
    const siteName = siteConfig.siteName || 'Arc CMS';

    // Read all ContentTypes with public URLs
    const contentTypesSnap = await db.collection('ContentTypes').get();
    const contentTypes = contentTypesSnap.empty
        ? []
        : contentTypesSnap.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter((ct: any) => ct.slug && ct.hasPublicUrl !== false) as Array<{
              id: string;
              slug: string;
              name: string;
              description?: string;
              [key: string]: any;
          }>;

    // Generate per-type RSS feeds
    for (const contentType of contentTypes) {
        const slug = contentType.slug;
        const collectionName = getPublishedCollectionName(slug);

        const contentsSnap = await db
            .collection(collectionName)
            .orderBy('publishedOn', 'desc')
            .limit(RSS_ITEM_LIMIT)
            .get();

        const items = contentsSnap.docs.map(doc => doc.data());

        const feedUrl = `${baseUrl}/${slug}/feed.xml`;
        const channelLink = `${baseUrl}/${slug}`;
        const channelTitle = `${siteName} - ${contentType.name}`;
        const channelDescription = contentType.description || `Latest ${contentType.name?.toLowerCase() || 'content'}`;
        const lastBuildDate = items.length > 0 ? toRfc822(items[0].publishedOn) : toRfc822(null);

        const rssItems = items
            .filter((item: any) => item.urlSlug)
            .map((item: any) => {
                const itemUrl = `${baseUrl}/${slug}/${item.urlSlug}`;
                return [
                    '    <item>',
                    `      <title>${escapeXml(item.title || '')}</title>`,
                    `      <link>${escapeXml(itemUrl)}</link>`,
                    `      <guid isPermaLink="true">${escapeXml(itemUrl)}</guid>`,
                    `      <pubDate>${toRfc822(item.publishedOn)}</pubDate>`,
                    `      <description>${escapeXml(getExcerpt(item))}</description>`,
                    '    </item>',
                ].join('\n');
            })
            .join('\n');

        const rssXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
            '  <channel>',
            `    <title>${escapeXml(channelTitle)}</title>`,
            `    <link>${escapeXml(channelLink)}</link>`,
            `    <description>${escapeXml(channelDescription)}</description>`,
            `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
            `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
            `    <generator>Arc CMS</generator>`,
            rssItems,
            '  </channel>',
            '</rss>',
            '',
        ].join('\n');

        await deploySeoFileToHosting(`/${slug}/feed.xml`, rssXml);
    }
}
