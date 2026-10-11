import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';

vi.mock('../media-files.service', () => ({ MediaFilesService: class {} }));

import { MediaFilesTabComponent } from './media-files-tab.component';
import { MediaFilesService } from '../media-files.service';
import { FileUploadService, MediaFileUploadError } from '../../../../../shared/services/file-upload.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { IMediaFile } from '../media-files.model';

const record = (id: string, title: string, extra: Partial<IMediaFile> = {}): IMediaFile => ({
    id, title, name: `${id}.pdf`, downloadURL: `https://x/${id}.pdf`, path: `mediaFiles/${id}.pdf`, type: 'pdf', contentType: 'application/pdf',
    bytes: 10, uploadTime: new Date(), createdAt: new Date(), modifiedAt: new Date(), createdBy: '', modifiedBy: '', ...extra,
});

describe('MediaFilesTabComponent', () => {
    let files: any;
    let upload: any;
    let notify: any;

    function create() {
        TestBed.configureTestingModule({
            imports: [MediaFilesTabComponent, NoopAnimationsModule, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
            providers: [
                { provide: MediaFilesService, useValue: files },
                { provide: FileUploadService, useValue: upload },
                { provide: NotifyService, useValue: notify },
                { provide: PLATFORM_ID, useValue: 'browser' },
            ],
        });
        const fixture = TestBed.createComponent(MediaFilesTabComponent);
        fixture.detectChanges();
        return fixture;
    }

    beforeEach(() => {
        files = {
            listPage: vi.fn().mockResolvedValue({ items: [record('a', 'Annual report'), record('b', 'Menu', { notes: 'Pune' })], totalItems: 2 }),
            listAll: vi.fn().mockResolvedValue([record('a', 'Annual report'), record('b', 'Menu', { notes: 'Pune' })]),
            addBatch: vi.fn(() => of(['new1'])),
            rememberBytes: vi.fn(),
        };
        upload = { uploadDocument: vi.fn(), removeStored: vi.fn().mockResolvedValue(undefined) };
        notify = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
    });

    afterEach(() => vi.clearAllMocks());

    it('lists the first page, newest first, with type and size', async () => {
        const fixture = create();
        await fixture.whenStable();
        fixture.detectChanges();
        const cards = fixture.nativeElement.querySelectorAll('.file-card:not(.file-upload-card)');
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain('Annual report');
        expect(cards[0].textContent).toContain('PDF · 10 bytes');
    });

    it('uploads, adds the files to the library, remembers a PDF\'s bytes and selects a lone upload', async () => {
        const fixture = create();
        const tab = fixture.componentInstance;
        const pdf = new File(['%PDF'], 'new.pdf');
        upload.uploadDocument.mockResolvedValue({ ...record('x', 'New'), type: 'pdf' });
        files.listPage.mockResolvedValue({ items: [record('new1', 'New')], totalItems: 1 });
        const selected = vi.fn();
        tab.selected.subscribe(selected);

        await tab.upload([pdf]);

        expect(files.addBatch).toHaveBeenCalledTimes(1);
        expect(files.rememberBytes).toHaveBeenCalledWith('new1', pdf);
        expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' }));
        expect(tab.uploading()).toBe(false);
    });

    it('names a refused file and carries on with the rest', async () => {
        const fixture = create();
        const tab = fixture.componentInstance;
        upload.uploadDocument
            .mockRejectedValueOnce(new MediaFileUploadError('size', 31 * 1024 * 1024))
            .mockRejectedValueOnce(new MediaFileUploadError('type', 1))
            .mockResolvedValueOnce(record('ok', 'OK'));
        files.addBatch.mockReturnValue(of(['k1']));

        await tab.upload([new File(['x'], 'big.pdf'), new File(['x'], '<b>.html'), new File(['x'], 'ok.pdf')]);

        expect(notify.error).toHaveBeenCalledWith('admin.media.files.error_size', { name: 'big.pdf', size: '31.0 MB' });
        expect(notify.error).toHaveBeenCalledWith('admin.media.files.error_type', { name: '<b>.html' });
        expect(files.addBatch).toHaveBeenCalledWith([expect.objectContaining({ id: 'ok' })]);
    });

    it('says so when the files are stored but not added to the library', async () => {
        const fixture = create();
        upload.uploadDocument.mockResolvedValue(record('x', 'X', { thumbnail: { url: 't', path: 'mediaFiles/x-thumb.jpg', width: 1, height: 1 } }));
        files.addBatch.mockReturnValue(throwError(() => new Error('denied')));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await fixture.componentInstance.upload([new File(['x'], 'x.pdf')]);
        expect(notify.error).toHaveBeenCalledWith('admin.media.files.metadata_failed');
        // Files no tab lists could never be deleted: they are taken back out.
        expect(upload.removeStored).toHaveBeenCalledWith(['mediaFiles/x.pdf', 'mediaFiles/x-thumb.jpg']);
    });

    it('searches every file once, by title and notes (MF-D23)', async () => {
        const fixture = create();
        const tab = fixture.componentInstance;
        await tab.onSearch('pune');
        expect(tab.shown().map((f) => f.id)).toEqual(['b']);
        await tab.onSearch('annual');
        expect(tab.shown().map((f) => f.id)).toEqual(['a']);
        expect(files.listAll).toHaveBeenCalledTimes(1);
        tab.clearSearch();
        expect(tab.searching()).toBe(false);
    });
});
