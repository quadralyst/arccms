/**
 * mediaUsage: how many content entries use a media library file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAdmin, store, selects, reads } = vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    /** collection name: { id: data } */
    store: {} as Record<string, Record<string, Record<string, unknown>>>,
    selects: [] as string[][],
    /** Entries read by content queries, and how many queries. */
    reads: { docs: 0, queries: 0, largestPage: 0 },
}));

function docs(name: string) {
    return Object.entries(store[name] ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, data]) => ({ id, data: () => data }));
}

/** A paged query: select, limit, startAfter, get, as the Admin SDK has them. */
function pagedQuery(name: string, lim = Infinity, after?: { id: string }): any {
    return {
        limit: (n: number) => pagedQuery(name, n, after),
        startAfter: (snap: { id: string }) => pagedQuery(name, lim, snap),
        get: async () => {
            const all = docs(name);
            const from = after ? all.findIndex((d) => d.id === after.id) + 1 : 0;
            const page = all.slice(from, from + lim);
            reads.docs += page.length;
            reads.queries += 1;
            reads.largestPage = Math.max(reads.largestPage, page.length);
            return { docs: page };
        },
    };
}

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => ({
            doc: (id: string) => ({
                get: async () => ({ exists: !!store[name]?.[id], data: () => store[name]?.[id] }),
            }),
            get: async () => ({ docs: docs(name) }),
            select: (...fields: string[]) => {
                selects.push(fields);
                return pagedQuery(name);
            },
        }),
    },
}));
vi.mock('../search/auth', () => ({ requireAdmin }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (options: unknown, handler?: Function) => handler ?? options,
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    },
}));

import { USAGE_CAP, USAGE_PAGE, holdsMedia, mediaPaths, mediaUsage, storagePathOf, usageNeedles } from './mediaUsage.js';

const call = (data: unknown) => (mediaUsage as unknown as Function)({ auth: { uid: 'a1', token: {} }, data });

const BUCKET = 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/';
const url = (path: string, token = 't1') => `${BUCKET}${encodeURIComponent(path)}?alt=media&token=${token}`;
const sized = (size: string) => `arccms/mediaImages/photo-a1b2-${size}.webp`;
const photo = {
    downloadURL: url(sized('xl')),
    variants: Object.fromEntries(['s', 'm', 'l', 'xl'].map((s) => [s, { path: sized(s), url: url(sized(s), `tok-${s}`) }])),
};

