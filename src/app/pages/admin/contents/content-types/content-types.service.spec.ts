import { TestBed } from '@angular/core/testing';
import { ContentTypesService } from './content-types.service';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { vi, describe, beforeEach, it, expect } from 'vitest';

const fs = vi.hoisted(() => ({
    getDocsFromServer: vi.fn(),
    getCountFromServer: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    getDocsFromServer: fs.getDocsFromServer,
    getCountFromServer: fs.getCountFromServer,
    doc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    endBefore: vi.fn(),
}));

describe('ContentTypesService', () => {
    let service: ContentTypesService;
    const mockFirestore = {};
    const mockAuth = {};

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                ContentTypesService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
            ],
        });
        service = TestBed.inject(ContentTypesService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    const types = (...ids: string[]) => ({ docs: ids.map((id) => ({ id })) });

    describe('slugInUse', () => {
        it('is true when another type has the slug', async () => {
            fs.getDocsFromServer.mockResolvedValue(types('ct-2'));
            await expect(service.slugInUse('articles', 'ct-1')).resolves.toBe(true);
        });

        it('is false when only the type itself has it', async () => {
            fs.getDocsFromServer.mockResolvedValue(types('ct-1'));
            await expect(service.slugInUse('articles', 'ct-1')).resolves.toBe(false);
        });

        it('is true for any holder when there is no type to except (a new type)', async () => {
            fs.getDocsFromServer.mockResolvedValue(types('ct-1'));
            await expect(service.slugInUse('articles')).resolves.toBe(true);
        });

        it('throws when the server cannot answer, so a save never goes ahead unchecked', async () => {
            fs.getDocsFromServer.mockRejectedValue(new Error('offline'));
            await expect(service.slugInUse('articles')).rejects.toThrow('offline');
        });
    });

    describe('hasStoredItems', () => {
        const snap = (empty: boolean) => ({ empty });

        it('asks the server about the entries, drafts and tags stored under the slug', async () => {
            fs.getDocsFromServer.mockResolvedValue(snap(true));
            await expect(service.hasStoredItems('articles')).resolves.toBe(false);
            const { collection } = await import('@angular/fire/firestore');
            const paths = vi.mocked(collection).mock.calls.map((call) => call[1]);
            expect(paths).toEqual(expect.arrayContaining(['arc_articles', 'arc_articles_drafts', 'Tags_articles']));
        });

        it('is true when any one of them holds a document', async () => {
            fs.getDocsFromServer
                .mockResolvedValueOnce(snap(true))
                .mockResolvedValueOnce(snap(true))
                .mockResolvedValueOnce(snap(false));
            await expect(service.hasStoredItems('articles')).resolves.toBe(true);
        });

        it('throws when the server cannot answer, so a rename never goes ahead on a guess', async () => {
            fs.getDocsFromServer.mockRejectedValue(new Error('offline'));
            await expect(service.hasStoredItems('articles')).rejects.toThrow('offline');
        });
    });

    describe('deleteImpact', () => {
        const type = { id: 'ct-1', slug: 'articles' };

        it('counts the drafts, where every entry lives', async () => {
            fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 7 }) });
            fs.getDocsFromServer.mockResolvedValue(types('ct-1'));
            await expect(service.deleteImpact(type)).resolves.toEqual({ entries: 7, shared: false });
            expect(fs.getCountFromServer).toHaveBeenCalledWith({ path: 'arc_articles_drafts' });
        });

        it('says when another type shares the slug', async () => {
            fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 7 }) });
            fs.getDocsFromServer.mockResolvedValue(types('ct-1', 'ct-2'));
            await expect(service.deleteImpact(type)).resolves.toEqual({ entries: 7, shared: true });
        });

        it('gives no count, and assumes the entries go, when the server cannot answer', async () => {
            fs.getCountFromServer.mockRejectedValue(new Error('offline'));
            fs.getDocsFromServer.mockRejectedValue(new Error('offline'));
            await expect(service.deleteImpact(type)).resolves.toEqual({ entries: null, shared: false });
        });
    });
});
