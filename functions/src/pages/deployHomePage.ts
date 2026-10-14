import type * as cheerio from 'cheerio';
import {
    getAboutConfig, getLocalizationSettings, getMiscSettings, getPartials, getSiteConfig, getUiStrings,
} from '../shared/site-settings.js';
import { getSiteFile, getSiteManifest, pageStylesheets, versionedUrl, type SiteManifest } from '../shared/site-files.js';
import { langPrefix } from '../shared/content-translation.js';
import { buildSiteNodes } from '../shared/site-jsonld.js';
import { renderJsonLdScripts } from '../shared/structured-data.js';
import { buildLanguageSwitcher, replaceArcComponents, toOgLocale, poweredByHtml } from '../shared/html-document.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { prefixAnchorHrefs } from '../shared/language-links.js';
import { publicContentTypeSlugs } from '../shared/public-content-types.js';
import { versionSiteUrls } from '../shared/site-urls.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import { buildSearchWidget } from '../search/widget.js';
import { isFeatureOn } from '../feature-flags.js';
import { HostingBatch, deployBatchToHosting } from './deployToHosting.js';
import { cardBlockTypes, renderCardBlocks, siteChrome } from './card-blocks.js';
import { siteInfoFor } from '../shared/site-info-source.js';
import { arcSiteScript, prepareLiveParts, setupState } from '../shared/live-parts.js';

import { arcHostingSite } from '../arc-config.js';

// The live parts moved to shared/live-parts.ts (SS5), the card blocks to card-blocks.ts;
// re-exported for existing callers.
export { addLegalNotices, arcSiteScript, setupState, type SetupState } from '../shared/live-parts.js';
export { partialPageData } from './card-blocks.js';

/**
 * The home page, published like content (specs/own-website-spec.md, W4).
 *
 * The site's home page is a whole HTML document: the app's
 * src/custom/site/home.html (or Arc CMS's placeholder), served at
 * /_site/home.html. For every enabled language this reads it from the live site,
 * fills the Arc CMS elements (<arc-header>, <arc-footer>,
 * <arc-content-partials>, <arc-search>, <arc-language-switcher>), translates
 * `data-arc-t`, adds every SEO tag the page does not set itself, and writes it to
 * Hosting as /index.html and /{lang}/index.html.
 *
 * A language uses home.{lang}.html when the site has one, else home.html with
 * that language's strings.
 */

/** Where a language's home page is written. */
export function homeFilePath(lang: string, defaultLang: string): string {
    return lang === defaultLang ? '/index.html' : `/${lang}/index.html`;
}

/** A language's home page address: `{base}/` or `{base}/{lang}`. */
export function homeUrl(baseUrl: string, lang: string, defaultLang: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    return lang === defaultLang ? `${base}/` : `${base}/${lang}`;
}

/** The content types a home page shows cards of, from its <arc-content-partials content-type="…">. */
export const homeContentTypes = cardBlockTypes;

/**
 * The source of a language's home page: its own file when the site has one,
 * else home.html (translated through strings by the caller). Null when the live
 * site has no home page file at all (not deployed with /_site/ yet).
 */
