import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { ImportFilesService, FileWithPath } from './import-files.service';
import { FileUploadService } from '../../../../../shared/services/file-upload.service';
// Paths go through the install's upload folder (arc-install.ts), whatever it is.
import { withStoragePrefix } from '../../../../core/config/arc-config';

const mockUploadOn = vi.fn();
vi.mock('@angular/fire/storage', () => ({
    Storage: class {},
    ref: vi.fn((_storage: any, path: string) => ({ fullPath: path })),
    uploadBytesResumable: vi.fn().mockReturnValue({
        on: vi.fn((_event: string, _progress: any, _error: any, complete: any) => {
            complete();
        }),
    }),
    getDownloadURL: vi.fn().mockResolvedValue('https://storage.example.com/uploaded-file.jpg'),
}));

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        doc: vi.fn((parent: any, ...segments: string[]) => segments.length
            ? { path: segments.join('/'), id: segments[segments.length - 1] }
            : { path: `${parent.path}/auto-id`, id: 'auto-id' }),
        collection: vi.fn((_db: any, name: string) => ({ path: name })),
        setDoc: (...args: any[]) => mockSetDoc(...args),
    };
});

describe('ImportFilesService', () => {
    let service: ImportFilesService;
    const uploadDocument = vi.fn();

    beforeEach(async () => {
        vi.clearAllMocks();

        await TestBed.configureTestingModule({
            providers: [
                ImportFilesService,
                { provide: Firestore, useValue: {} },
                { provide: Storage, useValue: {} },
                { provide: FileUploadService, useValue: { uploadDocument } },
            ],
        }).compileComponents();

        service = TestBed.inject(ImportFilesService);
    });

    describe('uploadFile', () => {
        it('should create correct storage reference', async () => {
            const { ref: mockRef } = await import('@angular/fire/storage');
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            await service.uploadFile(file, 'mediaImages/test.jpg', vi.fn());

            expect(mockRef).toHaveBeenCalledWith(expect.anything(), withStoragePrefix('mediaImages/test.jpg'));
        });

        it('should report progress via callback', async () => {
            const { uploadBytesResumable: mockUpload } = await import('@angular/fire/storage');

            // Override mock to call progress callback
            (mockUpload as any).mockReturnValueOnce({
                on: vi.fn((_event: string, progressCb: any, _error: any, complete: any) => {
                    progressCb({ bytesTransferred: 50, totalBytes: 100 });
                    complete();
                }),
            });

            const progressSpy = vi.fn();
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            await service.uploadFile(file, 'mediaImages/test.jpg', progressSpy);

            expect(progressSpy).toHaveBeenCalledWith(50);
        });

        it('should return downloadURL on success', async () => {
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const result = await service.uploadFile(file, 'mediaImages/test.jpg', vi.fn());

            expect(result.downloadURL).toBe('https://storage.example.com/uploaded-file.jpg');
            expect(result.fullPath).toBe(withStoragePrefix('mediaImages/test.jpg'));
        });
    });

    describe('uploadFiles', () => {
        it('should upload each file sequentially', async () => {
            const { uploadBytesResumable: mockUpload } = await import('@angular/fire/storage');

            const files: FileWithPath[] = [
                { file: new File(['1'], 'file1.jpg'), storagePath: 'mediaImages/file1.jpg' },
                { file: new File(['2'], 'file2.png'), storagePath: 'mediaImages/file2.png' },
            ];

            const results = await service.uploadFiles(files, vi.fn());

            expect(results).toHaveLength(2);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(true);
            expect(mockUpload).toHaveBeenCalledTimes(2);
        });

        it('should handle upload errors gracefully', async () => {
            const { uploadBytesResumable: mockUpload } = await import('@angular/fire/storage');
            (mockUpload as any).mockReturnValueOnce({
                on: vi.fn((_event: string, _progress: any, errorCb: any) => {
                    errorCb(new Error('Upload quota exceeded'));
                }),
            });

            const files: FileWithPath[] = [
                { file: new File(['1'], 'file1.jpg'), storagePath: 'mediaImages/file1.jpg' },
            ];

            const results = await service.uploadFiles(files, vi.fn());

            expect(results[0].success).toBe(false);
            expect(results[0].error).toBe('Upload quota exceeded');
        });
    });

    describe('updateMediaMetadata', () => {
        it('should create docs in media collection with setDoc', async () => {
            const uploadResults = [
                { fileName: 'img1.jpg', storagePath: 'mediaImages/img1.jpg', downloadURL: 'https://example.com/img1.jpg', success: true },
                { fileName: 'img2.png', storagePath: 'mediaImages/img2.png', downloadURL: 'https://example.com/img2.png', success: true },
            ];

            await service.updateMediaMetadata(uploadResults);

            expect(mockSetDoc).toHaveBeenCalledTimes(2);
            expect(mockSetDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    downloadURL: 'https://example.com/img1.jpg',
                    name: 'img1.jpg',
                }),
            );
        });

        it('should skip failed uploads', async () => {
            const uploadResults = [
                { fileName: 'img1.jpg', storagePath: 'mediaImages/img1.jpg', downloadURL: '', success: false, error: 'Failed' },
                { fileName: 'img2.png', storagePath: 'mediaImages/img2.png', downloadURL: 'https://example.com/img2.png', success: true },
            ];

            await service.updateMediaMetadata(uploadResults);

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });
    });

    describe('importFromManifest', () => {
        it('should match files to manifest entries by name', async () => {
            const manifest = {
                media1: { name: 'img1.jpg', storagePath: 'mediaImages/img1.jpg' },
                media2: { name: 'img2.png', storagePath: 'mediaImages/img2.png' },
            };

            const files = [
                new File(['1'], 'img1.jpg'),
                new File(['2'], 'img2.png'),
                new File(['3'], 'unmatched.gif'), // Not in manifest
            ];

            const results = await service.importFromManifest(manifest, files, vi.fn());

            // Only 2 files match the manifest
            expect(results).toHaveLength(2);
        });

        it('should upload to original storage paths from manifest', async () => {
            const { ref: mockRef } = await import('@angular/fire/storage');

            const manifest = {
                media1: { name: 'img1.jpg', storagePath: 'custom/path/img1.jpg' },
            };

            const files = [new File(['1'], 'img1.jpg')];

            await service.importFromManifest(manifest, files, vi.fn());

            expect(mockRef).toHaveBeenCalledWith(expect.anything(), withStoragePrefix('custom/path/img1.jpg'));
        });
    });

    describe('documents go to the library\'s Files (docs/features/media.html)', () => {
        const uploaded = (name: string) => ({
            title: name.replace(/\.[^.]+$/, ''), name: `${name}-abc123`, downloadURL: `https://storage.example/${name}`, path: `mediaFiles/${name}`,
            type: 'pdf', contentType: 'application/pdf', bytes: 1, uploadTime: new Date(),
        });

        beforeEach(() => {
            uploadDocument.mockImplementation(async (file: File) => uploaded(file.name));
        });

        it('stores each through the Files upload and writes its mediaFiles record', async () => {
            const results = await service.uploadDocuments([{ file: new File(['%PDF'], 'menu.pdf') }], true, vi.fn());
            expect(uploadDocument).toHaveBeenCalledTimes(1);
            expect(mockSetDoc).toHaveBeenCalledWith(
                expect.objectContaining({ path: 'mediaFiles/auto-id' }),
                expect.objectContaining({ title: 'menu', path: 'mediaFiles/menu.pdf', id: 'auto-id' }),
            );
            expect(results[0]).toMatchObject({ success: true, collection: 'mediaFiles' });
        });

        it('writes no record when the media collection is not to be updated', async () => {
            await service.uploadDocuments([{ file: new File(['%PDF'], 'menu.pdf') }], false, vi.fn());
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('reports a refused document as failed and carries on', async () => {
            uploadDocument.mockRejectedValueOnce(new Error('This file type cannot be uploaded.'));
            const results = await service.uploadDocuments([{ file: new File(['x'], 'a.pdf') }, { file: new File(['%PDF'], 'b.pdf') }], true, vi.fn());
            expect(results.map((r) => r.success)).toEqual([false, true]);
        });

        it('restores a manifest\'s documents to Files with their title and notes, and its images as before', async () => {
            const manifest = {
                f1: { name: 'brochure-abc123.pdf', collection: 'mediaFiles', title: 'Spring brochure', notes: 'For the shop' },
                m1: { name: 'img1.jpg', storagePath: 'mediaImages/img1.jpg', title: 'Shop front', alt: 'The shop' },
            };
            const results = await service.importFromManifest(manifest, [new File(['%PDF'], 'brochure-abc123.pdf'), new File(['1'], 'img1.jpg')], vi.fn());
            expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Spring brochure', notes: 'For the shop' }));
            expect(results.find((r) => r.fileName === 'img1.jpg')).toMatchObject({ details: { title: 'Shop front', alt: 'The shop' } });
        });

        it('keeps documents out of the media collection, and gives images their details', async () => {
            await service.updateMediaMetadata([
                { fileName: 'a.pdf', storagePath: 'mediaFiles/a.pdf', downloadURL: 'u', success: true, collection: 'mediaFiles' },
                { fileName: 'b.jpg', storagePath: 'mediaImages/b.jpg', downloadURL: 'v', success: true, details: { alt: 'B' } },
            ]);
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'b.jpg', alt: 'B' }));
        });
    });
});
