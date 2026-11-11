import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DraftContentsStore } from './draft-contents.store';
import { DraftContentsService } from './draft-contents.service';
import { AuthState } from '../../../(auth)/auth.store';

describe('DraftContentsStore', () => {
    let store: DraftContentsStore;
    let mockService: any;

    const mockAuthStore = {
        currentUser: vi.fn().mockReturnValue({ id: 'test-user-123' })
    };

    beforeEach(() => {
        mockService = {
            collectionName: 'DraftContents',
            getAll: vi.fn(),
            getById: vi.fn(),
            add: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            checkExistingSlugUrl: vi.fn().mockResolvedValue({ exists: false, slug: 'test-slug' }),
            getBySlug: vi.fn(),
            getContentsByType: vi.fn(),
            updateNextContentReferences: vi.fn(),
            updatePreviousContentReferences: vi.fn(),
            applyBacklinks: vi.fn(),
            currentSeriesReference: vi.fn(),
            createDraft: vi.fn().mockResolvedValue('new-id'),
            newDraftId: vi.fn().mockReturnValue('pre-id'),
            saveDraft: vi.fn().mockResolvedValue(undefined),
            isSlugTaken: vi.fn().mockResolvedValue(true),
        };

        TestBed.configureTestingModule({
            providers: [
                DraftContentsStore,
                { provide: DraftContentsService, useValue: mockService },
                { provide: AuthState, useValue: mockAuthStore }
            ]
        });
        store = TestBed.inject(DraftContentsStore);
    });

    it('should be created', () => {
        expect(store).toBeTruthy();
    });

    it('should be injectable', () => {
        expect(store).toBeInstanceOf(DraftContentsStore);
    });

    describe('Store State', () => {
        it('should have items signal', () => {
            expect(store.items).toBeDefined();
            expect(typeof store.items).toBe('function');
        });

        it('should have isLoading signal', () => {
            expect(store.isLoading).toBeDefined();
            expect(typeof store.isLoading).toBe('function');
        });

        it('should have currentItem signal', () => {
            expect(store.currentItem).toBeDefined();
            expect(typeof store.currentItem).toBe('function');
        });

        it('should have totalRecords signal', () => {
            expect(store.totalRecords).toBeDefined();
            expect(typeof store.totalRecords).toBe('function');
        });
    });

    describe('Store Methods', () => {
        it('should have getAll method', () => {
            expect(store.getAll).toBeDefined();
            expect(typeof store.getAll).toBe('function');
        });

        it('should have getById method', () => {
            expect(store.getById).toBeDefined();
            expect(typeof store.getById).toBe('function');
        });

        it('should have add method', () => {
            expect(store.add).toBeDefined();
            expect(typeof store.add).toBe('function');
        });

        it('should have update method', () => {
            expect(store.update).toBeDefined();
            expect(typeof store.update).toBe('function');
        });

        it('should have delete method', () => {
            expect(store.delete).toBeDefined();
            expect(typeof store.delete).toBe('function');
        });
    });

    describe('Initial State', () => {
        it('should start with empty items array', () => {
            expect(store.items()).toEqual([]);
        });

        it('should start with isLoading false', () => {
            expect(store.isLoading()).toBe(false);
        });

        it('should start with empty currentItem object', () => {
            expect(store.currentItem()).toEqual({});
        });

        it('should start with totalRecords as 0', () => {
            expect(store.totalRecords()).toBe(0);
        });
    });

    describe('checkExistingSlugUrl', () => {
        it('should have checkExistingSlugUrl method', () => {
            expect(store.checkExistingSlugUrl).toBeDefined();
            expect(typeof store.checkExistingSlugUrl).toBe('function');
        });

        it('should return a promise', () => {
            const result = store.checkExistingSlugUrl('test-slug', 'articles');
            // Use thenable check instead of instanceof due to Zone.js Promise wrapping
            expect(typeof result.then).toBe('function');
        });

        it('should call service checkExistingSlugUrl method with contentType', async () => {
            await store.checkExistingSlugUrl('my-slug', 'articles');
            expect(mockService.checkExistingSlugUrl).toHaveBeenCalledWith('my-slug', 'articles');
        });

        it('should return service result', async () => {
            mockService.checkExistingSlugUrl.mockResolvedValue({ exists: true, slug: 'existing-slug' });

            const result = await store.checkExistingSlugUrl('existing-slug', 'articles');

            expect(result.exists).toBe(true);
            expect(result.slug).toBe('existing-slug');
        });

        it('should return exists false for new slugs', async () => {
            mockService.checkExistingSlugUrl.mockResolvedValue({ exists: false, slug: 'new-slug' });

            const result = await store.checkExistingSlugUrl('new-slug', 'articles');

            expect(result.exists).toBe(false);
            expect(result.slug).toBe('new-slug');
        });
    });

    describe('getBySlug', () => {
        it('should have getBySlug method', () => {
            expect(store.getBySlug).toBeDefined();
            expect(typeof store.getBySlug).toBe('function');
        });

        it('should call service getBySlug with both arguments', async () => {
            mockService.getBySlug.mockResolvedValue({ id: '123', slug: 'test-slug' });
            await store.getBySlug('test-slug', 'articles');
            expect(mockService.getBySlug).toHaveBeenCalledWith('test-slug', 'articles');
        });

        it('should return service result', async () => {
            const mockContent = { id: '123', slug: 'test-slug', title: 'Test' };
            mockService.getBySlug.mockResolvedValue(mockContent);

            const result = await store.getBySlug('test-slug', 'articles');

            expect(result).toEqual(mockContent);
        });
    });

    describe('getContentsByType', () => {
        it('should have getContentsByType method', () => {
            expect(store.getContentsByType).toBeDefined();
            expect(typeof store.getContentsByType).toBe('function');
        });

        it('should call service getContentsByType with contentType', async () => {
            mockService.getContentsByType.mockResolvedValue([]);
            await store.getContentsByType('articles');
            expect(mockService.getContentsByType).toHaveBeenCalledWith('articles', undefined);
        });

        it('should call service getContentsByType with excludeId when provided', async () => {
            mockService.getContentsByType.mockResolvedValue([]);
            await store.getContentsByType('articles', 'exclude-123');
            expect(mockService.getContentsByType).toHaveBeenCalledWith('articles', 'exclude-123');
        });

        it('should return service result', async () => {
            const mockContents = [{ id: '1' }, { id: '2' }];
            mockService.getContentsByType.mockResolvedValue(mockContents);

            const result = await store.getContentsByType('articles');

            expect(result).toEqual(mockContents);
        });
    });

    describe('updateNextContentReferences', () => {
        it('should have updateNextContentReferences method', () => {
            expect(store.updateNextContentReferences).toBeDefined();
            expect(typeof store.updateNextContentReferences).toBe('function');
        });

        it('should call service updateNextContentReferences with all arguments', async () => {
            const updatedData = { title: 'Updated' };
            mockService.updateNextContentReferences.mockResolvedValue(undefined);

            await store.updateNextContentReferences('content-123', updatedData, 'articles');

            expect(mockService.updateNextContentReferences).toHaveBeenCalledWith('content-123', updatedData, 'articles');
        });

        it('should pass through service call', async () => {
            const updatedData = { slug: 'new-slug' };
            mockService.updateNextContentReferences.mockResolvedValue(undefined);

            await store.updateNextContentReferences('id-456', updatedData, 'pages');

            expect(mockService.updateNextContentReferences).toHaveBeenCalledWith('id-456', updatedData, 'pages');
        });
    });

    describe('updatePreviousContentReferences', () => {
        it('passes the renamed entry to the service', async () => {
            const updatedData = { title: 'Part one', summary: '', slug: 'part-one' };
            mockService.updatePreviousContentReferences.mockResolvedValue(undefined);

            await store.updatePreviousContentReferences('p1', updatedData, 'articles');

            expect(mockService.updatePreviousContentReferences).toHaveBeenCalledWith('p1', updatedData, 'articles');
        });
    });

    describe('applyBacklinks', () => {
        it('passes the changes to the service and returns what it changed and what failed', async () => {
            const owner = { id: 'a', title: 'A', summary: '', slug: 'a' };
            const changes = [{ targetId: 'b', field: 'previousContent' as const, action: 'set' as const }];
            mockService.applyBacklinks.mockResolvedValue({ changed: ['b'], failed: [] });

            await expect(store.applyBacklinks('articles', owner, changes)).resolves.toEqual({ changed: ['b'], failed: [] });
            expect(mockService.applyBacklinks).toHaveBeenCalledWith('articles', owner, changes);
        });
    });

    describe('currentSeriesReference', () => {
        it('asks the service for the entry as it is now', async () => {
            const current = { id: 'b', title: 'B', summary: '', slug: 'b' };
            mockService.currentSeriesReference.mockResolvedValue(current);

            await expect(store.currentSeriesReference('articles', 'b')).resolves.toEqual(current);
            expect(mockService.currentSeriesReference).toHaveBeenCalledWith('articles', 'b');
        });
    });

    // RF4 4.1, 4.4, 4.5, 4.6: the editor's writes report failures.
    describe('the editor\'s writes', () => {
        it('creates with who wrote it, and passes a failure on', async () => {
            const { firstValueFrom } = await import('rxjs');
            expect(await firstValueFrom(store.createDraft({ title: 'A' }, 'blog'))).toBe('new-id');
            expect(mockService.createDraft).toHaveBeenCalledWith('blog', { title: 'A', createdBy: 'test-user-123', modifiedBy: 'test-user-123' }, undefined);
            mockService.createDraft.mockRejectedValueOnce(new Error('offline'));
            await expect(firstValueFrom(store.createDraft({ title: 'B' }, 'blog'))).rejects.toThrow('offline');
        });

        it('saves against the time the editor opened, and writes nothing until subscribed', async () => {
            const { firstValueFrom } = await import('rxjs');
            const opened = new Date();
            const save$ = store.saveDraft('d1', { title: 'A' }, 'blog', opened);
            expect(mockService.saveDraft).not.toHaveBeenCalled();
            await firstValueFrom(save$, { defaultValue: undefined });
            expect(mockService.saveDraft).toHaveBeenCalledWith('blog', 'd1', { title: 'A', modifiedBy: 'test-user-123' }, opened);
        });

        it('asks the server whether an address is taken, leaving the entry itself out', async () => {
            expect(await store.isSlugTaken('guide', 'blog', 'd1')).toBe(true);
            expect(mockService.isSlugTaken).toHaveBeenCalledWith('guide', 'blog', 'd1');
        });
    });

    // RF4 review H1, M4: a new entry keeps one id across retries and becomes the current item.
    describe('a new entry', () => {
        it('writes under the id chosen up front, so a retry cannot make a second entry', async () => {
            const { firstValueFrom } = await import('rxjs');
            const id = store.newDraftId('blog');
            await firstValueFrom(store.createDraft({ title: 'A' }, 'blog', id));
            await firstValueFrom(store.createDraft({ title: 'A' }, 'blog', id));
            expect(mockService.createDraft.mock.calls.map((c: any[]) => c[2])).toEqual(['pre-id', 'pre-id']);
        });

        it('becomes the current item once created', () => {
            store.adoptCreated({ id: 'new-1', title: 'A', publishedOn: null } as any);
            expect(store.currentItem()).toMatchObject({ id: 'new-1', title: 'A' });
        });
    });
});
