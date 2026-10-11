import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslocoTestingModule } from '@jsverse/transloco';

vi.mock('../pdf-image-taker/pdf-image-taker.component', async () => {
    const { Component, input, output } = await import('@angular/core');
    @Component({ selector: 'arc-pdf-image-taker', standalone: true, template: '' })
    class PdfImageTakerComponent {
        source = input<unknown>();
        uploadSettings = input<unknown>();
        initialRatio = input<unknown>();
        size = input<unknown>();
        insertable = input<unknown>();
        multiple = input<unknown>();
        startPage = input<unknown>();
        startZoom = input<unknown>();
        inList = input<unknown>();
        sizeChange = output<unknown>();
        opened = output<void>();
        failed = output<void>();
        back = output<void>();
        inserted = output<unknown>();
    }
    return { PdfImageTakerComponent };
});

import { MediaPdfTabComponent } from './media-pdf-tab.component';
import { MediaFilesService } from '../media-files.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { PdfPickerMemory } from '../pdf-picker-memory.service';
import { IMediaFile } from '../media-files.model';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const pdf = (id: string, title: string, extra: Partial<IMediaFile> = {}): IMediaFile => ({
    id, title, name: `${id}-abc123.pdf`, downloadURL: `https://x/${id}.pdf`, path: `mediaFiles/${id}.pdf`, type: 'pdf',
    contentType: 'application/pdf', bytes: 10, pages: 4, uploadTime: new Date(), createdAt: new Date(), modifiedAt: new Date(),
    createdBy: '', modifiedBy: '', ...extra,
});

describe('MediaPdfTabComponent (PI3)', () => {
    let files: any;
    let notify: any;
    let memory: PdfPickerMemory;

    function create(inputs: Record<string, unknown> = {}) {
        TestBed.configureTestingModule({
            imports: [MediaPdfTabComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
            providers: [
                { provide: MediaFilesService, useValue: files },
                { provide: NotifyService, useValue: notify },
                { provide: PdfPickerMemory, useValue: memory },
            ],
        });
        const fixture = TestBed.createComponent(MediaPdfTabComponent);
        fixture.componentRef.setInput('uploadSettings', { maxFileSize: 5, maxSize: 1200, convertToWebp: true });
        for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        files = {
            listAll: vi.fn().mockResolvedValue([pdf('a', 'Garden Catalogue'), { ...pdf('w', 'Menu'), type: 'word' }, pdf('b', 'Spring Brochure', { notes: 'roses' })]),
            pdfBytes: vi.fn().mockResolvedValue(new Blob(['%PDF'])),
            keepPdf: vi.fn().mockResolvedValue(pdf('k', 'Kept')),
        };
        notify = { error: vi.fn(), success: vi.fn() };
        memory = new PdfPickerMemory();
    });

    afterEach(() => vi.restoreAllMocks());

    it('lists only the PDFs in Files, under the card for one from the computer (PI-D2)', async () => {
        const fixture = create();
        await flush();
        fixture.detectChanges();
        const cards = Array.from(fixture.nativeElement.querySelectorAll('.pdf-card')) as HTMLElement[];
        expect(cards[0].id).toBe('pdfChooseBtn');
        expect(cards.slice(1).map((c) => c.dataset['file'])).toEqual(['a', 'b']);
    });

    it('puts the PDF last used first, and finds PDFs by their notes', async () => {
        memory.remember({ key: 'b', fileId: 'b', title: 'Spring Brochure', page: 1, zoom: 1 });
        const fixture = create();
        const tab = fixture.componentInstance;
        await flush();
        expect(tab.shown().map((f) => f.id)).toEqual(['b', 'a']);
        tab.onSearch({ target: { value: 'roses' } } as unknown as Event);
        expect(tab.shown().map((f) => f.id)).toEqual(['b']);
    });

    it('opens a PDF in Files, reading it through the files service', async () => {
        const fixture = create();
        const tab = fixture.componentInstance;
        await flush();
        tab.openFile(tab.pdfs()[0]);
        const source = tab.source()!;
        expect(source).toMatchObject({ title: 'Garden Catalogue', fileId: 'a', key: 'a' });
        await source.load(() => {});
        expect(files.pdfBytes).toHaveBeenCalledWith('a', expect.any(Function));
    });

    it('opens on the remembered page (PI-D8)', async () => {
        const fixture = create({ resume: { key: 'a', fileId: 'a', title: 'Garden Catalogue', page: 3, zoom: 2 } });
        const tab = fixture.componentInstance;
        expect(tab.source()?.fileId).toBe('a');
        expect(tab.startPage()).toBe(3);
        expect(tab.startZoom()).toBe(2);
    });

    it('keeps a PDF from the computer in Files once it opens (PI-D3)', async () => {
        const fixture = create();
        const tab = fixture.componentInstance;
        await flush();
        const file = new File(['%PDF'], 'Garden.pdf', { type: 'application/pdf' });
        tab.onInput({ target: { files: [file], value: 'x' } } as unknown as Event);
        expect(tab.source()?.title).toBe('Garden');
        expect(files.keepPdf).not.toHaveBeenCalled();
        tab.onOpened();
        expect(await tab.source()!.storing!.done).toBe('k');
        expect(files.keepPdf).toHaveBeenCalledWith(file, expect.any(Function));
        expect(tab.lastUsedId()).toBe('k');
    });

    it('refuses a file that is not a PDF, and more than one at a time', async () => {
        const fixture = create();
        const tab = fixture.componentInstance;
        tab.onInput({ target: { files: [new File(['x'], 'menu.docx')], value: 'x' } } as unknown as Event);
        expect(notify.error).toHaveBeenCalledWith('admin.media.pdf_tab.not_pdf', { name: 'menu.docx' });
        const two = [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }), new File(['%PDF'], 'b.pdf', { type: 'application/pdf' })];
        tab.onInput({ target: { files: two, value: 'x' } } as unknown as Event);
        expect(notify.error).toHaveBeenCalledWith('admin.media.pdf_tab.one_at_a_time');
        expect(tab.source()).toBeNull();
    });

    it('forgets a remembered PDF that is no longer in Files, and shows the list', async () => {
        memory.remember({ key: 'gone', fileId: 'gone', title: 'Old', page: 2, zoom: 1 });
        memory.chose(true);
        const fixture = create({ resume: memory.place() });
        const tab = fixture.componentInstance;
        await tab.onFailed();
        expect(notify.error).toHaveBeenCalledWith('admin.media.pdf_tab.gone');
        expect(tab.source()).toBeNull();
        expect(memory.place()).toBeNull();
    });
});
