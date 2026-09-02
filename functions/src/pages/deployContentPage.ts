import { db } from '../init.js';
import { getPartials, getSiteConfig, getMiscSettings, getLocalizationSettings, getUiStrings } from '../shared/site-settings.js';
import {
    ContentTranslation,
    TRANSLATABLE_BUILTIN_FIELDS,
    detailFilePath,
    detailUrl,
    langPrefix,
    localizedPageTitle,
    mergeTranslation,
} from '../shared/content-translation.js';
import { calculateReadingTime } from '../shared/reading-time.js';
import { contentTypeName } from '../shared/content-type-names.js';
import {
    buildHtmlDocument,
    buildLanguageSwitcher,
    replaceArcComponents,
    extractStylesAndScripts,
    PageMeta,
    POWERED_BY_HTML,
} from '../shared/html-document.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { prefixAnchorHrefs } from '../shared/language-links.js';
import { HostingBatch, deployBatchToHosting, removeFileFromHosting } from './deployToHosting.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';

// ─── Fallback Template ──────────────────────────────────────────────────────

const FALLBACK_DETAIL_TEMPLATE = `<article>
  <header>
    <h1 data-arc-bind="title">Title</h1>
    <time data-arc-bind="publishedOn">Date</time>
    <span data-arc-bind="readTime">0</span> min read
  </header>
  <img data-arc-bind="coverImage" alt="" style="max-width:100%">
  <div [innerHTML]="content">Content</div>
</article>`;

// ─── Private Helpers ────────────────────────────────────────────────────────

/**
 * Format a Firestore Timestamp or date value to a human-readable string.
 * Handles Firestore Timestamp objects ({ seconds, nanoseconds }) and Date/string values.
 */
function formatContentDate(date: any, lang = 'en'): string {
    if (!date) return '';
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    try {
        return dateObj.toLocaleDateString(lang, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    } catch {
        // An unknown locale must not abort a deploy — fall back to English.
        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    }
}

/**
 * Reads the language variants stored alongside a published content item:
 * `arc_{slug}/{docId}/translations/{lang}`.
 */
async function loadTranslations(
    collectionName: string,
    docId: string,
): Promise<Map<string, ContentTranslation>> {
    const translations = new Map<string, ContentTranslation>();
    try {
        const snap = await db.collection(collectionName).doc(docId).collection('translations').get();
        snap.docs.forEach(doc => {
            translations.set(doc.id, { ...(doc.data() as ContentTranslation), lang: doc.id });
        });
    } catch (error) {
        // Losing translations degrades to a single-language deploy, which is
        // far better than failing the publish outright.
        console.error(`Could not read translations for ${collectionName}/${docId}:`, error);
    }
    return translations;
}

/**
 * Loads the detail template using 3-tier fallback:
 *  Tier 1: Firestore doc `templates/{folder}:detail` → field `html` or `originalHtml`
 *  Tier 2: HTTP fetch from hosting `https://{siteId}.web.app/templates/{folder}/detail.html`
 *  Tier 3: Built-in FALLBACK_DETAIL_TEMPLATE
 */
async function loadDetailTemplate(templateFolder: string | undefined, siteId: string): Promise<string> {
    // "default" is a real template folder, not an absence of one. It used to
    // short-circuit to the bare built-in skeleton below, while the Angular
    // renderer drew its own full-featured default layout — so the same content
    // looked completely different served statically vs. previewed locally.
    // public/templates/default/ now holds that layout, and both renderers use it.
    const folder = !templateFolder || templateFolder === 'default' ? 'default' : templateFolder;

    // Tier 1: Firestore
    try {
        const docRef = db.doc(`templates/${folder}:detail`);
        const snap = await docRef.get();
        if (snap.exists) {
            const data = snap.data();
            const html = data?.html || data?.originalHtml;
            if (html) return html;
        }
    } catch {
        // Fall through to Tier 2
    }

    // Tier 2: Fetch from hosting
    try {
        const url = `https://${siteId}.web.app/templates/${folder}/detail.html`;
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            if (text) return text;
        }
    } catch {
        // Fall through to Tier 3
    }

    // Tier 3: Built-in fallback
    return FALLBACK_DETAIL_TEMPLATE;
}

/**
 * Build the template data object from content, content type, and site config.
 * Mirrors the pattern used in the Angular content-detail.component.ts.
 */
