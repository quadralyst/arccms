import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { ExportFilesService } from './export-files.service';

vi.mock('@angular/fire/storage', () => ({
    Storage: class {},
    ref: vi.fn((_storage: any, path: string) => ({ fullPath: path })),
    getBlob: vi.fn().mockResolvedValue(new Blob(['test-image-data'], { type: 'image/jpeg' })),
}));

vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        collection: vi.fn(),
        getDocs: vi.fn().mockResolvedValue({
            docs: [
                {
                    id: 'media1',
                    data: () => ({
                        name: 'image_001',
                        downloadURL: 'https://example.com/img1.jpg',
                        storagePath: 'mediaImages/image_001.jpg',
                        uploadTime: '2024-01-15T10:00:00Z',
                        type: 'image',
                    }),
                },
                {
                    id: 'media2',
                    data: () => ({
                        name: 'image_002',
                        downloadURL: 'https://example.com/img2.png',
                        storagePath: 'mediaImages/image_002.png',
                        uploadTime: '2024-01-14T09:00:00Z',
                        type: 'image',
                    }),
                },
            ],
        }),
        query: vi.fn((...args: any[]) => args[0]),
        orderBy: vi.fn(),
    };
});

// Mock JSZip — track calls across all instances
const jsZipFileSpy = vi.fn();
const jsZipGenerateAsyncSpy = vi.fn().mockResolvedValue(new Blob(['zip-content'], { type: 'application/zip' }));

vi.mock('jszip', () => {
    class MockJSZip {
        file = jsZipFileSpy;
        generateAsync = jsZipGenerateAsyncSpy;
    }
    return { default: MockJSZip };
});

describe('ExportFilesService', () => {
    let service: ExportFilesService;

    beforeEach(async () => {
        vi.clearAllMocks();

        await TestBed.configureTestingModule({
            providers: [
                ExportFilesService,
                { provide: Firestore, useValue: {} },
                { provide: Storage, useValue: {} },
            ],
        }).compileComponents();

        service = TestBed.inject(ExportFilesService);
    });

    describe('getMediaItems', () => {
        it('should return media items from Firestore media collection', async () => {
            const items = await service.getMediaItems();

            expect(items).toHaveLength(2);
            expect(items[0].id).toBe('media1');
            expect(items[0].name).toBe('image_001');
            expect(items[0].downloadURL).toBe('https://example.com/img1.jpg');
            expect(items[0].storagePath).toBe('mediaImages/image_001.jpg');
        });

        it('should handle uploadTime as ISO string', async () => {
            const items = await service.getMediaItems();

            expect(items[0].uploadTime).toBe('2024-01-15T10:00:00Z');
        });

        it('should handle Firestore Timestamp uploadTime', async () => {
            const { getDocs } = await import('@angular/fire/firestore');
            const mockDate = new Date('2024-06-01T12:00:00Z');
            (getDocs as any).mockResolvedValueOnce({
                docs: [{
                    id: 'ts-media',
                    data: () => ({
                        name: 'ts_image',
                        downloadURL: 'https://example.com/ts.jpg',
                        storagePath: 'mediaImages/ts.jpg',
                        uploadTime: { toDate: () => mockDate },
                        type: 'image',
                    }),
                }],
            });

            const items = await service.getMediaItems();
            expect(items[0].uploadTime).toBe(mockDate.toISOString());
        });

        it('should return empty array when no media documents exist', async () => {
            const { getDocs } = await import('@angular/fire/firestore');
            (getDocs as any).mockResolvedValueOnce({ docs: [] });

            const items = await service.getMediaItems();
            expect(items).toHaveLength(0);
        });
    });

    describe('downloadFile', () => {
        it('should use getBlob from Firebase SDK to download by storage path', async () => {
            const { getBlob, ref } = await import('@angular/fire/storage');
            const item = {
                id: 'media1',
                name: 'img1',
                downloadURL: 'https://example.com/img1.jpg',
                storagePath: 'mediaImages/img1.jpg',
                uploadTime: '2024-01-15',
                type: 'image',
            };

            const blob = await service.downloadFile(item);

            expect(blob).toBeInstanceOf(Blob);
            expect(ref).toHaveBeenCalledWith(expect.anything(), 'mediaImages/img1.jpg');
            expect(getBlob).toHaveBeenCalled();
        });

        it('should extract storage path from downloadURL when storagePath is empty', async () => {
            const { getBlob, ref } = await import('@angular/fire/storage');
            const item = {
                id: 'media1',
                name: 'img1',
                downloadURL: 'https://firebasestorage.googleapis.com/v0/b/my-bucket.appspot.com/o/mediaImages%2Fimage_001.jpg?alt=media&token=abc123',
                storagePath: '',
                uploadTime: '2024-01-15',
                type: 'image',
            };

            const blob = await service.downloadFile(item);

            expect(blob).toBeInstanceOf(Blob);
            // Should extract "mediaImages/image_001.jpg" from the URL-encoded path
            expect(ref).toHaveBeenCalledWith(expect.anything(), 'mediaImages/image_001.jpg');
            expect(getBlob).toHaveBeenCalled();
        });

        it('should throw when neither storagePath nor downloadURL can provide a path', async () => {
            const item = {
                id: 'media1',
                name: 'img1',
                downloadURL: '',
                storagePath: '',
                uploadTime: '2024-01-15',
                type: 'image',
            };

            await expect(service.downloadFile(item)).rejects.toThrow('Cannot determine storage path');
        });
    });

    describe('downloadAsZip', () => {
        const mockItems = [
            {
                id: 'media1',
                name: 'img1',
                downloadURL: 'https://example.com/img1.jpg',
                storagePath: 'mediaImages/img1.jpg',
                uploadTime: '2024-01-15',
                type: 'image',
            },
            {
                id: 'media2',
                name: 'img2',
                downloadURL: 'https://example.com/img2.png',
                storagePath: 'mediaImages/img2.png',
                uploadTime: '2024-01-14',
                type: 'image',
            },
        ];

        it('should bundle selected media into a ZIP', async () => {
            const zipBlob = await service.downloadAsZip(mockItems, vi.fn());
            expect(zipBlob).toBeInstanceOf(Blob);
        });

        it('should invoke progress callback', async () => {
            const progressSpy = vi.fn();
            await service.downloadAsZip([mockItems[0]], progressSpy);

            expect(progressSpy).toHaveBeenCalled();
            expect(progressSpy).toHaveBeenCalledWith(
                expect.objectContaining({ currentFile: 'img1' }),
            );
        });

        it('should include media-manifest.json in the ZIP', async () => {
            await service.downloadAsZip(mockItems, vi.fn());

            // The manifest file should be added to the zip
            expect(jsZipFileSpy).toHaveBeenCalledWith(
                'media-manifest.json',
                expect.stringContaining('"media1"'),
            );
        });
    });

    describe('triggerDownload', () => {
        it('should create download link and trigger click', () => {
            const createElementSpy = vi.spyOn(document, 'createElement');
            const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
            const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

            const mockAnchor = { href: '', download: '', click: vi.fn() } as any;
            createElementSpy.mockReturnValue(mockAnchor);
            vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor);
            vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor);

            const blob = new Blob(['test']);
            service.triggerDownload(blob, 'test.zip');

            expect(mockAnchor.download).toBe('test.zip');
            expect(mockAnchor.click).toHaveBeenCalled();

            createElementSpy.mockRestore();
            createObjectURLSpy.mockRestore();
            revokeObjectURLSpy.mockRestore();
        });
    });
});
