import { describe, expect, it } from 'vitest';
import * as server from '../../../functions/src/shared/file-rows';
import { fileLoopRow, fileMeta, fileSiblings, formatBytes, isFileList, isFileRow, toFileRows } from './file-rows';

const pdf = { url: 'https://x/o/mediaFiles%2Fa.pdf?alt=media', title: 'Annual Report', type: 'pdf' as const, bytes: 2411724, pages: 24 };
const csv = { url: 'https://x/o/mediaFiles%2Fb.csv?alt=media', title: 'Prices', type: 'csv' as const, bytes: 900 };

describe('formatBytes', () => {
    it('reads the way people say sizes', () => {
        expect(formatBytes(12)).toBe('12 bytes');
        expect(formatBytes(640 * 1024)).toBe('640 KB');
        expect(formatBytes(2411724)).toBe('2.3 MB');
        expect(formatBytes(-1)).toBe('');
        expect(formatBytes(Number.NaN)).toBe('');
    });
});

describe('fileMeta', () => {
    it('is the type and size, with pages when asked', () => {
        expect(fileMeta(pdf)).toBe('PDF · 2.3 MB');
        expect(fileMeta(pdf, (n) => `${n} pages`)).toBe('PDF · 2.3 MB · 24 pages');
        expect(fileMeta(csv, (n) => `${n} pages`)).toBe('CSV · 900 bytes');
    });
});

describe('file rows (MF-D18)', () => {
    it('knows a file row by its url and bytes', () => {
        expect(isFileRow(pdf)).toBe(true);
        expect(isFileRow({ url: 'x', title: 'no size' })).toBe(false);
        expect(isFileRow({ image: 'x', caption: 'gallery row' })).toBe(false);
        expect(isFileRow(null)).toBe(false);
    });

    it('treats a list as a file field only when every row is a file', () => {
        expect(isFileList([pdf, csv])).toBe(true);
        expect(isFileList([pdf, { image: 'x' }])).toBe(false);
        expect(isFileList([])).toBe(false);
        expect(isFileList('x')).toBe(false);
    });

    it('stores only url, title, type, bytes and pages', () => {
        expect(toFileRows([{ ...pdf, id: 'f1', extra: 1 }, { image: 'x' }, csv])).toEqual([pdf, csv]);
        expect(toFileRows('nope')).toEqual([]);
    });

    it('reads in a loop as url, title, type, kind, size and pages', () => {
        expect(fileLoopRow(pdf)).toEqual({ url: pdf.url, title: 'Annual Report', type: 'PDF', kind: 'pdf', size: '2.3 MB', bytes: 2411724, pages: 24 });
        expect(fileLoopRow(csv).pages).toBe('');
    });

    it('binds the first file beside the field', () => {
        expect(fileSiblings('brochure', [pdf, csv])).toEqual({
            brochure_url: pdf.url,
            brochure_title: 'Annual Report',
            brochure_type: 'PDF',
            brochure_size: '2.3 MB',
            brochure_pages: 24,
        });
    });
});

describe('parity with the Cloud Functions mirror', () => {
    it('gives the same answers', () => {
        const values: unknown[] = [[pdf, csv], [pdf, { image: 'x' }], [], 'x', null];
        for (const value of values) {
            expect(server.isFileList(value)).toBe(isFileList(value));
            expect(server.toFileRows(value)).toEqual(toFileRows(value));
        }
        for (const row of [pdf, csv]) {
            expect(server.fileLoopRow(row)).toEqual(fileLoopRow(row));
            expect(server.fileMeta(row)).toBe(fileMeta(row));
        }
        expect(server.fileSiblings('k', [pdf])).toEqual(fileSiblings('k', [pdf]));
        for (const n of [0, 1023, 1024, 5_000_000]) expect(server.formatBytes(n)).toBe(formatBytes(n));
    });
});