export async function homeSource(
    lang: string,
    defaultLang: string,
    manifest: SiteManifest | null,
): Promise<{ html: string; ownFile: boolean } | null> {
    if (lang !== defaultLang && manifest?.home[lang]) {
        const own = await getSiteFile(`home.${lang}.html`);
        if (own) return { html: own, ownFile: true };
    }
    const html = await getSiteFile('home.html');
    return html ? { html, ownFile: lang === defaultLang } : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

function setMetaIfMissing($: cheerio.CheerioAPI, attr: 'name' | 'property', key: string, content: string): void {
    if (!content || $(`meta[${attr}="${key}"]`).length) return;
    $('head').append(`<meta ${attr}="${key}" content="${escapeAttr(content)}">\n`);
}

/**
 * Whether the home page (in any language) shows cards of this content type, so a
 * change to that type's content has to republish it.
 */
export async function homeShowsType(slug: string): Promise<boolean> {
    if (!slug || !arcHostingSite()) return false;
    const manifest = await getSiteManifest();
    const files = ['home.html', ...Object.keys(manifest?.home ?? {}).filter((l) => l !== 'default').map((l) => `home.${l}.html`)];
    for (const file of files) {
        const html = await getSiteFile(file);
        if (html && homeContentTypes(html).includes(slug)) return true;
    }
    return false;
}

/** Builds and deploys the home page in every enabled language. */
export async function generateAndDeployHomePage(batch?: HostingBatch): Promise<void> {
    const siteId = arcHostingSite();
    if (!siteId) {
        console.log('Hosting is off; not publishing the home page.');
        return;
    }
    const target = batch ?? new HostingBatch();

    const [manifest, partials, siteConfig, miscSettings, localization, about, setup, contentTypes] = await Promise.all([
        getSiteManifest(), getPartials(), getSiteConfig(), getMiscSettings(), getLocalizationSettings(), getAboutConfig(), setupState(),
        publicContentTypeSlugs(),
    ]);
    // Image size bindings fit the configured maximum (Settings, Misc).
    TemplateHydrationService.setMaxImageSize(miscSettings.mediaMaxSize);
    const stylesheets = await pageStylesheets(siteConfig.cssUrls || []);
    const defaultLang = localization.defaultLanguage;
    const languages = localization.enabledLanguages;
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
    const alternates = languages.map((l) => ({ lang: l.code, url: homeUrl(baseUrl, l.code, defaultLang) }));
    const switcherLinks = languages.map((l) => ({ lang: l.code, url: l.code === defaultLang ? '/' : `/${l.code}` }));
    const labels = Object.fromEntries(languages.map((l) => [l.code, l.nativeLabel || l.label]));

    for (const language of languages) {
        const lang = language.code;
        const source = await homeSource(lang, defaultLang, manifest);
        if (!source) {
            throw new Error('The live site has no home page (/_site/home.html). Deploy the website first.');
        }
        const prefix = langPrefix(lang, defaultLang);
        const strings = await getUiStrings(lang);

        // Body: words, the site's details (SS3) and standard pages (SS6), cards, chrome, links, notices.
        const siteInfo = await siteInfoFor(lang, defaultLang);
        let html = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(source.html, strings), siteInfo);
        const $body = loadHtml(html, { xmlMode: false });
        await renderCardBlocks($body, lang, defaultLang, strings, siteInfo);
        // Signup and contact forms: their notices, and contact forms only with the feature (SS5).
        prepareLiveParts($body, strings, manifest, siteInfo.pages);
        html = $body.html();
        // The header and footer, their own card blocks filled, as on every page.
        const chrome = await siteChrome(partials, lang, defaultLang, strings, siteInfo, target);
        html = replaceArcComponents(
            html,
            prefixAnchorHrefs(chrome.headerHtml, prefix, contentTypes),
            prefixAnchorHrefs(chrome.footerHtml, prefix, contentTypes),
            buildLanguageSwitcher(switcherLinks, lang, labels),
            buildSearchWidget({ projectId: process.env.GCLOUD_PROJECT || '', lang, defaultLang, strings }),
        );
        html = prefixAnchorHrefs(html, prefix, contentTypes);

        // Head: what the page does not say itself.
        const $ = loadHtml(html, { xmlMode: false });
        $('html').attr('lang', lang);
        if (language.rtl) $('html').attr('dir', 'rtl');
        const pageUrl = homeUrl(baseUrl, lang, defaultLang);
        const title = $('title').first().text().trim() || about.name || siteConfig.siteName || '';
        if (!$('title').length) $('head').append(`<title>${escapeHtml(title)}</title>\n`);
        const description = $('meta[name="description"]').attr('content')?.trim() || about.description || '';
        setMetaIfMissing($, 'name', 'description', description);
        setMetaIfMissing($, 'property', 'og:title', title);
        setMetaIfMissing($, 'property', 'og:description', description);
        setMetaIfMissing($, 'property', 'og:type', 'website');
        setMetaIfMissing($, 'property', 'og:site_name', siteConfig.siteName || about.name);
        setMetaIfMissing($, 'property', 'og:image', about.logoUrl);
        setMetaIfMissing($, 'name', 'twitter:card', 'summary_large_image');
        setMetaIfMissing($, 'name', 'twitter:title', title);
        setMetaIfMissing($, 'name', 'twitter:description', description);
        setMetaIfMissing($, 'name', 'robots', 'index, follow');
        // Always this language's own: an authored canonical or locale would be wrong in the others.
        $('link[rel="canonical"], meta[property="og:url"], meta[property="og:locale"], link[rel="alternate"][hreflang]').remove();
        $('head').append(`<link rel="canonical" href="${escapeAttr(pageUrl)}">\n`);
        $('head').append(`<meta property="og:url" content="${escapeAttr(pageUrl)}">\n`);
        $('head').append(`<meta property="og:locale" content="${escapeAttr(toOgLocale(lang))}">\n`);
        if (alternates.length > 1) {
            for (const alt of alternates) $('head').append(`<link rel="alternate" hreflang="${alt.lang}" href="${escapeAttr(alt.url)}">\n`);
            $('head').append(`<link rel="alternate" hreflang="x-default" href="${escapeAttr(homeUrl(baseUrl, defaultLang, defaultLang))}">\n`);
        }
        const site = buildSiteNodes({ siteConfig, about, lang, defaultLang });
        $('head').append(`${renderJsonLdScripts([site.organization, site.webSite])}\n`);
        if (isFeatureOn('pwa') && !$('link[rel="manifest"]').length) {
            $('head').append('<link rel="manifest" href="/manifest.webmanifest">\n');
        }
        $('head').append('<meta name="arc-served-by" content="firebase-hosting">\n');
        $('head').append(`<meta name="arc-deployed-at" content="${new Date().toISOString()}">\n`);
        // Arc CMS's stylesheets first, so the page's own (after them) win.
        $('head').prepend(stylesheets.map((url) => `<link rel="stylesheet" href="${escapeAttr(url)}">`).join('\n') + '\n');
        const charset = $('meta[charset]');
        if (charset.length) $('head').prepend(charset.first());
        else $('head').prepend('<meta charset="UTF-8">\n');

        // The live parts of a published page: forms, counts, install, setup (W5).
        $('body').append(`\n${arcSiteScript(versionedUrl('/assets/js/arc-site.js', manifest), setup, strings)}`);
        if (miscSettings.showPoweredBy) $('body').append(`\n${poweredByHtml(strings)}`);

        // Links to the site's files (the page's own CSS, scripts, images) carry their version.
        const out = versionSiteUrls($.html(), manifest?.files);
        target.add(homeFilePath(lang, defaultLang), out.startsWith('<!DOCTYPE') || out.startsWith('<!doctype') ? out : `<!DOCTYPE html>\n${out}`);
    }

    if (!batch) await deployBatchToHosting(siteId, target, '', '');
}
