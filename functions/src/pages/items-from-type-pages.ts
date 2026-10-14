import { db } from '../init.js';
import { arcHostingSite } from '../arc-config.js';
import { getPublishedCollectionName } from '../draftContent/collectionHelpers.js';
import { itemsFromTypeSources } from '../shared/items-from-type.js';
import { DEFAULT_TEMPLATE_FOLDER, getSiteFile, getSiteManifest, loadDetailTemplate, loadSiteTemplate } from '../shared/site-files.js';
import { generateAndDeployContentDetailPage } from './deployContentPage.js';
import type { HostingBatch } from './deployToHosting.js';

/**
 * Keeping detail pages that show entries of another type fresh
 * (data-arc-items-src, shared/items-from-type.ts).
 *
 * A published detail page has those entries baked in, so when an entry of the
 * shown type is published, updated, unpublished, deleted or put in a new order,
 * the pages showing it are built again. Finding them is cheap: the detail
 * templates come from the live site and are cached by build hash. Only the types
 * whose templates name the changed type have their entries read, and of those,
 * only the entries whose own template (their layout, else the folder's
 * detail.html) names it are rebuilt, all in one release.
 */

/** A content type whose detail templates read entries of another type. */
export interface TypeShowingItems {
    slug: string;
    templateFolder: string;
}

/** Every detail template a type's entries can render with: the folder's detail.html and its layouts. */
async function detailTemplatesOf(folder: string): Promise<string[]> {
    const wanted = folder && folder !== DEFAULT_TEMPLATE_FOLDER ? folder : DEFAULT_TEMPLATE_FOLDER;
    const templates: string[] = [];
    try {
        templates.push(await loadSiteTemplate(folder, 'detail'));
    } catch {
        // A folder the live site lacks publishes nothing, so shows nothing either.
        return [];
    }
    const manifest = await getSiteManifest();
    for (const name of Object.keys(manifest?.layouts?.[wanted] ?? {})) {
        const html = await getSiteFile(`templates/${wanted}/detail-${name}.html`);
        if (html) templates.push(html);
    }
    return templates;
}

/**
 * The content types with public pages whose detail templates show entries of
 * `slug`. Empty with hosting off, or when nothing names it.
 */
export async function typesShowingItemsOf(slug: string): Promise<TypeShowingItems[]> {
    if (!slug || !arcHostingSite()) return [];
    const types = await db.collection('ContentTypes').get();
    const showing: TypeShowingItems[] = [];
    for (const doc of types.docs) {
        const type = doc.data() as { slug?: string; hasPublicUrl?: boolean; templateFolder?: string };
        if (!type.slug || type.hasPublicUrl === false) continue;
        const templates = await detailTemplatesOf(type.templateFolder || '');
        if (templates.some((html) => itemsFromTypeSources(html).includes(slug))) {
            showing.push({ slug: type.slug, templateFolder: type.templateFolder || '' });
        }
    }
    return showing;
}

/**
 * Builds again, into `batch`, every published detail page whose template shows
 * entries of `slug`. Returns how many pages were built. One page that cannot be
 * built does not stop the others.
 */
export async function rebuildPagesShowingItemsOf(slug: string, batch: HostingBatch): Promise<number> {
    let pages = 0;
    for (const type of await typesShowingItemsOf(slug)) {
        const shows = new Map<string, Promise<boolean>>();
        const showsFor = (layout: string) => {
            if (!shows.has(layout)) {
                shows.set(layout, loadDetailTemplate(type.templateFolder, layout)
                    .then((html) => itemsFromTypeSources(html).includes(slug))
                    .catch(() => false));
            }
            return shows.get(layout)!;
        };
        const published = await db.collection(getPublishedCollectionName(type.slug)).get();
        for (const doc of published.docs) {
            const layout = typeof doc.data()?.['layout'] === 'string' ? doc.data()['layout'].trim() : '';
            if (!(await showsFor(layout))) continue;
            try {
                await generateAndDeployContentDetailPage(type.slug, doc.id, batch);
                pages++;
            } catch (error) {
                console.error(`Could not rebuild ${type.slug}/${doc.id}, which shows entries of ${slug}:`, error);
            }
        }
    }
    return pages;
}
