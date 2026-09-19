/**
 * Settings a source may need while indexing, loaded once and cached.
 *
 * Sources receive a SearchContext rather than fetching content types or the
 * language list themselves, so a reindex of a thousand documents reads the
 * settings once rather than a thousand times.
 */

import { db } from '../init.js';
import { getLocalizationSettings } from '../shared/site-settings.js';
import type { SearchContentType, SearchContext } from './source.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let contentTypesCache: { data: Map<string, SearchContentType>; timestamp: number } | null = null;

/** Content types keyed by slug. Cached for five minutes like the other settings. */
export async function loadContentTypes(force = false): Promise<Map<string, SearchContentType>> {
    if (!force && contentTypesCache && Date.now() - contentTypesCache.timestamp < CACHE_TTL_MS) {
        return contentTypesCache.data;
    }

    const snap = await db.collection('ContentTypes').get();
    const map = new Map<string, SearchContentType>();
    for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const slug = typeof data['slug'] === 'string' ? data['slug'] : '';
        if (!slug) continue;
        map.set(slug, {
            id: doc.id,
            slug,
            name: typeof data['name'] === 'string' ? data['name'] : slug,
            singularName: typeof data['singularName'] === 'string' ? data['singularName'] : undefined,
            hasPublicUrl: data['hasPublicUrl'] !== false,
            nameTranslations: (data['nameTranslations'] as SearchContentType['nameTranslations']) ?? undefined,
            fields: Array.isArray(data['fields'])
                ? (data['fields'] as SearchContentType['fields']).map(field => ({
                    key: String(field.key ?? ''),
                    type: String(field.type ?? ''),
                    label: typeof field.label === 'string' ? field.label : undefined,
                }))
                : [],
            searchFields: Array.isArray(data['searchFields'])
                ? (data['searchFields'] as unknown[]).filter((key): key is string => typeof key === 'string')
                : [],
        });
    }
    contentTypesCache = { data: map, timestamp: Date.now() };
    return map;
}

/** Drops the cache. The reindex callable calls it so it sees fresh settings. */
export function clearSearchContextCache(): void {
    contentTypesCache = null;
}

/** The context for one document. */
export async function buildSearchContext(collection: string, docId: string): Promise<SearchContext> {
    const [localization, contentTypes] = await Promise.all([
        getLocalizationSettings(),
        loadContentTypes(),
    ]);
    return { collection, docId, localization, contentTypes };
}
