/**
 * Client for the `search` and `reindexSearch` callables.
 *
 * Every search box on the site goes through here: the admin header, the
 * public header widget in the SPA, the two results pages, and any page a
 * developer builds on top of a custom source. It debounces nothing itself;
 * the search box owns the keystroke timing. It does cache: the same query
 * in the same scope and language is answered from memory for the session,
 * and a response that arrives after a newer request was sent is dropped.
 *
 * Spec: docs/search-spec.md, phase S4 item 1.
 */

import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
    ReindexRequest,
    SearchRequest,
    SearchResponse,
    SourceReindexResult,
} from '../../../shared/models/search.model';

/** Queries shorter than this are not sent (S4 item 1). */
export const MIN_QUERY_LENGTH = 2;

/** Keystroke debounce the search box uses. */
export const SEARCH_DEBOUNCE_MS = 250;

const CACHE_LIMIT = 200;

@Injectable({ providedIn: 'root' })
export class SearchService {
    /**
     * Optional so a host without Firebase Functions (a spec rendering the
     * public header, a storybook) gets an empty answer rather than a crash.
     */
    private functions = inject(Functions, { optional: true });
    private cache = new Map<string, SearchResponse>();
    private sequence = 0;

    /** True when the query is long enough to be worth a round trip. */
    isSearchable(q: string): boolean {
        return q.trim().length >= MIN_QUERY_LENGTH;
    }

    /**
     * Runs one search. Resolves to null when a newer search was started
     * before this one answered, so a caller can ignore stale responses by
     * checking for null.
     */
    async search(request: SearchRequest): Promise<SearchResponse | null> {
        const q = request.q.trim();
        if (!this.isSearchable(q)) return { results: [], tookMs: 0 };

        const key = this.cacheKey({ ...request, q });
        const cached = this.cache.get(key);
        if (cached) return cached;

        const ticket = ++this.sequence;
        const response = await this.call({ ...request, q });
        if (ticket !== this.sequence) return null;

        this.remember(key, response);
        return response;
    }

    /** Rebuilds the index. Admin only; the function enforces it. */
    async reindex(request: ReindexRequest = {}): Promise<SourceReindexResult[]> {
        if (!this.functions) throw new Error('Firebase Functions is not available.');
        const callable = httpsCallable<ReindexRequest, { results: SourceReindexResult[] }>(this.functions, 'reindexSearch');
        const result = await callable(request);
        this.cache.clear();
        return result.data.results;
    }

    /** Drops the session cache, for after content changes. */
    clearCache(): void {
        this.cache.clear();
    }

    protected async call(request: SearchRequest): Promise<SearchResponse> {
        if (!this.functions) return { results: [], tookMs: 0 };
        const callable = httpsCallable<SearchRequest, SearchResponse>(this.functions, 'search');
        // The SDK would send an undefined field as null; leave it out instead.
        const payload = Object.fromEntries(
            Object.entries(request).filter(([, value]) => value !== undefined),
        ) as SearchRequest;
        const result = await callable(payload);
        return result.data;
    }

    private cacheKey(request: SearchRequest): string {
        return JSON.stringify([
            request.q.toLowerCase(),
            request.lang ?? '',
            request.scope ?? 'public',
            [...(request.sources ?? [])].sort(),
            request.limit ?? 0,
        ]);
    }

    private remember(key: string, response: SearchResponse): void {
        if (this.cache.size >= CACHE_LIMIT) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, response);
    }
}
