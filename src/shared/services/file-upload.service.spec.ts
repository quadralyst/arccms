import { TestBed } from '@angular/core/testing';
import { FileUploadService } from './file-upload.service';
import { vi } from 'vitest';

// Import the types for providing to DI
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';

vi.mock('@angular/fire/storage', () => ({
    Storage: class { },
    getStorage: vi.fn(),
    ref: vi.fn(),
    uploadBytesResumable: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    getFirestore: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    deleteDoc: vi.fn()
}));

// Import functions after mocking for usage in tests
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { doc, getDoc, deleteDoc } from '@angular/fire/firestore';

// Mock instances for DI
const mockFirestore = {};
const mockStorage = {};

describe('FileUploadService', () => {
    let service: FileUploadService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                FileUploadService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Storage, useValue: mockStorage },
            ]
        });
        service = TestBed.inject(FileUploadService);
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should have convertToWebp in DEFAULT_UPLOAD_SETTINGS', async () => {
        const { DEFAULT_UPLOAD_SETTINGS } = await import('./file-upload.service');
        expect(DEFAULT_UPLOAD_SETTINGS.convertToWebp).toBe(false);
    });

    describe('generateUniqueImageName', () => {
        it('should generate a unique name with timestamp', () => {
            const name = service.generateUniqueImageName();
            expect(name).toMatch(/^image_\d+$/);
        });
    });

    describe('uploadFileInDb', () => {
        const mockBase64 = 'data:image/jpeg;base64,iVBORw0kggoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

        it('should upload file successfully', async () => {
            const mockRef = {};
            const mockUploadTask = {
                on: vi.fn((event, progress, error, complete) => {
                    progress({ bytesTransferred: 50, totalBytes: 100 });
                    complete();
                })
            };

            (ref as any).mockReturnValue(mockRef);
            (uploadBytesResumable as any).mockReturnValue(mockUploadTask);
            (getDownloadURL as any).mockResolvedValue('http://example.com/image.jpg');

            const progressSpy = vi.fn();
            const result = await service.uploadFileInDb(mockBase64, progressSpy);

            // Service uses injected mockStorage
            expect(ref).toHaveBeenCalledWith(mockStorage, expect.stringMatching(/^mediaImages\/image_\d+\.jpg$/));
            expect(uploadBytesResumable).toHaveBeenCalled();
            expect(progressSpy).toHaveBeenCalledWith(50);
            expect(result).toEqual({
                downloadURL: 'http://example.com/image.jpg',
                name: expect.stringMatching(/^image_\d+$/),
                uploadTime: expect.any(Date)
            });
        });

        it('should handle upload error', async () => {
            const mockRef = {};
            const mockUploadTask = {
                on: vi.fn((event, progress, error, complete) => {
                    error(new Error('Upload failed'));
                })
            };
            (ref as any).mockReturnValue(mockRef);
            (uploadBytesResumable as any).mockReturnValue(mockUploadTask);

            await expect(service.uploadFileInDb(mockBase64, () => { })).rejects.toThrow('Upload failed');
        });
    });

    describe('validateFileType', () => {
        it('should return null for allowed image types', () => {
            expect(service.validateFileType(new File([''], 'test.jpg', { type: 'image/jpeg' }))).toBeNull();
            expect(service.validateFileType(new File([''], 'test.png', { type: 'image/png' }))).toBeNull();
            expect(service.validateFileType(new File([''], 'test.webp', { type: 'image/webp' }))).toBeNull();
            expect(service.validateFileType(new File([''], 'test.gif', { type: 'image/gif' }))).toBeNull();
        });

        it('should return error for disallowed types', () => {
            expect(service.validateFileType(new File([''], 'test.pdf', { type: 'application/pdf' }))).toBeTruthy();
            expect(service.validateFileType(new File([''], 'test.bmp', { type: 'image/bmp' }))).toBeTruthy();
        });
    });

    describe('generateSeoFilename', () => {
        it('should use correct extension based on MIME type', () => {
            expect(service.generateSeoFilename('photo.png', 'image/jpeg')).toMatch(/\.jpg$/);
            expect(service.generateSeoFilename('photo.jpg', 'image/png')).toMatch(/\.png$/);
            expect(service.generateSeoFilename('photo.jpg', 'image/webp')).toMatch(/\.webp$/);
            expect(service.generateSeoFilename('photo.jpg', 'image/gif')).toMatch(/\.gif$/);
        });

        it('should sanitize filename to SEO-friendly format', () => {
            const name = service.generateSeoFilename('My Vacation Photo!.png', 'image/png');
            expect(name).toMatch(/^my-vacation-photo-[a-z0-9]{6}\.png$/);
        });

        it('should fallback to "image" for empty filenames', () => {
            const name = service.generateSeoFilename('!!!.png', 'image/png');
            expect(name).toMatch(/^image-[a-z0-9]{6}\.png$/);
        });

        it('should truncate long filenames to 50 chars', () => {
            const longName = 'a'.repeat(100) + '.png';
            const name = service.generateSeoFilename(longName, 'image/png');
            const basePart = name.replace(/-[a-z0-9]{6}\.png$/, '');
            expect(basePart.length).toBeLessThanOrEqual(50);
        });
    });

    describe('deleteMediaItem', () => {
        it('should delete media item successfully', async () => {
            const mockDocRef = {};
            const mockDocSnap = {
                exists: () => true,
                data: () => ({ downloadURL: 'path/to/image.jpg' })
            };
            const mockStorageRef = {};

            (doc as any).mockReturnValue(mockDocRef);
            (getDoc as any).mockResolvedValue(mockDocSnap);
            (ref as any).mockReturnValue(mockStorageRef);
            (deleteObject as any).mockResolvedValue(undefined);
            (deleteDoc as any).mockResolvedValue(undefined);

            await service.deleteMediaItem('media-id-123');

            // Service uses injected mockFirestore
            expect(doc).toHaveBeenCalledWith(mockFirestore, 'media', 'media-id-123');
            expect(getDoc).toHaveBeenCalledWith(mockDocRef);
            // Service uses injected mockStorage
            expect(ref).toHaveBeenCalledWith(mockStorage, 'path/to/image.jpg');
            expect(deleteObject).toHaveBeenCalledWith(mockStorageRef);
            expect(deleteDoc).toHaveBeenCalledWith(mockDocRef);
        });

        it('should throw error if media item does not exist', async () => {
            const mockDocRef = {};
            const mockDocSnap = {
                exists: () => false
            };
            (doc as any).mockReturnValue(mockDocRef);
            (getDoc as any).mockResolvedValue(mockDocSnap);

            await expect(service.deleteMediaItem('media-id-123')).rejects.toThrow('Failed to delete media item: Media item not found in Firestore');
        });
    });
});