function buildTemplateData(
    content: Record<string, any>,
    contentType: Record<string, any>,
    siteConfig: { siteName: string; baseUrl: string },
    lang = 'en',
    defaultLang = 'en',
    translation?: ContentTranslation,
): Record<string, any> {
    const readTime = content.readTime || calculateReadingTime(content.content || '');
    const publishedOn = formatContentDate(content.publishedOn, lang);

    // Build canonical share URL — language variants share their content's
    // canonicalUrl only when the author set one explicitly.
    const shareUrl =
        content.canonicalUrl ||
        detailUrl(siteConfig.baseUrl, lang, defaultLang, contentType.slug, content.urlSlug);
    // Same crossed-language trap as the <title>: share text must not fall back
    // to the base language's seoTitle on a translated page.
    const shareTitle = localizedPageTitle(content, translation);
    const shareSummary = content.summary || content.metaDescription || '';

    const share = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareSummary)}`,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(shareTitle + ' ' + shareUrl)}`,
        email: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareUrl)}`,
    };

    // Custom fields are spread last so they can extend the template data —
    // but content types often define a field whose key shadows a built-in
    // (`title` is common). An untranslated custom field must not silently
    // override a field the translator explicitly filled in, so deliberately
    // translated values are re-applied on top.
    const translatedOverrides: Record<string, any> = {};
    if (translation) {
        for (const field of TRANSLATABLE_BUILTIN_FIELDS) {
            const value = translation[field];
            if (typeof value === 'string' && value.replace(/<[^>]*>/g, '').trim()) {
                translatedOverrides[field] = value;
            }
        }
    }

    // The type's name shows up in the page ("Back to Articles"), so it is
    // translated like any other visible noun (M-D19).
    const typeName = contentTypeName(contentType, lang);

    return {
        contentType: typeName,
        cat: typeName,
        contentTypeSlug: contentType.slug,
        ...content,
        publishedOn,
        date: publishedOn,
        readTime,
        readingTime: `${readTime} min read`,
        ...((content.customFields as Record<string, any>) || {}),
        ...translatedOverrides,
        share,
        // Available to templates that want to build their own language links.
        lang,
        langPrefix: langPrefix(lang, defaultLang),
    };
}

// ─── Exported Functions ─────────────────────────────────────────────────────

/**
 * Generates and deploys a content detail page as static HTML.
 *
 * Full pipeline:
 *  1. Read published content from Firestore
 *  2. Read ContentType from Firestore
 *  3. Load partials + site config
 *  4. Load detail template (3-tier fallback)
 *  5. Build template data + hydrate
 *  6. Replace arc components, extract styles/scripts
 *  7. Build full HTML document
 *  8. Deploy to hosting
 */
export async function generateAndDeployContentDetailPage(
    contentTypeSlug: string,
    docId: string,
    batch?: HostingBatch,
): Promise<void> {
    // When the caller supplies a batch, files join it and are released with the
    // rest of the publish in one version — see HostingBatch for why.
    const target = batch ?? new HostingBatch();
    const siteId = process.env.GCLOUD_PROJECT || '';

    // 1. Read published content
    const collectionName = getPublishedCollectionName(contentTypeSlug);
    const contentSnap = await db.collection(collectionName).doc(docId).get();
    if (!contentSnap.exists) {
        const err = new Error('Published content not found');
        (err as any).code = 'CONTENT_NOT_FOUND';
        throw err;
    }
    const content = { id: contentSnap.id, ...contentSnap.data() } as Record<string, any>;

    // 2. Read ContentType
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

    // 3. Load partials + site config + misc settings + languages (all cached)
    const [partials, siteConfig, miscSettings, localization] = await Promise.all([
        getPartials(),
        getSiteConfig(),
        getMiscSettings(),
        getLocalizationSettings(),
    ]);

    // 4. Load detail template (3-tier fallback). The same template renders
    //    every language — only the data differs.
    const templateHtml = await loadDetailTemplate(contentType.templateFolder, siteId);

    // 5. Work out which languages this item is published in: the default
    //    language always, plus every enabled language that has a translation.
    const defaultLang = localization.defaultLanguage;
    const translations = await loadTranslations(collectionName, docId);
    const languages = localization.enabledLanguages.filter(
        lang => lang.code === defaultLang || translations.has(lang.code),
    );

    // 6. hreflang alternates — the full set, shared by every variant, so each
    //    page points at all the others (including itself).
    const alternates = languages.map(lang => ({
        lang: lang.code,
        url: detailUrl(siteConfig.baseUrl, lang.code, defaultLang, contentTypeSlug, content.urlSlug),
    }));
    // Relative for the switcher — see buildLanguageSwitcher. The page must keep
    // working on whatever host it is actually served from.
    const switcherLinks = languages.map(lang => ({
        lang: lang.code,
        url: detailUrl('', lang.code, defaultLang, contentTypeSlug, content.urlSlug),
    }));

    const poweredBy = miscSettings.showPoweredBy ? POWERED_BY_HTML : undefined;
    const languageLabels = Object.fromEntries(
        localization.enabledLanguages.map(l => [l.code, l.nativeLabel || l.label]),
    );

    for (const language of languages) {
        const lang = language.code;
        // Untranslated fields fall back to the default-language content, so a
        // partial translation still deploys a complete page.
        const localizedContent = mergeTranslation(content, translations.get(lang));

        const templateData = buildTemplateData(
            localizedContent,
            contentType,
            siteConfig,
            lang,
            defaultLang,
            translations.get(lang),
        );

        const tagsData =
            localizedContent.tagsWithColors ||
            (localizedContent.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));

        // Hydrate template: process loops first, then bindings
        // Static chrome baked into the template ("Read Article", "min read").
        // Applied before hydration so a translated value may carry its own
        // interpolation — "Back to {{ contentType }}" — and before loops so a
        // repeated item template is translated once rather than per item.
        const uiStrings = lang === defaultLang ? {} : await getUiStrings(lang);
        const localizedTemplate = TemplateHydrationService.applyStrings(templateHtml, uiStrings);

        let hydratedHtml = TemplateHydrationService.processLoops(localizedTemplate, {
            tags: tagsData,
        });
        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        // Replace arc components (header, footer, admin buttons, partials)
        // The partials are one file shared by every language, so their links
        // are root-relative and have to be pointed at this language — without
        // it the page reads in Hindi and its chrome navigates to English.
        const chrome = (html: string) =>
            prefixAnchorHrefs(
                TemplateHydrationService.applyStrings(html, uiStrings),
                langPrefix(lang, defaultLang),
            );

        hydratedHtml = replaceArcComponents(
            hydratedHtml,
            chrome(partials.headerHtml),
            chrome(partials.footerHtml),
            buildLanguageSwitcher(switcherLinks, lang, languageLabels),
        );

        // Extract inline styles/scripts from template
        const { body, styles, scripts } = extractStylesAndScripts(hydratedHtml);

        const meta: PageMeta = {
            title: localizedPageTitle(localizedContent, translations.get(lang)),
            metaDescription: localizedContent.metaDescription || '',
            // An author-set canonical applies to the default-language page it
            // was written for. Reusing it on every variant would point them all
            // at one URL — directly contradicting the hreflang tags and telling
            // search engines to drop the translations. Variants are always
            // self-referential.
            canonicalUrl:
                (lang === defaultLang ? localizedContent.canonicalUrl : '') ||
                detailUrl(siteConfig.baseUrl, lang, defaultLang, contentTypeSlug, content.urlSlug),
            ogImage: localizedContent.coverImage || '',
            ogType: 'article',
            siteName: siteConfig.siteName,
            cssUrls: siteConfig.cssUrls || [],
            lang,
            rtl: language.rtl,
            alternates,
            defaultLang,
        };

        // Header/footer already injected by replaceArcComponents — pass empty to avoid duplication
        const fullHtml = buildHtmlDocument(body, meta, '', '', styles, scripts, poweredBy);

        target.add(detailFilePath(lang, defaultLang, contentTypeSlug, content.urlSlug), fullHtml);
    }

    if (!batch) {
        await deployBatchToHosting(siteId, target, collectionName, docId);
    }

    if (languages.length > 1) {
        console.log(
            `Deployed ${languages.length} language variants of ${contentTypeSlug}/${content.urlSlug}: ` +
            languages.map(l => l.code).join(', '),
        );
    }
}

/**
 * Removes a content page — every language variant — from Firebase Hosting.
 *
 * Removal is attempted for all enabled languages rather than only those with
 * translations: a language may have been disabled, or its translation deleted,
 * since the page was deployed, and the file would otherwise be orphaned.
 * Removing a path that was never deployed is a no-op.
 */
export async function removeContentPage(
    contentTypeSlug: string,
    urlSlug: string,
    batch?: HostingBatch,
): Promise<void> {
    const siteId = process.env.GCLOUD_PROJECT || '';
    const localization = await getLocalizationSettings();
    const defaultLang = localization.defaultLanguage;
    const target = batch ?? new HostingBatch();

    for (const language of localization.enabledLanguages) {
        target.remove(detailFilePath(language.code, defaultLang, contentTypeSlug, urlSlug));
    }

    if (!batch) {
        for (const path of target.removedPaths) {
            await removeFileFromHosting(siteId, path);
        }
    }
}
