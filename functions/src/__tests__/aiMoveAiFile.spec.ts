/**
 * moveAiFile (specs/ai-media-spec.md, AM-D10): moves only a file a call made, never onto a
 * file that is there, never into Arc's own folders, and points the call's records at it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    records: [] as Array<{ files: Array<{ path: string }>; update: Record<string, unknown> | null }>,
    existing: new Set<string>(),
    moved: [] as Array<[string, string]>,
}));

vi.mock('../init', () => ({
    owner: {},
    db: {
        collection: () => ({
            where: (_f: string, _op: string, path: string) => ({
                limit: () => ({
                    get: async () => {
                        const docs = h.records.filter((r) => r.files.some((f) => f.path === path)).map((r) => ({ data: () => ({ files: r.files }), ref: { update: async (u: Record<string, unknown>) => void (r.update = u) } }));
                        return { empty: docs.length === 0, docs };
                    },
                }),
            }),
        }),
    },
    storage: {
        bucket: () => ({
            file: (path: string) => ({
                exists: async () => [h.existing.has(path)],
                move: async (to: string) => void h.moved.push([path, to]),
            }),
        }),
    },
}));

import { moveAiFile } from '../ai/files.js';

beforeEach(() => {
    h.records = [{ files: [{ path: 'app/covers/r1-1.png' }, { path: 'app/covers/r1-2.png' }], update: null }];
    h.existing = new Set(['app/kept/taken.png']);
    h.moved = [];
});

describe('moveAiFile', () => {
    it('moves a file a call made and points its record at the new place', async () => {
        expect(await moveAiFile('app/covers/r1-1.png', 'app/kept/hero.png')).toBe('app/kept/hero.png');
        expect(h.moved).toEqual([['app/covers/r1-1.png', 'app/kept/hero.png']]);
        expect(h.records[0].update).toMatchObject({ filePaths: ['app/kept/hero.png', 'app/covers/r1-2.png'] });
        // A file in Arc's own AI folder is the call's even before a record is found.
        await moveAiFile('ai-files/cover/2026-11/r2-1.png', 'app/kept/two.png');
        expect(h.moved[1]).toEqual(['ai-files/cover/2026-11/r2-1.png', 'app/kept/two.png']);
    });

    it('refuses any other file, test files, the cache copies, Arc folders and a file already there', async () => {
        await expect(moveAiFile('users/u1/photo.jpg', 'app/public/photo.jpg')).rejects.toThrow('is not a file a call made');
        await expect(moveAiFile('ai-files/_test/cover/2026-11/r-1.png', 'app/x.png')).rejects.toThrow('test files');
        await expect(moveAiFile('ai-files/_cache/cover/h-1.png', 'app/x.png')).rejects.toThrow('test files');
        await expect(moveAiFile('app/covers/r1-1.png', 'mediaImages/x.png')).rejects.toThrow('one of Arc\'s own folders');
        await expect(moveAiFile('app/covers/r1-1.png', 'app/kept/taken.png')).rejects.toThrow('is already there');
        await expect(moveAiFile('app/../users/u1/x', 'app/x.png')).rejects.toThrow('plain path');
        expect(h.moved).toEqual([]);
    });
});
