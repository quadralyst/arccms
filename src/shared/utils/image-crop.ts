/**
 * Image cropping: the ratios on offer and the geometry of the crop frame.
 *
 * A crop is a rectangle in the image's own pixels (`naturalWidth` ×
 * `naturalHeight`), never in screen pixels, so it means the same thing at any
 * zoom and can be handed straight to a canvas or to Unsplash's `rect`.
 *
 * Two places apply it:
 * - An upload in the library: the browser draws the rectangle onto a canvas
 *   and saves the result as a new media item at every size. The original is
 *   left alone, because content may already use it.
 * - An Unsplash photo: Unsplash's image server crops it through the URL
 *   (`rect=x,y,w,h`, in the photo's original pixels), so nothing is copied
 *   and the photo is still used from Unsplash, as its terms require.
 */

/** The ratios the crop frame offers. `free` lets it take any shape. */
export const CROP_RATIOS = ['free', 'original', '1:1', '4:3', '3:4', '3:2', '16:9'] as const;
export type CropRatio = (typeof CROP_RATIOS)[number];

/** A rectangle in image pixels. */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Which part of the frame is being dragged: the body, a corner, or an edge. */
export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

/** The smallest crop, in image pixels, so a slip of the pointer cannot make a 0 px image. */
export const MIN_CROP_SIZE = 16;

/**
 * Width divided by height for `ratio`, or null when the frame is free.
 * `original` is the image's own shape.
 */
export function cropRatioValue(ratio: CropRatio, imageWidth: number, imageHeight: number): number | null {
    switch (ratio) {
        case 'free':
            return null;
        case 'original':
            return imageWidth / imageHeight;
        default: {
            const [w, h] = ratio.split(':').map(Number);
            return w / h;
        }
    }
}

/**
 * The largest rectangle of `ratio` that fits the image, centred. A free
 * frame starts as the whole image.
 */
export function initialCropRect(ratio: number | null, imageWidth: number, imageHeight: number): CropRect {
    if (ratio === null) return { x: 0, y: 0, width: imageWidth, height: imageHeight };

    let width = imageWidth;
    let height = width / ratio;
    if (height > imageHeight) {
        height = imageHeight;
        width = height * ratio;
    }
    return {
        x: (imageWidth - width) / 2,
        y: (imageHeight - height) / 2,
        width,
        height,
    };
}

/**
 * The frame after dragging `handle` by `dx`, `dy` image pixels, starting
 * from `start` (the frame when the drag began, so rounding never builds up
 * over a long drag).
 *
 * The frame never leaves the image and never gets smaller than
 * MIN_CROP_SIZE (or the image, if the image is smaller still). With a ratio,
 * every handle keeps it: a corner resizes about the opposite corner, an
 * edge about the middle of the opposite edge.
 */
export function dragCropRect(
    start: CropRect,
    handle: CropHandle,
    dx: number,
    dy: number,
    ratio: number | null,
    imageWidth: number,
    imageHeight: number,
): CropRect {
    if (handle === 'move') {
        return {
            ...start,
            x: clamp(start.x + dx, 0, imageWidth - start.width),
            y: clamp(start.y + dy, 0, imageHeight - start.height),
        };
    }

    const minW = Math.min(MIN_CROP_SIZE, imageWidth);
    const minH = Math.min(MIN_CROP_SIZE, imageHeight);
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.includes('n');
    const south = handle.includes('s');

    if (ratio === null) {
        let { x, y, width, height } = start;
        if (west) {
            x = clamp(start.x + dx, 0, right - minW);
            width = right - x;
        }
        if (east) width = clamp(start.width + dx, minW, imageWidth - start.x);
        if (north) {
            y = clamp(start.y + dy, 0, bottom - minH);
            height = bottom - y;
        }
        if (south) height = clamp(start.height + dy, minH, imageHeight - start.y);
        return { x, y, width, height };
    }

    // With a ratio, one dimension leads and the other follows. A corner
    // follows whichever way the pointer moved further; an edge leads with
    // its own axis.
    const corner = (west || east) && (north || south);
    const signedDx = west ? -dx : dx;
    const signedDy = north ? -dy : dy;
    const widthLeads = corner ? Math.abs(signedDx) >= Math.abs(signedDy * ratio) : west || east;

    // The anchor that stays put, and the room the frame has to grow into
    // from it.
    const anchorX = west ? right : east ? start.x : start.x + start.width / 2;
    const anchorY = north ? bottom : south ? start.y : start.y + start.height / 2;
    const roomW = west ? anchorX : east ? imageWidth - anchorX : 2 * Math.min(anchorX, imageWidth - anchorX);
    const roomH = north ? anchorY : south ? imageHeight - anchorY : 2 * Math.min(anchorY, imageHeight - anchorY);

    const maxW = Math.min(roomW, roomH * ratio);
    const minWidth = Math.min(Math.max(minW, minH * ratio), maxW);
    const wanted = widthLeads ? start.width + signedDx : (start.height + signedDy) * ratio;
    const width = clamp(wanted, minWidth, maxW);
    const height = width / ratio;

    const x = west ? anchorX - width : east ? anchorX : anchorX - width / 2;
    const y = north ? anchorY - height : south ? anchorY : anchorY - height / 2;
    return { x, y, width, height };
}

/**
 * Whole pixels, kept inside the image. Rounding can push the far edge one
 * pixel out; this pulls it back.
 */
export function roundCropRect(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
    const x = clamp(Math.round(rect.x), 0, imageWidth - 1);
    const y = clamp(Math.round(rect.y), 0, imageHeight - 1);
    return {
        x,
        y,
        width: clamp(Math.round(rect.width), 1, imageWidth - x),
        height: clamp(Math.round(rect.height), 1, imageHeight - y),
    };
}

/** True when the frame covers the whole image, which is no crop at all. */
export function isWholeImage(rect: CropRect, imageWidth: number, imageHeight: number): boolean {
    const r = roundCropRect(rect, imageWidth, imageHeight);
    return r.x === 0 && r.y === 0 && r.width === imageWidth && r.height === imageHeight;
}

/**
 * Scales a rectangle from one pixel space to another: from the image shown
 * in the cropper to the photo's original pixels, for instance.
 */
export function scaleCropRect(rect: CropRect, fromWidth: number, fromHeight: number, toWidth: number, toHeight: number): CropRect {
    const sx = toWidth / fromWidth;
    const sy = toHeight / fromHeight;
    return roundCropRect(
        { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy },
        toWidth,
        toHeight,
    );
}

/**
 * An Unsplash URL cropped to `rect`, in the photo's original pixels. Any
 * crop the URL already carries is replaced. Unsplash applies `rect` before
 * the `w`, `h` and `fit` that pick a size, so every size of the cropped
 * photo derives from this URL (image-sizes.ts keeps the parameter).
 */
export function unsplashCropUrl(url: string, rect: CropRect): string {
    const parsed = new URL(url);
    parsed.searchParams.set('rect', [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(','));
    return parsed.toString();
}

/** The crop an Unsplash URL carries, or null. */
export function unsplashCropOf(url: string): CropRect | null {
    let value: string | null;
    try {
        value = new URL(url).searchParams.get('rect');
    } catch {
        return null;
    }
    const parts = value?.split(',').map(Number) ?? [];
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    const [x, y, width, height] = parts;
    if (width === 0 || height === 0) return null;
    return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
