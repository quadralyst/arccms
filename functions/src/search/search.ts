/**
 * The `search` callable: one ranked, scoped, language-aware endpoint for
 * every search box on the site.
 *
 * Request  { q, lang, scope, sources?, limit? }
 * Response { results, tookMs, fallbackUsed? }
 *
 * Public callers never see an admin source: the scope of the request is
 * checked against the scope of every source it may touch before a single
 * read happens (S-D8). The index itself is closed to clients by rules, so
 * this function is the only way in.
 *
 * Spec: docs/search-spec.md, phase S3.
 */

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { isAdminCaller } from './auth.js';
import { SEARCH_SOURCES, findSource } from './registry.js';
import { queryTokens } from './tokenizer.js';
import { rank, type Highlights } from './ranking.js';
import { fallbackTokenSets } from './fallback.js';
import {
    ANY_LANGUAGE,
    SEARCH_INDEX_COLLECTION,
    SEARCH_SCOPES,
    type SearchIndexEntry,
    type SearchScope,
    type SearchSource,
} from './source.js';

export const MAX_QUERY_LENGTH = 120;
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;
export const MAX_SOURCES_PER_CALL = 5;
/** Candidates read per Firestore query (see the risk note on candidate caps). */
export const CANDIDATES_PER_QUERY = 50;

export interface SearchRequest {
    q: string;
    lang?: string;
    scope?: SearchScope;
    sources?: string[];
    limit?: number;
}

export interface SearchResult {
    source: string;
    docId: string;
    lang: string;
    title: string;
    snippet?: string;
    badge?: string;
    link: string;
    meta?: Record<string, unknown>;
    score: number;
    highlights: Highlights;
}

export interface SearchResponse {
    results: SearchResult[];
    tookMs: number;
    /** The shortened last token, when the typo fallback produced the results. */
    fallbackUsed?: string;
}

interface ParsedRequest {
    q: string;
    lang: string;
    scope: SearchScope;
    sources: SearchSource[] | null;
    limit: number;
}

/** Which source scopes a request scope may read. */
export function readableScopes(scope: SearchScope): SearchScope[] {
    switch (scope) {
        case 'public': return ['public'];
        case 'authenticated': return ['public', 'authenticated'];
        case 'admin': return ['public', 'authenticated', 'admin'];
    }
}

export function parseRequest(data: unknown): ParsedRequest {
    const raw = (data ?? {}) as Partial<SearchRequest>;

    if (typeof raw.q !== 'string') throw new HttpsError('invalid-argument', 'q must be a string.');
    const q = raw.q.trim().slice(0, MAX_QUERY_LENGTH);

    const lang = typeof raw.lang === 'string' && raw.lang.trim()
        ? raw.lang.trim().toLowerCase()
        : ANY_LANGUAGE;

    const scope = raw.scope ?? 'public';
    if (!SEARCH_SCOPES.includes(scope)) throw new HttpsError('invalid-argument', 'scope is not valid.');

    let sources: SearchSource[] | null = null;
    if (raw.sources !== undefined) {
        if (!Array.isArray(raw.sources) || raw.sources.some(id => typeof id !== 'string')) {
            throw new HttpsError('invalid-argument', 'sources must be a list of source ids.');
        }
        if (raw.sources.length > MAX_SOURCES_PER_CALL) {
            throw new HttpsError('invalid-argument', `At most ${MAX_SOURCES_PER_CALL} sources per call.`);
        }
        sources = raw.sources.map(id => {
            const source = findSource(id);
            if (!source) throw new HttpsError('not-found', `Unknown search source: ${id}`);
            return source;
        });
    }

    let limit = DEFAULT_LIMIT;
    if (raw.limit !== undefined) {
        if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
            throw new HttpsError('invalid-argument', 'limit must be a number.');
        }
        limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(raw.limit)));
    }

    return { q, lang, scope, sources, limit };
}

/**
 * Refuses the request outright if any named source is outside what the
 * caller may read. Silently dropping the source would hide a misconfigured
 * search box behind empty results.
 */
export async function authorize(request: CallableRequest, parsed: ParsedRequest): Promise<void> {
    if (parsed.scope === 'authenticated' && !request.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    if (parsed.scope === 'admin') {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
        if (!(await isAdminCaller(request))) throw new HttpsError('permission-denied', 'Admin access required.');
    }
    const allowed = readableScopes(parsed.scope);
    for (const source of parsed.sources ?? []) {
        if (!allowed.includes(source.scope)) {
            throw new HttpsError('permission-denied', `Source ${source.id} is not searchable in scope ${parsed.scope}.`);
        }
    }
}

interface CandidateQuery {
    field: 'scope' | 'source';
    value: string;
    lang: string;
}

/** One Firestore query per (scope or source) and per (lang, any-language). */
export function candidateQueries(parsed: ParsedRequest): CandidateQuery[] {
    const langs = parsed.lang === ANY_LANGUAGE ? [ANY_LANGUAGE] : [parsed.lang, ANY_LANGUAGE];
    const targets: { field: 'scope' | 'source'; value: string }[] = parsed.sources
        ? parsed.sources.map(source => ({ field: 'source', value: source.id }))
        : readableScopes(parsed.scope)
            .filter(scope => SEARCH_SOURCES.some(source => source.scope === scope))
            .map(scope => ({ field: 'scope', value: scope }));
    return targets.flatMap(target => langs.map(lang => ({ ...target, lang })));
}

async function fetchCandidates(queries: CandidateQuery[], tokens: string[]): Promise<Map<string, SearchIndexEntry>> {
    const snapshots = await Promise.all(queries.map(query =>
        db.collection(SEARCH_INDEX_COLLECTION)
            .where(query.field, '==', query.value)
            .where('lang', '==', query.lang)
            .where('tokens', 'array-contains-any', tokens)
            .orderBy('sortAt', 'desc')
            .limit(CANDIDATES_PER_QUERY)
            .get(),
    ));
    const byId = new Map<string, SearchIndexEntry>();
    for (const snap of snapshots) {
        for (const doc of snap.docs) byId.set(doc.id, doc.data() as SearchIndexEntry);
    }
    return byId;
}

export async function runSearch(parsed: ParsedRequest): Promise<SearchResponse> {
    const started = Date.now();
    const { tokens, phrase } = queryTokens(parsed.q);
    if (tokens.length === 0) return { results: [], tookMs: Date.now() - started };

    const queries = candidateQueries(parsed);
    if (queries.length === 0) return { results: [], tookMs: Date.now() - started };

    for (const attempt of fallbackTokenSets(tokens)) {
        const candidates = await fetchCandidates(queries, attempt.tokens);
        if (candidates.size === 0) continue;

        const ranked = rank([...candidates.values()], attempt.tokens, attempt.fallback ? '' : phrase);
        if (ranked.length === 0) continue;

        const results: SearchResult[] = ranked.slice(0, parsed.limit).map(({ entry, score, highlights }) => ({
            source: entry.source,
            docId: entry.docId,
            lang: entry.lang,
            title: entry.title,
            snippet: entry.snippet || undefined,
            badge: entry.badge || undefined,
            link: entry.link,
            meta: entry.meta && Object.keys(entry.meta).length ? entry.meta : undefined,
            score: Math.round(score * 1000) / 1000,
            highlights,
        }));
        return { results, tookMs: Date.now() - started, ...(attempt.fallback ? { fallbackUsed: attempt.fallback } : {}) };
    }

    return { results: [], tookMs: Date.now() - started };
}

export const search = onCall({ cors: true }, async (request) => {
    const parsed = parseRequest(request.data);
    await authorize(request, parsed);
    return runSearch(parsed);
});