describe('mediaUsage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selects.length = 0;
        Object.assign(reads, { docs: 0, queries: 0, largestPage: 0 });
        for (const key of Object.keys(store)) delete store[key];
        requireAdmin.mockResolvedValue(undefined);
        store['media'] = { p1: photo };
        store['ContentTypes'] = { blog: { slug: 'blog' }, info: { slug: 'info' } };
    });

    it('counts an entry that uses any size of the image, in any field, once', async () => {
        store['arc_blog_drafts'] = {
            a: { title: 'Spring news', content: `<p>Hi</p><img src="${url(sized('m'), 'other')}">` },
            b: { title: 'Cover only', coverImage: url(sized('xl')) },
            c: { title: 'Gallery', customFields: { gallery: [{ id: 'r1', image: url(sized('s')) }] } },
            d: { title: 'Unrelated', content: `<img src="${url('arccms/mediaImages/other-m.webp')}">` },
        };
        // The published copy of entry a: the same entry, counted once.
        store['arc_blog'] = { a: { title: 'Spring news', coverImage: url(sized('l')) } };
        store['arc_info_drafts'] = { about: { title: 'About', customFields: { photo: url(sized('l')) } } };

        const result = await call({ mediaId: 'p1' });
        expect(result.count).toBe(4);
        expect(result.titles).toHaveLength(3);
        expect(result.titles).not.toContain('Unrelated');
    });

    it('reads only the fields that can hold a file', async () => {
        await call({ mediaId: 'p1' });
        expect(selects.length).toBe(4); // drafts and published of two types, one page each
        expect(selects[0]).toEqual(['title', 'coverImage', 'content', 'customFields']);
    });

    it('is zero when nothing uses it', async () => {
        store['arc_blog_drafts'] = { a: { title: 'Plain', content: '<p>No images</p>' } };
        expect(await call({ mediaId: 'p1' })).toEqual({ count: 0, titles: [], more: false });
    });

    it('does not count a field copied in from another entry', async () => {
        store['arc_blog_drafts'] = {
            a: { title: 'Linker', customFields: { related: { _refCollection: 'arc_info', _refId: 'about', coverImage: url(sized('xl')) } } },
        };
        expect((await call({ mediaId: 'p1' })).count).toBe(0);
    });

    it('finds a document (PDF) by its file', async () => {
        store['mediaFiles'] = { f1: { path: 'arccms/mediaFiles/guide.pdf', downloadURL: url('arccms/mediaFiles/guide.pdf') } };
        store['arc_blog_drafts'] = {
            a: { title: 'Guide', customFields: { files: [{ url: url('arccms/mediaFiles/guide.pdf'), title: 'Guide' }] } },
        };
        expect(await call({ fileId: 'f1' })).toEqual({ count: 1, titles: ['Guide'], more: false });
    });

    it('is zero for a file that is gone', async () => {
        expect(await call({ mediaId: 'missing' })).toEqual({ count: 0, titles: [], more: false });
    });

    it('is for admins only, and needs an id', async () => {
        requireAdmin.mockRejectedValueOnce(new Error('Admin access required.'));
        await expect(call({ mediaId: 'p1' })).rejects.toThrow('Admin access required.');
        await expect(call({})).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ mediaId: 'a/b' })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    describe('cost on a large site (review M5)', () => {
        const many = (n: number, uses: (i: number) => boolean) => Object.fromEntries(Array.from({ length: n }, (_, i) => [
            `e${String(i).padStart(5, '0')}`,
            { title: `Entry ${i}`, content: uses(i) ? `<img src="${url(sized('m'))}">` : '<p>Text</p>' },
        ]));

        it('reads page by page, never a whole collection at once', async () => {
            store['ContentTypes'] = { blog: { slug: 'blog' } };
            store['arc_blog_drafts'] = many(250, (i) => i === 249);
            const result = await call({ mediaId: 'p1' });
            expect(result).toEqual({ count: 1, titles: ['Entry 249'], more: false });
            expect(reads.largestPage).toBe(USAGE_PAGE);
            expect(reads.queries).toBe(4); // 3 pages of drafts, 1 empty published
        });

        it(`stops at ${USAGE_CAP} entries and says there may be more`, async () => {
            store['ContentTypes'] = { blog: { slug: 'blog' }, info: { slug: 'info' } };
            store['arc_blog_drafts'] = many(5000, () => true);
            store['arc_info_drafts'] = many(5000, () => true);
            const result = await call({ mediaId: 'p1' });
            expect(result.count).toBe(USAGE_CAP);
            expect(result.more).toBe(true);
            expect(result.titles).toHaveLength(3);
            // One page of one type, not 10,000 entries.
            expect(reads.docs).toBe(USAGE_PAGE);
        });
    });

    describe('helpers', () => {
        it('mediaPaths: every size, the legacy file and a document path, without repeats', () => {
            expect(mediaPaths(photo).sort()).toEqual(['s', 'm', 'l', 'xl'].map(sized).sort());
            expect(mediaPaths({ downloadURL: url('mediaImages/old.jpg') })).toEqual(['mediaImages/old.jpg']);
            expect(mediaPaths(undefined)).toEqual([]);
        });

        it('storagePathOf reads the path out of a download URL', () => {
            expect(storagePathOf(url('arccms/mediaImages/a b.webp'))).toBe('arccms/mediaImages/a b.webp');
            expect(storagePathOf('https://images.unsplash.com/photo-1')).toBeNull();
        });

        it('holdsMedia ignores letter case in the encoding', () => {
            const needles = usageNeedles(['mediaImages/a.webp']);
            expect(holdsMedia({ content: `${BUCKET}mediaImages%2fa.webp?alt=media` }, needles)).toBe(true);
            expect(holdsMedia({ content: `${BUCKET}mediaImages%2Fab.webp` }, needles)).toBe(false);
        });
    });
});
