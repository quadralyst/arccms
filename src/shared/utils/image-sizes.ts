/**
 * Image size variants.
 *
 * Every upload through the Media Manager is stored four times, as
 * `<name>-s`, `-m`, `-l` and `-xl`. Each size is a bound on the image's
 * *longest side* — a quarter, half, three-quarters and the whole of the one
 * maximum set in Settings → Misc (1200px by default, so 300 / 600 / 900 /
 * 1200) — so "M" is always "fits in a 600px box" whether the photo is
 * landscape or portrait. The editor picks one size when inserting an image;
 * templates can reach the others through `{{ key_s }}` … `{{ key_xl }}`,
 * derived here from whichever URL is stored.
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

/** Each size as a fraction of the configured maximum (longest side). */
export const IMAGE_SIZE_FRACTIONS: Record<ImageSize, number> = {
    s: 0.25,
    m: 0.5,
    l: 0.75,
    xl: 1,
};

/** The maximum longest side on a new install. */
export const DEFAULT_MAX_IMAGE_SIZE = 1200;

/** The size an editor gets when they do not choose one. */
export const DEFAULT_IMAGE_SIZE: ImageSize = 'm';

export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = {
    s: 'S',
    m: 'M',
    l: 'L',
    xl: 'XL',
};

/**
 * The longest-side limit of each size for a given maximum, largest last.
 * `1200` gives 300 / 600 / 900 / 1200. A missing or unusable maximum means
 * the default.
 */
export function imageSizeLimits(maxSize: unknown = DEFAULT_MAX_IMAGE_SIZE): Record<ImageSize, number> {
    const max = Number(maxSize);
    const bound = Number.isFinite(max) && max >= 1 ? max : DEFAULT_MAX_IMAGE_SIZE;
    const limits = {} as Record<ImageSize, number>;
    for (const size of IMAGE_SIZES) {
        limits[size] = Math.max(1, Math.round(bound * IMAGE_SIZE_FRACTIONS[size]));
    }
    return limits;
}

/**
 * `width × height` scaled down to fit inside a `limit × limit` box, keeping
 * the aspect ratio and never enlarging.
 */
export function fitLongestSide(width: number, height: number, limit: number): { width: number; height: number } {
    const scale = Math.min(1, limit / Math.max(width, height));
    if (scale === 1) return { width, height };
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
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
export function imageSizeUrls(url: unknown, maxSize: number = DEFAULT_MAX_IMAGE_SIZE): Record<ImageSize, string> | null {
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
        const limits = imageSizeLimits(maxSize);
        return mapSizes((size) => unsplashAtSize(url, limits[size]));
    }

    return null;
}

/**
 * An Unsplash URL fitted inside a `limit × limit` box — `w`, `h` and
 * `fit=max` bound the longest side without cropping; `fm=webp` set, the rest
 * kept.
 */
export function unsplashAtSize(url: string, limit: number): string {
    const parsed = new URL(url);
    parsed.searchParams.set('w', String(limit));
    parsed.searchParams.set('h', String(limit));
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
