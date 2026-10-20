import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';

const openPdf = vi.fn();
vi.mock('../../../../../shared/utils/pdf-pages', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../../shared/utils/pdf-pages')>()),
    openPdf: (...args: unknown[]) => openPdf(...args),
}));
vi.mock('../media-manager.store', () => ({ MediaManagerStore: class {} }));

import { cropViewSize, PdfImageTakerComponent, PdfImageSource } from './pdf-image-taker.component';
import { MediaManagerStore } from '../media-manager.store';
import { PdfPickerMemory } from '../pdf-picker-memory.service';
import { FileUploadService } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { PdfOpenError } from '../../../../../shared/utils/pdf-pages';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A page drawn at 2 px per point, 1131 x 1600 px, framed at 200 x 100
// points from (50, 100).
const FRAME = { x: 100, y: 200, width: 400, height: 200 };

describe('PdfImageTakerComponent (MF3, MF4, PI2, PI4)', () => {
    let upload: any;
    let store: any;
    let notify: any;
    let pdf: any;
    let memory: PdfPickerMemory;

    function create(source: Partial<PdfImageSource> = {}, inputs: Record<string, unknown> = {}) {
        TestBed.configureTestingModule({
            imports: [PdfImageTakerComponent, TranslocoTestingModule.forRoot({ langs: { en: { admin: { media: { pdf: { image_title: '{{ title }}, page {{ page }}' } } } } }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true })],
            providers: [
                { provide: FileUploadService, useValue: upload },
                { provide: MediaManagerStore, useValue: store },
                { provide: NotifyService, useValue: notify },
                { provide: PdfPickerMemory, useValue: memory },
            ],
        });
        const fixture = TestBed.createComponent(PdfImageTakerComponent);
        fixture.componentRef.setInput('source', { title: 'Brochure', key: 'local:b', load: async () => new Blob(['%PDF']), ...source });
        fixture.componentRef.setInput('uploadSettings', { maxFileSize: 5, maxSize: 1200, convertToWebp: true });
        for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return fixture;
    }

    /** Opens `page` and plays the cropper's part: the image loads and the admin frames `frame`. */
    async function openOn(taker: PdfImageTakerComponent, page = 2, frame = FRAME) {
        await taker.openPage(page);
        taker.onCropLoaded({ width: 1131, height: 1600 });
        taker.onCropRect(frame);
    }

    beforeEach(() => {
        globalThis.URL.createObjectURL ??= () => 'blob:x';
        globalThis.URL.revokeObjectURL ??= () => {};
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:page');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        pdf = {
            pageCount: 3,
            renderPage: vi.fn(async (_page: number, longest: number) => ({ blob: new Blob(['jpg']), width: Math.round(longest * 0.707), height: longest, scale: longest / 800 })),
            renderRegion: vi.fn().mockResolvedValue({ blob: new Blob(['png'], { type: 'image/png' }), width: 1200, height: 600, scale: 6 }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };
        openPdf.mockResolvedValue(pdf);
        let n = 0;
        upload = {
            removeStored: vi.fn().mockResolvedValue(undefined),
            uploadFile: vi.fn(async () => ({ downloadURL: 'https://x/img-xl.webp', name: 'img-xl.webp', uploadTime: new Date(), title: 'Brochure p2' })),
        };
        store = { addBatch: vi.fn(() => of([`img${++n}`])) };
        notify = { success: vi.fn(), error: vi.fn() };
        memory = new PdfPickerMemory();
    });

    afterEach(() => vi.restoreAllMocks());

    it('opens the PDF, says so, and shows a tile per page', async () => {
        const fixture = create();
        const opened = vi.fn();
        fixture.componentInstance.opened.subscribe(opened);
        await flush();
        fixture.detectChanges();
        expect(fixture.componentInstance.step()).toBe('pages');
        expect(opened).toHaveBeenCalled();
        expect(fixture.nativeElement.querySelectorAll('.pdf-page')).toHaveLength(3);
    });

    it('says a PDF is locked, without asking for its password (MF-D17), and reports it', async () => {
        openPdf.mockRejectedValue(new PdfOpenError('locked'));
        const fixture = create();
        const failed = vi.fn();
        fixture.componentInstance.failed.subscribe(failed);
        await flush();
        expect(fixture.componentInstance.step()).toBe('error');
        expect(fixture.componentInstance.problem()).toBe('locked');
        expect(failed).toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('input[type=password]')).toBeNull();
    });

    it('says when a library PDF could not be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const fixture = create({ fileId: 'f1', load: async () => { throw new Error('offline'); } });
        await flush();
        expect(fixture.componentInstance.problem()).toBe('read_failed');
    });

    it('opens a page with the centred frame and remembers the place (PI-D7)', async () => {
        const fixture = create({ fileId: 'f1' });
        const taker = fixture.componentInstance;
        await flush();
        await taker.openPage(2);
        expect(pdf.renderPage).toHaveBeenCalledWith(2, 1600, 'image/jpeg');
        // No frame placed: the cropper starts with its own centred one.
        expect(taker.placedFrame()).toBeNull();
        expect(memory.place()).toMatchObject({ key: 'f1', fileId: 'f1', page: 2, zoom: 1 });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.pdf-crop-hint').textContent).toContain('admin.media.pdf.crop_hint');
    });

    it('saves the framed part at the XL size as a normal upload, and leaves the frame where it was (MF-D14, PI-D16)', async () => {
        const fixture = create({ fileId: 'f1' });
        const taker = fixture.componentInstance;
        const saved = vi.fn();
        taker.saved.subscribe(saved);
        await flush();
        await openOn(taker, 2);
        await taker.save();

        // 200 x 100 points, drawn at 6x for 1200 px.
        expect(pdf.renderRegion).toHaveBeenCalledWith(2, { x: 50, y: 100, width: 200, height: 100 }, 6, 'image/png');
        const [file, settings] = upload.uploadFile.mock.calls[0];
        expect(file.name).toBe('Brochure-p2.png');
        expect(settings.maxSize).toBe(1200);
        expect(store.addBatch).toHaveBeenCalledWith([expect.objectContaining({ source: { fileId: 'f1', page: 2 }, title: 'Brochure, page 2' })]);
        expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'img1' }));
        expect(taker.step()).toBe('crop');
        expect(taker.savedCount()).toBe(1);
        expect(taker.placedFrame()).toBeNull();
        expect(taker.cropRect()).toEqual(FRAME);
    });

    it('numbers a second image from the same page, and saves alt text then clears it (PI-D17)', async () => {
        const fixture = create({ fileId: 'f1' }, { insertable: true, size: 'm' });
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        taker.alt.set('Red roses');
        await taker.save();
        taker.onCropRect({ x: 600, y: 200, width: 400, height: 200 });
        await taker.save();
        const [first] = store.addBatch.mock.calls[0][0];
        const [second] = store.addBatch.mock.calls[1][0];
        expect(first.alt).toBe('Red roses');
        expect(second.alt).toBeUndefined();
        expect(second.title).toBe('Brochure, page 2 (2)');
        expect(taker.alt()).toBe('');
    });

    it('Insert saves, then hands back the image; a gallery gets every one taken (PI-D16, PI-D18)', async () => {
        const fixture = create({ fileId: 'f1' }, { insertable: true, size: 'l' });
        const taker = fixture.componentInstance;
        const inserted = vi.fn();
        taker.inserted.subscribe(inserted);
        await flush();
        await openOn(taker, 2);
        await taker.insert();
        expect(inserted).toHaveBeenCalledWith([expect.objectContaining({ id: 'img1' })]);
    });

    it('in a gallery picker, Insert hands back every image taken in the visit (PI-D18)', async () => {
        const fixture = create({ fileId: 'f1' }, { insertable: true, multiple: true });
        const taker = fixture.componentInstance;
        const inserted = vi.fn();
        taker.inserted.subscribe(inserted);
        await flush();
        await openOn(taker, 2);
        await taker.save();
        expect(taker.insertCount()).toBe(2);
        taker.onCropRect({ x: 600, y: 200, width: 400, height: 200 });
        await taker.insert();
        expect(inserted.mock.calls[0][0].map((s: any) => s.id)).toEqual(['img1', 'img2']);
    });

    it('waits for a PDF from the computer to be kept in Files, so the image records it (PI-D6)', async () => {
        let keep: (id: string | null) => void = () => {};
        const done = new Promise<string | null>((resolve) => (keep = resolve));
        const fixture = create({ storing: { done, percent: signal(40) } });
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        const saving = taker.save();
        await flush();
        expect(taker.waitingForStore()).toBe(true);
        expect(upload.uploadFile).not.toHaveBeenCalled();
        keep('kept1');
        await saving;
        expect(store.addBatch.mock.calls[0][0][0].source).toEqual({ fileId: 'kept1', page: 2 });
        expect(memory.place()).toMatchObject({ key: 'kept1', fileId: 'kept1', page: 2 });
        expect(taker.storeNote()).toBe('admin.media.pdf.note_kept');
    });

    it('still saves when the PDF could not be kept, without a source', async () => {
        const fixture = create({ storing: { done: Promise.resolve(null), percent: signal(0) } });
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 1);
        await taker.save();
        expect(store.addBatch.mock.calls[0][0][0].source).toBeUndefined();
        expect(taker.storeNote()).toBe('admin.media.pdf.note_not_kept');
    });

    it('starts a fresh centred frame for a new ratio', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        taker.setZoom(2);
        await flush();
        expect(taker.placedFrame()).not.toBeNull();
        taker.selectRatio('1:1');
        expect(taker.ratio()).toBe('1:1');
        expect(taker.placedFrame()).toBeNull();
    });

    it('zooms in steps, draws the page again with more detail, and keeps the frame (PI-D14)', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        taker.zoomIn();
        expect(taker.zoom()).toBe(1.5);
        taker.zoomIn();
        expect(taker.zoom()).toBe(2);
        await flush();
        expect(pdf.renderPage).toHaveBeenLastCalledWith(2, 3200, 'image/jpeg');
        // Drawn at 4 px per point now: the same frame, scaled.
        expect(taker.placedFrame()).toEqual({ x: 200, y: 400, width: 800, height: 400 });
        taker.setZoom(9);
        expect(taker.zoom()).toBe(4);
        taker.setZoom(0.2);
        expect(taker.zoom()).toBe(1);
        expect(memory.place()?.zoom).toBe(1);
    });

    it('moves between pages with the buttons, a typed number and Page Down (PI-D15)', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        taker.goToPage(3);
        expect(taker.cropPage()).toBe(3);
        taker.goToPage(4);
        expect(taker.cropPage()).toBe(3);
        await flush();
        const field = { value: '1' } as HTMLInputElement;
        taker.onPageInput({ target: field } as unknown as Event);
        expect(taker.cropPage()).toBe(1);
        const bad = { value: '99' } as HTMLInputElement;
        taker.onPageInput({ target: bad } as unknown as Event);
        expect(bad.value).toBe('1');
        await flush();
        const key = new KeyboardEvent('keydown', { key: 'PageDown' });
        Object.defineProperty(key, 'target', { value: document.body });
        taker.onCropKey(key);
        expect(taker.cropPage()).toBe(2);
    });

    it('opens straight on the remembered page and zoom (PI-D8)', async () => {
        const fixture = create({ fileId: 'f1' }, { startPage: 3, startZoom: 2 });
        const taker = fixture.componentInstance;
        await flush();
        await flush();
        expect(taker.step()).toBe('crop');
        expect(taker.cropPage()).toBe(3);
        expect(taker.zoom()).toBe(2);
        expect(pdf.renderPage).toHaveBeenCalledWith(3, 3200, 'image/jpeg');
    });

    it('saves nothing while a sharper drawing loads, and takes no frame reported for the old one', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        taker.setZoom(2);
        await flush();
        expect(taker.viewPending()).toBe(true);
        // The cropper reporting a frame for the old drawing is ignored.
        taker.onCropRect({ x: 10, y: 10, width: 50, height: 50 });
        expect(taker.cropRect()).toBeNull();
        await taker.save();
        expect(upload.uploadFile).not.toHaveBeenCalled();
        taker.onCropLoaded({ width: 2262, height: 3200 });
        taker.onCropRect(taker.placedFrame()!);
        await taker.save();
        // At 4 px per point: the same 200 x 100 points.
        expect(pdf.renderRegion).toHaveBeenCalledWith(2, { x: 50, y: 100, width: 200, height: 100 }, 6, 'image/png');
    });

    it('counts images taken from earlier PDFs in a gallery\'s Insert (PI-D18)', async () => {
        const fixture = create({ fileId: 'f1' }, { insertable: true, multiple: true, takenBefore: 2 });
        const taker = fixture.componentInstance;
        await flush();
        await openOn(taker, 2);
        expect(taker.insertCount()).toBe(3);
    });

    it('takes the stored image back out when its library record cannot be written', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        upload.uploadFile.mockResolvedValue({ downloadURL: 'u', name: 'n', uploadTime: new Date(), variants: { s: { path: 'a-s' }, m: { path: 'a-m' }, l: { path: 'a-l' }, xl: { path: 'a-xl' } } });
        store.addBatch.mockReturnValue(throwError(() => new Error('denied')));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await flush();
        await openOn(taker, 1);
        await taker.save();
        expect(upload.removeStored).toHaveBeenCalledWith(['a-s', 'a-m', 'a-l', 'a-xl']);
        expect(notify.error).toHaveBeenCalledWith('admin.media.pdf.save_failed', expect.anything());
        expect(taker.saving()).toBe(false);
    });

    it('keeps only the latest page view in memory', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        await flush();
        await taker.openPage(1);
        await taker.openPage(2);
        expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('frees the PDF when closed', async () => {
        const fixture = create();
        await flush();
        fixture.destroy();
        expect(pdf.destroy).toHaveBeenCalled();
    });
});

describe('PDF crop helpers', () => {
    it('draws more detail as the zoom grows, up to twice the fit view', () => {
        expect([1, 1.5, 2, 4].map(cropViewSize)).toEqual([1600, 2400, 3200, 3200]);
    });
});
