/**
 * Every search source this app has (specs/feature-flags-spec.md, section 6):
 *
 *  - content and content drafts, with the content feature;
 *  - the app's sources written in code (CUSTOM_SEARCH_SOURCES);
 *  - the collections it names (SEARCH_COLLECTIONS) and set up in Search settings.
 *
 * The first two are fixed at deploy; the setups are read from Settings and cached,
 * so every entry point (the search callable, a trigger, a reindex) awaits
 * `refreshSearchSources()` once before using the synchronous lookups below.
 *
 * Spec: specs/search-spec.md, decision S-D7.
 */

import type { SearchSource } from './source.js';
import { sourceMatches } from './source.js';
import { contentSource } from './sources/content.js';
import { contentDraftsSource } from './sources/content-drafts.js';
import { buildCollectionSource, readCollectionSetups } from './collections.js';
import { refusedReason } from './refused.js';
import { isFeatureOn } from '../feature-flags.js';
import { CUSTOM_SEARCH_SOURCES, SEARCH_COLLECTIONS } from '../custom/search-sources.js';

/** Content's own sources: they watch collections created at runtime, so a queue indexes drafts. */
export const CONTENT_SOURCES: readonly SearchSource[] = [contentSource, contentDraftsSource];

/** A trigger's name for a collection: letters, digits and underscores only. */
export function triggerName(collection: string): string {
    return collection.replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * The problems with what an app named, or none. Checked when the functions load,
 * so a refused or malformed name fails the deploy with the reason.
 */
export function searchSetupProblems(collections: readonly string[], codeSources: readonly SearchSource[]): string[] {
    const problems: string[] = [];
    const names = new Map<string, string>();
    const claim = (collection: string, where: string) => {
        const reason = refusedReason(collection);
        if (reason) problems.push(`${where}: ${collection} can never be searchable (${reason}).`);
        if (!/^[A-Za-z0-9_-]+$/.test(collection)) problems.push(`${where}: "${collection}" is not a plain collection name.`);
        const name = triggerName(collection);
        const other = names.get(name);
        if (other && other !== collection) problems.push(`${where}: ${collection} and ${other} would share the trigger searchSync-${name}.`);
        names.set(name, collection);
    };
    for (const collection of collections) claim(collection, 'SEARCH_COLLECTIONS');
    for (const source of codeSources) {
        if (typeof source.collection !== 'string') {
            if (source.trigger !== false) {
                problems.push(`CUSTOM_SEARCH_SOURCES: ${source.id} watches a pattern; name one collection, or set trigger: false and index it yourself.`);
            }
            continue;
        }
        claim(source.collection, `CUSTOM_SEARCH_SOURCES (${source.id})`);
    }
    return problems;
}

const problems = searchSetupProblems(SEARCH_COLLECTIONS, CUSTOM_SEARCH_SOURCES);
if (problems.length) {
    throw new Error(`functions/src/custom/search-sources.ts:\n  - ${problems.join('\n  - ')}`);
}

let configured: SearchSource[] = [];

/** Reads the Search settings setups (cached for a minute; `force` to reread). */
export async function refreshSearchSources(force = false): Promise<void> {
    const setups = await readCollectionSetups(force);
    configured = SEARCH_COLLECTIONS.filter((c) => setups[c]).map((c) => buildCollectionSource(c, setups[c]));
}

/** Every source, as of the last refresh. */
export function searchSources(): SearchSource[] {
    return [
        ...(isFeatureOn('content') ? CONTENT_SOURCES : []),
        ...CUSTOM_SEARCH_SOURCES,
        ...configured,
    ];
}

/** The collections that get their own trigger: named ones and code sources' fixed ones. */
export function triggeredCollections(): string[] {
    const fromCode = CUSTOM_SEARCH_SOURCES
        .filter((s) => typeof s.collection === 'string' && s.trigger !== false)
        .map((s) => s.collection as string);
    return [...new Set([...SEARCH_COLLECTIONS, ...fromCode])];
}

export function findSources(collection: string, sources: readonly SearchSource[] = searchSources()): SearchSource[] {
    return sources.filter(source => sourceMatches(source, collection));
}

export function findSource(id: string, sources: readonly SearchSource[] = searchSources()): SearchSource | undefined {
    return sources.find(source => source.id === id);
}
