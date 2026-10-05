import { db } from '../init.js';
import { getAboutConfig } from './site-settings.js';
import { readPublishedInDisplayOrder } from '../pages/published-entries.js';
import type { SiteInfoSource, SitePageLink } from './site-info.js';

/**
 * What data-arc-site prints on a published page (specs/site-sections-spec.md,
 * SS3 and SS6): Settings, About, this year, and the published standard pages in
 * their arranged order, titled in the page's language, for the footer.
 *
 * A whole-site republish builds every page, so the pages are read once a few
 * seconds per language, not once per page.
 */

const CACHE_MS = 10_000;
const pagesCache = new Map<string, { at: number; pages: SitePageLink[] }>();

/** The content type Arc CMS created for the standard pages, or null. */
export async function standardPagesContentType(): Promise<Record<string, any> | null> {
    const snap = await db.collection('ContentTypes').where('standard', '==', 'pages').limit(1).get();
    return snap.empty ? null : (snap.docs[0].data() as Record<string, any>);
}

/** The published standard pages for a language, in their order; none without the type. */
export async function standardPageLinks(lang: string, defaultLang: string): Promise<SitePageLink[]> {
    const cached = pagesCache.get(lang);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.pages;

    const type = await standardPagesContentType();
    let pages: SitePageLink[] = [];
    if (type?.['slug'] && type['hasPublicUrl'] !== false) {
        const slug = String(type['slug']);
        const entries = await readPublishedInDisplayOrder(slug, type, 50);
        pages = await Promise.all(entries.map(async (entry) => {
            let title = String(entry['title'] || '');
            if (lang && lang !== defaultLang) {
                const translation = await db.collection(`arc_${slug}`).doc(entry['id']).collection('translations').doc(lang).get();
                const translated = translation.exists ? translation.data()?.['title'] : '';
                if (typeof translated === 'string' && translated.trim()) title = translated;
            }
            return { title, url: `/${slug}/${entry['urlSlug']}` };
        }));
    }
    pagesCache.set(lang, { at: Date.now(), pages });
    return pages;
}

/** Everything a page's data-arc-site bindings print, for a language. */
export async function siteInfoFor(lang: string, defaultLang: string): Promise<SiteInfoSource> {
    const [about, pages] = await Promise.all([getAboutConfig(), standardPageLinks(lang, defaultLang)]);
    return { ...about, year: new Date().getFullYear(), pages };
}

/** For the tests, and after a change that must show at once. */
export function clearSiteInfoCache(): void {
    pagesCache.clear();
}
