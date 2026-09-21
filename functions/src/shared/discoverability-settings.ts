/**
 * `Settings/discoverability` for the publish pipeline
 * (docs/discoverability-spec.md, D2 default author; D3 crawler policy,
 * llms.txt and IndexNow). Mirrors IDiscoverabilitySettings in
 * src/shared/models/discoverability.model.ts. Cached like site-settings.
 */
import { db } from '../init.js';
import { CRAWLERS, DEFAULT_CRAWLER_POLICY } from './crawlers.js';

export interface DiscoverabilitySettings {
    defaultAuthorId: string;
    /** Allowed (true) or denied (false), keyed by crawler id. Unknown ids are dropped. */
    crawlers: Record<string, boolean>;
    /** Publish /llms.txt and /llms-full.txt. */
    llmsTxt: boolean;
    indexNow: {
        enabled: boolean;
        /** Generated on first use; served at /{key}.txt. */
        key: string;
    };
}

export const DEFAULT_DISCOVERABILITY: DiscoverabilitySettings = {
    defaultAuthorId: '',
    crawlers: { ...DEFAULT_CRAWLER_POLICY },
    llmsTxt: true,
    indexNow: { enabled: true, key: '' },
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { data: DiscoverabilitySettings; timestamp: number } | null = null;

/** Shapes a raw document: defaults filled, unknown crawler ids dropped. */
export function normalizeDiscoverability(raw: unknown): DiscoverabilitySettings {
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    const crawlers: Record<string, boolean> = { ...DEFAULT_CRAWLER_POLICY };
    const stored = data.crawlers && typeof data.crawlers === 'object' ? data.crawlers : {};
    for (const agent of CRAWLERS) {
        if (typeof stored[agent.id] === 'boolean') crawlers[agent.id] = stored[agent.id];
    }
    return {
        defaultAuthorId: typeof data.defaultAuthorId === 'string' ? data.defaultAuthorId : '',
        crawlers,
        llmsTxt: data.llmsTxt !== false,
        indexNow: {
            enabled: data.indexNow?.enabled !== false,
            key: typeof data.indexNow?.key === 'string' ? data.indexNow.key : '',
        },
    };
}

export async function getDiscoverabilitySettings(): Promise<DiscoverabilitySettings> {
    if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) return cache.data;
    try {
        const snap = await db.doc('Settings/discoverability').get();
        const settings = normalizeDiscoverability(snap.exists ? snap.data() : null);
        cache = { data: settings, timestamp: Date.now() };
        return settings;
    } catch (error) {
        // Defaults keep every page publishing; a settings read must never block a deploy.
        console.error('Could not read Settings/discoverability, using defaults:', error);
        return { ...DEFAULT_DISCOVERABILITY, crawlers: { ...DEFAULT_CRAWLER_POLICY } };
    }
}

export function clearDiscoverabilityCache(): void {
    cache = null;
}
