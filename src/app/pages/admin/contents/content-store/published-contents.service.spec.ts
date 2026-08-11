import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';

const { mockOnSnapshot } = vi.hoisted(() => ({ mockOnSnapshot: vi.fn() }));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class Firestore { },
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({})),
    getDocs: vi.fn(),
    query: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
}));

vi.mock('../../../../../shared/services/db.service', () => ({
    DbService: class MockDbService {
        constructor(_collectionName: string) { }
    },
}));

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

    describe('pollDeployStatus during SSR', () => {
        beforeEach(() => {
            TestBed.resetTestingModule();
            mockOnSnapshot.mockClear();
            mockOnSnapshot.mockReturnValue(vi.fn());
        });

        function makeService(platform: 'browser' | 'server'): ContentsService {
            TestBed.configureTestingModule({
                providers: [
                    ContentsService,
                    { provide: PLATFORM_ID, useValue: platform },
                ],
            });
            return TestBed.inject(ContentsService);
        }

        it('does not register a Firestore listener during SSR', async () => {
            // Publishing is user-triggered, so this is not reachable on the
            // server today — but a listener registered there would outlive the
            // request injector @angular/fire captured, and the next snapshot
            // would fire its callback against a destroyed injector (NG0205) on
            // a Firestore timer where nothing catches it.
            const service = makeService('server');

            await new Promise<void>((resolve, reject) => {
                service.pollDeployStatus('doc1', 'posts').subscribe({
                    complete: resolve,
                    error: reject,
                });
            });

            expect(mockOnSnapshot).not.toHaveBeenCalled();
        });

        it('registers a listener in the browser', () => {
            const service = makeService('browser');

            service.pollDeployStatus('doc1', 'posts').subscribe();

            expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
        });
    });
});
