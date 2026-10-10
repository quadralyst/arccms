import { describe, expect, it } from 'vitest';
import {
    CROP_RATIOS,
    CropRect,
    cropRatioValue,
    dragCropRect,
    initialCropRect,
    isWholeImage,
    MIN_CROP_SIZE,
    roundCropRect,
    scaleCropRect,
    unsplashCropOf,
    unsplashCropUrl,
} from './image-crop';
import { imageSizeUrls } from './image-sizes';

const W = 1200;
const H = 800;

function ratioOf(rect: CropRect): number {
    return rect.width / rect.height;
}

function inside(rect: CropRect, w = W, h = H): boolean {
    const e = 1e-9;
    return rect.x >= -e && rect.y >= -e && rect.x + rect.width <= w + e && rect.y + rect.height <= h + e;
}

describe('cropRatioValue', () => {
    it('is null for a free frame and the image shape for original', () => {
        expect(cropRatioValue('free', W, H)).toBeNull();
        expect(cropRatioValue('original', W, H)).toBe(1.5);
    });

    it('reads every fixed ratio on offer', () => {
        expect(cropRatioValue('1:1', W, H)).toBe(1);
        expect(cropRatioValue('4:3', W, H)).toBeCloseTo(4 / 3);
        expect(cropRatioValue('3:4', W, H)).toBeCloseTo(3 / 4);
        expect(cropRatioValue('3:2', W, H)).toBe(1.5);
        expect(cropRatioValue('16:9', W, H)).toBeCloseTo(16 / 9);
        for (const ratio of CROP_RATIOS) {
            const value = cropRatioValue(ratio, W, H);
            expect(value === null || Number.isFinite(value)).toBe(true);
        }
    });
});

describe('initialCropRect', () => {
    it('covers the whole image when free', () => {
        expect(initialCropRect(null, W, H)).toEqual({ x: 0, y: 0, width: W, height: H });
    });

    it('is the largest centred square in a landscape image', () => {
        expect(initialCropRect(1, W, H)).toEqual({ x: 200, y: 0, width: 800, height: 800 });
    });

    it('is the largest centred 16:9 frame in a portrait image', () => {
        const rect = initialCropRect(16 / 9, 900, 1600);
        expect(rect.width).toBe(900);
        expect(rect.height).toBeCloseTo(506.25);
        expect(rect.y).toBeCloseTo((1600 - 506.25) / 2);
    });
});

describe('dragCropRect: move', () => {
    const start = { x: 100, y: 100, width: 400, height: 300 };

    it('moves the frame by the drag', () => {
        expect(dragCropRect(start, 'move', 50, -20, null, W, H)).toEqual({ x: 150, y: 80, width: 400, height: 300 });
    });

    it('stops at the image edges without changing size', () => {
        expect(dragCropRect(start, 'move', -500, 5000, null, W, H)).toEqual({ x: 0, y: 500, width: 400, height: 300 });
    });
});

describe('dragCropRect: free frame', () => {
    const start = { x: 100, y: 100, width: 400, height: 300 };

    it('moves only the dragged edges', () => {
        expect(dragCropRect(start, 'se', 100, 50, null, W, H)).toEqual({ x: 100, y: 100, width: 500, height: 350 });
        expect(dragCropRect(start, 'nw', -50, 20, null, W, H)).toEqual({ x: 50, y: 120, width: 450, height: 280 });
        expect(dragCropRect(start, 'e', 30, 999, null, W, H)).toEqual({ x: 100, y: 100, width: 430, height: 300 });
        expect(dragCropRect(start, 'n', 999, -40, null, W, H)).toEqual({ x: 100, y: 60, width: 400, height: 340 });
    });

    it('stops at the image', () => {
        const rect = dragCropRect(start, 'se', 5000, 5000, null, W, H);
        expect(rect).toEqual({ x: 100, y: 100, width: 1100, height: 700 });
        const west = dragCropRect(start, 'w', -5000, 0, null, W, H);
        expect(west).toEqual({ x: 0, y: 100, width: 500, height: 300 });
    });

    it('never shrinks below the minimum, and never flips', () => {
        const rect = dragCropRect(start, 'nw', 5000, 5000, null, W, H);
        expect(rect.width).toBe(MIN_CROP_SIZE);
        expect(rect.height).toBe(MIN_CROP_SIZE);
        expect(rect.x + rect.width).toBe(500);
        expect(rect.y + rect.height).toBe(400);
    });
});

