import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDocGet } = vi.hoisted(() => ({ mockDocGet: vi.fn() }));

vi.mock('../init', () => ({
    db: {
        collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockDocGet })) })),
    },
}));

import {
    authorTemplateData,
    authorToPerson,
    clearAuthorCache,
    getAuthor,
    toAuthorProfile,
} from '../shared/authors.js';
import { contentSearchFields } from '../search/sources/content-fields.js';

describe('authors (docs/discoverability-spec.md, D2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAuthorCache();
    });

    it('toAuthorProfile trims, filters sameAs and needs a name', () => {
        expect(toAuthorProfile('a1', { name: ' ' })).toBeNull();
        expect(toAuthorProfile('a1', undefined)).toBeNull();
        expect(toAuthorProfile('a1', {
            name: ' Jane ', bio: 'Writes.', sameAs: ['https://x.com/jane', 'nope', 3], jobTitle: 'Founder',
        })).toEqual({
            id: 'a1', name: 'Jane', slug: '', bio: 'Writes.', photoUrl: '', jobTitle: 'Founder', url: '', sameAs: ['https://x.com/jane'],
        });
    });

    it('getAuthor returns null for no id, a missing doc, or a failed read', async () => {
        expect(await getAuthor('')).toBeNull();
        expect(await getAuthor(null)).toBeNull();
        mockDocGet.mockResolvedValueOnce({ exists: false });
        expect(await getAuthor('missing')).toBeNull();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockDocGet.mockRejectedValueOnce(new Error('down'));
        expect(await getAuthor('boom')).toBeNull();
        errorSpy.mockRestore();
    });

    it('getAuthor reads once per id within the cache window', async () => {
        mockDocGet.mockResolvedValue({ exists: true, id: 'a1', data: () => ({ name: 'Jane' }) });
        const first = await getAuthor('a1');
        const second = await getAuthor('a1');
        expect(first?.name).toBe('Jane');
        expect(second).toBe(first);
        expect(mockDocGet).toHaveBeenCalledTimes(1);
    });

    it('authorToPerson omits empty fields and is undefined without an author', () => {
        expect(authorToPerson(null)).toBeUndefined();
        expect(authorToPerson({ id: 'a1', name: 'Jane', slug: '', bio: '', photoUrl: '', jobTitle: '', url: 'https://jane.dev', sameAs: [] }))
            .toEqual({ name: 'Jane', url: 'https://jane.dev', imageUrl: undefined, description: undefined, jobTitle: undefined, sameAs: [] });
    });

    it('authorTemplateData gives an object for bindings and a flat name', () => {
        expect(authorTemplateData(null)).toEqual({ author: {}, authorName: '' });
        const data = authorTemplateData({ id: 'a1', name: 'Jane', slug: 'jane', bio: 'B', photoUrl: 'P', jobTitle: 'J', url: 'U', sameAs: [] });
        expect(data.authorName).toBe('Jane');
        expect(data.author).toEqual({ name: 'Jane', bio: 'B', photoUrl: 'P', jobTitle: 'J', url: 'U' });
    });

    it('the content search source indexes authorName with a low weight', () => {
        const specs = contentSearchFields(undefined);
        const author = specs.find(s => s.path === 'authorName');
        expect(author).toBeDefined();
        expect(author!.weight).toBeLessThan(specs.find(s => s.path === 'title')!.weight);
        expect(author!.prefix).toBe(true);
    });
});
