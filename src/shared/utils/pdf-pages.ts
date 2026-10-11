/**
 * Draws the pages of a PDF in the browser, for thumbnails and for taking an
 * image from a page (docs/features/media.html, Take an image from a PDF).
 *
 * pdf.js is large, so it is imported only when a PDF is opened: the admin's
 * first load does not carry it, and it never runs on the server. It is pinned
 * (package.json) at a 6.x release: CVE-2024-4367 was fixed in 4.2.67, and
 * from 5.0 pdf.js no longer evaluates code from a font at all, so no
 * `isEvalSupported` setting is needed (MF-D13). Scripts in a PDF never run
 * here: only the page drawing is used.
 */

/** Why a PDF could not be opened, in the words the screen uses. */
export type PdfOpenProblem = 'locked' | 'unreadable';

export class PdfOpenError extends Error {
    constructor(readonly problem: PdfOpenProblem, cause?: unknown) {
        super(problem === 'locked' ? 'The PDF is locked with a password.' : 'The PDF could not be opened.');
        this.name = 'PdfOpenError';
        if (cause) (this as { cause?: unknown }).cause = cause;
    }
}

/** A part of a page in PDF points (1/72 inch), from its top left. */
export interface PdfRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The size of a page in PDF points. */
export interface PdfPageSize {
    width: number;
    height: number;
}

/** A drawn page or part of one. */
export interface PdfDrawing {
    blob: Blob;
    width: number;
    height: number;
    /** Pixels per PDF point. */
    scale: number;
}

/**
 * The most pixels one drawing may have. iPhone Safari refuses a canvas larger
 * than about 16.7 million pixels and draws nothing, without an error.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** An open PDF. Call `destroy()` when done: pdf.js keeps the file and a worker. */
export interface PdfDocument {
    readonly pageCount: number;
    pageSize(pageNumber: number): Promise<PdfPageSize>;
    /** The whole page fitted in a `longestSide` box, as an image, and the scale it was drawn at. */
    renderPage(pageNumber: number, longestSide: number, type?: string): Promise<PdfDrawing>;
    /** `rect` of the page drawn at `scale` (pixels per point), as an image. */
    renderRegion(pageNumber: number, rect: PdfRect, scale: number, type?: string): Promise<PdfDrawing>;
    destroy(): Promise<void>;
}

type PdfJs = typeof import('pdfjs-dist');

let pdfjsLoading: Promise<PdfJs> | null = null;

/** pdf.js and its worker, loaded once, on first use. */
function loadPdfJs(): Promise<PdfJs> {
    pdfjsLoading ??= (async () => {
        const [pdfjs, worker] = await Promise.all([
            import('pdfjs-dist'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
    })().catch((error) => {
        pdfjsLoading = null;
        throw error;
    });
    return pdfjsLoading;
}

/**
 * Opens a PDF from its bytes. Rejects with a PdfOpenError: `locked` for a
 * password-protected file (no password box is offered, MF-D17), `unreadable`
 * for anything else pdf.js cannot read.
 */
export async function openPdf(data: Blob | ArrayBuffer | Uint8Array): Promise<PdfDocument> {
    const pdfjs = await loadPdfJs();
    const bytes = data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data instanceof Uint8Array ? data : new Uint8Array(data);

    const task = pdfjs.getDocument({ data: bytes });
    let doc: Awaited<typeof task.promise>;
    try {
        doc = await task.promise;
    } catch (error: any) {
        void task.destroy();
        throw new PdfOpenError(error?.name === 'PasswordException' ? 'locked' : 'unreadable', error);
    }

    const draw = async (pageNumber: number, scale: number, width: number, height: number, offset: { x: number; y: number }, type: string) => {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const context = canvas.getContext('2d')!;
        // PDFs assume a white sheet; a transparent canvas would turn a
        // page's background black in a JPEG and grey in some viewers.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: [1, 0, 0, 1, -offset.x, -offset.y],
        }).promise;
        page.cleanup();
        return { blob: await canvasToBlob(canvas, type), width: canvas.width, height: canvas.height, scale };
    };

    return {
        pageCount: doc.numPages,

        async pageSize(pageNumber) {
            const page = await doc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
        },

        async renderPage(pageNumber, longestSide, type = 'image/jpeg') {
            const page = await doc.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const scale = cappedScale(longestSide / Math.max(base.width, base.height), base);
            return draw(pageNumber, scale, base.width * scale, base.height * scale, { x: 0, y: 0 }, type);
        },

        async renderRegion(pageNumber, rect, scale, type = 'image/png') {
            const safe = cappedScale(scale, rect);
            return draw(pageNumber, safe, rect.width * safe, rect.height * safe, { x: rect.x * safe, y: rect.y * safe }, type);
        },

        async destroy() {
            await task.destroy();
        },
    };
}

/** `scale`, lowered when needed so `size` drawn at it stays under MAX_CANVAS_PIXELS. */
export function cappedScale(scale: number, size: { width: number; height: number }): number {
    const area = size.width * size.height;
    if (!(area > 0) || !(scale > 0)) return 1;
    const most = Math.sqrt(MAX_CANVAS_PIXELS / area);
    return Math.min(scale, most);
}

/**
 * The scale to draw a cropped part at so its longest side is `target` pixels
 * (MF-D14): the XL size, so every stored size is drawn from enough pixels.
 * Text and vector art come out sharp; a photo in the PDF is as sharp as the
 * photo the PDF holds. Capped by MAX_CANVAS_PIXELS.
 */
export function saveScale(rect: PdfRect, target: number): number {
    const longest = Math.max(rect.width, rect.height);
    if (!(longest > 0) || !(target > 0)) return 1;
    return cappedScale(target / longest, rect);
}

/** A crop frame placed on a page drawn at `shownScale`, in PDF points. */
export function frameToPdfRect(frame: { x: number; y: number; width: number; height: number }, shownScale: number): PdfRect {
    return {
        x: frame.x / shownScale,
        y: frame.y / shownScale,
        width: frame.width / shownScale,
        height: frame.height / shownScale,
    };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('The page could not be drawn.'))),
            type,
            type === 'image/png' ? undefined : 0.9,
        );
    });
}
