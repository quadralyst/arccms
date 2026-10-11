import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
    getDoc: vi.fn(),
}));

vi.mock('../../../../app/pages/admin/(media)/media-manager.store', () => ({
    MediaManagerStore: class {},
}));

vi.mock('../../../../app/pages/admin/(media)/media-files.service', () => ({
    MediaFilesService: class {},
}));

import { getDoc } from '@angular/fire/firestore';
import { EditorImageUploadService } from './editor-image-upload.service';
import { FileUploadService, UploadedMedia } from '../../../services/file-upload.service';
import { MediaManagerStore } from '../../../../app/pages/admin/(media)/media-manager.store';
import { NotifyService } from '../../../services/notify.service';
import { MediaFilesService } from '../../../../app/pages/admin/(media)/media-files.service';
import { MediaFileUploadError } from '../../../services/file-upload.service';

/**
 * The editor's dropped or pasted image goes through the media library: the
 * Settings → Misc limits, a `media` document, and the M size back.
 */

const variant = (size: string) => ({ url: `https://storage.example/photo-${size}.webp`, path: `mediaImages/photo-${size}.webp`, width: 100, height: 80 });

const sized: UploadedMedia = {
    downloadURL: 'https://storage.example/photo-xl.webp',
    name: 'photo-xl.webp',
    uploadTime: new Date(),
    width: 1200,
    height: 960,
    variants: { s: variant('s'), m: variant('m'), l: variant('l'), xl: variant('xl') },
};

