/**
 * The `search` callable: request parsing, scope enforcement, the Firestore
 * queries it issues, and ranking plus fallback end to end against a fake
 * index.
 *
 * Spec: docs/search-spec.md, phase S3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    }
    return {
        onCall: vi.fn((...args: unknown[]) => (args.length === 2 ? args[1] : args[0])),
        HttpsError,
    };
});

interface FakeEntry {
    id: string;
    source: string;
    scope: string;
    lang: string;
    tokens: string[];
    fields: Record<string, string>;
    weights: Record<string, number>;
    boost: number;
    title: string;
    snippet: string;
    badge: string;
    link: string;
    meta: Record<string, unknown>;
    docId: string;
    sortAt: { seconds: number };
}

const index: FakeEntry[] = [];
const issuedQueries: { filters: [string, string, unknown][] }[] = [];
const getUser = vi.fn();

vi.mock('../init.js', () => ({
    db: {
        collection: () => {
            const filters: [string, string, unknown][] = [];
            const query = {
                where: (field: string, op: string, value: unknown) => { filters.push([field, op, value]); return query; },
                orderBy: () => query,
                limit: () => query,
                get: async () => {
                    issuedQueries.push({ filters });
                    const docs = index
                        .filter(entry => filters.every(([field, op, value]) => {
                            const actual = (entry as unknown as Record<string, unknown>)[field];
                            if (op === '==') return actual === value;
                            if (op === 'array-contains-any') return (actual as string[]).some(t => (value as string[]).includes(t));
                            return true;
                        }))
                        .map(entry => ({ id: entry.id, data: () => entry }));
                    return { docs, empty: docs.length === 0, size: docs.length };
                },
            };
            return query;
        },
    },
    owner: { getUser: (...args: unknown[]) => getUser(...args) },
}));

import { search, parseRequest, authorize, candidateQueries, runSearch, readableScopes } from '../search/search.js';
import { fallbackTokenSets } from '../search/fallback.js';
import { tokenize } from '../search/tokenizer.js';

type Handler = (request: { data: unknown; auth?: { uid: string; token: Record<string, unknown> } }) => Promise<unknown>;
const handler = search as unknown as Handler;

function entry(id: string, source: string, scope: string, lang: string, title: string, snippet = '', seconds = 1): FakeEntry {
    return {
        id, source, scope, lang, title, snippet,
        tokens: [...tokenize(title, { prefix: true }), ...tokenize(snippet, { prefix: true })],
        fields: snippet ? { title, summary: snippet } : { title },
        weights: snippet ? { title: 3, summary: 2 } : { title: 3 },
        boost: 1,
        badge: source, link: `/${source}/${id}`, meta: {}, docId: id, sortAt: { seconds },
    };
}

beforeEach(() => {
    index.length = 0;
    issuedQueries.length = 0;
    getUser.mockReset();
    index.push(
        entry('a', 'content', 'public', 'en', 'Gunjan Karun', '', 3),
        entry('b', 'content', 'public', 'en', 'Firebase Hosting Guide', 'Written by Gunjan Karun in 2024', 2),
        entry('c', 'content', 'public', 'en', 'Interview: Gunjan on Firebase', '', 1),
        entry('h', 'content', 'public', 'hi', 'गुंजन करुण', '', 1),
        entry('d', 'content-drafts', 'admin', 'en', 'Gunjan Karun draft', '', 4),
    );
});

describe('parseRequest', () => {
    it('applies defaults and caps', () => {
        const parsed = parseRequest({ q: '  kar  ' });
        expect(parsed).toMatchObject({ q: 'kar', lang: '*', scope: 'public', sources: null, limit: 8 });
        expect(parseRequest({ q: 'x'.repeat(500) }).q).toHaveLength(120);
        expect(parseRequest({ q: 'x', limit: 99 }).limit).toBe(20);
        expect(parseRequest({ q: 'x', limit: 0 }).limit).toBe(1);
        expect(parseRequest({ q: 'x', lang: ' EN ' }).lang).toBe('en');
    });

    it('rejects bad input', () => {
        expect(() => parseRequest({})).toThrow(/q must be/);
        expect(() => parseRequest({ q: 'x', scope: 'root' })).toThrow(/scope/);
        expect(() => parseRequest({ q: 'x', sources: 'content' })).toThrow(/sources/);
        expect(() => parseRequest({ q: 'x', sources: ['nope'] })).toThrow(/Unknown search source/);
        expect(() => parseRequest({ q: 'x', sources: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(/At most 5/);
        expect(() => parseRequest({ q: 'x', limit: 'ten' })).toThrow(/limit/);
    });
});

describe('authorize', () => {
    it('lets a public caller search public sources only', async () => {
        await expect(authorize({} as never, parseRequest({ q: 'x', sources: ['content'] }))).resolves.toBeUndefined();
        await expect(authorize({} as never, parseRequest({ q: 'x', sources: ['content-drafts'] })))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('requires auth for authenticated scope and an admin for admin scope', async () => {
        await expect(authorize({} as never, parseRequest({ q: 'x', scope: 'authenticated' })))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(authorize({} as never, parseRequest({ q: 'x', scope: 'admin' })))
            .rejects.toMatchObject({ code: 'unauthenticated' });

        getUser.mockResolvedValue({ customClaims: {} });
        await expect(authorize({ auth: { uid: 'u', token: {} } } as never, parseRequest({ q: 'x', scope: 'admin' })))
            .rejects.toMatchObject({ code: 'permission-denied' });

        await expect(authorize({ auth: { uid: 'u', token: { role: 'admin' } } } as never, parseRequest({ q: 'x', scope: 'admin', sources: ['content-drafts'] })))
            .resolves.toBeUndefined();
    });

    it('maps request scopes to readable source scopes', () => {
        expect(readableScopes('public')).toEqual(['public']);
        expect(readableScopes('authenticated')).toEqual(['public', 'authenticated']);
        expect(readableScopes('admin')).toEqual(['public', 'authenticated', 'admin']);
    });
});

describe('candidateQueries', () => {
    it('queries each readable scope for the language and for any-language', () => {
        const queries = candidateQueries(parseRequest({ q: 'x', lang: 'en', scope: 'public' }));
        expect(queries).toEqual([
            { field: 'scope', value: 'public', lang: 'en' },
            { field: 'scope', value: 'public', lang: '*' },
        ]);
    });

    it("issues one unfiltered query per target for lang 'all'", () => {
        const queries = candidateQueries(parseRequest({ q: 'x', lang: 'all', scope: 'public' }));
        expect(queries).toEqual([{ field: 'scope', value: 'public', lang: 'all' }]);
    });

    it('queries per named source instead of per scope', () => {
        const queries = candidateQueries(parseRequest({ q: 'x', lang: 'hi', scope: 'admin', sources: ['content', 'content-drafts'] }));
        expect(queries.map(q => `${q.field}=${q.value}/${q.lang}`)).toEqual([
            'source=content/hi', 'source=content/*', 'source=content-drafts/hi', 'source=content-drafts/*',
        ]);
    });

    it('skips scopes no source uses', () => {
        const queries = candidateQueries(parseRequest({ q: 'x', scope: 'admin' }));
        expect(queries.map(q => q.value)).toEqual(['public', 'admin']);
    });
});

describe('runSearch', () => {
    it('returns ranked public results for the language, never admin entries', async () => {
        const response = await runSearch(parseRequest({ q: 'kar', lang: 'en', scope: 'public' }));
        expect(response.results.map(r => r.docId)).toEqual(['a', 'b']);
        expect(response.results[0].highlights.title).toEqual([[7, 10]]);
        expect(response.results[0].link).toBe('/content/a');
        expect(response.fallbackUsed).toBeUndefined();
        expect(typeof response.tookMs).toBe('number');
    });

    it('honours the language filter', async () => {
        const response = await runSearch(parseRequest({ q: 'गुंजन', lang: 'hi', scope: 'public' }));
        expect(response.results.map(r => r.docId)).toEqual(['h']);
    });

    it("searches every language for lang 'all' and folds a document's variants into one row", async () => {
        index.push(entry('a-hi', 'content', 'public', 'hi', 'Gunjan Karun (hi)', '', 3));
        index[index.length - 1].docId = 'a';
        const response = await runSearch(parseRequest({ q: 'gunjan', lang: 'all', scope: 'public' }));
        const ids = response.results.map(r => r.docId);
        expect(ids.filter(id => id === 'a')).toHaveLength(1);
        const hindi = await runSearch(parseRequest({ q: 'गुंजन', lang: 'all', scope: 'public' }));
        expect(hindi.results.map(r => r.docId)).toEqual(['h']);
        expect(issuedQueries.every(q => !q.filters.some(([field]) => field === 'lang'))).toBe(true);
    });

    it('includes admin entries for an admin-scope request', async () => {
        const response = await runSearch(parseRequest({ q: 'gunjan karun', lang: 'en', scope: 'admin' }));
        expect(response.results.map(r => r.docId)).toContain('d');
    });

    it('reads nothing for a stop-word-only or empty query', async () => {
        expect((await runSearch(parseRequest({ q: '' }))).results).toEqual([]);
        expect(issuedQueries).toHaveLength(0);
    });

    it('falls back to a shorter token on a typo and says so', async () => {
        const response = await runSearch(parseRequest({ q: 'gunjam', lang: 'en', scope: 'public' }));
        expect(response.fallbackUsed).toBe('gunja');
        expect(response.results.map(r => r.docId)).toEqual(['a', 'c', 'b']);
    });

    it('limits the results', async () => {
        const response = await runSearch(parseRequest({ q: 'gunjan', lang: 'en', scope: 'public', limit: 1 }));
        expect(response.results).toHaveLength(1);
    });
});

describe('fallbackTokenSets', () => {
    it('shortens the shortest long-enough token, twice at most, never below 3', () => {
        expect(fallbackTokenSets(['gunjam']).map(a => a.tokens)).toEqual([['gunjam'], ['gunja'], ['gunj']]);
        expect(fallbackTokenSets(['abc'])).toEqual([{ tokens: ['abc'] }]);
        expect(fallbackTokenSets(['firebase', 'gunj']).map(a => a.fallback)).toEqual([undefined, 'gun']);
        expect(fallbackTokenSets(['firebase', 'gunj'])[1].tokens).toEqual(['firebase', 'gun']);
        expect(fallbackTokenSets([])).toEqual([{ tokens: [] }]);
    });
});

describe('search callable', () => {
    it('rejects a public request that names an admin source before reading anything', async () => {
        await expect(handler({ data: { q: 'kar', sources: ['content-drafts'] } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(issuedQueries).toHaveLength(0);
    });

    it('answers a plain public request', async () => {
        const response = await handler({ data: { q: 'kar', lang: 'en' } }) as { results: { docId: string }[] };
        expect(response.results.map(r => r.docId)).toEqual(['a', 'b']);
    });
});
