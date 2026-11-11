import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fs = vi.hoisted(() => {
    const state = {
        docs: {} as Record<string, unknown>,
        taken: { drafts: [] as string[], live: [] as string[] },
        writes: [] as Array<{ op: string; ref: { path: string; id: string } }>,
    };
    const ref = (path: string) => ({ path, id: path.split('/').pop()! });
    return {
        state,
        collection: vi.fn((_f: unknown, path: string, ...rest: string[]) => ({ path: [path, ...rest].join('/') })),
        doc: vi.fn((col: { path: string }, id?: string) => ref(`${col.path}/${id ?? 'auto-id'}`)),
        query: vi.fn((col: { path: string }) => col),
        where: vi.fn(),
        limit: vi.fn(),
        getDocsFromServer: vi.fn(async (col: { path: string }) => ({
            docs: (col.path.endsWith('_drafts') ? state.taken.drafts : state.taken.live).map((id) => ({ id })),
        })),
        runTransaction: vi.fn(async (_f: unknown, fn: (t: unknown) => Promise<void>) => fn({
            get: async (r: { path: string }) => ({ exists: () => r.path in state.docs, data: () => state.docs[r.path] }),
            set: (r: { path: string; id: string }) => state.writes.push({ op: 'set', ref: r }),
            update: (r: { path: string; id: string }) => state.writes.push({ op: 'update', ref: r }),
            delete: (r: { path: string; id: string }) => state.writes.push({ op: 'delete', ref: r }),
        })),
    };
});
vi.mock('@angular/fire/firestore', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    collection: fs.collection,
    doc: fs.doc,
    query: fs.query,
    where: fs.where,
    limit: fs.limit,
    getDocsFromServer: fs.getDocsFromServer,
    runTransaction: fs.runTransaction,
}));
vi.mock('../../../../../shared/services/search-queue', () => ({ draftQueueEntry: () => null }));

import { Firestore } from '@angular/fire/firestore';
import { DraftContentsService } from './draft-contents.service';
import { isEntryGone } from './entry-changed';

// The editor's writes (RF4 review H1, L1, L3, M6; server review M1).
describe('DraftContentsService writes', () => {
    let service: DraftContentsService;

    beforeEach(() => {
        fs.state.docs = {};
        fs.state.taken = { drafts: [], live: [] };
        fs.state.writes = [];
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
        service = TestBed.inject(DraftContentsService);
    });

    it('writes a new entry under the id it is given, the same one on a retry', async () => {
        expect(await service.createDraft('blog', { title: 'A' }, 'pre-id')).toBe('pre-id');
        expect(await service.createDraft('blog', { title: 'A' }, 'pre-id')).toBe('pre-id');
        expect(fs.state.writes.map((w) => w.ref.path)).toEqual(['arc_blog_drafts/pre-id', 'arc_blog_drafts/pre-id']);
    });

    it('says an entry deleted since it was opened is gone', async () => {
        const error = await service.saveDraft('blog', 'missing', { title: 'A' }, null).catch((e) => e);
        expect(isEntryGone(error)).toBe(true);
    });

    it('counts an address held by a live page as taken, the entry itself aside', async () => {
        fs.state.taken.live = ['other'];
        expect(await service.isSlugTaken('b', 'blog', 'mine')).toBe(true);
        fs.state.taken.live = ['mine'];
        expect(await service.isSlugTaken('b', 'blog', 'mine')).toBe(false);
    });

    it('writes a translation in a transaction, which fails at once offline', async () => {
        await service.saveTranslation('blog', 'd1', { lang: 'hi', title: 'नमस्ते' } as any);
        expect(fs.runTransaction).toHaveBeenCalled();
        expect(fs.state.writes[0]).toMatchObject({ op: 'set', ref: { path: 'arc_blog_drafts/d1/translations/hi' } });
    });
});
