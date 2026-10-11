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
    /**
     * The pictures embedded in a page, in reading order, in page points
     * (PI-D10, PI-D11). Empty when there are none or the page cannot be read.
     */
    findPictures(pageNumber: number): Promise<PdfRect[]>;
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

        async findPictures(pageNumber) {
            try {
                const page = await doc.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 1 });
                // Parsed again (pdf.js keeps the drawing's parse apart), which
                // costs milliseconds; pictures are not decoded for it. Stamps
                // and other annotations are left out: their position comes
                // from the annotation, which the walk does not follow.
                const list = await page.getOperatorList({ intent: 'display', annotationMode: pdfjs.AnnotationMode.DISABLE });
                return picturesFromOperators(list, pdfjs.OPS, viewport.transform, { width: viewport.width, height: viewport.height });
            } catch (error) {
                console.warn(`Could not find the pictures on page ${pageNumber}:`, error);
                return [];
            }
        },

        async destroy() {
            await task.destroy();
        },
    };
}

/** The pdf.js operator codes the picture walk follows (`pdfjs.OPS`). */
export interface PictureOps {
    save: number;
    restore: number;
    transform: number;
    paintFormXObjectBegin: number;
    paintFormXObjectEnd: number;
    paintImageXObject: number;
    paintInlineImageXObject: number;
}

/** A page's drawing instructions, as `page.getOperatorList()` gives them. */
export interface PdfOperatorList {
    fnArray: ArrayLike<number>;
    argsArray: ArrayLike<unknown>;
}

/** Pictures smaller than this on either side are left out: bullets, icons, small logos (PI-D11). */
export const MIN_PICTURE_POINTS = 48;
/** A picture covering this share of the page is a scan or a background, not a photo (PI-D11). */
export const MAX_PICTURE_PAGE_SHARE = 0.9;
/** At most this many pictures are offered on one page (PI-D11). */
export const MAX_PICTURES_PER_PAGE = 40;
/** Edges this close (in points) touch or line up, for joining a photo cut into strips. */
const EDGE_SLACK = 2;
/**
 * Pictures looked at on one page. Joining compares every pair, so a page
 * of thousands of tiny images (a mosaic, a map) would stall the tab.
 */
const MAX_RAW_PICTURES = 400;

type Matrix = [number, number, number, number, number, number];

/** `a` then `b`, as pdf.js's `Util.transform(a, b)`: points go through `b` first. */
function multiply(a: Matrix, b: ArrayLike<number>): Matrix {
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ];
}

function isMatrix(value: unknown): value is ArrayLike<number> {
    const list = value as ArrayLike<number> | null;
    return !!list && typeof list === 'object' && list.length === 6 && Array.from(list).every((n) => Number.isFinite(n));
}

/**
 * Where the pictures on a page are, from its drawing instructions (PI-D10).
 *
 * Follows the drawing position through `save`, `restore`, `transform` and
 * form objects (whose matrix pdf.js applies once, in
 * `paintFormXObjectBegin`; a transparency group's copy of it is not applied
 * again), and boxes every picture painted: a picture fills the unit square
 * of the position it is painted at. `viewportTransform` turns page space
 * into points from the top left, rotation included, as the drawn page shows
 * it. Then PI-D11: pieces that touch and line up are joined, near copies
 * merged, small pictures and whole-page ones left out, and the rest sorted
 * into reading order. Masks, repeated tiles and groups of tiny inline
 * images are not followed, so they are never offered.
 */
export function picturesFromOperators(
    list: PdfOperatorList,
    ops: PictureOps,
    viewportTransform: ArrayLike<number>,
    page: PdfPageSize,
): PdfRect[] {
    const base: Matrix = isMatrix(viewportTransform) ? (Array.from(viewportTransform) as Matrix) : [1, 0, 0, 1, 0, 0];
    let position: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    const boxes: PdfRect[] = [];

    for (let i = 0; i < list.fnArray.length; i++) {
        const fn = list.fnArray[i];
        const args = list.argsArray[i] as unknown[] | null;
        if (fn === ops.save) {
            stack.push(position);
        } else if (fn === ops.restore) {
            position = stack.pop() ?? position;
        } else if (fn === ops.transform) {
            if (args && isMatrix(args)) position = multiply(position, args);
        } else if (fn === ops.paintFormXObjectBegin) {
            stack.push(position);
            if (args && isMatrix(args[0])) position = multiply(position, args[0] as ArrayLike<number>);
        } else if (fn === ops.paintFormXObjectEnd) {
            position = stack.pop() ?? position;
        } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
            if (boxes.length >= MAX_RAW_PICTURES) break;
            const box = unitSquareBox(multiply(base, position), page);
            if (box) boxes.push(box);
        }
    }

    return tidyPictures(boxes, page);
}

