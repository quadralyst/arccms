/**
 * Image size variants.
 *
 * Every upload through the Media Manager is stored four times, as
 * `<name>-s`, `-m`, `-l` and `-xl` — a quarter, half, three-quarters and the
 * whole of the configured maximum width (1200px by default). The editor picks
 * one size when inserting an image; templates can reach the others through
 * `{{ key_s }}` … `{{ key_xl }}`, derived here from whichever URL is stored.
 *
 * Deriving rather than storing keeps content documents unchanged: a cover
 * image is still one URL. The derivation works because media storage is
 * publicly readable, so a sibling URL needs no download token — the stored
 * URL's token is dropped and `alt=media` kept.
 *
 * Source of truth; functions/src/shared/image-sizes.ts is a mirror for the
 * Cloud Functions build, which cannot import from src/. A parity spec keeps
 * them agreeing.
 */

export const IMAGE_SIZES = ['s', 'm', 'l', 'xl'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Each size as a fraction of the configured maximum width. */
export const IMAGE_SIZE_FRACTIONS: Record<ImageSize, number> = {
    s: 0.25,
    m: 0.5,
    l: 0.75,
    xl: 1,
};

/** The size an editor gets when they do not choose one. */
export const DEFAULT_IMAGE_SIZE: ImageSize = 'm';

export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = {
    s: 'S',
    m: 'M',
    l: 'L',
    xl: 'XL',
};

/**
 * Target width of each size for a given maximum width, largest first.
 * `1200` gives 300 / 600 / 900 / 1200.
 */
export function imageSizeWidths(maxWidth: number): Record<ImageSize, number> {
    const widths = {} as Record<ImageSize, number>;
    for (const size of IMAGE_SIZES) {
        widths[size] = Math.max(1, Math.round(maxWidth * IMAGE_SIZE_FRACTIONS[size]));
    }
    return widths;
}

/**
 * A Firebase Storage download URL of a sized upload:
 *   …/o/mediaImages%2Fphoto-a1b2c3-m.webp?alt=media&token=…
 * Group 1 is everything up to the size suffix, 2 the suffix, 3 the extension.
 */
const STORAGE_VARIANT = /^(.*\/o\/mediaImages%2F[^?#]*?)-(s|m|l|xl)(\.[a-z0-9]+)(?:\?[^#]*)?$/i;

/** A media upload from before sizes existed — one file, no suffix. */
const STORAGE_LEGACY = /^.*\/o\/mediaImages%2F[^?#]+(?:\?[^#]*)?$/i;

/** An Unsplash photo URL; imgix's `w=` parameter resizes it on the fly. */
const UNSPLASH = /^https:\/\/images\.unsplash\.com\//i;

/**
 * The same image at every size, from any one of its URLs.
 *
 * - A sized upload swaps the suffix and drops the per-file token.
 * - A legacy upload has one file, so every size is that file.
 * - An Unsplash photo is resized by the CDN.
 * - Anything else — a pasted external URL — is not an image this CMS can
 *   resize, and yields null so no bindings are added.
 */
export function imageSizeUrls(url: unknown, maxWidth = 1200): Record<ImageSize, string> | null {
    if (typeof url !== 'string' || !url) return null;

    const sized = STORAGE_VARIANT.exec(url);
    if (sized) {
        const [, base, , ext] = sized;
        return mapSizes((size) => `${base}-${size}${ext}?alt=media`);
    }

    if (STORAGE_LEGACY.test(url)) {
        return mapSizes(() => url);
    }

    if (UNSPLASH.test(url)) {
        const widths = imageSizeWidths(maxWidth);
        return mapSizes((size) => unsplashAtWidth(url, widths[size]));
    }

    return null;
}

/** An Unsplash URL resized to `width` — `w`, `fit=max` and `fm=webp` set, the rest kept. */
export function unsplashAtWidth(url: string, width: number): string {
    const parsed = new URL(url);
    parsed.searchParams.set('w', String(width));
    parsed.searchParams.set('fit', 'max');
    parsed.searchParams.set('fm', 'webp');
    parsed.searchParams.set('q', parsed.searchParams.get('q') || '80');
    return parsed.toString();
}

function mapSizes(fn: (size: ImageSize) => string): Record<ImageSize, string> {
    const result = {} as Record<ImageSize, string>;
    for (const size of IMAGE_SIZES) result[size] = fn(size);
    return result;
}
