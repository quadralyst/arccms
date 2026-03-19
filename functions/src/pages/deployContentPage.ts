import { db } from '../init.js';
import { getPartials, getSiteConfig, getMiscSettings } from '../shared/site-settings.js';
import { calculateReadingTime } from '../shared/reading-time.js';
import {
    buildHtmlDocument,
    replaceArcComponents,
    extractStylesAndScripts,
    PageMeta,
    POWERED_BY_HTML,
} from '../shared/html-document.js';
import { TemplateHydrationService } from '../shared/template-hydration.js';
import { deployFileToHosting, removeFileFromHosting } from './deployToHosting.js';
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
function formatContentDate(date: any): string {
    if (!date) return '';
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/**
 * Loads the detail template using 3-tier fallback:
 *  Tier 1: Firestore doc `templates/{folder}:detail` → field `html` or `originalHtml`
 *  Tier 2: HTTP fetch from hosting `https://{siteId}.web.app/templates/{folder}/detail.html`
 *  Tier 3: Built-in FALLBACK_DETAIL_TEMPLATE
 */
async function loadDetailTemplate(templateFolder: string | undefined, siteId: string): Promise<string> {
    // If no custom template folder or explicitly "default", use fallback immediately
    if (!templateFolder || templateFolder === 'default') {
        return FALLBACK_DETAIL_TEMPLATE;
    }

    // Tier 1: Firestore
    try {
        const docRef = db.doc(`templates/${templateFolder}:detail`);
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
        const url = `https://${siteId}.web.app/templates/${templateFolder}/detail.html`;
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
): Record<string, any> {
    const readTime = content.readTime || calculateReadingTime(content.content || '');
    const publishedOn = formatContentDate(content.publishedOn);

    // Build canonical share URL
    const shareUrl =
        content.canonicalUrl ||
        `${siteConfig.baseUrl}/${contentType.slug}/${content.urlSlug}`;
    const shareTitle = content.seoTitle || content.title || '';
    const shareSummary = content.summary || content.metaDescription || '';

    const share = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareSummary)}`,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(shareTitle + ' ' + shareUrl)}`,
        email: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareUrl)}`,
    };

    return {
        contentType: contentType.name,
        cat: contentType.name,
        contentTypeSlug: contentType.slug,
        ...content,
        publishedOn,
        date: publishedOn,
        readTime,
        readingTime: `${readTime} min read`,
        ...((content.customFields as Record<string, any>) || {}),
        share,
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
): Promise<void> {
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

    // 3. Load partials + site config + misc settings (all cached, fast)
    const [partials, siteConfig, miscSettings] = await Promise.all([getPartials(), getSiteConfig(), getMiscSettings()]);

    // 4. Load detail template (3-tier fallback)
    const templateHtml = await loadDetailTemplate(contentType.templateFolder, siteId);

    // 5. Build template data
    const templateData = buildTemplateData(content, contentType, siteConfig);

    // 6. Build loop data for tags
    const tagsData =
        content.tagsWithColors ||
        (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));

    // 7. Hydrate template: process loops first, then bindings
    let hydratedHtml = TemplateHydrationService.processLoops(templateHtml, {
        tags: tagsData,
    });
    hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

    // 8. Replace arc components (header, footer, admin buttons, partials)
    hydratedHtml = replaceArcComponents(hydratedHtml, partials.headerHtml, partials.footerHtml);

    // 9. Extract inline styles/scripts from template
    const { body, styles, scripts } = extractStylesAndScripts(hydratedHtml);

    // 10. Build PageMeta for SEO
    const meta: PageMeta = {
        title: content.seoTitle || content.title || '',
        metaDescription: content.metaDescription || '',
        canonicalUrl:
            content.canonicalUrl ||
            `${siteConfig.baseUrl}/${contentTypeSlug}/${content.urlSlug}`,
        ogImage: content.coverImage || '',
        ogType: 'article',
        siteName: siteConfig.siteName,
        cssUrls: siteConfig.cssUrls || [],
    };

    // 11. Assemble full HTML document
    //     Header/footer already injected by replaceArcComponents — pass empty to avoid duplication
    const poweredBy = miscSettings.showPoweredBy ? POWERED_BY_HTML : undefined;
    const fullHtml = buildHtmlDocument(body, meta, '', '', styles, scripts, poweredBy);

    // 12. Deploy to hosting
    const filePath = `/${contentTypeSlug}/${content.urlSlug}.html`;
    await deployFileToHosting(siteId, filePath, fullHtml, collectionName, docId);
}

/**
 * Removes a content page from Firebase Hosting.
 */
export async function removeContentPage(
    contentTypeSlug: string,
    urlSlug: string,
): Promise<void> {
    const siteId = process.env.GCLOUD_PROJECT || '';
    const filePath = `/${contentTypeSlug}/${urlSlug}.html`;
    await removeFileFromHosting(siteId, filePath);
}
