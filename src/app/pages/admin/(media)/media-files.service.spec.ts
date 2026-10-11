import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';

const getDoc = vi.fn();
const updateDoc = vi.fn();
const deleteDoc = vi.fn();
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: vi.fn(),
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
    getDoc: (...a: unknown[]) => getDoc(...a),
    getDocs: vi.fn(),
    updateDoc: (...a: unknown[]) => updateDoc(...a),
    deleteDoc: (...a: unknown[]) => deleteDoc(...a),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
}));

const deleteObject = vi.fn();
const updateMetadata = vi.fn();
vi.mock('@angular/fire/storage', () => ({
    Storage: class {},
    ref: vi.fn((_s: unknown, path: string) => ({ fullPath: path })),
    deleteObject: (...a: unknown[]) => deleteObject(...a),
    updateMetadata: (...a: unknown[]) => updateMetadata(...a),
}));

const callable = vi.fn();
vi.mock('../../../core/config/arc-functions', () => ({
    arcCallable: () => (data: unknown) => callable(data),
}));

import { of, throwError } from 'rxjs';
import { MediaFilesService } from './media-files.service';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { IMediaFile } from './media-files.model';

const file: IMediaFile = {
    id: 'f1', title: 'Report', name: 'report-abc123.pdf', downloadURL: 'u', path: 'mediaFiles/report-abc123.pdf',
    type: 'pdf', contentType: 'application/pdf', bytes: 3, uploadTime: new Date(),
    thumbnail: { url: 't', path: 'mediaFiles/report-abc123-thumb.jpg', width: 1, height: 1 },
    createdAt: new Date(), modifiedAt: new Date(), createdBy: '', modifiedBy: '',
};

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

/** jsdom's Blob has no arrayBuffer(); FileReader reads it. */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

