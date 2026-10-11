import { describe, it, expect, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { NEVER, of } from 'rxjs';
import MediaManagerComponent, { MediaDialogData, MediaSelection } from './media.page';
import { PdfPickerMemory } from './pdf-picker-memory.service';
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
    let memory: PdfPickerMemory;

    async function create(data: MediaDialogData) {
        memory ??= new PdfPickerMemory();
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
        files = { listPage: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }), listAll: vi.fn().mockResolvedValue([]), pdfBytes: vi.fn(), keepPdf: vi.fn().mockResolvedValue({ ...report, id: 'kept1' }), addBatch: vi.fn(() => of([])), saveDetails: vi.fn(), deleteFile: vi.fn(), rememberBytes: vi.fn() };

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
                { provide: PdfPickerMemory, useValue: memory },
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

    afterEach(() => {
        fixture?.destroy();
        memory = undefined as unknown as PdfPickerMemory;
    });

    describe('which tabs show', () => {
        it('shows Files on the Media page', async () => {
            await create({ isDialogOpen: false });
            expect(tabs()).toContain('files');
        });

        it('keeps Files out of a picker that only knows images (allowFiles off by default)', async () => {
            await create({ isDialogOpen: true });
            expect(tabs()).toEqual(['upload', 'pdf', 'search']);
        });

        it('shows Files alone, without a tab bar, for a files-only picker', async () => {
            await create({ isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files' });
            expect(tabs()).toEqual(['files']);
            expect(component.showTabBar).toBe(false);
            expect(component.isFilesTab).toBe(true);
        });

        it('still falls back to images for a caller asking for nothing', async () => {
            await create({ isDialogOpen: true, allowImages: false });
            expect(tabs()).toEqual(['upload', 'pdf', 'search']);
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

    describe('documents dropped on My Uploads (MF-D11, PI-D5)', () => {
        function choose(...picked: File[]) {
            const input = { files: picked, value: 'x' } as unknown as HTMLInputElement;
            component.onFileChange({ target: input } as unknown as Event);
        }

        it('opens Take an image for one PDF on the Media page, and keeps it in Files once it opens', async () => {
            await create({ isDialogOpen: false });
            const pdf = new File(['%PDF'], 'Spring Brochure.pdf', { type: 'application/pdf' });
            choose(pdf);
            expect(component.pdfSource?.title).toBe('Spring Brochure');
            expect(component.pdfSource?.fileId).toBeUndefined();
            expect(files.keepPdf).not.toHaveBeenCalled();
            component.onPdfOpened(true);
            expect(await component.pdfSource!.storing!.done).toBe('kept1');
            expect(files.keepPdf).toHaveBeenCalledWith(pdf, expect.any(Function));
        });

        it('does not keep a PDF that would not open (a locked one)', async () => {
            await create({ isDialogOpen: false });
            choose(new File(['%PDF'], 'locked.pdf', { type: 'application/pdf' }));
            component.onPdfOpened(false);
            expect(await component.pdfSource!.storing!.done).toBeNull();
            expect(files.keepPdf).not.toHaveBeenCalled();
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

        it('in a picker, opens a dropped PDF in From a PDF, where Insert is', async () => {
            await create({ isDialogOpen: true });
            // Let the test bed's first check (which runs ngOnInit again) pass first.
            await new Promise((resolve) => setTimeout(resolve, 0));
            const openLocal = vi.fn();
            const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
            choose(pdf);
            expect(component.isPdfTab).toBe(true);
            expect(component.pdfSource).toBeNull();
            component.pdfTab = { openLocal } as any;
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(openLocal).toHaveBeenCalledWith(pdf);
        });
    });

    describe('From a PDF in the pickers (PI3, PI4)', () => {
        const taken = (id: string, alt?: string) => ({
            id,
            media: {
                downloadURL: `https://x/${id}-xl.webp`, name: `${id}-xl.webp`, title: `Brochure, page 3`, uploadTime: new Date(),
                variants: { s: { url: `https://x/${id}-s.webp` }, m: { url: `https://x/${id}-m.webp` }, l: { url: `https://x/${id}-l.webp` }, xl: { url: `https://x/${id}-xl.webp` } } as any,
                ...(alt ? { alt } : {}),
            },
        });

        it('is not on the Media page, which has Files > Take an image (PI-D1)', async () => {
            await create({ isDialogOpen: false });
            expect(tabs()).not.toContain('pdf');
        });

        it('opens on the remembered PDF and page when the last image came from a PDF (PI-D8)', async () => {
            memory = new PdfPickerMemory();
            memory.remember({ key: 'f1', fileId: 'f1', title: 'Annual Report', page: 3, zoom: 2 });
            memory.chose(true);
            await create({ isDialogOpen: true });
            expect(component.isPdfTab).toBe(true);
            expect(component.pdfResume).toMatchObject({ fileId: 'f1', page: 3, zoom: 2 });
        });

        it('leaves the caller\'s own first tab alone, and opens as usual after another tab\'s insert', async () => {
            memory = new PdfPickerMemory();
            memory.remember({ key: 'f1', fileId: 'f1', title: 'Annual Report', page: 3, zoom: 1 });
            memory.chose(true);
            await create({ isDialogOpen: true, initialTab: 'search' });
            expect(component.selectedItem?.value).toBe('search');
            expect(component.pdfResume).toBeNull();
            component.insertMedia();
            expect(memory.lastChoiceFromPdf()).toBe(false);
        });

        it('opens the list, not the remembered page, when the tab is clicked', async () => {
            memory = new PdfPickerMemory();
            memory.remember({ key: 'f1', fileId: 'f1', title: 'Annual Report', page: 3, zoom: 1 });
            memory.chose(true);
            await create({ isDialogOpen: true });
            component.selectedMenu(component.menuItems.find((m) => m.value === 'pdf')!);
            expect(component.pdfResume).toBeNull();
        });

        it('inserts an image taken from a PDF at the size chosen, with its alt text (PI-D16, PI-D17)', async () => {
            await create({ isDialogOpen: true });
            component.onPdfSizeChange('l');
            component.insertFromPdf([taken('img1', 'Red roses')]);
            const selection: MediaSelection = dialogRef.close.mock.calls[0][0];
            expect(selection).toEqual({ type: 'submit', kind: 'image', mediaUrl: 'https://x/img1-l.webp', size: 'l', alt: 'Red roses' });
        });

        it('inserts every image taken in a gallery picker (PI-D18)', async () => {
            await create({ isDialogOpen: true, multiple: true });
            component.insertFromPdf([taken('img1'), taken('img2')]);
            const selection: MediaSelection = dialogRef.close.mock.calls[0][0];
            expect(selection.mediaUrls).toEqual(['https://x/img1-m.webp', 'https://x/img2-m.webp']);
            expect(selection.mediaUrl).toBe('https://x/img1-m.webp');
        });

        it('remembers that the image came from a PDF, so the next picker opens there', async () => {
            memory = new PdfPickerMemory();
            await create({ isDialogOpen: true });
            memory.remember({ key: 'f1', fileId: 'f1', title: 'Annual Report', page: 3, zoom: 1 });
            component.insertFromPdf([taken('img1')]);
            expect(memory.lastChoiceFromPdf()).toBe(true);
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

        it('applies alt text before the save finishes, so an Insert that blurred the field carries it', async () => {
            await create({ isDialogOpen: true });
            let finish!: () => void;
            mediaService.saveMediaDetails.mockReturnValue(new Promise<void>((r) => { finish = r; }));
            component.selectMedia({ id: 'i1', url: 'https://x/i1', name: 'i1.webp' });
            const saving = component.onImageDetailsChanged({ alt: 'Lamps' });
            component.insertMedia();
            expect(dialogRef.close.mock.calls[0][0]).toMatchObject({ alt: 'Lamps' });
            finish();
            await saving;
        });

        it('keeps the newly selected item when a slow save of the previous one finishes', async () => {
            await create({ isDialogOpen: false });
            let finish!: () => void;
            mediaService.saveMediaDetails.mockReturnValue(new Promise<void>((r) => { finish = r; }));
            component.selectMedia({ id: 'i1', url: 'https://x/i1' });
            const saving = component.onImageDetailsChanged({ title: 'First' });
            component.selectMedia({ id: 'i2', url: 'https://x/i2' });
            finish();
            await saving;
            expect(component.selectedMediaUrl?.id).toBe('i2');
        });

        it('puts the old details back when the save fails', async () => {
            await create({ isDialogOpen: false });
            mediaService.saveMediaDetails.mockRejectedValue(new Error('denied'));
            vi.spyOn(console, 'error').mockImplementation(() => {});
            component.selectMedia({ id: 'i1', url: 'https://x/i1', alt: 'Old' });
            await component.onImageDetailsChanged({ alt: 'New' });
            expect(component.selectedMediaUrl?.alt).toBe('Old');
            expect(component.notify.error).toHaveBeenCalledWith('admin.media.details.save_failed');
        });

        it('does not switch the file panel back to a file saved after another was picked', async () => {
            await create({ isDialogOpen: false });
            component.selectFile(prices);
            component.onFileChanged({ ...report, title: 'Renamed' });
            expect(component.selectedFile?.id).toBe('f2');
        });

        it('shows a file\'s own title, else its name', async () => {
            await create({ isDialogOpen: false });
            expect(component.imageTitle({ id: 'x', title: 'Shop', name: 'a.webp' })).toBe('Shop');
            expect(component.imageTitle({ id: 'x', name: 'a.webp' })).toBe('a.webp');
        });
    });
});
