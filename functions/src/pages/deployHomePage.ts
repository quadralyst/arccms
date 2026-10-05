import type * as cheerio from 'cheerio';
import { db } from '../init.js';
import {
    getAboutConfig, getLocalizationSettings, getMiscSettings, getPartials, getSiteConfig, getUiStrings,
} from '../shared/site-settings.js';
import { getSiteFile, getSiteManifest, loadSiteTemplate, pageStylesheets, versionedUrl, type SiteManifest } from '../shared/site-files.js';
import { langPrefix, mergeTranslation, type ContentTranslation } from '../shared/content-translation.js';
import { contentTypeDescription, contentTypeName } from '../shared/content-type-names.js';
import { interpolate } from '../shared/interpolate.js';
import { cardData } from '../shared/content-cards.js';
import { buildSiteNodes } from '../shared/site-jsonld.js';
import { renderJsonLdScripts } from '../shared/structured-data.js';
import { buildLanguageSwitcher, replaceArcComponents, toOgLocale, POWERED_BY_HTML } from '../shared/html-document.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { prefixAnchorHrefs } from '../shared/language-links.js';
import { publicContentTypeSlugs } from '../shared/public-content-types.js';
import { versionSiteUrls } from '../shared/site-urls.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import { buildSearchWidget } from '../search/widget.js';
import { isFeatureOn } from '../feature-flags.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { HostingBatch, deployBatchToHosting } from './deployToHosting.js';
import { readPublishedInDisplayOrder } from './published-entries.js';
import { siteInfoFor } from '../shared/site-info-source.js';
import type { SiteInfoSource } from '../shared/site-info.js';
import { arcSiteScript, prepareLiveParts, setupState } from '../shared/live-parts.js';

import { arcHostingSite } from '../arc-config.js';

// The live parts moved to shared/live-parts.ts (SS5); re-exported for existing callers.
export { addLegalNotices, arcSiteScript, setupState, type SetupState } from '../shared/live-parts.js';

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
export function homeContentTypes(html: string): string[] {
    const types = new Set<string>();
    for (const match of html.matchAll(/<arc-content-partials\b[^>]*\bcontent-type\s*=\s*["']([^"']+)["']/gi)) {
        types.add(match[1].trim());
    }
    return [...types];
}

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

/**
 * What partials.html binds outside the items loop. The default heading is the
 * page's `latest_of_type` string, else "Latest {type}". A type without public
 * pages has no list page, so `listUrl` is empty. Pure; the admin's Template
 * Reference is checked against it.
 */
export function partialPageData(
    type: Record<string, any>, lang: string, prefix: string, sectionTitle: string, itemCount: number,
    strings: Record<string, string> = {},
): Record<string, any> {
    const typeName = contentTypeName(type, lang);
    const latest = strings['latest_of_type'] ? interpolate(strings['latest_of_type'], { contentType: typeName }) : `Latest ${typeName}`;
    return {
        contentType: typeName,
        contentTypeSlug: type.slug,
        contentTypeDescription: contentTypeDescription(type, lang),
        sectionTitle: sectionTitle.trim() || latest,
        listUrl: type.hasPublicUrl === false ? '' : `${prefix}/${type.slug}`,
        hasItems: itemCount > 0,
        lang,
        langPrefix: prefix,
    };
}

/**
 * Replaces each <arc-content-partials content-type="…" count="…" section-title="…"
 * template-folder="…"> with cards of that type, laid out by its partials.html,
 * as the app's content-partials component draws them. A type without public
 * pages shows its cards too, without links (specs/site-sections-spec.md, SS1);
 * only a type that does not exist is removed.
 */
async function renderContentPartials(
    $: cheerio.CheerioAPI,
    lang: string,
    defaultLang: string,
    strings: Record<string, string>,
    about: SiteInfoSource | null = null,
): Promise<void> {
    const prefix = langPrefix(lang, defaultLang);
    for (const element of $('arc-content-partials').toArray()) {
        const $el = $(element);
        const slug = ($el.attr('content-type') || '').trim();
        const count = Math.max(1, Math.min(50, Number($el.attr('count')) || 4));
        const typeSnap = slug
            ? await db.collection('ContentTypes').where('slug', '==', slug).limit(1).get()
            : null;
        const type = typeSnap && !typeSnap.empty ? typeSnap.docs[0].data() : null;
        if (!type) {
            $el.remove();
            continue;
        }

        const collectionName = getPublishedCollectionName(slug);
        // In the type's entry order: newest first, or the order an admin arranged (SS2).
        const entries = await readPublishedInDisplayOrder(slug, type, count);
        const typeName = contentTypeName(type, lang);
        const items = await Promise.all(entries.map(async (content) => {
            let translation: ContentTranslation | undefined;
            if (lang !== defaultLang) {
                const tr = await db.collection(collectionName).doc(content.id).collection('translations').doc(lang).get();
                if (tr.exists) translation = { ...(tr.data() as ContentTranslation), lang };
            }
            return cardData({ ...mergeTranslation(content, translation), id: content.id }, slug, typeName, lang, prefix, type.hasPublicUrl !== false);
        }));

        const template = await loadSiteTemplate(($el.attr('template-folder') || '').trim() || type.templateFolder, 'partials');
        let html = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(template, strings), about);
        html = TemplateHydrationService.processLoops(html, { items });
        html = TemplateHydrationService.hydrateTemplate(html, partialPageData({ ...type, slug }, lang, prefix, $el.attr('section-title') || '', items.length, strings));
        $el.replaceWith(html);
    }
}

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
        const strings = lang === defaultLang ? {} : await getUiStrings(lang);

        // Body: words, the site's details (SS3) and standard pages (SS6), cards, chrome, links, notices.
        const siteInfo = await siteInfoFor(lang, defaultLang);
        let html = TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(source.html, strings), siteInfo);
        const $body = loadHtml(html, { xmlMode: false });
        await renderContentPartials($body, lang, defaultLang, strings, siteInfo);
        // Signup and contact forms: their notices, and contact forms only with the feature (SS5).
        prepareLiveParts($body, strings, manifest, siteInfo.pages);
        html = $body.html();
        const chrome = (part: string) => prefixAnchorHrefs(
            TemplateHydrationService.applySiteInfo(TemplateHydrationService.applyStrings(part, strings), siteInfo), prefix, contentTypes);
        html = replaceArcComponents(
            html,
            chrome(partials.headerHtml),
            chrome(partials.footerHtml),
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
        if (miscSettings.showPoweredBy) $('body').append(`\n${POWERED_BY_HTML}`);

        // Links to the site's files (the page's own CSS, scripts, images) carry their version.
        const out = versionSiteUrls($.html(), manifest?.files);
        target.add(homeFilePath(lang, defaultLang), out.startsWith('<!DOCTYPE') || out.startsWith('<!doctype') ? out : `<!DOCTYPE html>\n${out}`);
    }

    if (!batch) await deployBatchToHosting(siteId, target, '', '');
}
