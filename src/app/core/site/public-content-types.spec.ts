/**
 * The public content types in the browser app (public-content-types.ts): which
 * links take the language, and which /{lang}/... addresses are content.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { UrlSegment } from '@angular/router';

const { mockGetDocs } = vi.hoisted(() => ({ mockGetDocs: vi.fn() }));
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: vi.fn(() => 'ContentTypes'),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

import { Firestore } from '@angular/fire/firestore';
import { PublicContentTypesService, publicContentTypeGuard } from './public-content-types';

const types = (...list: Record<string, unknown>[]) => ({ docs: list.map((data) => ({ data: () => data })) });
const segments = (...paths: string[]) => paths.map((path) => new UrlSegment(path, {}));

describe('PublicContentTypesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
    });

    it('reads the types with public pages once, and shows them as a signal', async () => {
        mockGetDocs.mockResolvedValue(types({ slug: 'articles' }, { slug: 'notes', hasPublicUrl: false }));
        const service = TestBed.inject(PublicContentTypesService);
        expect(service.slugs().size).toBe(0);
        expect([...await service.load()]).toEqual(['articles']);
        await service.load();
        expect(mockGetDocs).toHaveBeenCalledTimes(1);
        expect([...service.slugs()]).toEqual(['articles']);
    });

    it('stays empty, and asks again next time, when they cannot be read', async () => {
        mockGetDocs.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(types({ slug: 'articles' }));
        const service = TestBed.inject(PublicContentTypesService);
        expect((await service.load()).size).toBe(0);
        expect([...await service.load()]).toEqual(['articles']);
    });

    it('lets /{lang}/{type} match only a public content type', async () => {
        mockGetDocs.mockResolvedValue(types({ slug: 'articles' }));
        const guard = (...paths: string[]) => TestBed.runInInjectionContext(() => publicContentTypeGuard({}, segments(...paths)));
        expect(await guard('hi', 'articles')).toBe(true);
        expect(await guard('hi', 'articles', 'my-post')).toBe(true);
        expect(await guard('hi', 'signup')).toBe(false);
        expect(await guard('hi', 'learn', 'lesson-1')).toBe(false);
    });

    it('lets everything through when the list cannot be read, as before', async () => {
        mockGetDocs.mockRejectedValue(new Error('offline'));
        expect(await TestBed.runInInjectionContext(() => publicContentTypeGuard({}, segments('hi', 'articles')))).toBe(true);
    });
});
