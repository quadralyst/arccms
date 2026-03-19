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
import { deployFileToHosting } from './deployToHosting.js';
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
function formatContentDateShort(date: any): string {
    if (!date) return '';
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
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
    if (!templateFolder || templateFolder === 'default') {
        return FALLBACK_LIST_TEMPLATE;
    }

    // Tier 1: Firestore
    try {
        const docRef = db.doc(`templates/${templateFolder}:list`);
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
        const url = `https://${siteId}.web.app/templates/${templateFolder}/list.html`;
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
): Promise<void> {
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

    // 3. Load partials + site config + misc settings
    const [partials, siteConfig, miscSettings] = await Promise.all([getPartials(), getSiteConfig(), getMiscSettings()]);

    // 4. Load list template (3-tier fallback)
    const templateHtml = await loadListTemplate(contentType.templateFolder, siteId);

    // 5. Build page-level data
    const templateData = {
        contentType: contentType.name,
        contentTypeSlug: contentType.slug,
        contentTypeDescription: contentType.description || '',
        description: contentType.description || '',
    };

    // 6. Build list data for loop hydration
    const listData = contents.map((content: Record<string, any>) => {
        const tagsData = content.tagsWithColors ||
            (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));

        // Pre-render tags HTML (nested loops not supported)
        const tagsHtml = tagsData.slice(0, 3).map((tag: { name: string; color: string }) =>
            `<span class="tag-pill arc-skeleton" style="background-color: ${tag.color}; color: #333;">${tag.name}</span>`
        ).join('');

        return {
            id: content.id,
            title: content.title || '',
            urlSlug: content.urlSlug || '',
            url: `/${contentTypeSlug}/${content.urlSlug}`,
            coverImage: content.coverImage || '',
            excerpt: getExcerpt(content),
            content: content.content || '',
            publishedOn: formatContentDateShort(content.publishedOn),
            readTime: content.readTime || calculateReadingTime(content.content || ''),
            author: content.author || '',
            tags: tagsData,
            tagsHtml,
            tagsDisplay: (content.tags || []).slice(0, 3).join(', '),
            contentType: contentType.name,
            cat: contentType.name,
            ...((content.customFields as Record<string, any>) || {}),
        };
    });

    // 7. Hydrate: process loops first, then page-level bindings
    let hydratedHtml = TemplateHydrationService.processLoops(templateHtml, { items: listData });
    hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

    // 8. Replace arc components
    hydratedHtml = replaceArcComponents(hydratedHtml, partials.headerHtml, partials.footerHtml);

    // 9. Extract inline styles/scripts
    const { body, styles, scripts } = extractStylesAndScripts(hydratedHtml);

    // 10. Build PageMeta for SEO
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
    const meta: PageMeta = {
        title: contentType.name || 'Content',
        metaDescription: contentType.description || `Browse all ${contentType.name?.toLowerCase() || 'content'}`,
        canonicalUrl: `${baseUrl}/${contentTypeSlug}`,
        ogImage: '',
        ogType: 'website',
        siteName: siteConfig.siteName,
        cssUrls: siteConfig.cssUrls || [],
        rssUrl: `${baseUrl}/${contentTypeSlug}/feed.xml`,
        rssTitle: `${siteConfig.siteName} - ${contentType.name || 'Content'} RSS Feed`,
    };

    // 11. Assemble full HTML document
    //     Header/footer already injected by replaceArcComponents — pass empty to avoid duplication
    const poweredBy = miscSettings.showPoweredBy ? POWERED_BY_HTML : undefined;
    const fullHtml = buildHtmlDocument(body, meta, '', '', styles, scripts, poweredBy);

    // 12. Deploy to hosting — use a synthetic doc reference for deployment logging
    //     We use the first content doc or create a placeholder for the collection
    const deployDocId = contents.length > 0 ? (contents[0] as any).id : '_list_index';
    const filePath = `/${contentTypeSlug}/index.html`;
    await deployFileToHosting(siteId, filePath, fullHtml, collectionName, deployDocId);
}
