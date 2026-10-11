import { describe, it, expect, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { NEVER, of } from 'rxjs';
import MediaManagerComponent, { MediaDialogData, MediaSelection } from './media.page';
import { MediaManagerService } from './media-manager.service';
import { MediaManagerStore } from './media-manager.store';
import { MediaFilesService } from './media-files.service';
import { IMediaFile } from './media-files.model';
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
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
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

/**
 * The media page's documents work (specs/media-files-spec.md): the Files
 * tab, where dropped documents go, file picks, image details and search.
 */

const report: IMediaFile = {
    id: 'f1', title: 'Annual Report', name: 'annual-report-abc123.pdf', downloadURL: 'https://storage/annual-report.pdf',
    path: 'mediaFiles/annual-report-abc123.pdf', type: 'pdf', contentType: 'application/pdf', bytes: 2048, pages: 4,
    uploadTime: new Date(), createdAt: new Date(), modifiedAt: new Date(), createdBy: '', modifiedBy: '',
};
const prices: IMediaFile = { ...report, id: 'f2', title: 'Prices', name: 'prices.xlsx', downloadURL: 'https://storage/prices.xlsx', type: 'excel', pages: undefined };

describe('MediaManagerComponent documents', () => {
    let fixture: ComponentFixture<MediaManagerComponent>;
    let component: MediaManagerComponent;
    let dialogRef: { close: ReturnType<typeof vi.fn> };
    let mediaService: any;
    let files: any;

    async function create(data: MediaDialogData) {
        dialogRef = { close: vi.fn() };
        mediaService = {
            getMediaListFromFirestore: vi.fn().mockReturnValue(NEVER),
            isUnsplashConfigured: vi.fn().mockResolvedValue(true),
            warmupUnsplash: vi.fn(),
            getAllMediaForSearch: vi.fn().mockResolvedValue([
                { id: 'a', url: 'https://x/a', title: 'Diwali stage', notes: 'festival', name: 'a.webp' },
                { id: 'b', url: 'https://x/b', title: 'Shop front', alt: 'The Pune shop', name: 'b.webp' },
            ]),
            saveMediaDetails: vi.fn().mockResolvedValue(undefined),
        };
        files = { listPage: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }), listAll: vi.fn().mockResolvedValue([]), pdfBytes: vi.fn(), addBatch: vi.fn(() => of([])), saveDetails: vi.fn(), deleteFile: vi.fn(), rememberBytes: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [MediaManagerComponent, BrowserAnimationsModule],
            providers: [
                { provide: MediaManagerService, useValue: mediaService },
                { provide: MediaManagerStore, useValue: { add: vi.fn(), addBatch: vi.fn().mockReturnValue(of([])) } },
                { provide: FileUploadService, useValue: { uploadFile: vi.fn(), validateFileType: vi.fn().mockReturnValue(null), deleteMediaItem: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), openCustomSnackbar: vi.fn() } },
                { provide: GlobalService, useValue: { debugMode: vi.fn(() => false) } },
                { provide: Location, useValue: { back: vi.fn() } },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => null }), snapshot: { paramMap: { get: () => null } } } },
                { provide: Firestore, useValue: {} },
                { provide: MediaFilesService, useValue: files },
                ConstantVariables,
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MediaManagerComponent);
        component = fixture.componentInstance;
        vi.spyOn(component.ref, 'detectChanges').mockImplementation(() => { });
        vi.spyOn(component.notify, 'info').mockImplementation(() => { });
        vi.spyOn(component.notify, 'error').mockImplementation(() => { });
        component.ngOnInit();
    }

    const tabs = () => component.menuItems.map((item) => item.value);

    afterEach(() => fixture?.destroy());

    describe('which tabs show', () => {
        it('shows Files on the Media page', async () => {
            await create({ isDialogOpen: false });
            expect(tabs()).toContain('files');
        });

        it('keeps Files out of a picker that only knows images (allowFiles off by default)', async () => {
            await create({ isDialogOpen: true });
            expect(tabs()).toEqual(['upload', 'search']);
        });

        it('shows Files alone, without a tab bar, for a files-only picker', async () => {
            await create({ isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files' });
            expect(tabs()).toEqual(['files']);
            expect(component.showTabBar).toBe(false);
            expect(component.isFilesTab).toBe(true);
        });

        it('still falls back to images for a caller asking for nothing', async () => {
            await create({ isDialogOpen: true, allowImages: false });
            expect(tabs()).toEqual(['upload', 'search']);
        });
    });

    describe('picking files', () => {
        it('hands back one file with its URL in mediaUrl', async () => {
            await create({ isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files' });
            component.selectFile(report);
            component.insertMedia();
            const selection: MediaSelection = dialogRef.close.mock.calls[0][0];
            expect(selection).toEqual({
                type: 'submit', kind: 'file', mediaUrl: report.downloadURL,
                file: { id: 'f1', url: report.downloadURL, title: 'Annual Report', type: 'pdf', bytes: 2048, pages: 4 },
            });
        });

        it('hands back several files in the order picked, and unpicks on a second click', async () => {
            await create({ isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files', multiple: true });
            component.selectFile(prices);
            component.selectFile(report);
            component.selectFile(report);
            component.selectFile(report);
            component.insertMedia();
            const selection: MediaSelection = dialogRef.close.mock.calls[0][0];
            expect(selection.files!.map((f) => f.title)).toEqual(['Prices', 'Annual Report']);
            expect(selection.mediaUrl).toBe(prices.downloadURL);
        });

        it('carries an image\'s alt text with the selection (MF-D22)', async () => {
            await create({ isDialogOpen: true });
            component.selectMedia({ id: 'i1', url: 'https://x/i1', alt: 'Lamps at night', variants: undefined });
            component.insertMedia();
            expect(dialogRef.close.mock.calls[0][0]).toMatchObject({ kind: 'image', alt: 'Lamps at night' });
        });
    });

    describe('documents dropped on My Uploads (MF-D11)', () => {
        function choose(...picked: File[]) {
            const input = { files: picked, value: 'x' } as unknown as HTMLInputElement;
            component.onFileChange({ target: input } as unknown as Event);
        }

        it('opens Take an image for one PDF, and offers to keep it in Files', async () => {
            await create({ isDialogOpen: false });
            choose(new File(['%PDF'], 'Spring Brochure.pdf', { type: 'application/pdf' }));
            expect(component.pdfSource?.title).toBe('Spring Brochure');
            expect(component.pdfSource?.fileId).toBeUndefined();
            expect(component.pendingPdfOffered).toBe(true);
        });

        it('sends Word, Excel and other documents to Files', async () => {
            vi.useFakeTimers();
            try {
                await create({ isDialogOpen: false });
                choose(new File(['x'], 'menu.docx'), new File(['x'], 'prices.xlsx'));
                expect(component.isFilesTab).toBe(true);
                expect(component.pdfSource).toBeNull();
                expect(component.notify.info).toHaveBeenCalledWith('admin.media.files.moved_to_files', { count: 2 });
            } finally {
                vi.useRealTimers();
            }
        });

        it('says so when the picker has no Files tab to send them to', async () => {
            await create({ isDialogOpen: true });
            choose(new File(['x'], 'menu.docx'));
            expect(component.notify.error).toHaveBeenCalledWith('admin.media.files.not_here');
        });

        it('does not offer "keep in Files" in a picker without it', async () => {
            await create({ isDialogOpen: true });
            choose(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
            expect(component.pdfSource).not.toBeNull();
            expect(component.pendingPdfOffered).toBe(false);
        });
    });

    describe('Take an image from a library PDF (MF4)', () => {
        it('reads the file through the files service, by id', async () => {
            await create({ isDialogOpen: false });
            files.pdfBytes.mockResolvedValue(new Blob(['%PDF']));
            component.takeImageFromFile(report);
            expect(component.pdfSource).toMatchObject({ title: 'Annual Report', fileId: 'f1' });
            const onProgress = vi.fn();
            await component.pdfSource!.load(onProgress);
            expect(files.pdfBytes).toHaveBeenCalledWith('f1', onProgress);
        });

        it('opens My Uploads on the newest image taken when done', async () => {
            await create({ isDialogOpen: false });
            component.selectedMenu(component.menuItems.find((m) => m.value === 'files')!);
            component.takeImageFromFile(report);
            component.onPdfImageSaved({ id: 'img9', media: { downloadURL: 'https://x/img9', name: 'img9-xl.webp', title: 'Annual Report, page 2', uploadTime: new Date() } });
            component.closePdf();
            expect(component.pdfSource).toBeNull();
            expect(component.selectedItem?.value).toBe('upload');
            expect(component.selectedMediaUrl).toMatchObject({ id: 'img9', title: 'Annual Report, page 2' });
        });
    });

    describe('details and search (MF5)', () => {
        it('saves an upload\'s details and keeps the change everywhere it is shown', async () => {
            await create({ isDialogOpen: false });
            const item = { id: 'i1', url: 'https://x/i1', name: 'i1.webp' };
            component.searchResults = [item as any];
            component.selectMedia(item);
            await component.onImageDetailsChanged({ alt: 'A red door' });
            expect(mediaService.saveMediaDetails).toHaveBeenCalledWith('i1', { alt: 'A red door' });
            expect(component.selectedMediaUrl).toMatchObject({ alt: 'A red door' });
            expect((component.searchResults[0] as any).alt).toBe('A red door');
        });

        it('searches every upload\'s title, notes and alt text once loaded', async () => {
            await create({ isDialogOpen: false });
            await component.onLibrarySearch('pune');
            expect(component.isLibrarySearching).toBe(true);
            expect(component.uploadItems.map((i) => i.id)).toEqual(['b']);
            await component.onLibrarySearch('festival');
            expect(component.uploadItems.map((i) => i.id)).toEqual(['a']);
            expect(mediaService.getAllMediaForSearch).toHaveBeenCalledTimes(1);
            component.clearLibrarySearch();
            expect(component.isLibrarySearching).toBe(false);
        });

        it('shows a file\'s own title, else its name', async () => {
            await create({ isDialogOpen: false });
            expect(component.imageTitle({ id: 'x', title: 'Shop', name: 'a.webp' })).toBe('Shop');
            expect(component.imageTitle({ id: 'x', name: 'a.webp' })).toBe('a.webp');
        });
    });
});
