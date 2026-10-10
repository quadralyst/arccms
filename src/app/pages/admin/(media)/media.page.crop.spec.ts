import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { NEVER, of } from 'rxjs';
import MediaManagerComponent, { MediaDialogData } from './media.page';
import { MediaManagerService } from './media-manager.service';
import { MediaManagerStore } from './media-manager.store';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalService } from '../../../../shared/services/global.service';
import { ConstantVariables } from '../../../../shared/constants/common-constants';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: vi.fn(),
    collection: vi.fn(),
    getFirestore: vi.fn(() => ({})),
    doc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
}));

vi.mock('@angular/fire/storage', () => ({
    getStorage: vi.fn(() => ({})),
    ref: vi.fn(),
    uploadBytesResumable: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(),
}));

const upload = {
    id: 'up1',
    url: 'https://storage/o/mediaImages%2Fteam-a1b2c3-xl.webp?alt=media',
    name: 'team-a1b2c3-xl.webp',
    variants: {
        s: { url: 'https://storage/s', path: 's', width: 300, height: 200 },
        m: { url: 'https://storage/m', path: 'm', width: 600, height: 400 },
        l: { url: 'https://storage/l', path: 'l', width: 900, height: 600 },
        xl: { url: 'https://storage/xl', path: 'xl', width: 1200, height: 800 },
    },
};

const unsplash = {
    id: 'un1',
    width: 4320,
    height: 2880,
    urls: {
        raw: 'https://images.unsplash.com/photo-1?ixid=abc',
        regular: 'https://images.unsplash.com/photo-1?ixid=abc&w=1080',
    },
};

