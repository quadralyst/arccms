/**
 * Index entries are built one way for every caller: the trigger, the publish
 * pipeline and the reindex tool all go through writer.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const batch = { set: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
const existingDocs: { id: string; ref: string }[] = [];
const collectionMock = vi.fn();

vi.mock('../init.js', () => ({
    db: {
        collection: (...args: unknown[]) => collectionMock(...args),
        batch: () => batch,
    },
}));

import {
    buildEntry,
    buildEntries,
    clip,
    plainText,
    upsertSearchEntries,
    removeSearchEntries,
} from '../search/writer.js';
import { MAX_TOKENS_PER_ENTRY } from '../search/tokenizer.js';
import type { SearchContext, SearchSource } from '../search/source.js';

const ctx: SearchContext = {
    collection: 'Directory',
    docId: 'd1',
    localization: { defaultLanguage: 'en', enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }] },
    contentTypes: new Map(),
};

const source: SearchSource = {
    id: 'directory',
    collection: 'Directory',
    scope: 'public',
    fields: [
        { path: 'name', weight: 3, prefix: true },
        { path: 'tagline', weight: 2, prefix: true },
        { path: 'address.city', weight: 1 },
    ],
    display: doc => ({
        title: String(doc['name']),
        snippet: String(doc['tagline'] ?? ''),
        badge: 'Directory',
        link: `/directory/${doc['slug']}`,
        sortAt: new Date('2026-01-01'),
    }),
    include: doc => doc['status'] === 'active',
};

beforeEach(() => {
    batch.set.mockClear();
    batch.delete.mockClear();
    batch.commit.mockClear();
    existingDocs.length = 0;
    collectionMock.mockReset();
    collectionMock.mockImplementation(() => {
        const query = {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: existingDocs.length === 0,
                size: existingDocs.length,
                docs: existingDocs.map(d => ({ id: d.id, ref: d.ref })),
            }),
            doc: vi.fn((id: string) => ({ id })),
        };
        return query;
    });
});

describe('buildEntry', () => {
    it('indexes every field with its weight and reads dotted paths', () => {
        const doc = { name: 'Gunjan Karun', tagline: 'Builder', address: { city: 'Bhopal' }, slug: 'gk', status: 'active' };
        const entry = buildEntry(source, { lang: '*', doc }, source.fields as never, ctx);

        expect(entry.fields).toEqual({ name: 'Gunjan Karun', tagline: 'Builder', 'address.city': 'Bhopal' });
        expect(entry.weights).toEqual({ name: 3, tagline: 2, 'address.city': 1 });
        expect(entry.tokens).toContain('kar');
        expect(entry.tokens).toContain('bhopal');
        expect(entry.tokens).not.toContain('bh');
        expect(entry.title).toBe('Gunjan Karun');
        expect(entry.link).toBe('/directory/gk');
        expect(entry.badge).toBe('Directory');
        expect(entry.source).toBe('directory');
        expect(entry.scope).toBe('public');
        expect(entry.lang).toBe('*');
        expect(entry.collection).toBe('Directory');
        expect(entry.docId).toBe('d1');
        expect(entry.boost).toBe(1);
    });

    it('caps tokens and keeps the title tokens when it does', () => {
        const longTagline = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
        const doc = { name: 'Gunjan Karun', tagline: longTagline, status: 'active' };
        const entry = buildEntry(source, { lang: '*', doc }, source.fields as never, ctx);

        expect(entry.tokens.length).toBeLessThanOrEqual(MAX_TOKENS_PER_ENTRY);
        expect(entry.tokens[0]).toBe('gunjan');
        expect(entry.tokens).toContain('karun');
    });

    it('strips HTML from the fields and the snippet', () => {
        const doc = { name: '<b>Bold</b> name', tagline: '<p>Line one&nbsp;two</p>', status: 'active' };
        const entry = buildEntry(source, { lang: '*', doc }, source.fields as never, ctx);
        expect(entry.fields['name']).toBe('Bold name');
        expect(entry.snippet).toBe('Line one two');
        expect(entry.title).toBe('Bold name');
    });
});

describe('buildEntries', () => {
    it('returns nothing when include() says no', async () => {
        const entries = await buildEntries(source, { name: 'Hidden', status: 'inactive' }, ctx);
        expect(entries).toEqual([]);
    });

    it('produces one entry per variant', async () => {
        const multilingual: SearchSource = {
            ...source,
            include: undefined,
            variants: async doc => [
                { lang: 'en', doc },
                { lang: 'hi', doc: { ...doc, name: 'गुंजन' } },
            ],
        };
        const entries = await buildEntries(multilingual, { name: 'Gunjan', slug: 'g' }, ctx);
        expect(entries.map(e => e.lang)).toEqual(['en', 'hi']);
        expect(entries[1].title).toBe('गुंजन');
        expect(entries[1].tokens).toContain('गुंजन');
    });

    it('drops variants with nothing to index', async () => {
        const entries = await buildEntries({ ...source, include: undefined }, { name: '', slug: 'x' }, ctx);
        expect(entries).toEqual([]);
    });
});

describe('upsertSearchEntries', () => {
    it('writes the new entries and deletes stale language entries of the same document', async () => {
        existingDocs.push({ id: 'directory:Directory:d1:hi', ref: 'ref-hi' });
        const entries = await buildEntries({ ...source, include: undefined }, { name: 'Gunjan', slug: 'g' }, ctx);
        await upsertSearchEntries('directory', 'Directory', 'd1', entries);

        expect(batch.set).toHaveBeenCalledTimes(1);
        expect(batch.set.mock.calls[0][0]).toEqual({ id: 'directory:Directory:d1:*' });
        expect(batch.delete).toHaveBeenCalledWith('ref-hi');
        expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it('commits nothing when there is nothing to write or delete', async () => {
        await upsertSearchEntries('directory', 'Directory', 'd1', []);
        expect(batch.commit).not.toHaveBeenCalled();
    });
});

describe('removeSearchEntries', () => {
    it('deletes every entry of the document and reports the count', async () => {
        existingDocs.push({ id: 'a', ref: 'r1' }, { id: 'b', ref: 'r2' });
        expect(await removeSearchEntries('directory', 'Directory', 'd1')).toBe(2);
        expect(batch.delete).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when nothing is indexed', async () => {
        expect(await removeSearchEntries('directory', 'Directory', 'd1')).toBe(0);
        expect(batch.commit).not.toHaveBeenCalled();
    });
});

describe('helpers', () => {
    it('plainText decodes entities and collapses whitespace', () => {
        expect(plainText('A &amp; B\n\n<i>C</i>')).toBe('A & B C');
        expect(plainText(['x', 'y'])).toBe('x y');
        expect(plainText(42)).toBe('42');
        expect(plainText(null)).toBe('');
    });

    it('clip cuts on a word boundary', () => {
        expect(clip('one two three', 8)).toBe('one two');
        expect(clip('short', 8)).toBe('short');
    });
});