describe('MediaFilesService', () => {
    let service: MediaFilesService;
    const fileUpload = { uploadDocument: vi.fn(), removeStored: vi.fn() };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                MediaFilesService,
                { provide: Firestore, useValue: {} },
                { provide: Storage, useValue: {} },
                { provide: Functions, useValue: {} },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: FileUploadService, useValue: fileUpload },
            ],
        });
        service = TestBed.inject(MediaFilesService);
    });

    afterEach(() => vi.clearAllMocks());

    describe('readFile (MF-D16)', () => {
        it('asks for parts until it has the whole file, reporting progress', async () => {
            callable
                .mockResolvedValueOnce({ data: { data: b64([1, 2]), offset: 0, total: 3 } })
                .mockResolvedValueOnce({ data: { data: b64([3]), offset: 2, total: 3 } });
            const progress = vi.fn();
            const blob = await service.readFile('f1', progress);
            expect(callable).toHaveBeenNthCalledWith(1, { fileId: 'f1', offset: 0 });
            expect(callable).toHaveBeenNthCalledWith(2, { fileId: 'f1', offset: 2 });
            expect(Array.from(new Uint8Array(await readBlob(blob)))).toEqual([1, 2, 3]);
            expect(blob.type).toBe('application/pdf');
            expect(progress).toHaveBeenLastCalledWith(100);
        });

        it('stops on an empty part instead of asking forever', async () => {
            callable.mockResolvedValue({ data: { data: '', offset: 0, total: 5 } });
            await expect(service.readFile('f1')).rejects.toThrow('stopped part-way');
        });
    });

    it('uses this visit\'s upload instead of reading a PDF back, keeping only the last three', async () => {
        const blobs = [1, 2, 3, 4].map((n) => new Blob([String(n)]));
        blobs.forEach((b, i) => service.rememberBytes(`id${i}`, b));
        expect(await service.pdfBytes('id3')).toBe(blobs[3]);
        expect(callable).not.toHaveBeenCalled();
        callable.mockResolvedValue({ data: { data: b64([9]), offset: 0, total: 1 } });
        await service.pdfBytes('id0');
        expect(callable).toHaveBeenCalledWith({ fileId: 'id0', offset: 0 });
    });

    it('reads a PDF from Storage once per visit, not once per picker (PI-D7)', async () => {
        callable.mockResolvedValue({ data: { data: b64([9]), offset: 0, total: 1 } });
        const first = await service.pdfBytes('f7');
        const again = await service.pdfBytes('f7');
        expect(again).toBe(first);
        expect(callable).toHaveBeenCalledTimes(1);
    });

    describe('saveDetails', () => {
        it('saves the title and notes, and makes the title the download name', async () => {
            await service.saveDetails(file, { title: ' Annual Report ' });
            expect(updateDoc).toHaveBeenCalledWith({ path: 'mediaFiles/f1' }, expect.objectContaining({ title: 'Annual Report' }));
            expect(updateMetadata).toHaveBeenCalledWith({ fullPath: file.path }, { contentDisposition: expect.stringMatching(/^inline; filename="Annual Report\.pdf"/) });
        });

        it('keeps the old title rather than an empty one, and saves notes without touching the download name', async () => {
            await service.saveDetails(file, { title: '  ', notes: ' for the shop ' });
            expect(updateDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'Report', notes: 'for the shop' }));
            expect(updateMetadata).not.toHaveBeenCalled();
        });

        it('still saves the title when the download name cannot change', async () => {
            updateMetadata.mockRejectedValue(new Error('denied'));
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            await expect(service.saveDetails(file, { title: 'New' })).resolves.toBeUndefined();
            expect(updateDoc).toHaveBeenCalled();
        });
    });

    describe('deleteFile', () => {
        it('removes the file, its thumbnail and its record', async () => {
            getDoc.mockResolvedValue({ exists: () => true, data: () => file });
            await service.deleteFile('f1');
            expect(deleteObject).toHaveBeenCalledWith({ fullPath: file.path });
            expect(deleteObject).toHaveBeenCalledWith({ fullPath: file.thumbnail!.path });
            expect(deleteDoc).toHaveBeenCalledWith({ path: 'mediaFiles/f1' });
        });

        it('removes the record when the file is already gone from Storage', async () => {
            getDoc.mockResolvedValue({ exists: () => true, data: () => file });
            deleteObject.mockRejectedValueOnce({ code: 'storage/object-not-found' });
            await service.deleteFile('f1');
            expect(deleteDoc).toHaveBeenCalled();
        });

        it('keeps the record when Storage refuses, so nothing is lost silently', async () => {
            getDoc.mockResolvedValue({ exists: () => true, data: () => file });
            deleteObject.mockRejectedValueOnce({ code: 'storage/unauthorized' });
            await expect(service.deleteFile('f1')).rejects.toBeTruthy();
            expect(deleteDoc).not.toHaveBeenCalled();
        });
    });

    describe('keepPdf (PI-D3, PI-D4)', () => {
        const pdf = new File(['%PDF'], 'Report.pdf', { type: 'application/pdf' });

        it('uses the same PDF already in Files, uploading nothing', async () => {
            vi.spyOn(service, 'listAll').mockResolvedValue([{ ...file, name: 'report-x1y2z3.pdf', bytes: pdf.size }]);
            const progress = vi.fn();
            const kept = await service.keepPdf(pdf, progress);
            expect(kept.id).toBe('f1');
            expect(fileUpload.uploadDocument).not.toHaveBeenCalled();
            expect(progress).toHaveBeenCalledWith(100);
            expect(await service.pdfBytes('f1')).toBe(pdf);
        });

        it('stores a new one, and remembers its bytes under its new id', async () => {
            vi.spyOn(service, 'listAll').mockResolvedValue([{ ...file, bytes: 999 }]);
            fileUpload.uploadDocument.mockResolvedValue({ ...file, id: undefined, name: 'report-q9q9q9.pdf' });
            vi.spyOn(service, 'addBatch').mockReturnValue(of(['new1']));
            const kept = await service.keepPdf(pdf);
            expect(kept.id).toBe('new1');
            expect(fileUpload.uploadDocument).toHaveBeenCalledWith(pdf, expect.any(Function));
            expect(await service.pdfBytes('new1')).toBe(pdf);
        });

        it('uploads a PDF opened twice at once only once', async () => {
            vi.spyOn(service, 'listAll').mockResolvedValue([]);
            fileUpload.uploadDocument.mockResolvedValue({ ...file, name: 'report-q9q9q9.pdf' });
            vi.spyOn(service, 'addBatch').mockReturnValue(of(['new2']));
            const [a, b] = await Promise.all([service.keepPdf(pdf), service.keepPdf(pdf)]);
            expect(a.id).toBe('new2');
            expect(b.id).toBe('new2');
            expect(fileUpload.uploadDocument).toHaveBeenCalledTimes(1);
        });

        it('takes the stored file back out when its record cannot be written', async () => {
            vi.spyOn(service, 'listAll').mockResolvedValue([]);
            fileUpload.uploadDocument.mockResolvedValue({ ...file, path: 'mediaFiles/a.pdf', thumbnail: undefined });
            vi.spyOn(service, 'addBatch').mockReturnValue(throwError(() => new Error('denied')));
            await expect(service.keepPdf(pdf)).rejects.toThrow('denied');
            expect(fileUpload.removeStored).toHaveBeenCalled();
        });
    });
});
