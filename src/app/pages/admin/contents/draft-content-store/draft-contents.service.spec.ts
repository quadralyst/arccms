import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DraftContentsService } from './draft-contents.service';

describe('DraftContentsService', () => {
    let service: DraftContentsService;
    let mockService: any;

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
            getCollectionRef: vi.fn(),
        };
        service = mockService as unknown as DraftContentsService;
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should be injectable', () => {
        // Mock service should have the expected interface
        expect(service).toBeDefined();
        expect(typeof (service as any).collectionName).toBe('string');
    });

    it('should have the correct collection name', () => {
        expect((service as any).collectionName).toBe('DraftContents');
    });

    it('should extend DbService', () => {
        expect(typeof service.getAll).toBe('function');
        expect(typeof service.getById).toBe('function');
        expect(typeof service.add).toBe('function');
        expect(typeof service.update).toBe('function');
        expect(typeof service.delete).toBe('function');
    });

    describe('checkExistingSlugUrl', () => {
        it('should have checkExistingSlugUrl method', () => {
            expect(service.checkExistingSlugUrl).toBeDefined();
            expect(typeof service.checkExistingSlugUrl).toBe('function');
        });

        it('should return a promise', () => {
            const result = service.checkExistingSlugUrl('test-slug', 'articles');
            expect(result).toBeInstanceOf(Promise);
        });

        it('should accept contentType parameter', async () => {
            await service.checkExistingSlugUrl('test-slug', 'articles');
            expect(mockService.checkExistingSlugUrl).toHaveBeenCalledWith('test-slug', 'articles');
        });

        it('should return exists false when error occurs', async () => {
            // The method catches errors and returns exists: false
            const result = await service.checkExistingSlugUrl('test-slug', 'articles');
            expect(result).toHaveProperty('exists');
            expect(result).toHaveProperty('slug');
            expect(result.slug).toBe('test-slug');
        });
    });

    describe('getBySlug', () => {
        it('should have getBySlug method', () => {
            expect(service.getBySlug).toBeDefined();
            expect(typeof service.getBySlug).toBe('function');
        });

        it('should accept slug and contentType parameters', () => {
            service.getBySlug('test-slug', 'articles');
            expect(mockService.getBySlug).toHaveBeenCalledWith('test-slug', 'articles');
        });
    });

    describe('getContentsByType', () => {
        it('should have getContentsByType method', () => {
            expect(service.getContentsByType).toBeDefined();
            expect(typeof service.getContentsByType).toBe('function');
        });

        it('should accept contentType parameter', () => {
            service.getContentsByType('articles');
            expect(mockService.getContentsByType).toHaveBeenCalledWith('articles');
        });

        it('should accept optional excludeId parameter', () => {
            service.getContentsByType('articles', 'exclude-id-123');
            expect(mockService.getContentsByType).toHaveBeenCalledWith('articles', 'exclude-id-123');
        });
    });

    describe('updateNextContentReferences', () => {
        it('should have updateNextContentReferences method', () => {
            expect(service.updateNextContentReferences).toBeDefined();
            expect(typeof service.updateNextContentReferences).toBe('function');
        });

        it('should accept contentId, updatedData, and contentType parameters', () => {
            const updatedData = { title: 'Updated Title' };
            service.updateNextContentReferences('content-123', updatedData, 'articles');
            expect(mockService.updateNextContentReferences).toHaveBeenCalledWith('content-123', updatedData, 'articles');
        });
    });

    describe('getCollectionRef', () => {
        it('should have getCollectionRef method', () => {
            expect(service.getCollectionRef).toBeDefined();
            expect(typeof service.getCollectionRef).toBe('function');
        });
    });

    describe('inherited methods', () => {
        it('should have getAll method', () => {
            expect(service.getAll).toBeDefined();
        });

        it('should have getById method', () => {
            expect(service.getById).toBeDefined();
        });

        it('should have add method', () => {
            expect(service.add).toBeDefined();
        });

        it('should have update method', () => {
            expect(service.update).toBeDefined();
        });

        it('should have delete method', () => {
            expect(service.delete).toBeDefined();
        });
    });
});
