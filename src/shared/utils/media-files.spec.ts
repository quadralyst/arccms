import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    ALLOWED_FILE_ACCEPT,
    ALLOWED_FILES,
    allowedFileOf,
    contentDispositionFor,
    defaultTitle,
    extensionOf,
    isLibraryDocument,
    isPdfFile,
    isSameUpload,
    MAX_FILE_BYTES,
    storedFileName,
} from './media-files';

describe('media files table', () => {
    it('takes documents by extension, whatever their case', () => {
        expect(allowedFileOf('Report.PDF')?.contentType).toBe('application/pdf');
        expect(allowedFileOf('notes.txt')?.type).toBe('text');
        expect(allowedFileOf('prices.csv')?.disposition).toBe('attachment');
        expect(allowedFileOf('deck.pptx')?.type).toBe('powerpoint');
    });

    it('refuses pages, scripts, archives, macro files and images', () => {
        for (const name of ['page.html', 'logo.svg', 'run.js', 'all.zip', 'macro.docm', 'sheet.xlsm', 'photo.jpg', 'noextension', '.pdf']) {
            expect(allowedFileOf(name), name).toBeNull();
            expect(isLibraryDocument(name), name).toBe(false);
        }
    });

    it('opens PDFs and text in the browser, and downloads the rest (MF-D7)', () => {
        const inline = ALLOWED_FILES.filter((f) => f.disposition === 'inline').map((f) => f.extension);
        expect(inline.sort()).toEqual(['pdf', 'txt']);
    });

    it('offers every allowed extension to the file chooser', () => {
        expect(ALLOWED_FILE_ACCEPT.split(',')).toEqual(ALLOWED_FILES.map((f) => `.${f.extension}`));
    });

    it('caps files at 20 MB', () => {
        expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    });

    it('agrees with storage.rules, pair by pair (MF-D12)', () => {
        const rules = readFileSync(resolve(__dirname, '../../../storage.rules'), 'utf8');
        for (const file of ALLOWED_FILES) {
            expect(rules, file.extension).toContain(`fileName.matches('.*[.]${file.extension}') && type == '${file.contentType}'`);
        }
        const pairs = rules.match(/fileName\.matches\('\.\*\[\.\]([a-z]+)'\) && type == '/g) ?? [];
        expect(pairs).toHaveLength(ALLOWED_FILES.length);
        expect(rules).toContain(`request.resource.size <= ${MAX_FILE_BYTES / (1024 * 1024)} * 1024 * 1024`);
    });
});

describe('extensionOf and isPdfFile', () => {
    it('reads the last extension, lower case', () => {
        expect(extensionOf('a.b.PDF')).toBe('pdf');
        expect(extensionOf('README')).toBe('');
        expect(extensionOf('trailing.')).toBe('');
    });

    it('knows a PDF by name or type', () => {
        expect(isPdfFile({ name: 'x.pdf' })).toBe(true);
        expect(isPdfFile({ name: 'x', type: 'application/pdf' })).toBe(true);
        expect(isPdfFile({ name: 'x.docx', type: '' })).toBe(false);
    });
});

describe('defaultTitle (MF-D8)', () => {
    it('drops the extension and turns dashes and underscores into spaces', () => {
        expect(defaultTitle('Annual-Report_2025.pdf')).toBe('Annual Report 2025');
        expect(defaultTitle('price  list.xlsx')).toBe('price list');
    });

    it('keeps the name when nothing would be left', () => {
        expect(defaultTitle('---.pdf')).toBe('---.pdf');
    });
});

describe('storedFileName', () => {
    it('is a slug, a random part and the extension', () => {
        expect(storedFileName('Annual Report 2025!.PDF', 'pdf', 'k3f9qa')).toBe('annual-report-2025-k3f9qa.pdf');
    });

    it('falls back to "file" and keeps names short', () => {
        expect(storedFileName('###.pdf', 'pdf', 'abc123')).toBe('file-abc123.pdf');
        const long = storedFileName(`${'a'.repeat(80)}.txt`, 'txt', 'abc123');
        expect(long.length).toBeLessThanOrEqual(50 + '-abc123.txt'.length);
    });
});

describe('contentDispositionFor', () => {
    const pdf = allowedFileOf('x.pdf')!;
    const docx = allowedFileOf('x.docx')!;

    it('opens or downloads under the title', () => {
        expect(contentDispositionFor(pdf, 'Annual Report')).toBe(`inline; filename="Annual Report.pdf"; filename*=UTF-8''Annual%20Report.pdf`);
        expect(contentDispositionFor(docx, 'Menu').startsWith('attachment; filename="Menu.docx"')).toBe(true);
    });

    it('keeps quotes and line breaks out of the header, and spells other scripts the RFC 5987 way', () => {
        const header = contentDispositionFor(pdf, 'Say "hi"\r\nX-Evil: 1');
        expect(header).not.toMatch(/[\r\n]/);
        expect(header).toContain('filename="Say hiX-Evil: 1.pdf"');
        const hindi = contentDispositionFor(pdf, 'मूल्य सूची');
        expect(hindi).toMatch(/filename="_+ _+\.pdf"/);
        expect(hindi).toContain(`filename*=UTF-8''${encodeURIComponent('मूल्य सूची.pdf')}`);
    });

    it('never names an empty file', () => {
        expect(contentDispositionFor(pdf, '  ')).toContain('filename="file.pdf"');
    });
});

describe('isSameUpload (PI-D4)', () => {
    it('matches a stored PDF by its name and size', () => {
        const stored = { name: `${storedFileName('Spring Brochure 2026.pdf', 'pdf')}`, bytes: 120 };
        expect(isSameUpload(stored, { name: 'Spring Brochure 2026.pdf', size: 120 })).toBe(true);
        expect(isSameUpload(stored, { name: 'Spring Brochure 2026.pdf', size: 121 })).toBe(false);
        expect(isSameUpload(stored, { name: 'Spring Brochure.pdf', size: 120 })).toBe(false);
        expect(isSameUpload(stored, { name: 'Spring Brochure 2026.docx', size: 120 })).toBe(false);
    });

    it('keeps a name that itself ends in a number', () => {
        expect(isSameUpload({ name: 'report-2024-x7f2k1.pdf', bytes: 5 }, { name: 'Report 2024.pdf', size: 5 })).toBe(true);
    });
});
