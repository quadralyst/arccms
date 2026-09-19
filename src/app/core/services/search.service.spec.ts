import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { SearchService } from './search.service';

const { callableMock } = vi.hoisted(() => ({ callableMock: vi.fn() }));
vi.mock('@angular/fire/functions', async () => {
    const actual = await vi.importActual<typeof import('@angular/fire/functions')>('@angular/fire/functions');
    return {
        ...actual,
        httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callableMock(name, data),
    };
});

describe('SearchService', () => {
    let service: SearchService;

    beforeEach(() => {
        callableMock.mockReset();
        TestBed.configureTestingModule({ providers: [{ provide: Functions, useValue: {} }] });
        service = TestBed.inject(SearchService);
    });

    it('does not call the function for a query under two characters', async () => {
        expect(await service.search({ q: ' k ' })).toEqual({ results: [], tookMs: 0 });
        expect(callableMock).not.toHaveBeenCalled();
        expect(service.isSearchable('k')).toBe(false);
        expect(service.isSearchable('ka')).toBe(true);
    });

    it('calls the search callable with a trimmed query and caches the answer', async () => {
        callableMock.mockResolvedValue({ data: { results: [{ docId: 'a' }], tookMs: 3 } });
        const first = await service.search({ q: ' kar ', lang: 'en', scope: 'public' });
        const second = await service.search({ q: 'KAR', lang: 'en', scope: 'public' });

        expect(callableMock).toHaveBeenCalledTimes(1);
        expect(callableMock).toHaveBeenCalledWith('search', { q: 'kar', lang: 'en', scope: 'public' });
        expect(second).toBe(first);
    });

    it('keys the cache on scope, sources, language and limit', async () => {
        callableMock.mockResolvedValue({ data: { results: [], tookMs: 0 } });
        await service.search({ q: 'kar', scope: 'public' });
        await service.search({ q: 'kar', scope: 'admin' });
        await service.search({ q: 'kar', scope: 'admin', sources: ['content-drafts'] });
        await service.search({ q: 'kar', scope: 'admin', sources: ['content-drafts'], limit: 20 });
        expect(callableMock).toHaveBeenCalledTimes(4);
    });

    it('drops a response that arrives after a newer search started', async () => {
        let resolveFirst!: (value: unknown) => void;
        callableMock
            .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ data: { results: [{ docId: 'second' }], tookMs: 1 } });

        const first = service.search({ q: 'ka' });
        const second = await service.search({ q: 'kar' });
        resolveFirst({ data: { results: [{ docId: 'first' }], tookMs: 1 } });

        expect(await first).toBeNull();
        expect(second?.results[0]).toEqual({ docId: 'second' });
    });

    it('reindexes through the admin callable and clears the cache', async () => {
        callableMock.mockResolvedValueOnce({ data: { results: [], tookMs: 0 } });
        await service.search({ q: 'kar' });
        callableMock.mockResolvedValueOnce({ data: { results: [{ source: 'content', entries: 2 }] } });
        const results = await service.reindex({ source: 'content' });

        expect(callableMock).toHaveBeenLastCalledWith('reindexSearch', { source: 'content' });
        expect(results).toEqual([{ source: 'content', entries: 2 }]);

        callableMock.mockResolvedValueOnce({ data: { results: [], tookMs: 0 } });
        await service.search({ q: 'kar' });
        expect(callableMock).toHaveBeenCalledTimes(3);
    });
});
