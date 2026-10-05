import { requireAdmin } from '../search/auth.js';
import { onCall } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { clearSettingsCache, getPartials, getSiteConfig } from '../shared/site-settings.js';
import { generateAndDeployContentDetailPage } from './deployContentPage.js';
import { generateAndDeployContentListPage } from './deployContentListPage.js';
import { generateAndDeployStaticPage, staticPageSlugs } from './deployStaticPage.js';
import { generateAndDeployHomePage } from './deployHomePage.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { generateAndDeployRobotsTxt } from './generateRobotsTxt.js';
import { generateAndDeployLlmsTxt } from './generateLlmsTxt.js';
import { generateAndDeploySitemap } from './generateSitemap.js';
import { generateAndDeployRssFeeds } from './generateRssFeed.js';

interface SeedResult {
    success: boolean;
    deployed: number;
    errors: number;
    details: string[];
    errorDetails: string[];
}

/**
 * Core seed logic — exported so it can be called directly from CLI scripts
 * (bypassing onCall auth) or from the onCall handler (with auth).
 */
export async function runSeed(): Promise<SeedResult> {
    // Clear settings cache to ensure fresh data
    clearSettingsCache();

    const result: SeedResult = {
        success: true,
        deployed: 0,
        errors: 0,
        details: [],
        errorDetails: [],
    };

    // 0. Validate required settings before deploying anything
    const [partials, siteConfig] = await Promise.all([getPartials(), getSiteConfig()]);

    if (!siteConfig.baseUrl) {
        result.success = false;
        result.details.push(
            'Missing required settings: baseUrl is empty. ' +
            'Please configure Settings/about (finalUrl) or Settings/site (baseUrl) before running seed.',
        );
        return result;
    }

    if (!partials.headerHtml) {
        result.success = false;
        result.details.push(
            'The live site has no header (/_site/header.html). ' +
            'Deploy the website before running seed.',
        );
        return result;
    }

    // 1. Read all ContentTypes
    const contentTypesSnap = await db.collection('ContentTypes').get();

    const contentTypes = contentTypesSnap.empty
        ? []
        : contentTypesSnap.docs.map(doc => ({
              id: doc.id,
              ...doc.data(),
          })) as Array<{ id: string; slug: string; name: string; [key: string]: any }>;

    if (contentTypes.length === 0) {
        result.details.push('No ContentTypes found — skipping content pages.');
    } else {
        result.details.push(`Found ${contentTypes.length} content type(s): ${contentTypes.map(ct => ct.slug).join(', ')}`);
    }

    // 2. For each ContentType, deploy all published content
    for (const contentType of contentTypes) {
        const slug = contentType.slug;
        if (!slug) {
            result.details.push(`Skipping ContentType ${contentType.id} — no slug`);
            continue;
        }

        if (contentType.hasPublicUrl === false) {
            result.details.push(`Skipping ${contentType.name} (${slug}) — no public URL`);
            continue;
        }

        const collectionName = getPublishedCollectionName(slug);
        const contentsSnap = await db.collection(collectionName)
            .orderBy('publishedOn', 'desc')
            .get();

        result.details.push(`\n--- ${contentType.name} (${slug}): ${contentsSnap.docs.length} published item(s) ---`);

        // Deploy each content detail page
        for (const doc of contentsSnap.docs) {
            const startTime = Date.now();
            try {
                await generateAndDeployContentDetailPage(slug, doc.id);
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                const urlSlug = doc.data()?.urlSlug || doc.id;
                result.details.push(`Deployed /${slug}/${urlSlug}.html (${duration}s)`);
                result.deployed++;
            } catch (err: any) {
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                result.errors++;
                result.success = false;
                const errorMsg = `Failed to deploy ${collectionName}/${doc.id} (${duration}s): ${err.message}`;
                result.details.push(`ERROR: ${errorMsg}`);
                result.errorDetails.push(errorMsg);
            }
        }

        // Deploy the list/index page for this content type
        const listStartTime = Date.now();
        try {
            await generateAndDeployContentListPage(slug);
            const duration = ((Date.now() - listStartTime) / 1000).toFixed(1);
            result.details.push(`Deployed /${slug}/index.html (${duration}s)`);
            result.deployed++;
        } catch (err: any) {
            const duration = ((Date.now() - listStartTime) / 1000).toFixed(1);
            result.errors++;
            result.success = false;
            const errorMsg = `Failed to deploy /${slug}/index.html (${duration}s): ${err.message}`;
            result.details.push(`ERROR: ${errorMsg}`);
            result.errorDetails.push(errorMsg);
        }
    }

    // 2b. The home page, every language (deployHomePage.ts)
    result.details.push('\n--- Home page ---');
    {
        const startTime = Date.now();
        try {
            await generateAndDeployHomePage();
            result.details.push(`Deployed the home page (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
            result.deployed++;
        } catch (err: any) {
            result.errors++;
            result.success = false;
            const errorMsg = `Failed to deploy the home page: ${err.message}`;
            result.details.push(`ERROR: ${errorMsg}`);
            result.errorDetails.push(errorMsg);
        }
    }

    // 3. Deploy static pages: every page the site has (staticPageSlugs)
    const staticPages = await staticPageSlugs();
    result.details.push(`\n--- Static pages: ${staticPages.length} page(s) ---`);

    for (const pageSlug of staticPages) {
        const startTime = Date.now();
        try {
            await generateAndDeployStaticPage(pageSlug);
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            result.details.push(`Deployed /pages/${pageSlug}/index.html (${duration}s)`);
            result.deployed++;
        } catch (err: any) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            result.errors++;
            result.success = false;
            const errorMsg = `Failed to deploy /pages/${pageSlug}/index.html (${duration}s): ${err.message}`;
            result.details.push(`ERROR: ${errorMsg}`);
            result.errorDetails.push(errorMsg);
        }
    }

    // 4. Deploy SEO files (robots.txt, sitemap.xml, RSS feeds)
    result.details.push('\n--- SEO files ---');

    // robots.txt
    const robotsStart = Date.now();
    try {
        await generateAndDeployRobotsTxt();
        const duration = ((Date.now() - robotsStart) / 1000).toFixed(1);
        result.details.push(`Deployed /robots.txt (${duration}s)`);
        result.deployed++;
    } catch (err: any) {
        const duration = ((Date.now() - robotsStart) / 1000).toFixed(1);
        result.errors++;
        result.success = false;
        const errorMsg = `Failed to deploy /robots.txt (${duration}s): ${err.message}`;
        result.details.push(`ERROR: ${errorMsg}`);
        result.errorDetails.push(errorMsg);
    }

    // llms.txt + llms-full.txt (D-D7); skipped when switched off in settings
    const llmsStart = Date.now();
    try {
        await generateAndDeployLlmsTxt();
        const duration = ((Date.now() - llmsStart) / 1000).toFixed(1);
        result.details.push(`Deployed /llms.txt and /llms-full.txt (${duration}s)`);
        result.deployed++;
    } catch (err: any) {
        const duration = ((Date.now() - llmsStart) / 1000).toFixed(1);
        result.errors++;
        result.success = false;
        const errorMsg = `Failed to deploy /llms.txt (${duration}s): ${err.message}`;
        result.details.push(`ERROR: ${errorMsg}`);
        result.errorDetails.push(errorMsg);
    }

    // sitemap.xml
    const sitemapStart = Date.now();
    try {
        await generateAndDeploySitemap();
        const duration = ((Date.now() - sitemapStart) / 1000).toFixed(1);
        result.details.push(`Deployed /sitemap.xml (${duration}s)`);
        result.deployed++;
    } catch (err: any) {
        const duration = ((Date.now() - sitemapStart) / 1000).toFixed(1);
        result.errors++;
        result.success = false;
        const errorMsg = `Failed to deploy /sitemap.xml (${duration}s): ${err.message}`;
        result.details.push(`ERROR: ${errorMsg}`);
        result.errorDetails.push(errorMsg);
    }

    // RSS feeds (one per content type)
    const rssStart = Date.now();
    try {
        await generateAndDeployRssFeeds();
        const duration = ((Date.now() - rssStart) / 1000).toFixed(1);
        result.details.push(`Deployed RSS feeds (${duration}s)`);
        result.deployed++;
    } catch (err: any) {
        const duration = ((Date.now() - rssStart) / 1000).toFixed(1);
        result.errors++;
        result.success = false;
        const errorMsg = `Failed to deploy RSS feeds (${duration}s): ${err.message}`;
        result.details.push(`ERROR: ${errorMsg}`);
        result.errorDetails.push(errorMsg);
    }

    result.details.push(`\n=== Seed complete: ${result.deployed} deployed, ${result.errors} errors ===`);

    return result;
}

/**
 * Callable function to deploy ALL existing published content as static HTML.
 * Can also be run from CLI via: npm run seed:dev / npm run seed:prod, which
 * calls runSeed directly with the person's own credentials.
 *
 * Admins only: a republish rebuilds and releases every page, so an open
 * callable would let anyone run up the install's costs.
 */
export const seedStaticPages = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MiB',
        cors: true,
        enforceAppCheck: false,
    },
    async (request): Promise<SeedResult> => {
        await requireAdmin(request);
        return runSeed();
    },
);