describe('MediaManagerComponent cropping', () => {
    let fixture: ComponentFixture<MediaManagerComponent>;
    let component: MediaManagerComponent;
    let dialogRef: { close: ReturnType<typeof vi.fn> };
    let fileUpload: any;
    let store: any;
    let mediaService: any;

    async function create(data: MediaDialogData) {
        dialogRef = { close: vi.fn() };
        fileUpload = {
            uploadFile: vi.fn(),
            uploadCroppedCopy: vi.fn().mockResolvedValue({
                downloadURL: 'https://storage/crop-xl',
                name: 'team-crop-q1w2e3-xl.webp',
                uploadTime: new Date(),
                width: 600,
                height: 600,
                variants: { ...upload.variants, xl: { url: 'https://storage/crop-xl', path: 'cxl', width: 600, height: 600 } },
            }),
            validateFileType: vi.fn().mockReturnValue(null),
            deleteMediaItem: vi.fn(),
        };
        store = { add: vi.fn(), addBatch: vi.fn().mockReturnValue(of(['crop-id'])) };
        mediaService = {
            getMediaListFromFirestore: vi.fn().mockReturnValue(NEVER),
            isUnsplashConfigured: vi.fn().mockResolvedValue(true),
            warmupUnsplash: vi.fn(),
            readMediaImage: vi.fn().mockResolvedValue(new Blob(['xl'], { type: 'image/webp' })),
        };

        await TestBed.configureTestingModule({
            imports: [MediaManagerComponent, BrowserAnimationsModule],
            providers: [
                { provide: MediaManagerService, useValue: mediaService },
                { provide: MediaManagerStore, useValue: store },
                { provide: FileUploadService, useValue: fileUpload },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), openCustomSnackbar: vi.fn() } },
                { provide: GlobalService, useValue: { debugMode: vi.fn(() => false) } },
                { provide: Location, useValue: { back: vi.fn() } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }), snapshot: { paramMap: { get: () => null } } } },
                { provide: Firestore, useValue: {} },
                ConstantVariables,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MediaManagerComponent);
        component = fixture.componentInstance;
        vi.spyOn(component.ref, 'detectChanges').mockImplementation(() => { });
        vi.spyOn(component.notify, 'success').mockImplementation(() => { });
        vi.spyOn(component.notify, 'error').mockImplementation(() => { });
    }

    /** The crop step as the cropper leaves it: the image loaded, the frame placed. */
    function frame(size: { width: number; height: number }, rect: { x: number; y: number; width: number; height: number }) {
        component.onCropLoaded(size);
        component.onCropRect(rect);
    }

    afterEach(() => fixture?.destroy());

    describe('who can crop', () => {
        beforeEach(() => create({ isDialogOpen: true }));

        it('offers it for an upload and an Unsplash photo with its size', () => {
            expect(component.canCrop(upload)).toBe(true);
            expect(component.canCrop(unsplash)).toBe(true);
        });

        it('does not offer it for a GIF, or an Unsplash photo of unknown size', () => {
            expect(component.canCrop({ id: 'g', url: 'https://storage/o/mediaImages%2Fparty-a1b2c3.gif?alt=media', name: 'party-a1b2c3.gif' })).toBe(false);
            expect(component.canCrop({ id: 'u', urls: { regular: 'r', raw: 'r' } })).toBe(false);
            expect(component.canCrop(null)).toBe(false);
        });
    });

    it('does not offer it when picking several images', async () => {
        await create({ isDialogOpen: true, multiple: true });
        expect(component.canCrop(upload)).toBe(false);
    });

    it('does not offer it for Unsplash on the Media Manager page, where nothing is inserted', async () => {
        await create({ isDialogOpen: false });
        expect(component.canCrop(unsplash)).toBe(false);
        expect(component.canCrop(upload)).toBe(true);
    });

    it('opens on the ratio the caller asked for', async () => {
        await create({ isDialogOpen: true, cropRatio: '1:1' });
        component.selectMedia(upload);
        component.selectCropRatio('16:9');
        component.cancelCrop();
        component.startCrop();
        expect(component.isCropping).toBe(true);
        expect(component.cropRatio).toBe('1:1');
        expect(component.cropRatioNumber).toBe(1);
    });

    it('does not warn about size on the Media Manager page, where no size is picked', async () => {
        await create({ isDialogOpen: false });
        component.selectMedia(upload);
        component.startCrop();
        frame({ width: 1200, height: 800 }, { x: 0, y: 0, width: 100, height: 100 });
        expect(component.cropTooSmall).toBe(false);
    });

    describe('an Unsplash photo', () => {
        beforeEach(() => create({ isDialogOpen: true }));

        it('crops the photo through its URL, in the original pixels, at the picked size', async () => {
            component.selectMedia(unsplash);
            component.startCrop();
            expect(component.cropSourceUrl).toBe(unsplash.urls.regular);
            expect(component.isCroppingUpload).toBe(false);
            // A quarter-in frame on the 1080 × 720 copy.
            frame({ width: 1080, height: 720 }, { x: 270, y: 180, width: 540, height: 360 });
            expect(component.cropResultSize).toEqual({ width: 2160, height: 1440 });
            await component.applyCrop();

            expect(component.isCropping).toBe(false);
            expect(fileUpload.uploadCroppedCopy).not.toHaveBeenCalled();
            expect(component.isCropped(unsplash)).toBe(true);
            expect(component.selectedImageDimensions).toBe('2160 × 1440');
            expect(component.previewUrl(unsplash)).toContain('rect=1080%2C720%2C2160%2C1440');

            component.insertMedia();
            const result = dialogRef.close.mock.calls[0][0];
            const params = new URL(result.mediaUrl).searchParams;
            expect(params.get('rect')).toBe('1080,720,2160,1440');
            expect(params.get('w')).toBe('600');
            expect(params.get('ixid')).toBe('abc');
        });

        it('clears the crop when the frame covers the whole photo, or on Remove crop', async () => {
            component.selectMedia(unsplash);
            component.startCrop();
            frame({ width: 1080, height: 720 }, { x: 0, y: 0, width: 540, height: 720 });
            await component.applyCrop();
            expect(component.isCropped(unsplash)).toBe(true);
            component.removeCrop();
            expect(component.isCropped(unsplash)).toBe(false);

            component.startCrop();
            frame({ width: 1080, height: 720 }, { x: 0, y: 0, width: 540, height: 720 });
            await component.applyCrop();
            component.startCrop();
            frame({ width: 1080, height: 720 }, { x: 0, y: 0, width: 1080, height: 720 });
            await component.applyCrop();
            expect(component.isCropped(unsplash)).toBe(false);
            component.insertMedia();
            expect(dialogRef.close.mock.calls[0][0].mediaUrl).not.toContain('rect=');
        });
    });

    describe('an upload', () => {
        beforeEach(() => create({ isDialogOpen: true }));

        it('saves the crop as a new image and selects it, leaving the original', async () => {
            component.selectMedia(upload);
            component.startCrop();
            expect(component.cropSourceUrl).toBe('https://storage/xl');
            expect(component.isCroppingUpload).toBe(true);
            frame({ width: 1200, height: 800 }, { x: 300, y: 100, width: 600, height: 600 });
            await component.applyCrop();

            // The bytes come through the server, whatever the bucket's CORS setup.
            expect(mediaService.readMediaImage).toHaveBeenCalledWith('up1');
            expect(fileUpload.uploadCroppedCopy).toHaveBeenCalledWith(
                expect.any(Blob), 'team-a1b2c3-xl.webp', { x: 300, y: 100, width: 600, height: 600 },
                expect.objectContaining({ maxSize: 1200 }), expect.any(Function),
            );
            expect(store.addBatch).toHaveBeenCalledWith([expect.objectContaining({ downloadURL: 'https://storage/crop-xl' })]);
            expect(component.isCropping).toBe(false);
            expect(component.isSavingCrop).toBe(false);
            expect(component.selectedMediaUrl?.id).toBe('crop-id');
            expect(component.currentPageIndex).toBe(0);
            expect(component.notify.success).toHaveBeenCalledWith('admin.media.crop.saved');
            expect(fileUpload.deleteMediaItem).not.toHaveBeenCalled();
        });

        it('saves nothing when the frame covers the whole image', async () => {
            component.selectMedia(upload);
            component.startCrop();
            frame({ width: 1200, height: 800 }, { x: 0, y: 0, width: 1200, height: 800 });
            await component.applyCrop();
            expect(fileUpload.uploadCroppedCopy).not.toHaveBeenCalled();
            expect(mediaService.readMediaImage).not.toHaveBeenCalled();
            expect(component.isCropping).toBe(false);
        });

        it('stays in the crop step and says why when saving fails', async () => {
            fileUpload.uploadCroppedCopy.mockRejectedValue(new Error('File size (6.0 MB) exceeds the maximum allowed size (5 MB).'));
            component.selectMedia(upload);
            component.startCrop();
            frame({ width: 1200, height: 800 }, { x: 0, y: 0, width: 600, height: 600 });
            await component.applyCrop();
            expect(component.isCropping).toBe(true);
            expect(component.isSavingCrop).toBe(false);
            expect(component.notify.error).toHaveBeenCalledWith('admin.media.crop.save_failed', { reason: expect.stringContaining('exceeds') });
            expect(store.addBatch).not.toHaveBeenCalled();
        });

        it('says why when the server cannot read the image', async () => {
            mediaService.readMediaImage.mockRejectedValue(new Error('The image file is missing from Storage.'));
            component.selectMedia(upload);
            component.startCrop();
            frame({ width: 1200, height: 800 }, { x: 0, y: 0, width: 600, height: 600 });
            await component.applyCrop();
            expect(fileUpload.uploadCroppedCopy).not.toHaveBeenCalled();
            expect(component.isSavingCrop).toBe(false);
            expect(component.notify.error).toHaveBeenCalledWith('admin.media.crop.save_failed', { reason: 'The image file is missing from Storage.' });
        });

        it('warns when the crop is smaller than the picked size', () => {
            component.selectMedia(upload);
            component.selectSize('xl');
            component.startCrop();
            frame({ width: 1200, height: 800 }, { x: 0, y: 0, width: 600, height: 400 });
            expect(component.cropTooSmall).toBe(true);
            component.selectSize('m');
            expect(component.cropTooSmall).toBe(false);
        });
    });

    describe('the screen', () => {
        beforeEach(() => create({ isDialogOpen: true }));

        it('shows Crop for the selection, and swaps the grid for the crop step', () => {
            // OnPush: mark the view dirty, as the component's own detectChanges would.
            const render = () => {
                component.ref.markForCheck();
                fixture.detectChanges();
            };
            render();
            component.searchResults = [upload as any];
            component.selectMedia(upload);
            render();
            const el: HTMLElement = fixture.nativeElement;
            const crop = el.querySelector<HTMLButtonElement>('#cropStartBtn');
            expect(crop).not.toBeNull();

            crop!.click();
            render();
            expect(el.querySelector('arc-image-cropper')).not.toBeNull();
            expect(el.querySelector('.img_container')).toBeNull();
            expect(el.querySelector('mat-paginator')).toBeNull();
            expect(el.querySelectorAll('.crop-ratios .size-chip').length).toBe(7);
            expect(el.querySelector('#cropStartBtn')).toBeNull();
            expect(el.querySelector<HTMLButtonElement>('#insertMediaBtn')!.disabled).toBe(true);

            el.querySelector<HTMLButtonElement>('#cropCancelBtn')!.click();
            render();
            expect(el.querySelector('arc-image-cropper')).toBeNull();
            expect(el.querySelector('.img_container')).not.toBeNull();
        });

        it('keeps the tab while a cropped copy is saving', () => {
            component.selectedMenu(component.menuItems[0]);
            component.isSavingCrop = true;
            component.selectedMenu(component.menuItems[1]);
            expect(component.selectedItem?.value).toBe('upload');
        });

        it('leaves the crop step when the tab changes', () => {
            component.selectMedia(upload);
            component.startCrop();
            component.selectedMenu(component.menuItems[1]);
            expect(component.isCropping).toBe(false);
        });
    });
});
