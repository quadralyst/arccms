/**
 * The draft service's series-link writes against a mocked Firestore: the
 * backlink transaction (no overwrite of a hand-set link, clearing only our
 * own) and the rename refresh (only stale copies are rewritten).
 */
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Firestore, getDocs, runTransaction, where, writeBatch } from '@angular/fire/firestore';
import { DraftContentsService } from './draft-contents.service';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((col: { path: string }, id: string) => ({ path: `${col.path}/${id}`, id })),
    query: vi.fn((col: unknown, ...constraints: unknown[]) => ({ col, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
}));

const OWNER = { id: 'a', title: 'Part A', summary: 'About A', slug: 'part-a' };

/** A fake Firestore holding the drafts by id, for runTransaction to read and write. */
function fakeDrafts(docs: Record<string, Record<string, unknown> | null>) {
    const updates: { id: string; data: Record<string, unknown> }[] = [];
    vi.mocked(runTransaction).mockImplementation((async (_db: unknown, fn: (t: unknown) => unknown) => {
        const transaction = {
            get: async (ref: { id: string }) => ({
                exists: () => docs[ref.id] != null,
                data: () => docs[ref.id],
            }),
            update: (ref: { id: string }, data: Record<string, unknown>) => updates.push({ id: ref.id, data }),
        };
        return fn(transaction);
    }) as any);
    return updates;
}

describe('DraftContentsService series links', () => {
    let service: DraftContentsService;

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [DraftContentsService, { provide: Firestore, useValue: {} }],
        });
        service = TestBed.inject(DraftContentsService);
    });

    describe('applyBacklinks', () => {
        it('points an empty Previous at the saved entry and marks that draft edited', async () => {
            const updates = fakeDrafts({ b: { title: 'B', previousContent: null } });

            const changed = await service.applyBacklinks('articles', OWNER,
                [{ targetId: 'b', field: 'previousContent', action: 'set' }]);

            expect(changed).toEqual(['b']);
            expect(updates).toEqual([{ id: 'b', data: { previousContent: OWNER, modifiedAt: expect.any(Date) } }]);
        });

        it('keeps a Previous an editor pointed at another entry', async () => {
            const updates = fakeDrafts({ b: { previousContent: { id: 'z', title: 'Z', summary: '', slug: 'z' } } });

            const changed = await service.applyBacklinks('articles', OWNER,
                [{ targetId: 'b', field: 'previousContent', action: 'set' }]);

            expect(changed).toEqual([]);
            expect(updates).toEqual([]);
        });

        it('sets the Next of the entry picked as Previous, the symmetric rule', async () => {
            const updates = fakeDrafts({ p: { nextContent: null } });

            await service.applyBacklinks('articles', OWNER, [{ targetId: 'p', field: 'nextContent', action: 'set' }]);

            expect(updates).toEqual([{ id: 'p', data: { nextContent: OWNER, modifiedAt: expect.any(Date) } }]);
        });

        it('clears a backlink only while it still points at the saved entry', async () => {
            const updates = fakeDrafts({
                mine: { previousContent: { ...OWNER } },
                theirs: { previousContent: { id: 'z', title: 'Z', summary: '', slug: 'z' } },
            });

            const changed = await service.applyBacklinks('articles', OWNER, [
                { targetId: 'mine', field: 'previousContent', action: 'clear' },
                { targetId: 'theirs', field: 'previousContent', action: 'clear' },
            ]);

            expect(changed).toEqual(['mine']);
            expect(updates).toEqual([{ id: 'mine', data: { previousContent: null, modifiedAt: expect.any(Date) } }]);
        });

        it('skips a deleted target and carries on after a failed one', async () => {
            const updates = fakeDrafts({ gone: null, b: {} });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.mocked(runTransaction).mockRejectedValueOnce(new Error('denied'));

            const changed = await service.applyBacklinks('articles', OWNER, [
                { targetId: 'x', field: 'previousContent', action: 'set' },
                { targetId: 'gone', field: 'previousContent', action: 'set' },
                { targetId: 'b', field: 'previousContent', action: 'set' },
            ]);

            expect(changed).toEqual(['b']);
            expect(updates.map((u) => u.id)).toEqual(['b']);
            errorSpy.mockRestore();
        });

        it('writes nothing for an entry without a real id', async () => {
            await service.applyBacklinks('articles', { ...OWNER, id: 'temp-id' },
                [{ targetId: 'b', field: 'previousContent', action: 'set' }]);

            expect(runTransaction).not.toHaveBeenCalled();
        });
    });

    describe('reference refresh after a rename', () => {
        function batchSpy() {
            const batch = { update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
            vi.mocked(writeBatch).mockReturnValue(batch as any);
            return batch;
        }
        const snapshot = (rows: { id: string; data: Record<string, unknown> }[]) =>
            ({ empty: rows.length === 0, docs: rows.map((r) => ({ id: r.id, data: () => r.data })) }) as any;

        it('rewrites the stale Previous copies and leaves current ones alone', async () => {
            const batch = batchSpy();
            vi.mocked(getDocs).mockResolvedValue(snapshot([
                { id: 'stale', data: { previousContent: { ...OWNER, title: 'Old title' } } },
                { id: 'fresh', data: { previousContent: { ...OWNER } } },
            ]));

            await service.updatePreviousContentReferences('a', { title: 'Part A', summary: 'About A', slug: 'part-a' }, 'articles');

            expect(where).toHaveBeenCalledWith('previousContent.id', '==', 'a');
            expect(batch.update).toHaveBeenCalledTimes(1);
            expect(batch.update).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'stale' }),
                { previousContent: OWNER, modifiedAt: expect.any(Date) },
            );
            expect(batch.commit).toHaveBeenCalledTimes(1);
        });

        it('queries Next links by the entry id, and commits nothing when all are current', async () => {
            const batch = batchSpy();
            vi.mocked(getDocs).mockResolvedValue(snapshot([{ id: 'fresh', data: { nextContent: { ...OWNER } } }]));

            await service.updateNextContentReferences('a', { title: 'Part A', summary: 'About A', slug: 'part-a' }, 'articles');

            expect(where).toHaveBeenCalledWith('nextContent.id', '==', 'a');
            expect(batch.commit).not.toHaveBeenCalled();
        });
    });
});
