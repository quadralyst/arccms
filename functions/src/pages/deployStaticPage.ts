import * as cheerio from 'cheerio';
import { getPartials, getSiteConfig, getMiscSettings } from '../shared/site-settings.js';
import { replaceArcComponents, POWERED_BY_HTML } from '../shared/html-document.js';
import { deployFileToHosting } from './deployToHosting.js';

/**
 * Generates and deploys a processed static page (e.g., privacy-policy, cookie-policy).
 *
 * Pipeline:
 *  1. Fetch raw HTML from hosting at /pages/{pageSlug}.html
 *  2. Load partials (header/footer) and site config (CSS URLs)
 *  3. Replace <arc-header> and <arc-footer> with actual HTML
 *  4. Inject site CSS <link> tags into <head>
 *  5. Add arc-served-by / arc-deployed-at meta tags
 *  6. Deploy processed HTML to /pages/{pageSlug}/index.html
 *
 * The raw .html files in public/pages/ serve as the source.
 * The processed versions at /pages/{slug}/index.html take priority for serving.
 */
export async function generateAndDeployStaticPage(
    pageSlug: string,
): Promise<void> {
    const siteId = process.env.GCLOUD_PROJECT || '';

    // 1. Fetch raw HTML from hosting
    const rawUrl = `https://${siteId}.web.app/pages/${pageSlug}.html`;
    const response = await fetch(rawUrl);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch static page source: ${rawUrl} (HTTP ${response.status})`,
        );
    }
    const rawHtml = await response.text();

    // 2. Load partials + site config + misc settings
    const [partials, siteConfig, miscSettings] = await Promise.all([getPartials(), getSiteConfig(), getMiscSettings()]);

    // 3. Replace arc components
    let processedHtml = replaceArcComponents(rawHtml, partials.headerHtml, partials.footerHtml);

    // 4. Post-process: inject CSS, meta tags, and powered-by footer
    {
        const $ = cheerio.load(processedHtml, { xmlMode: false });

        // Inject site CSS <link> tags into <head>
        if (siteConfig.cssUrls && siteConfig.cssUrls.length > 0) {
            const cssLinks = siteConfig.cssUrls
                .map(url => `<link rel="stylesheet" href="${url}">`)
                .join('\n    ');
            $('head').append(`\n    ${cssLinks}`);
        }

        // 5. Add arc-served-by meta tags
        if (!$('meta[name="arc-served-by"]').length) {
            $('head').append('<meta name="arc-served-by" content="firebase-hosting">');
        }
        if (!$('meta[name="arc-deployed-at"]').length) {
            $('head').append(`<meta name="arc-deployed-at" content="${new Date().toISOString()}">`);
        }

        // 6. Inject "Powered by Arc CMS" footer if enabled
        if (miscSettings.showPoweredBy) {
            $('body').append(POWERED_BY_HTML);
        }

        processedHtml = $.html();
    }

    // 7. Deploy to /pages/{pageSlug}/index.html
    const filePath = `/pages/${pageSlug}/index.html`;
    await deployFileToHosting(siteId, filePath, processedHtml, 'static_pages', pageSlug);
}
