/**
 * The public content types the publish side prefixes links for
 * (functions/src/shared/public-content-types.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../init', () => ({ db: { collection: () => ({ get: mockGet }) } }));

import { clearPublicContentTypesCache, publicContentTypeSlugs } from '../shared/public-content-types.js';

const types = (...list: Record<string, unknown>[]) => ({ docs: list.map((data) => ({ data: () => data })) });

describe('publicContentTypeSlugs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPublicContentTypesCache();
    });

    it('lists the types with public pages', async () => {
        mockGet.mockResolvedValue(types({ slug: 'articles' }, { slug: 'notes', hasPublicUrl: false }, { name: 'no slug' }));
        expect([...await publicContentTypeSlugs()]).toEqual(['articles']);
    });

    it('reads them once a minute, not once a page', async () => {
        mockGet.mockResolvedValue(types({ slug: 'articles' }));
        await publicContentTypeSlugs(1000);
        await publicContentTypeSlugs(30_000);
        expect(mockGet).toHaveBeenCalledTimes(1);
        await publicContentTypeSlugs(62_000);
        expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('is empty when they cannot be read, so no link is pointed at a page that may not exist, and asks again next time', async () => {
        mockGet.mockRejectedValueOnce(new Error('offline'));
        expect((await publicContentTypeSlugs()).size).toBe(0);
        mockGet.mockResolvedValue(types({ slug: 'articles' }));
        expect([...await publicContentTypeSlugs()]).toEqual(['articles']);
    });
});
