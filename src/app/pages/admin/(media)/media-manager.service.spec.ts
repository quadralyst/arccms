import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Firestore, onSnapshot } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { MediaManagerService } from './media-manager.service';

// Mock Firebase Firestore
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn(),
    getFirestore: vi.fn(() => ({})),
    getDocs: vi.fn(),
    onSnapshot: vi.fn((_, callback) => {
        return vi.fn();
    }),
    query: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    startAfter: vi.fn(() => ({})),
    getCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 2 }) })),
    collectionChanges: vi.fn(),
}));

// Mock the DbService parent class
vi.mock('../../../../shared/services/db.service', () => ({
    DbService: class MockDbService {
        constructor(collectionName: string) { }
    },
}));

// Mock httpsCallable — returns a jest fn we can control per test
const mockSearchUnsplashCallable = vi.fn();

vi.mock('@angular/fire/functions', () => ({
    Functions: class { },
    httpsCallable: vi.fn(() => mockSearchUnsplashCallable),
}));

const mockFirestore = {};
const mockFunctions = {};

describe('MediaManagerService', () => {
    let service: MediaManagerService;

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                MediaManagerService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Functions, useValue: mockFunctions },
            ]
        });
        service = TestBed.inject(MediaManagerService);
    });

    describe('constructor', () => {
        it('should create service instance', () => {
            expect(service).toBeTruthy();
        });
    });

    describe('getImagesFromUnsplash', () => {
        it('should call the searchUnsplash Cloud Function with query and page', async () => {
            mockSearchUnsplashCallable.mockResolvedValueOnce({
                data: {
                    items: [],
                    pagination: { pageIndex: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
                    status: 200,
                }
            });

            await service.getImagesFromUnsplash('nature', 1);

            expect(mockSearchUnsplashCallable).toHaveBeenCalledWith({ query: 'nature', page: 1 });
        });

        it('should return the data payload from the Cloud Function result', async () => {
            const mockData = {
                items: [{ id: '1', urls: { regular: 'http://example.com/img1.jpg' } }],
                pagination: { pageIndex: 1, pageSize: 20, totalItems: 50, totalPages: 3 },
                status: 200,
            };
            mockSearchUnsplashCallable.mockResolvedValueOnce({ data: mockData });

            const result = await service.getImagesFromUnsplash('mountains', 1);

            expect(result).toEqual(mockData);
            expect(result.items).toHaveLength(1);
            expect(result.pagination.totalPages).toBe(3);
        });

        it('should propagate errors from the Cloud Function', async () => {
            const mockError = new Error('Function call failed');
            mockSearchUnsplashCallable.mockRejectedValueOnce(mockError);

            await expect(service.getImagesFromUnsplash('nature', 1)).rejects.toThrow('Function call failed');
        });

        it('should not contain any Unsplash API key in the service source', () => {
            // Verify no key is embedded at runtime — the key lives only server-side
            const serviceStr = service.constructor.toString();
            expect(serviceStr).not.toContain('hohA25ko');
            expect(serviceStr).not.toContain('Client-ID');
        });
    });

    describe('warmupUnsplash', () => {
        it('should call the Cloud Function with warmup: true', () => {
            mockSearchUnsplashCallable.mockResolvedValueOnce({ data: { ok: true } });

            service.warmupUnsplash();

            expect(mockSearchUnsplashCallable).toHaveBeenCalledWith({ warmup: true });
        });

        it('should not throw if warmup call fails', () => {
            mockSearchUnsplashCallable.mockRejectedValueOnce(new Error('cold'));

            expect(() => service.warmupUnsplash()).not.toThrow();
        });
    });

    describe('getMediaListFromFirestore', () => {
        it('should return an Observable', () => {
            const result = service.getMediaListFromFirestore(20);
            expect(result).toBeDefined();
            expect(typeof result.subscribe).toBe('function');
        });

        it('should accept pageSize parameter without throwing', () => {
            expect(() => service.getMediaListFromFirestore(10)).not.toThrow();
        });

        it('should accept optional startAfterDoc parameter without throwing', () => {
            const mockDoc = {} as any;
            expect(() => service.getMediaListFromFirestore(10, mockDoc)).not.toThrow();
        });

        it('should complete after first emission (take(1))', async () => {
            const unsubFn = vi.fn();
            vi.mocked(onSnapshot).mockImplementationOnce(((_q: any, callback: any) => {
                callback({
                    docs: [{
                        id: 'doc1',
                        data: () => ({ downloadURL: 'url1', name: 'img1' }),
                    }],
                });
                return unsubFn;
            }) as any);

            let completed = false;
            await new Promise<void>((resolve, reject) => {
                service.getMediaListFromFirestore(20).subscribe({
                    next: () => { },
                    complete: () => { completed = true; resolve(); },
                    error: reject,
                });
            });

            expect(completed).toBe(true);
        });

        it('should call onSnapshot unsubscribe after first emission', async () => {
            const unsubFn = vi.fn();
            vi.mocked(onSnapshot).mockImplementationOnce(((_q: any, callback: any) => {
                callback({
                    docs: [{
                        id: 'doc1',
                        data: () => ({ downloadURL: 'url1', name: 'img1' }),
                    }],
                });
                return unsubFn;
            }) as any);

            await new Promise<void>((resolve, reject) => {
                service.getMediaListFromFirestore(20).subscribe({
                    complete: resolve,
                    error: reject,
                });
            });

            expect(unsubFn).toHaveBeenCalled();
        });
    });
});
