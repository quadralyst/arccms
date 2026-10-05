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
import { arcDatabaseId, arcFunctionsRegion, arcHostingSite } from '../arc-config.js';
import { ARC_FUNCTION_GROUP } from '../function-names.js';

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

/** The terms notice's words; translated through `strings/{lang}.json`. */
const LEGAL_DEFAULTS = {
    legal_notice: 'By signing up, you agree to our {terms} and {privacy}, and to receive emails from us.',
    legal_terms: 'Terms of Service',
    legal_privacy: 'Privacy Policy',
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/**
 * The terms notice on every signup form that does not carry one
 * ([data-legal-notice]), above its submit button: the same notice the app adds
 * to its forms (src/shared/constants/legal-notice.ts). Its links go to the app's
 * own terms and privacy pages, and only when the app has them.
 */
export function addLegalNotices($: cheerio.CheerioAPI, strings: Record<string, string>, manifest: SiteManifest | null): void {
    const t = (key: keyof typeof LEGAL_DEFAULTS) => (strings[key]?.trim() ? strings[key] : LEGAL_DEFAULTS[key]);
    const link = (label: string, page: string) => (manifest?.pages[page] === 'app'
        ? `<a href="/p/${page}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${escapeHtml(label)}</a>`
        : escapeHtml(label));
    const sentence = escapeHtml(t('legal_notice'))
        .replace('{terms}', link(t('legal_terms'), 'terms'))
        .replace('{privacy}', link(t('legal_privacy'), 'privacy-policy'));
    const notice = `<p class="arc-legal-notice" data-legal-notice style="font-size:0.8rem;opacity:0.75;margin:0.5rem 0;line-height:1.4">${sentence}</p>`;

    $('form[data-waitlist-form]').each((_, form) => {
        const $form = $(form);
        if ($form.find('[data-legal-notice]').length) return;
        const submit = $form.find('button[type="submit"], input[type="submit"], button:not([type])').first();
        if (submit.length) submit.before(notice);
        else $form.append(notice);
    });
}

/**
 * What partials.html binds outside the items loop. The default heading is the
 * page's `latest_of_type` string, else "Latest {type}". Pure; the admin's
 * Template Reference is checked against it.
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
        listUrl: `${prefix}/${type.slug}`,
        hasItems: itemCount > 0,
        lang,
        langPrefix: prefix,
    };
}

/**
 * Replaces each <arc-content-partials content-type="…" count="…" section-title="…"
 * template-folder="…"> with cards of that type, laid out by its partials.html,
 * as the app's content-partials component draws them.
 */
async function renderContentPartials(
    $: cheerio.CheerioAPI,
    lang: string,
    defaultLang: string,
    strings: Record<string, string>,
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
        if (!type || type.hasPublicUrl === false) {
            $el.remove();
            continue;
        }

        const collectionName = getPublishedCollectionName(slug);
        const itemsSnap = await db.collection(collectionName).orderBy('publishedOn', 'desc').limit(count).get();
        const typeName = contentTypeName(type, lang);
        const items = await Promise.all(itemsSnap.docs.map(async (doc) => {
            const content = { id: doc.id, ...doc.data() } as Record<string, any>;
            let translation: ContentTranslation | undefined;
            if (lang !== defaultLang) {
                const tr = await db.collection(collectionName).doc(doc.id).collection('translations').doc(lang).get();
                if (tr.exists) translation = { ...(tr.data() as ContentTranslation), lang };
            }
            return cardData({ id: doc.id, ...mergeTranslation(content, translation) }, slug, typeName, lang, prefix);
        }));

        const template = await loadSiteTemplate(($el.attr('template-folder') || '').trim() || type.templateFolder, 'partials');
        let html = TemplateHydrationService.applyStrings(template, strings);
        html = TemplateHydrationService.processLoops(html, { items });
        html = TemplateHydrationService.hydrateTemplate(html, partialPageData({ ...type, slug }, lang, prefix, $el.attr('section-title') || '', items.length, strings));
        $el.replaceWith(html);
    }
}

/**
 * The <script> for arc-site.js (public/assets/js/arc-site.js), with what it needs
 * to reach the functions and the public Firestore documents, and the signup
 * panels' text in the page's language (the `signup_*` keys of its strings).
 */
export function arcSiteScript(src: string, setup: SetupState = '', strings: Record<string, string> = {}): string {
    const project = process.env.GCLOUD_PROJECT || '';
    const signup = Object.fromEntries(Object.entries(strings).filter(([key, value]) => key.startsWith('signup_') && typeof value === 'string'));
    const attrs = [
        `src="${escapeAttr(src)}"`,
        `data-functions="${escapeAttr(`https://${arcFunctionsRegion()}-${project}.cloudfunctions.net`)}"`,
        `data-group="${ARC_FUNCTION_GROUP}"`,
        `data-project="${escapeAttr(project)}"`,
        `data-database="${escapeAttr(arcDatabaseId())}"`,
        ...(setup ? [`data-setup="${setup}"`] : []),
        ...(Object.keys(signup).length ? [`data-strings="${escapeAttr(JSON.stringify(signup))}"`] : []),
        'defer',
    ];
    return `<script ${attrs.join(' ')}></script>`;
}

/** Whether the setup wizard was still to do when the page was published. */
export type SetupState = '' | 'first-run' | 'in-progress';

/**
 * The setup wizard's state, decided as the app decides it (onboarding-setup.service.ts):
 * `Settings/onboarding_status` when it exists, otherwise an empty `email_lookup` means
 * a fresh install. A published page that was built during setup asks arc-site.js to
 * check again and send the owner to /onboarding; one built after setup costs nothing.
 */
export async function setupState(): Promise<SetupState> {
    try {
        const status = await db.collection('Settings').doc('onboarding_status').get();
        if (status.exists) return status.data()?.['completed'] === true ? '' : 'in-progress';
        const lookup = await db.collection('email_lookup').limit(1).get();
        return lookup.empty ? 'first-run' : '';
    } catch {
        return '';
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

        // Body: words, cards, chrome, links, notices.
        let html = TemplateHydrationService.applyStrings(source.html, strings);
        const $body = loadHtml(html, { xmlMode: false });
        await renderContentPartials($body, lang, defaultLang, strings);
        addLegalNotices($body, strings, manifest);
        html = $body.html();
        const chrome = (part: string) => prefixAnchorHrefs(TemplateHydrationService.applyStrings(part, strings), prefix, contentTypes);
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
