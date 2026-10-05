import { db } from '../init.js';
import { getPartials, getSiteConfig, getMiscSettings, getLocalizationSettings, getUiStrings, getAboutConfig } from '../shared/site-settings.js';
import { buildSearchWidget } from '../search/widget.js';
import {
    ContentTranslation,
    langPrefix,
    listFilePath,
    listUrl,
    mergeTranslation,
} from '../shared/content-translation.js';
import { cardData } from '../shared/content-cards.js';
import { contentTypeDescription, contentTypeName } from '../shared/content-type-names.js';
import { buildBreadcrumbList, buildCollectionPage } from '../shared/structured-data.js';
import { buildSiteNodes } from '../shared/site-jsonld.js';
import {
    buildHtmlDocument,
    buildLanguageSwitcher,
    replaceArcComponents,
    extractStylesAndScripts,
    PageMeta,
    POWERED_BY_HTML,
} from '../shared/html-document.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { getSiteManifest, loadSiteTemplate, pageStylesheets } from '../shared/site-files.js';
import { versionSiteUrls } from '../shared/site-urls.js';
import { prefixAnchorHrefs } from '../shared/language-links.js';
import { publicContentTypeSlugs } from '../shared/public-content-types.js';
import { HostingBatch, deployBatchToHosting } from './deployToHosting.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { arcHostingSite } from '../arc-config.js';

// ─── Exported Functions ─────────────────────────────────────────────────────

/** What list.html binds outside the items loop. Pure; the admin's Template Reference is checked against it. */
export function listPageData(contentType: Record<string, any>, lang: string, prefix: string): Record<string, any> {
    const typeDescription = contentTypeDescription(contentType, lang);
    return {
        contentType: contentTypeName(contentType, lang),
        contentTypeSlug: contentType.slug,
        contentTypeDescription: typeDescription,
        description: typeDescription,
        lang,
        langPrefix: prefix,
    };
}

/**
 * Generates and deploys a content list/index page as static HTML.
 *
 * Pipeline:
 *  1. Read ContentType from Firestore
 *  2. Read ALL published content for this type, ordered by publishedOn desc
 *  3. Load partials + site config
 *  4. Load the list template from the live site (site-files.ts)
 *  5. Build list data with excerpts, tags, dates
 *  6. Hydrate template: process loops, then page-level bindings
 *  7. Replace arc components, extract styles/scripts
 *  8. Build full HTML document with SEO
 *  9. Deploy to hosting at /{slug}/index.html
 */