describe('dragCropRect: locked ratio', () => {
    const start = { x: 200, y: 100, width: 400, height: 300 }; // 4:3
    const ratio = 4 / 3;

    it('keeps the ratio from every handle', () => {
        for (const handle of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as const) {
            for (const [dx, dy] of [[40, 10], [-60, -90], [300, -10], [-1000, 1000]]) {
                const rect = dragCropRect(start, handle, dx, dy, ratio, W, H);
                expect(ratioOf(rect)).toBeCloseTo(ratio, 6);
                expect(inside(rect)).toBe(true);
            }
        }
    });

    it('resizes a corner about the opposite corner', () => {
        const rect = dragCropRect(start, 'se', 80, 0, ratio, W, H);
        expect(rect).toEqual({ x: 200, y: 100, width: 480, height: 360 });
        const nw = dragCropRect(start, 'nw', -80, 0, ratio, W, H);
        expect(nw.x + nw.width).toBe(600);
        expect(nw.y + nw.height).toBe(400);
        expect(nw.width).toBe(480);
    });

    it('resizes an edge about the middle of the opposite edge', () => {
        const rect = dragCropRect(start, 'e', 80, 0, ratio, W, H);
        expect(rect.x).toBe(200);
        expect(rect.width).toBe(480);
        expect(rect.y + rect.height / 2).toBe(250);
        const south = dragCropRect(start, 's', 0, 60, ratio, W, H);
        expect(south.y).toBe(100);
        expect(south.height).toBe(360);
        expect(south.x + south.width / 2).toBe(400);
    });

    it('stops growing at the nearest image edge', () => {
        const rect = dragCropRect(start, 'se', 5000, 5000, ratio, W, H);
        // Height runs out first: 700 px below the top edge.
        expect(rect.height).toBeCloseTo(700);
        expect(rect.width).toBeCloseTo(700 * ratio);
        expect(inside(rect)).toBe(true);
    });

    it('never shrinks below the minimum', () => {
        const rect = dragCropRect(start, 'se', -5000, -5000, ratio, W, H);
        expect(rect.height).toBeGreaterThanOrEqual(MIN_CROP_SIZE - 1e-9);
        expect(ratioOf(rect)).toBeCloseTo(ratio, 6);
    });
});

describe('roundCropRect and isWholeImage', () => {
    it('rounds to whole pixels inside the image', () => {
        expect(roundCropRect({ x: 0.4, y: 799.6, width: 1200.4, height: 3 }, W, H)).toEqual({ x: 0, y: 799, width: 1200, height: 1 });
    });

    it('knows a frame over the whole image is no crop', () => {
        expect(isWholeImage({ x: 0.2, y: 0, width: 1199.9, height: 800 }, W, H)).toBe(true);
        expect(isWholeImage({ x: 0, y: 0, width: 1100, height: 800 }, W, H)).toBe(false);
    });
});

describe('scaleCropRect', () => {
    it('maps a frame on the shown image to the original pixels', () => {
        // Unsplash shows a 1080 px wide copy of a 4320 × 2880 photo.
        expect(scaleCropRect({ x: 270, y: 180, width: 540, height: 360 }, 1080, 720, 4320, 2880))
            .toEqual({ x: 1080, y: 720, width: 2160, height: 1440 });
    });
});

describe('Unsplash crops', () => {
    const raw = 'https://images.unsplash.com/photo-123?ixid=abc&ixlib=rb-4.0.3';

    it('adds rect in whole pixels and keeps the other parameters', () => {
        const url = unsplashCropUrl(raw, { x: 10.4, y: 20, width: 300.6, height: 200 });
        const params = new URL(url).searchParams;
        expect(params.get('rect')).toBe('10,20,301,200');
        expect(params.get('ixid')).toBe('abc');
    });

    it('replaces an earlier crop', () => {
        const once = unsplashCropUrl(raw, { x: 1, y: 2, width: 3, height: 4 });
        const twice = unsplashCropUrl(once, { x: 5, y: 6, width: 7, height: 8 });
        expect(new URL(twice).searchParams.getAll('rect')).toEqual(['5,6,7,8']);
    });

    it('reads a crop back, and ignores anything that is not one', () => {
        expect(unsplashCropOf(unsplashCropUrl(raw, { x: 1, y: 2, width: 3, height: 4 }))).toEqual({ x: 1, y: 2, width: 3, height: 4 });
        expect(unsplashCropOf(raw)).toBeNull();
        expect(unsplashCropOf(`${raw}&rect=1,2,0,4`)).toBeNull();
        expect(unsplashCropOf(`${raw}&rect=a,b,c,d`)).toBeNull();
        expect(unsplashCropOf('not a url')).toBeNull();
    });

    it('keeps the crop in every size a template derives', () => {
        const cropped = unsplashCropUrl(raw, { x: 1000, y: 500, width: 3000, height: 1000 });
        const sizes = imageSizeUrls(cropped, 1200)!;
        for (const url of Object.values(sizes)) {
            expect(new URL(url).searchParams.get('rect')).toBe('1000,500,3000,1000');
        }
        expect(new URL(sizes.s).searchParams.get('w')).toBe('300');
    });
});
