import { db } from '../init.js';

/** How long one function instance reuses the list: a site-wide republish asks for it once per page. */
const CACHE_MS = 60_000;
let cached: { at: number; slugs: Promise<ReadonlySet<string>> } | null = null;

/**
 * The slugs of the content types with public pages, the ones whose list and item
 * pages exist in every language (isLocalizedPath in shared/language-links.ts).
 * An empty set when they cannot be read, so links are left unprefixed rather
 * than pointed at pages that may not exist.
 */
export function publicContentTypeSlugs(now = Date.now()): Promise<ReadonlySet<string>> {
    if (cached && now - cached.at < CACHE_MS) return cached.slugs;
    const slugs = Promise.resolve()
        .then(() => db.collection('ContentTypes').get())
        .then((snap) => new Set(snap.docs
            .map((doc) => doc.data() as { slug?: string; hasPublicUrl?: boolean })
            .filter((type) => type.slug && type.hasPublicUrl !== false)
            .map((type) => type.slug as string)) as ReadonlySet<string>)
        .catch((error) => {
            console.error('Could not read the content types for language links:', error);
            cached = null;
            return new Set<string>() as ReadonlySet<string>;
        });
    cached = { at: now, slugs };
    return slugs;
}

/** For tests: forget the cached list. */
export function clearPublicContentTypesCache(): void {
    cached = null;
}
