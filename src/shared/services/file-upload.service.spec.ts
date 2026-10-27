import { TestBed } from '@angular/core/testing';
import { FileUploadService } from './file-upload.service';
import { vi } from 'vitest';

// Import the types for providing to DI
import { Firestore } from '@angular/fire/firestore';
import { ArcStorage } from '../../app/core/config/arc-storage';

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

const openPdf = vi.fn();
vi.mock('../utils/pdf-pages', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../utils/pdf-pages')>()),
    openPdf: (...args: unknown[]) => openPdf(...args),
}));

// Import functions after mocking for usage in tests
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { doc, getDoc, deleteDoc } from '@angular/fire/firestore';
// Paths go through the install's upload folder (arc-install.ts), whatever it is.
import { arcConfig } from '../../app/core/config/arc-config';

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
                { provide: ArcStorage, useValue: { get: async () => mockStorage } },
            ]
        });
        service = TestBed.inject(FileUploadService);
        vi.clearAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('defaults to WebP at 1200px, matching Settings → Misc', async () => {
        const { DEFAULT_UPLOAD_SETTINGS } = await import('./file-upload.service');
        const { DEFAULT_MISC_SETTINGS } = await import('../../app/pages/admin/(settings)/misc/misc-settings.model');
        expect(DEFAULT_UPLOAD_SETTINGS.convertToWebp).toBe(true);
        expect(DEFAULT_UPLOAD_SETTINGS.maxSize).toBe(1200);
        expect(DEFAULT_UPLOAD_SETTINGS).toEqual({
            maxFileSize: DEFAULT_MISC_SETTINGS.mediaMaxFileSize,
            maxSize: DEFAULT_MISC_SETTINGS.mediaMaxSize,
            convertToWebp: DEFAULT_MISC_SETTINGS.mediaConvertToWebp,
        });
    });

    describe('uploadSettingsFromMisc', () => {
        it('reads the media fields of Settings/misc and fills gaps with the defaults', async () => {
            const { uploadSettingsFromMisc, DEFAULT_UPLOAD_SETTINGS } = await import('./file-upload.service');
            expect(uploadSettingsFromMisc(undefined)).toEqual(DEFAULT_UPLOAD_SETTINGS);
            expect(uploadSettingsFromMisc({ mediaMaxFileSize: 2, mediaMaxSize: 1600, mediaConvertToWebp: false }))
                .toEqual({ maxFileSize: 2, maxSize: 1600, convertToWebp: false });
            expect(uploadSettingsFromMisc({ mediaMaxSize: 800 })).toEqual({ ...DEFAULT_UPLOAD_SETTINGS, maxSize: 800 });
        });

        it('ignores the retired width and height limits', async () => {
            const { uploadSettingsFromMisc, DEFAULT_UPLOAD_SETTINGS } = await import('./file-upload.service');
            expect(uploadSettingsFromMisc({ mediaMaxWidth: 1920, mediaMaxHeight: 1080 } as any)).toEqual(DEFAULT_UPLOAD_SETTINGS);
        });
    });

    describe('uploadFile', () => {
        it('stores a file under every size name, so each size a template derives exists', async () => {
            // A 500px photo with a 1200 maximum: M, L and XL are all 500px, S is 300px.
            vi.spyOn(service as any, 'loadImageFromFile').mockResolvedValue({ naturalWidth: 500, naturalHeight: 400 });
            const encode = vi.spyOn(service as any, 'encodeImage').mockImplementation(async (_img: any, w: number) => new Blob([`img-${w}`]));
            const paths: string[] = [];
            vi.spyOn(service as any, 'uploadBlob').mockImplementation(async (path: string) => { paths.push(path); return `url:${path}`; });

            const file = new File(['x'], 'Team Photo.jpg', { type: 'image/jpeg' });
            const result = await service.uploadFile(file, { maxFileSize: 5, maxSize: 1200, convertToWebp: true }, () => {});

            expect(paths.map((p) => p.replace(/^.*-(s|m|l|xl)\.webp$/, '$1')).sort()).toEqual(['l', 'm', 's', 'xl']);
            // Encoded once per distinct pixel size: 500px and 300px.
            expect(encode).toHaveBeenCalledTimes(2);
            expect(result.variants!.l.url).toMatch(/-l\.webp$/);
            expect(result.variants!.l.width).toBe(500);
            expect(result.variants!.s.width).toBe(300);
        });
    });

    describe('uploadCroppedCopy', () => {
        function spyPipeline() {
            const load = vi.spyOn(service as any, 'loadImageFromFile').mockResolvedValue({ naturalWidth: 1200, naturalHeight: 800 });
            const encode = vi.spyOn(service as any, 'encodeImage').mockImplementation(async (_img: any, w: number) => new Blob([`img-${w}`]));
            const paths: string[] = [];
            vi.spyOn(service as any, 'uploadBlob').mockImplementation(async (path: string) => { paths.push(path); return `url:${path}`; });
            return { load, encode, paths };
        }

        it('crops the largest stored size and stores the crop at every size', async () => {
            const { load, encode, paths } = spyPipeline();
            const crop = { x: 100, y: 50, width: 800, height: 600 };
            const source = new Blob(['xl'], { type: 'image/webp' });

            const result = await service.uploadCroppedCopy(
                source, 'team-photo-a1b2c3-xl.webp', crop,
                { maxFileSize: 5, maxSize: 1200, convertToWebp: true }, () => {},
            );

            expect(load).toHaveBeenCalledWith(source);
            // Every encode draws the crop, never the whole image.
            for (const call of encode.mock.calls) expect(call[4]).toEqual(crop);
            // Sizes come from the crop: 800 px is the XL and L size here, never enlarged.
            expect(result.width).toBe(800);
            expect(result.height).toBe(600);
            expect(result.variants!.m.width).toBe(600);
            expect(result.variants!.s.width).toBe(300);
            // A new file set named after the original, so the original is untouched.
            expect(paths).toHaveLength(4);
            for (const path of paths) expect(path).toMatch(/mediaImages\/team-photo-crop-[a-z0-9]{6}-(s|m|l|xl)\.webp$/);
        });

        it('keeps the original type when WebP conversion is off, and does not stack -crop', async () => {
            const { paths } = spyPipeline();
            await service.uploadCroppedCopy(
                new Blob(['x']), 'logo-crop-zz9zz9-xl.png', { x: 0, y: 0, width: 10, height: 10 },
                { maxFileSize: 5, maxSize: 1200, convertToWebp: false }, () => {},
            );
            for (const path of paths) expect(path).toMatch(/mediaImages\/logo-crop-[a-z0-9]{6}-(s|m|l|xl)\.png$/);
        });

        it('refuses a GIF, whose animation a crop would drop', async () => {
            const { load } = spyPipeline();
            await expect(service.uploadCroppedCopy(new Blob(['g']), 'party-a1b2c3.gif', { x: 0, y: 0, width: 5, height: 5 }, undefined, () => {}))
                .rejects.toThrow(/GIF/);
            expect(load).not.toHaveBeenCalled();
        });

        it('stops when the cropped XL file is over the size limit', async () => {
            spyPipeline();
            vi.spyOn(service as any, 'encodeImage').mockImplementation(async () => new Blob([new Uint8Array(2 * 1024 * 1024)]));
            await expect(service.uploadCroppedCopy(new Blob(['x']), 'big-a1b2c3-xl.webp', { x: 0, y: 0, width: 1000, height: 800 },
                { maxFileSize: 1, maxSize: 1200, convertToWebp: true }, () => {})).rejects.toThrow(/exceeds/);
        });
    });

    describe('mimeTypeOfName', () => {
        it('reads the type from the extension', async () => {
            const { mimeTypeOfName } = await import('./file-upload.service');
            expect(mimeTypeOfName('a-xl.webp')).toBe('image/webp');
            expect(mimeTypeOfName('a.PNG')).toBe('image/png');
            expect(mimeTypeOfName('a.jpeg')).toBe('image/jpeg');
            expect(mimeTypeOfName('a.gif')).toBe('image/gif');
            expect(mimeTypeOfName('image_1700000000000')).toBe('image/jpeg');
        });
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
            expect(ref).toHaveBeenCalledWith(mockStorage, expect.stringMatching(new RegExp(`^${arcConfig.storagePrefix}mediaImages/image_\\d+\\.jpg$`)));
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

        it('deletes every stored size of a sized upload, each once', async () => {
            const mockDocRef = {};
            const shared = { url: 'u', path: 'mediaImages/photo-m.webp', width: 600, height: 400 };
            const mockDocSnap = {
                exists: () => true,
                data: () => ({
                    downloadURL: 'https://…/photo-xl.webp',
                    variants: {
                        s: { url: 'u', path: 'mediaImages/photo-s.webp', width: 300, height: 200 },
                        m: shared,
                        // A small image reuses M for L and XL: one file, deleted once.
                        l: shared,
                        xl: shared,
                    },
                }),
            };

            (doc as any).mockReturnValue(mockDocRef);
            (getDoc as any).mockResolvedValue(mockDocSnap);
            (ref as any).mockImplementation((_storage: any, path: string) => ({ path }));
            (deleteObject as any).mockResolvedValue(undefined);
            (deleteDoc as any).mockResolvedValue(undefined);

            await service.deleteMediaItem('media-id-123');

            expect((deleteObject as any).mock.calls.map((call: any[]) => call[0].path)).toEqual([
                'mediaImages/photo-s.webp',
                'mediaImages/photo-m.webp',
            ]);
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

    describe('uploadDocument (docs/features/media.html, Files)', () => {
        const task = { on: vi.fn((_e: string, progress: Function, _err: Function, complete: Function) => { progress({ bytesTransferred: 1, totalBytes: 1 }); complete(); }) };

        beforeEach(() => {
            (ref as any).mockImplementation((_s: unknown, path: string) => ({ fullPath: path }));
            (uploadBytesResumable as any).mockReturnValue(task);
            (getDownloadURL as any).mockImplementation(async (r: { fullPath: string }) => `https://storage/${r.fullPath}`);
            openPdf.mockReset();
        });

        it('refuses a type the library does not take, before sending anything', async () => {
            const { MediaFileUploadError } = await import('./file-upload.service');
            const error = await service.uploadDocument(new File(['<html>'], 'page.html', { type: 'text/html' }), vi.fn()).catch((e) => e);
            expect(error).toBeInstanceOf(MediaFileUploadError);
            expect(error.problem).toBe('type');
            expect(uploadBytesResumable).not.toHaveBeenCalled();
        });

        it('refuses a file over 20 MB', async () => {
            const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
            Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 });
            await expect(service.uploadDocument(big, vi.fn())).rejects.toMatchObject({ problem: 'size' });
            expect(uploadBytesResumable).not.toHaveBeenCalled();
        });

        it('stores the type from the extension, with open-or-download and the title as the name (MF-D6, MF-D7)', async () => {
            // Windows calls a CSV an Excel file; the extension decides.
            const csv = new File(['a,b'], 'Price_List.csv', { type: 'application/vnd.ms-excel' });
            const result = await service.uploadDocument(csv, vi.fn());
            const [, , metadata] = (uploadBytesResumable as any).mock.calls[0];
            expect(metadata.contentType).toBe('text/csv');
            expect(metadata.contentDisposition).toMatch(/^attachment; filename="Price List\.csv"/);
            expect(result).toMatchObject({ title: 'Price List', type: 'csv', contentType: 'text/csv', bytes: 3 });
            expect(result.path).toMatch(new RegExp(`^${arcConfig.storagePrefix}mediaFiles/price-list-[a-z0-9]+\\.csv$`));
            expect(result.downloadURL).toBe(`https://storage/${result.path}`);
            expect(result.pages).toBeUndefined();
            expect(openPdf).not.toHaveBeenCalled();
        });

        it('gives a PDF its page count and a first-page thumbnail (MF-D9)', async () => {
            const thumb = new Blob(['jpg'], { type: 'image/jpeg' });
            const destroy = vi.fn();
            openPdf.mockResolvedValue({ pageCount: 24, renderPage: vi.fn().mockResolvedValue({ blob: thumb, width: 283, height: 400, scale: 0.5 }), destroy });
            const pdf = new File(['%PDF'], 'Annual Report.pdf', { type: 'application/pdf' });
            const result = await service.uploadDocument(pdf, vi.fn());
            expect(result.pages).toBe(24);
            expect(result.thumbnail).toMatchObject({ width: 283, height: 400 });
            expect(result.thumbnail!.path).toBe(result.path.replace(/\.pdf$/, '-thumb.jpg'));
            const thumbCall = (uploadBytesResumable as any).mock.calls[1];
            expect(thumbCall[2].contentType).toBe('image/jpeg');
            expect(destroy).toHaveBeenCalled();
            const [, , metadata] = (uploadBytesResumable as any).mock.calls[0];
            expect(metadata.contentDisposition).toMatch(/^inline; /);
        });

        it('still uploads a locked PDF, without pages or a thumbnail (MF-D17)', async () => {
            const { PdfOpenError } = await import('../utils/pdf-pages');
            openPdf.mockRejectedValue(new PdfOpenError('locked'));
            const result = await service.uploadDocument(new File(['%PDF'], 'secret.pdf', { type: 'application/pdf' }), vi.fn());
            expect(result.pages).toBeUndefined();
            expect(result.thumbnail).toBeUndefined();
            expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
        });
    });

    it('gives an uploaded image a title from its file name', async () => {
        const gif = new File(['GIF89a'], 'Party_Time.gif', { type: 'image/gif' });
        (ref as any).mockReturnValue({});
        (uploadBytesResumable as any).mockReturnValue({ on: vi.fn((_e: string, _p: Function, _err: Function, complete: Function) => complete()) });
        (getDownloadURL as any).mockResolvedValue('https://storage/x.gif');
        const result = await service.uploadFile(gif, undefined, vi.fn());
        expect(result.title).toBe('Party Time');
    });

    describe('removeStored and storedPaths', () => {
        it('removes each path once, ignoring a file already gone', async () => {
            (ref as any).mockImplementation((_s: unknown, path: string) => ({ fullPath: path }));
            (deleteObject as any).mockRejectedValueOnce({ code: 'storage/object-not-found' }).mockResolvedValue(undefined);
            await service.removeStored(['a', 'a', undefined, 'b']);
            expect((deleteObject as any).mock.calls.map((c: any[]) => c[0].fullPath)).toEqual(['a', 'b']);
        });

        it('lists every stored file of an image, a GIF and a document', () => {
            const sized = { downloadURL: 'u', name: 'n', uploadTime: new Date(), variants: { s: { path: 'p-s' }, m: { path: 'p-m' }, l: { path: 'p-l' }, xl: { path: 'p-xl' } } } as any;
            expect(FileUploadService.storedPaths(sized)).toEqual(['p-s', 'p-m', 'p-l', 'p-xl']);
            const gif = { downloadURL: 'https://x/o/arccms%2FmediaImages%2Fparty.gif?alt=media', name: 'party.gif', uploadTime: new Date() } as any;
            expect(FileUploadService.storedPaths(gif)).toEqual(['arccms/mediaImages/party.gif']);
            const doc = { path: 'mediaFiles/a.pdf', thumbnail: { path: 'mediaFiles/a-thumb.jpg' } } as any;
            expect(FileUploadService.storedPaths(doc)).toEqual(['mediaFiles/a.pdf', 'mediaFiles/a-thumb.jpg']);
        });
    });
});
