import { db } from '../init.js';
import { getPartials, getSiteConfig, getMiscSettings, getLocalizationSettings, getUiStrings } from '../shared/site-settings.js';
import {
    ContentTranslation,
    langPrefix,
    listFilePath,
    listUrl,
    mergeTranslation,
} from '../shared/content-translation.js';
import { calculateReadingTime } from '../shared/reading-time.js';
import { contentTypeDescription, contentTypeName } from '../shared/content-type-names.js';
import {
    buildHtmlDocument,
    buildLanguageSwitcher,
    replaceArcComponents,
    extractStylesAndScripts,
    PageMeta,
    POWERED_BY_HTML,
} from '../shared/html-document.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { HostingBatch, deployBatchToHosting } from './deployToHosting.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';

// ─── Fallback Template ──────────────────────────────────────────────────────

const FALLBACK_LIST_TEMPLATE = `<section>
  <h1 data-arc-bind="contentType">Content</h1>
  <p data-arc-bind="contentTypeDescription">Browse all content.</p>
  <div data-arc-loop="items">
    <div>
      <a href="{{ url }}">
        <h2>{{ title }}</h2>
        <time>{{ publishedOn }}</time>
        <span>{{ readTime }} min read</span>
        <p>{{ excerpt }}</p>
      </a>
    </div>
  </div>
</section>`;

// ─── Private Helpers ────────────────────────────────────────────────────────

/**
 * Format date in short form for list pages (e.g., "Jan 15, 2024").
 * Matches the Angular content-list.component.ts pattern.
 */
function formatContentDateShort(date: any, lang = 'en'): string {
    if (!date) return '';
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    try {
        return dateObj.toLocaleDateString(lang, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        // An unknown locale must not abort a deploy — fall back to English.
        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    }
}

/**
 * Generate an excerpt from content text.
 * Strips HTML, takes first 25 words. Matches Angular content-list.component.ts.
 */
function getExcerpt(content: Record<string, any>): string {
    const text = content.metaDescription || content.content || '';
    const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanText.split(' ').slice(0, 25);
    return words.length >= 25 ? words.join(' ') + '...' : cleanText;
}

/**
 * Loads the list template using 3-tier fallback:
 *  Tier 1: Firestore doc `templates/{folder}:list` → field `html` or `originalHtml`
 *  Tier 2: HTTP fetch from hosting `https://{siteId}.web.app/templates/{folder}/list.html`
 *  Tier 3: Built-in FALLBACK_LIST_TEMPLATE
 */
async function loadListTemplate(templateFolder: string | undefined, siteId: string): Promise<string> {
    // "default" is a real template folder — see loadDetailTemplate for why.
    const folder = !templateFolder || templateFolder === 'default' ? 'default' : templateFolder;

    // Tier 1: Firestore
    try {
        const docRef = db.doc(`templates/${folder}:list`);
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
        const url = `https://${siteId}.web.app/templates/${folder}/list.html`;
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            if (text) return text;
        }
    } catch {
        // Fall through to Tier 3
    }

    // Tier 3: Built-in fallback
    return FALLBACK_LIST_TEMPLATE;
}

// ─── Exported Functions ─────────────────────────────────────────────────────

/**
 * Generates and deploys a content list/index page as static HTML.
 *
 * Pipeline:
 *  1. Read ContentType from Firestore
 *  2. Read ALL published content for this type, ordered by publishedOn desc
 *  3. Load partials + site config
 *  4. Load list template (3-tier fallback)
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
    const siteId = process.env.GCLOUD_PROJECT || '';

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
    const [partials, siteConfig, miscSettings, localization] = await Promise.all([
        getPartials(),
        getSiteConfig(),
        getMiscSettings(),
        getLocalizationSettings(),
    ]);

    // 4. Load list template (3-tier fallback) — one template, every language
    const templateHtml = await loadListTemplate(contentType.templateFolder, siteId);

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
        const templateData = {
            contentType: typeName,
            contentTypeSlug: contentType.slug,
            contentTypeDescription: typeDescription,
            description: typeDescription,
            lang,
            langPrefix: prefix,
        };

        // Items are never filtered by translation status — an untranslated item
        // falls back to its default-language card. A half-empty list page reads
        // as a broken site, and partial translation is the normal state.
        const listData = contents.map((content: Record<string, any>) => {
            const localized = mergeTranslation(
                content,
                translationsByDoc.get(content.id)?.get(lang),
            );

            const tagsData = localized.tagsWithColors ||
                (localized.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));

            // Pre-render tags HTML (nested loops not supported)
            const tagsHtml = tagsData.slice(0, 3).map((tag: { name: string; color: string }) =>
                `<span class="tag-pill arc-skeleton" style="background-color: ${tag.color}; color: #333;">${tag.name}</span>`
            ).join('');

            return {
                id: content.id,
                title: localized.title || '',
                urlSlug: localized.urlSlug || '',
                url: `${prefix}/${contentTypeSlug}/${localized.urlSlug}`,
                coverImage: localized.coverImage || '',
                excerpt: getExcerpt(localized),
                content: localized.content || '',
                publishedOn: formatContentDateShort(localized.publishedOn, lang),
                readTime: localized.readTime || calculateReadingTime(localized.content || ''),
                author: localized.author || '',
                tags: tagsData,
                tagsHtml,
                tagsDisplay: (localized.tags || []).slice(0, 3).join(', '),
                contentType: typeName,
                cat: typeName,
                ...((localized.customFields as Record<string, any>) || {}),
            };
        });

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
        hydratedHtml = replaceArcComponents(
            hydratedHtml,
            TemplateHydrationService.applyStrings(partials.headerHtml, uiStrings),
            TemplateHydrationService.applyStrings(partials.footerHtml, uiStrings),
            buildLanguageSwitcher(switcherLinks, lang, languageLabels),
        );

        // Extract inline styles/scripts
        const { body, styles, scripts } = extractStylesAndScripts(hydratedHtml);

        const meta: PageMeta = {
            title: typeName || 'Content',
            metaDescription: typeDescription || `Browse all ${typeName?.toLowerCase() || 'content'}`,
            canonicalUrl: listUrl(baseUrl, lang, defaultLang, contentTypeSlug),
            ogImage: '',
            ogType: 'website',
            siteName: siteConfig.siteName,
            cssUrls: siteConfig.cssUrls || [],
            // The feed stays default-language only — per-language RSS is a
            // deliberate non-goal until someone asks for it.
            rssUrl: `${baseUrl}/${contentTypeSlug}/feed.xml`,
            rssTitle: `${siteConfig.siteName} - ${typeName || 'Content'} RSS Feed`,
            lang,
            rtl: language.rtl,
            alternates,
            defaultLang,
        };

        // Header/footer already injected by replaceArcComponents — pass empty to avoid duplication
        const fullHtml = buildHtmlDocument(body, meta, '', '', styles, scripts, poweredBy);

        target.add(listFilePath(lang, defaultLang, contentTypeSlug), fullHtml);
    }

    if (!batch) {
        // Deployment logging needs a doc reference; use the newest item, or a
        // placeholder when the type has no published content yet.
        const deployDocId = contents.length > 0 ? (contents[0] as any).id : '_list_index';
        await deployBatchToHosting(siteId, target, collectionName, deployDocId);
    }
}