export async function generateAndDeployContentListPage(
    contentTypeSlug: string,
    batch?: HostingBatch,
): Promise<void> {
    // See generateAndDeployContentDetailPage.
    const target = batch ?? new HostingBatch();
    const siteId = arcHostingSite();

    // 1. Read ContentType
    const contentTypeQuery = await db
        .collection('ContentTypes')
        .where('slug', '==', contentTypeSlug)
        .limit(1)
        .get();
    if (contentTypeQuery.empty) {
        const err = new Error('Content type configuration not found');
        (err as any).code = 'CONTENT_TYPE_NOT_FOUND';
        throw err;
    }
    const contentType = contentTypeQuery.docs[0].data();

    // 2. Read published content, ordered by publishedOn desc (capped at 100)
    const collectionName = getPublishedCollectionName(contentTypeSlug);
    const contentsSnap = await db
        .collection(collectionName)
        .orderBy('publishedOn', 'desc')
        .limit(100)
        .get();
    const contents = contentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 3. Load partials + site config + misc settings + languages
    const [partials, siteConfig, miscSettings, localization, about] = await Promise.all([
        getPartials(),
        getSiteConfig(),
        getMiscSettings(),
        getLocalizationSettings(),
        getAboutConfig(),
    ]);
    // Image size bindings fit the configured maximum (Settings, Misc).
    TemplateHydrationService.setMaxImageSize(miscSettings.mediaMaxSize);

    // The stylesheets every language's page links, versioned (site-files.ts).
    const stylesheets = await pageStylesheets(siteConfig.cssUrls || []);

    // 4. Load the list template from the live site (site-files.ts): one
    //    template, every language. The detail page already stopped a publish
    //    whose folder is missing, with the reason on the item.
    const templateHtml = await loadSiteTemplate(contentType.templateFolder, 'list');

    // 5. Read every item's translations once, up front, so each language pass
    //    is pure assembly.
    const defaultLang = localization.defaultLanguage;
    const translationsByDoc = new Map<string, Map<string, ContentTranslation>>();
    await Promise.all(
        contents.map(async (content: Record<string, any>) => {
            try {
                const snap = await db
                    .collection(collectionName)
                    .doc(content.id)
                    .collection('translations')
                    .get();
                const perLang = new Map<string, ContentTranslation>();
                snap.docs.forEach(doc =>
                    perLang.set(doc.id, { ...(doc.data() as ContentTranslation), lang: doc.id }),
                );
                translationsByDoc.set(content.id, perLang);
            } catch (error) {
                console.error(`Could not read translations for ${collectionName}/${content.id}:`, error);
                translationsByDoc.set(content.id, new Map());
            }
        }),
    );

    // A list page is deployed for every enabled language, not only those with
    // translated items: the page itself must exist for the language switcher
    // to have somewhere to go.
    const languages = localization.enabledLanguages;
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
    const alternates = languages.map(lang => ({
        lang: lang.code,
        url: listUrl(baseUrl, lang.code, defaultLang, contentTypeSlug),
    }));
    // Relative for the switcher — see buildLanguageSwitcher.
    const switcherLinks = languages.map(lang => ({
        lang: lang.code,
        url: listUrl('', lang.code, defaultLang, contentTypeSlug),
    }));

    const poweredBy = miscSettings.showPoweredBy ? POWERED_BY_HTML : undefined;
    const languageLabels = Object.fromEntries(
        languages.map(l => [l.code, l.nativeLabel || l.label]),
    );

    for (const language of languages) {
        const lang = language.code;
        const prefix = langPrefix(lang, defaultLang);

        const typeName = contentTypeName(contentType, lang);
        const typeDescription = contentTypeDescription(contentType, lang);
        const templateData = listPageData(contentType, lang, prefix);

        // Items are never filtered by translation status — an untranslated item
        // falls back to its default-language card. A half-empty list page reads
        // as a broken site, and partial translation is the normal state.
        const listData = contents.map((content: Record<string, any>) => cardData(
            { id: content.id, ...mergeTranslation(content, translationsByDoc.get(content.id)?.get(lang)) },
            contentTypeSlug, typeName, lang, prefix,
        ));

        // Hydrate: process loops first, then page-level bindings
        // Static chrome baked into the template ("Read Article", "min read").
        // Applied before hydration so a translated value may carry its own
        // interpolation — "Back to {{ contentType }}" — and before loops so a
        // repeated item template is translated once rather than per item.
        const uiStrings = lang === defaultLang ? {} : await getUiStrings(lang);
        const localizedTemplate = TemplateHydrationService.applyStrings(templateHtml, uiStrings);

        let hydratedHtml = TemplateHydrationService.processLoops(localizedTemplate, { items: listData });
        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        // Replace arc components
        // The partials are one file shared by every language, so their links
        // are root-relative and have to be pointed at this language — without
        // it the page reads in Hindi and its chrome navigates to English.
        const contentTypes = await publicContentTypeSlugs();
        const chrome = (html: string) =>
            prefixAnchorHrefs(TemplateHydrationService.applyStrings(html, uiStrings), prefix, contentTypes);

        hydratedHtml = replaceArcComponents(
            hydratedHtml,
            chrome(partials.headerHtml),
            chrome(partials.footerHtml),
            buildLanguageSwitcher(switcherLinks, lang, languageLabels),
            buildSearchWidget({ projectId: process.env.GCLOUD_PROJECT || '', lang, defaultLang, strings: uiStrings }),
        );

        // Extract inline styles/scripts
        const { body, styles, scripts } = extractStylesAndScripts(hydratedHtml);

        const pageUrl = listUrl(baseUrl, lang, defaultLang, contentTypeSlug);
        const site = buildSiteNodes({ siteConfig, about, lang, defaultLang });
        const jsonLd = [
            site.organization,
            site.webSite,
            buildBreadcrumbList([
                { name: siteConfig.siteName || baseUrl, url: `${baseUrl}${prefix}/` },
                { name: typeName || 'Content', url: pageUrl },
            ]),
            buildCollectionPage({
                url: pageUrl,
                name: typeName || 'Content',
                description: typeDescription,
                inLanguage: lang,
                publisherId: site.publisherId,
                items: listData.map(item => ({ name: item.title, url: `${baseUrl}${item.url}` })),
            }),
        ];

        const meta: PageMeta = {
            title: typeName || 'Content',
            metaDescription: typeDescription || `Browse all ${typeName?.toLowerCase() || 'content'}`,
            canonicalUrl: pageUrl,
            ogImage: '',
            ogType: 'website',
            siteName: siteConfig.siteName,
            cssUrls: stylesheets,
            // The feed stays default-language only — per-language RSS is a
            // deliberate non-goal until someone asks for it.
            rssUrl: `${baseUrl}/${contentTypeSlug}/feed.xml`,
            rssTitle: `${siteConfig.siteName} - ${typeName || 'Content'} RSS Feed`,
            lang,
            rtl: language.rtl,
            alternates,
            defaultLang,
            jsonLd,
        };

        // Header/footer already injected by replaceArcComponents — pass empty to avoid duplication
        const fullHtml = buildHtmlDocument(body, meta, '', '', styles, scripts, poweredBy);

        // Links to the site's files carry their version (shared/site-urls.ts).
        target.add(listFilePath(lang, defaultLang, contentTypeSlug), versionSiteUrls(fullHtml, (await getSiteManifest())?.files));
    }

    if (!batch) {
        // Deployment logging needs a doc reference; use the newest item, or a
        // placeholder when the type has no published content yet.
        const deployDocId = contents.length > 0 ? (contents[0] as any).id : '_list_index';
        await deployBatchToHosting(siteId, target, collectionName, deployDocId);
    }
}
