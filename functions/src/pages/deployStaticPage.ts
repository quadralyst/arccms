import { loadHtml } from '../shared/lazy-cheerio.js';
import { getPartials, getSiteConfig, getMiscSettings, getLocalizationSettings, getAboutConfig } from '../shared/site-settings.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { replaceArcComponents, POWERED_BY_HTML } from '../shared/html-document.js';
import { buildSearchWidget } from '../search/widget.js';
import { deployFileToHosting, type HostingBatch } from './deployToHosting.js';
import { arcHostingSite } from '../arc-config.js';
import { getSiteFile, getSiteManifest, LEGACY_STATIC_PAGES, pageStylesheets } from '../shared/site-files.js';
import { versionSiteUrls } from '../shared/site-urls.js';
import { liveSiteScript, prepareLiveParts } from '../shared/live-parts.js';

/**
 * Generates and deploys a processed static page (e.g., privacy-policy, terms).
 *
 * Pipeline:
 *  1. Fetch raw HTML from the live site at /_site/pages/{pageSlug}.html
 *  2. Load partials (header/footer) and site config (CSS URLs)
 *  3. Replace <arc-header> and <arc-footer> with actual HTML
 *  4. Inject site CSS <link> tags into <head>
 *  5. Add arc-served-by / arc-deployed-at meta tags
 *  6. Deploy processed HTML to /pages/{pageSlug}/index.html
 *
 * The source is the site's page (src/custom/site/pages/ over public/_site/pages/,
 * scripts/arc-site.mjs). The processed version is served at /pages/{slug}.
 */
export async function generateAndDeployStaticPage(
    pageSlug: string,
    /** Add the page to this release instead of releasing it alone (a site-wide republish). */
    batch?: HostingBatch,
): Promise<void> {
    const siteId = arcHostingSite();
    if (!siteId) {
        console.log(`Hosting is off; not generating static page ${pageSlug}.`);
        return;
    }

    // 1. Fetch raw HTML from the live site
    const rawHtml = await getSiteFile(`pages/${pageSlug}.html`);
    if (!rawHtml) {
        throw new Error(`The live site has no page ${pageSlug} (/_site/pages/${pageSlug}.html). Deploy the website first.`);
    }

    // 2. Load partials + site config + misc settings
    const [partials, siteConfig, miscSettings, localization, about] = await Promise.all([
        getPartials(), getSiteConfig(), getMiscSettings(), getLocalizationSettings(), getAboutConfig(),
    ]);
    // The site's own details (SS3) in the page, its header and its footer.
    const withSiteInfo = (html: string) => TemplateHydrationService.applySiteInfo(html, about);

    // 3. Replace arc components. Static pages exist in the default language
    //    only, so the search widget is built for that language.
    const defaultLang = localization.defaultLanguage;
    let processedHtml = replaceArcComponents(
        withSiteInfo(rawHtml),
        withSiteInfo(partials.headerHtml),
        withSiteInfo(partials.footerHtml),
        '',
        // The project, not the hosting site: the widget calls the project's
        // functions, and an install's own site is named differently.
        buildSearchWidget({ projectId: process.env.GCLOUD_PROJECT || '', lang: defaultLang, defaultLang }),
    );

    // 4. Post-process: live parts, CSS, meta tags, and powered-by footer
    {
        const manifest = await getSiteManifest();
        const $ = loadHtml(processedHtml, { xmlMode: false });

        // The live parts (SS5): signup and contact forms work here as on the home page.
        prepareLiveParts($, {}, manifest);
        $('body').append(`\n${await liveSiteScript(manifest)}`);

        // Inject site CSS <link> tags into <head>, versioned, the site's site.css last
        const stylesheets = await pageStylesheets(siteConfig.cssUrls || []);
        if (stylesheets.length > 0) {
            const cssLinks = stylesheets
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

    // Links to the site's files carry their version (shared/site-urls.ts).
    processedHtml = versionSiteUrls(processedHtml, (await getSiteManifest())?.files);

    // 7. Deploy to /pages/{pageSlug}/index.html
    const filePath = `/pages/${pageSlug}/index.html`;
    if (batch) {
        batch.add(filePath, processedHtml);
        return;
    }
    await deployFileToHosting(siteId, filePath, processedHtml, 'static_pages', pageSlug);
}

/**
 * The static pages to publish: every page in the live site's manifest (Arc CMS's
 * samples and the app's own, such as terms), or the two Arc CMS has always
 * shipped when the live site predates the manifest.
 */
export async function staticPageSlugs(): Promise<string[]> {
    const manifest = await getSiteManifest();
    return manifest ? Object.keys(manifest.pages).sort() : [...LEGACY_STATIC_PAGES];
}