/** The unit square through `m`, as an upright box kept inside the page; null when nothing is left. */
function unitSquareBox(m: Matrix, page: PdfPageSize): PdfRect | null {
    const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
    const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
    const left = Math.max(0, Math.min(...xs));
    const top = Math.max(0, Math.min(...ys));
    const right = Math.min(page.width, Math.max(...xs));
    const bottom = Math.min(page.height, Math.max(...ys));
    if (!(right - left > 0.5) || !(bottom - top > 0.5)) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function union(a: PdfRect, b: PdfRect): PdfRect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function overlapArea(a: PdfRect, b: PdfRect): number {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

const near = (a: number, b: number) => Math.abs(a - b) <= EDGE_SLACK;

/** One picture or two pieces of one: near copies, or strips that touch and line up. */
function belongTogether(a: PdfRect, b: PdfRect): boolean {
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    if (smaller > 0 && overlapArea(a, b) >= 0.8 * smaller) return true;
    const sameColumn = near(a.x, b.x) && near(a.x + a.width, b.x + b.width);
    const stacked = near(a.y + a.height, b.y) || near(b.y + b.height, a.y);
    if (sameColumn && stacked) return true;
    const sameRow = near(a.y, b.y) && near(a.y + a.height, b.y + b.height);
    const sideBySide = near(a.x + a.width, b.x) || near(b.x + b.width, a.x);
    return sameRow && sideBySide;
}

/** PI-D11's rules over the raw boxes, then reading order. */
function tidyPictures(boxes: PdfRect[], page: PdfPageSize): PdfRect[] {
    const pageArea = page.width * page.height;
    const wholePage = (box: PdfRect) => pageArea > 0 && (box.width * box.height) / pageArea >= MAX_PICTURE_PAGE_SHARE;
    // A scan or background goes first: merged with the photos printed on it,
    // it would swallow them.
    const joined = boxes.filter((box) => !wholePage(box));
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < joined.length; i++) {
            for (let j = i + 1; j < joined.length; j++) {
                if (belongTogether(joined[i], joined[j])) {
                    joined[i] = union(joined[i], joined[j]);
                    joined.splice(j, 1);
                    changed = true;
                    break outer;
                }
            }
        }
    }
    // Small ones only now: a photo cut into thin strips is small piece by piece.
    const kept = joined.filter((box) => box.width >= MIN_PICTURE_POINTS && box.height >= MIN_PICTURE_POINTS && !wholePage(box));
    return readingOrder(kept).slice(0, MAX_PICTURES_PER_PAGE);
}

/**
 * Top to bottom, then left to right. Boxes sharing at least half the height
 * of the smaller one are on the same row, so a row of photos whose tops
 * differ a little still reads left to right.
 */
export function readingOrder(boxes: PdfRect[]): PdfRect[] {
    const byTop = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: PdfRect[][] = [];
    for (const box of byTop) {
        const row = rows[rows.length - 1];
        const first = row?.[0];
        const shared = first ? Math.min(first.y + first.height, box.y + box.height) - Math.max(first.y, box.y) : 0;
        if (first && shared >= 0.5 * Math.min(first.height, box.height)) row.push(box);
        else rows.push([box]);
    }
    return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * The frame for a clicked picture (PI-D12): its exact edges with no ratio,
 * else the largest frame of `ratio` (width / height) centred on it.
 */
export function snapFrame(picture: PdfRect, ratio: number | null): PdfRect {
    if (!ratio || !(ratio > 0)) return { ...picture };
    let width = picture.width;
    let height = width / ratio;
    if (height > picture.height) {
        height = picture.height;
        width = height * ratio;
    }
    return {
        x: picture.x + (picture.width - width) / 2,
        y: picture.y + (picture.height - height) / 2,
        width,
        height,
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