describe('EditorImageUploadService', () => {
    let service: EditorImageUploadService;
    let fileUpload: { validateFileType: ReturnType<typeof vi.fn>; uploadFile: ReturnType<typeof vi.fn>; uploadDocument: ReturnType<typeof vi.fn> };
    let mediaFiles: { addBatch: ReturnType<typeof vi.fn>; rememberBytes: ReturnType<typeof vi.fn> };
    let mediaStore: { addBatch: ReturnType<typeof vi.fn> };
    let notify: { warning: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    const file = new File(['x'], 'Team Photo.jpg', { type: 'image/jpeg' });

    function settingsDoc(data: Record<string, unknown> | null) {
        vi.mocked(getDoc).mockResolvedValue({ exists: () => data !== null, data: () => data } as any);
    }

    beforeEach(() => {
        fileUpload = {
            // The real check: it reads nothing from the service.
            validateFileType: vi.fn((f: File) => FileUploadService.prototype.validateFileType.call(null, f)),
            uploadFile: vi.fn().mockResolvedValue(sized),
            uploadDocument: vi.fn(),
        };
        mediaFiles = { addBatch: vi.fn().mockReturnValue(of(['file-1'])), rememberBytes: vi.fn() };
        mediaStore = { addBatch: vi.fn().mockReturnValue(of(['media-1'])) };
        notify = { warning: vi.fn(), error: vi.fn() };
        settingsDoc(null);

        TestBed.configureTestingModule({
            providers: [
                EditorImageUploadService,
                { provide: FileUploadService, useValue: fileUpload },
                { provide: MediaManagerStore, useValue: mediaStore },
                { provide: Firestore, useValue: {} },
                { provide: NotifyService, useValue: notify },
                { provide: MediaFilesService, useValue: mediaFiles },
            ],
        });
        service = TestBed.inject(EditorImageUploadService);
    });

    afterEach(() => vi.clearAllMocks());

    it('uploads with the Settings → Misc limits and returns the M size, the size Insert image uses', async () => {
        settingsDoc({ mediaMaxFileSize: 2, mediaMaxSize: 1600, mediaConvertToWebp: false, mediaMaxWidth: 1920 });
        const onProgress = vi.fn();

        const url = await service.upload(file, onProgress);

        expect(fileUpload.uploadFile).toHaveBeenCalledWith(file, { maxFileSize: 2, maxSize: 1600, convertToWebp: false }, onProgress);
        expect(url).toBe('https://storage.example/photo-m.webp');
        expect(url.startsWith('data:')).toBe(false);
    });

    it('uses the defaults when Settings/misc is missing or cannot be read', async () => {
        vi.mocked(getDoc).mockRejectedValue(new Error('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await service.upload(file, vi.fn());

        expect(fileUpload.uploadFile).toHaveBeenCalledWith(file, { maxFileSize: 5, maxSize: 1200, convertToWebp: true }, expect.any(Function));
    });

    it('writes a media document, as the media manager does, so the image is in My Uploads', async () => {
        await service.upload(file, vi.fn());
        expect(mediaStore.addBatch).toHaveBeenCalledWith([sized]);
    });

    it('returns the one stored file for a GIF, which has no sizes', async () => {
        const gif: UploadedMedia = { downloadURL: 'https://storage.example/anim.gif', name: 'anim.gif', uploadTime: new Date() };
        fileUpload.uploadFile.mockResolvedValue(gif);

        expect(await service.upload(new File(['x'], 'anim.gif', { type: 'image/gif' }), vi.fn())).toBe('https://storage.example/anim.gif');
    });

    it('refuses a type the library does not take before uploading anything', async () => {
        await expect(service.upload(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), vi.fn()))
            .rejects.toThrow('Invalid file type. Allowed types: JPEG, PNG, WebP, GIF.');
        expect(fileUpload.uploadFile).not.toHaveBeenCalled();
        expect(mediaStore.addBatch).not.toHaveBeenCalled();
    });

    it('passes on a too-large refusal from the upload', async () => {
        fileUpload.uploadFile.mockRejectedValue(new Error('File size (9.0 MB) exceeds the maximum allowed size (5 MB).'));
        await expect(service.upload(file, vi.fn())).rejects.toThrow('exceeds the maximum allowed size');
        expect(mediaStore.addBatch).not.toHaveBeenCalled();
    });

    it('still returns the image when only its library entry fails, and says so', async () => {
        mediaStore.addBatch.mockReturnValue(throwError(() => new Error('permission-denied')));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await service.upload(file, vi.fn())).toBe('https://storage.example/photo-m.webp');
        expect(notify.warning).toHaveBeenCalledWith('admin.media.editor_library_failed');
    });

    describe('showError', () => {
        it("shows the upload's own reason for a wrong type or a file too large", () => {
            service.showError(file, new Error('File size (9.0 MB) exceeds the maximum allowed size (5 MB).'));
            expect(notify.error).toHaveBeenCalledWith('admin.media.editor_upload_failed', {
                name: 'Team Photo.jpg',
                reason: 'File size (9.0 MB) exceeds the maximum allowed size (5 MB).',
            });
        });

        it('passes a file name that looks like HTML through unchanged, since the toast shows it as text', () => {
            service.showError(new File(['x'], '<img src=x onerror=alert(1)>.png', { type: 'image/png' }), new Error('Failed to load image.'));
            expect(notify.error).toHaveBeenCalledWith('admin.media.editor_upload_failed', {
                name: '<img src=x onerror=alert(1)>.png',
                reason: 'Failed to load image.',
            });
        });

        it('shows a plain sentence, not a Firebase code, when Storage fails', () => {
            const storageError = Object.assign(new Error('Firebase Storage: An unknown error occurred (storage/unknown)'), { code: 'storage/unknown' });
            service.showError(file, storageError);
            expect(notify.error).toHaveBeenCalledWith('admin.media.editor_upload_failed', {
                name: 'Team Photo.jpg',
                reason: 'the upload did not finish. Check your connection and try again.',
            });
        });
    });

    it('labels the placeholder with the file name and a whole percent', () => {
        expect(service.uploadingLabel(file, 42.6)).toBe('Uploading Team Photo.jpg... 43%');
    });

    describe('documents (MF-D20)', () => {
        const pdf = new File(['%PDF'], 'Brochure.pdf', { type: 'application/pdf' });
        const uploaded = {
            title: 'Brochure', name: 'brochure-abc123.pdf', downloadURL: 'https://storage.example/brochure.pdf', path: 'mediaFiles/brochure-abc123.pdf',
            type: 'pdf', contentType: 'application/pdf', bytes: 4, pages: 3, uploadTime: new Date(),
        };

        it('uploads to Files, adds it to the library, and returns the file the card links to', async () => {
            fileUpload.uploadDocument.mockResolvedValue(uploaded);
            const onProgress = vi.fn();
            const ref = await service.uploadDocument(pdf, onProgress);
            expect(fileUpload.uploadDocument).toHaveBeenCalledWith(pdf, onProgress);
            expect(mediaFiles.addBatch).toHaveBeenCalledWith([uploaded]);
            expect(mediaFiles.rememberBytes).toHaveBeenCalledWith('file-1', pdf);
            expect(ref).toEqual({ url: uploaded.downloadURL, title: 'Brochure', type: 'pdf', bytes: 4, pages: 3 });
        });

        it('still returns the file when only its library entry fails, and says so', async () => {
            fileUpload.uploadDocument.mockResolvedValue(uploaded);
            mediaFiles.addBatch.mockReturnValue(throwError(() => new Error('denied')));
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const ref = await service.uploadDocument(pdf, vi.fn());
            expect(ref.url).toBe(uploaded.downloadURL);
            expect(notify.warning).toHaveBeenCalledWith('admin.media.editor_file_library_failed');
        });

        it('words a type or size refusal from the library', () => {
            service.showError(pdf, new MediaFileUploadError('size', 31 * 1024 * 1024));
            expect(notify.error).toHaveBeenCalledWith('admin.media.files.error_size', { name: 'Brochure.pdf', size: '31.0 MB' });
            service.showUnsupported(new File(['x'], '<b>.html', { type: 'text/html' }));
            expect(notify.error).toHaveBeenCalledWith('admin.media.files.error_type', { name: '<b>.html' });
        });
    });
});
