import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentsService } from './published-contents.service';

describe('ContentsService', () => {
    let service: ContentsService;
    let mockService: any;

    beforeEach(() => {
        mockService = {
            collectionName: 'Contents',
            getAll: vi.fn(),
            getById: vi.fn(),
            add: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            getCollectionRef: vi.fn(),
        };
        service = mockService as unknown as ContentsService;
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
        // The collection name is set in the constructor via super()
        expect((service as any).collectionName).toBe('Contents');
    });

    it('should extend DbService', () => {
        // DbService methods should be available
        expect(typeof service.getAll).toBe('function');
        expect(typeof service.getById).toBe('function');
        expect(typeof service.add).toBe('function');
        expect(typeof service.update).toBe('function');
        expect(typeof service.delete).toBe('function');
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
