import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();
// pdf.js 6.3's operator codes, the ones the picture walk follows.
const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageMaskXObject: 83, paintImageXObject: 85, paintInlineImageXObject: 86 };
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {}, OPS }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.mjs' }));

import { cappedScale, frameToPdfRect, MAX_CANVAS_PIXELS, openPdf, PdfOpenError, picturesFromOperators, readingOrder, saveScale, snapFrame } from './pdf-pages';

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

describe('finding the pictures on a page (PI-D10, PI-D11)', () => {
    // An upright A4 page: page space has its origin at the bottom left.
    const A4 = { width: 595, height: 842 };
    const UPRIGHT = [1, 0, 0, -1, 0, 842];

    /** Instructions for pictures painted at page-space boxes [x, y, w, h], each in its own save. */
    function painted(...boxes: number[][]) {
        const fnArray: number[] = [];
        const argsArray: unknown[] = [];
        for (const [x, y, w, h] of boxes) {
            fnArray.push(OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore);
            argsArray.push(null, [w, 0, 0, h, x, y], ['img'], null);
        }
        return { fnArray, argsArray };
    }

    const find = (list: { fnArray: number[]; argsArray: unknown[] }, transform = UPRIGHT, page = A4) =>
        picturesFromOperators(list, OPS, transform, page).map((r) => [r.x, r.y, r.width, r.height].map(Math.round));

    it('boxes a picture in points from the top left', () => {
        // The MF test catalogue's picture: drawn at (50, 20), 200 x 90, measured 2026-10-11.
        expect(find(painted([50, 20, 200, 90]))).toEqual([[50, 732, 200, 90]]);
    });

    it('follows nested positions and form objects, and restores after them', () => {
        const fnArray = [
            OPS.save, OPS.transform, OPS.paintFormXObjectBegin, OPS.transform, OPS.paintInlineImageXObject, OPS.paintFormXObjectEnd, OPS.restore,
            OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
        ];
        const argsArray = [
            null, [1, 0, 0, 1, 100, 100], [[2, 0, 0, 2, 0, 0], [0, 0, 100, 100]], [50, 0, 0, 50, 0, 0], [{}], null, null,
            null, [100, 0, 0, 100, 300, 600], ['img'], null,
        ];
        // The form doubles the size and sits at (100, 100): a 100 x 100 picture there.
        expect(find({ fnArray, argsArray })).toEqual([[300, 142, 100, 100], [100, 642, 100, 100]]);
    });

    it('gives boxes as the drawn page shows them on a rotated page', () => {
        // A page turned 90 degrees (pdf.js viewport transform): x and y swap.
        expect(find(painted([50, 20, 200, 90]), [0, 1, 1, 0, 0, 0], { width: 842, height: 595 })).toEqual([[20, 50, 90, 200]]);
    });

    it('leaves out small pictures, scans and masks', () => {
        const list = painted([50, 50, 40, 200], [0, 0, 595, 842], [300, 300, 100, 100]);
        list.fnArray.push(OPS.save, OPS.transform, OPS.paintImageMaskXObject, OPS.restore);
        list.argsArray.push(null, [200, 0, 0, 200, 50, 500], [{}], null);
        expect(find(list)).toEqual([[300, 442, 100, 100]]);
    });

    it('keeps photos printed on a whole-page background', () => {
        expect(find(painted([0, 0, 595, 842], [100, 100, 200, 150]))).toEqual([[100, 592, 200, 150]]);
    });

    it('joins a photo cut into strips, and counts a near copy once', () => {
        const strips = painted([100, 400, 300, 20], [100, 420, 300, 20], [100, 440, 300, 20]);
        expect(find(strips)).toEqual([[100, 382, 300, 60]]);
        expect(find(painted([100, 100, 200, 200], [102, 101, 198, 198]))).toEqual([[100, 542, 200, 200]]);
    });

    it('keeps pictures inside the page', () => {
        expect(find(painted([-50, 700, 200, 200]))).toEqual([[0, 0, 150, 142]]);
    });

    it('offers no more than 40 a page', () => {
        const many = Array.from({ length: 50 }, (_, i) => [10 + (i % 5) * 110, 10 + Math.floor(i / 5) * 80, 60, 60]);
        expect(find(painted(...many))).toHaveLength(40);
    });

    it('sorts rows top to bottom, each left to right, with ragged tops on one row', () => {
        const order = readingOrder([
            { x: 300, y: 400, width: 100, height: 100 },
            { x: 300, y: 10, width: 100, height: 100 },
            { x: 10, y: 30, width: 100, height: 100 },
            { x: 10, y: 400, width: 100, height: 100 },
        ]);
        expect(order.map((r) => [r.x, r.y])).toEqual([[10, 30], [300, 10], [10, 400], [300, 400]]);
    });

    it('ignores instructions it does not understand', () => {
        expect(find({ fnArray: [OPS.transform, OPS.restore, 999], argsArray: [null, null, null] })).toEqual([]);
    });
});

describe('snapping the frame to a picture (PI-D12)', () => {
    const picture = { x: 100, y: 50, width: 400, height: 200 };

    it('takes the exact edges with no ratio', () => {
        expect(snapFrame(picture, null)).toEqual(picture);
    });

    it('centres the largest frame of a ratio on the picture', () => {
        expect(snapFrame(picture, 1)).toEqual({ x: 200, y: 50, width: 200, height: 200 });
        expect(snapFrame(picture, 4)).toEqual({ x: 100, y: 100, width: 400, height: 100 });
    });
});

describe('PdfDocument.findPictures', () => {
    it('reads the page as it is displayed, and gives nothing when that fails', async () => {
        const getOperatorList = vi.fn().mockResolvedValue({ fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore], argsArray: [null, [200, 0, 0, 90, 50, 20], ['i'], null] });
        const page = { getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] }), getOperatorList };
        const getPage = vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('gone'));
        getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy: vi.fn() });
        const pdf = await openPdf(new Uint8Array([1]));
        expect(await pdf.findPictures(1)).toEqual([{ x: 50, y: 732, width: 200, height: 90 }]);
        expect(getOperatorList).toHaveBeenCalledWith({ intent: 'display' });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await pdf.findPictures(2)).toEqual([]);
    });
});
