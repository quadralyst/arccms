import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.mjs' }));

import { cappedScale, frameToPdfRect, MAX_CANVAS_PIXELS, openPdf, PdfOpenError, saveScale } from './pdf-pages';

describe('pdf-pages scales (MF-D14)', () => {
    it('draws a crop so its longest side is the target', () => {
        // A 100 x 50 point part of a page, for a 1200 px XL size.
        expect(saveScale({ x: 0, y: 0, width: 100, height: 50 }, 1200)).toBe(12);
        expect(saveScale({ x: 0, y: 0, width: 600, height: 900 }, 1200)).toBeCloseTo(1200 / 900);
    });

    it('never draws more than the canvas limit', () => {
        // A whole A4 page (595 x 842 pt) asked at 20x would be 200 million pixels.
        const scale = saveScale({ x: 0, y: 0, width: 595, height: 842 }, 842 * 20);
        expect(595 * scale * 842 * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
        expect(cappedScale(2, { width: 100, height: 100 })).toBe(2);
    });

    it('falls back to 1 for nonsense', () => {
        expect(saveScale({ x: 0, y: 0, width: 0, height: 0 }, 1200)).toBe(1);
        expect(cappedScale(Number.NaN, { width: 10, height: 10 })).toBe(1);
    });

    it('turns a frame on the drawn page into PDF points', () => {
        expect(frameToPdfRect({ x: 200, y: 100, width: 400, height: 300 }, 2)).toEqual({ x: 100, y: 50, width: 200, height: 150 });
    });
});

describe('openPdf (MF-D17)', () => {
    beforeEach(() => getDocument.mockReset());

    it('says a password-protected PDF is locked, and frees it', async () => {
        const destroy = vi.fn();
        getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error('pw'), { name: 'PasswordException' })), destroy });
        const error = await openPdf(new Uint8Array([1])).catch((e) => e);
        expect(error).toBeInstanceOf(PdfOpenError);
        expect(error.problem).toBe('locked');
        expect(destroy).toHaveBeenCalled();
    });

    it('says anything else is unreadable', async () => {
        getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error('bad'), { name: 'InvalidPDFException' })), destroy: vi.fn() });
        await expect(openPdf(new Uint8Array([1]))).rejects.toMatchObject({ problem: 'unreadable' });
    });

    it('reports the page count and closes through its loading task', async () => {
        const destroy = vi.fn();
        getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 7 }), destroy });
        const pdf = await openPdf(new ArrayBuffer(4));
        expect(pdf.pageCount).toBe(7);
        await pdf.destroy();
        expect(destroy).toHaveBeenCalled();
        expect(getDocument.mock.calls[0][0].data).toBeInstanceOf(Uint8Array);
    });
});
