import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';

const openPdf = vi.fn();
vi.mock('../../../../../shared/utils/pdf-pages', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../../shared/utils/pdf-pages')>()),
    openPdf: (...args: unknown[]) => openPdf(...args),
}));
vi.mock('../media-manager.store', () => ({ MediaManagerStore: class {} }));

import { PdfImageTakerComponent, PdfImageSource } from './pdf-image-taker.component';
import { MediaManagerStore } from '../media-manager.store';
import { FileUploadService } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { PdfOpenError } from '../../../../../shared/utils/pdf-pages';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PdfImageTakerComponent (MF3, MF4)', () => {
    let upload: any;
    let store: any;
    let notify: any;
    let pdf: any;

    function create(source: Partial<PdfImageSource> = {}) {
        TestBed.configureTestingModule({
            imports: [PdfImageTakerComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
            providers: [
                { provide: FileUploadService, useValue: upload },
                { provide: MediaManagerStore, useValue: store },
                { provide: NotifyService, useValue: notify },
            ],
        });
        const fixture = TestBed.createComponent(PdfImageTakerComponent);
        fixture.componentRef.setInput('source', { title: 'Brochure', load: async () => new Blob(['%PDF']), ...source });
        fixture.componentRef.setInput('uploadSettings', { maxFileSize: 5, maxSize: 1200, convertToWebp: true });
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        globalThis.URL.createObjectURL ??= () => 'blob:x';
        globalThis.URL.revokeObjectURL ??= () => {};
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:page');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        pdf = {
            pageCount: 3,
            renderPage: vi.fn().mockResolvedValue({ blob: new Blob(['jpg']), width: 1131, height: 1600, scale: 2 }),
            renderRegion: vi.fn().mockResolvedValue({ blob: new Blob(['png'], { type: 'image/png' }), width: 1200, height: 600, scale: 12 }),
            destroy: vi.fn().mockResolvedValue(undefined),
        };
        openPdf.mockResolvedValue(pdf);
        upload = { removeStored: vi.fn().mockResolvedValue(undefined), uploadFile: vi.fn().mockResolvedValue({ downloadURL: 'https://x/img-xl.webp', name: 'img-xl.webp', uploadTime: new Date(), title: 'Brochure p2' }) };
        store = { addBatch: vi.fn(() => of(['img1'])) };
        notify = { success: vi.fn(), error: vi.fn() };
    });

    afterEach(() => vi.restoreAllMocks());

    it('opens the PDF and shows a tile per page', async () => {
        const fixture = create();
        await flush();
        fixture.detectChanges();
        expect(fixture.componentInstance.step()).toBe('pages');
        expect(fixture.nativeElement.querySelectorAll('.pdf-page')).toHaveLength(3);
    });

    it('says a PDF is locked, without asking for its password (MF-D17)', async () => {
        openPdf.mockRejectedValue(new PdfOpenError('locked'));
        const fixture = create();
        await flush();
        expect(fixture.componentInstance.step()).toBe('error');
        expect(fixture.componentInstance.problem()).toBe('locked');
        expect(fixture.nativeElement.querySelector('input[type=password]')).toBeNull();
    });

    it('says when a library PDF could not be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const fixture = create({ fileId: 'f1', load: async () => { throw new Error('offline'); } });
        await flush();
        expect(fixture.componentInstance.problem()).toBe('read_failed');
    });

    it('saves the framed part at the XL size as a normal upload, named after the PDF, and returns to the pages (MF-D14, MF-D15)', async () => {
        const fixture = create({ fileId: 'f1' });
        const taker = fixture.componentInstance;
        const saved = vi.fn();
        taker.saved.subscribe(saved);
        await flush();

        await taker.openPage(2);
        expect(pdf.renderPage).toHaveBeenCalledWith(2, 1600, 'image/jpeg');
        taker.onCropRect({ x: 200, y: 100, width: 200, height: 100 });
        await taker.save();

        // The frame was on a page drawn at 2 px per point: 100 x 50 points, drawn at 12x for 1200 px.
        expect(pdf.renderRegion).toHaveBeenCalledWith(2, { x: 100, y: 50, width: 100, height: 50 }, 12, 'image/png');
        const [file, settings] = upload.uploadFile.mock.calls[0];
        expect(file.name).toBe('Brochure-p2.png');
        expect(settings.maxSize).toBe(1200);
        expect(store.addBatch).toHaveBeenCalledWith([expect.objectContaining({ source: { fileId: 'f1', page: 2 } })]);
        expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'img1' }));
        expect(taker.step()).toBe('pages');
        expect(taker.savedCount()).toBe(1);
    });

    it('records no source for a PDF from the computer, which is not stored', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        await flush();
        await taker.openPage(1);
        taker.onCropRect({ x: 0, y: 0, width: 10, height: 10 });
        await taker.save();
        expect(store.addBatch.mock.calls[0][0][0].source).toBeUndefined();
    });

    it('takes the stored image back out when its library record cannot be written', async () => {
        const fixture = create();
        const taker = fixture.componentInstance;
        upload.uploadFile.mockResolvedValue({ downloadURL: 'u', name: 'n', uploadTime: new Date(), variants: { s: { path: 'a-s' }, m: { path: 'a-m' }, l: { path: 'a-l' }, xl: { path: 'a-xl' } } });
        store.addBatch.mockReturnValue(throwError(() => new Error('denied')));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await flush();
        await taker.openPage(1);
        taker.onCropRect({ x: 0, y: 0, width: 10, height: 10 });
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
