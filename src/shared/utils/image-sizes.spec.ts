import { describe, expect, it } from 'vitest';
import { fitLongestSide, imageSizeLimits, imageSizeUrls, unsplashAtSize } from './image-sizes';
import { imageSizeUrls as imageSizeUrlsServerSide } from '../../../functions/src/shared/image-sizes';

const BUCKET = 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/';
const SIZED = `${BUCKET}mediaImages%2Fteam-photo-a1b2c3-m.webp?alt=media&token=abc-123`;
const LEGACY = `${BUCKET}mediaImages%2Fteam-photo-a1b2c3.jpg?alt=media&token=abc-123`;
const UNSPLASH = 'https://images.unsplash.com/photo-1?ixid=xyz&q=80';

const URLS: [string, string][] = [
    ['a sized upload', SIZED],
    ['a legacy upload', LEGACY],
    ['an Unsplash photo', UNSPLASH],
    ['an external image', 'https://example.com/pic.jpg'],
    ['a sized upload without a token', `${BUCKET}mediaImages%2Fx-s.webp?alt=media`],
];

describe('imageSizeLimits', () => {
    it('defaults to 300 / 600 / 900 / 1200', () => {
        expect(imageSizeLimits()).toEqual({ s: 300, m: 600, l: 900, xl: 1200 });
    });

    it('quarters whatever maximum is set', () => {
        expect(imageSizeLimits(1600)).toEqual({ s: 400, m: 800, l: 1200, xl: 1600 });
        expect(imageSizeLimits('1000')).toEqual({ s: 250, m: 500, l: 750, xl: 1000 });
    });

    it('falls back to the default for an unusable maximum', () => {
        expect(imageSizeLimits(0)).toEqual({ s: 300, m: 600, l: 900, xl: 1200 });
        expect(imageSizeLimits('abc')).toEqual({ s: 300, m: 600, l: 900, xl: 1200 });
    });
});

describe('fitLongestSide', () => {
    it('bounds the longest side whichever way the image faces', () => {
        expect(fitLongestSide(1440, 1080, 1200)).toEqual({ width: 1200, height: 900 });
        expect(fitLongestSide(1080, 1440, 1200)).toEqual({ width: 900, height: 1200 });
        expect(fitLongestSide(3000, 3000, 600)).toEqual({ width: 600, height: 600 });
    });

    it('never enlarges', () => {
        expect(fitLongestSide(500, 300, 1200)).toEqual({ width: 500, height: 300 });
    });
});

describe('imageSizeUrls', () => {
    it('swaps the suffix of a sized upload and drops the token', () => {
        expect(imageSizeUrls(SIZED)).toEqual({
            s: `${BUCKET}mediaImages%2Fteam-photo-a1b2c3-s.webp?alt=media`,
            m: `${BUCKET}mediaImages%2Fteam-photo-a1b2c3-m.webp?alt=media`,
            l: `${BUCKET}mediaImages%2Fteam-photo-a1b2c3-l.webp?alt=media`,
            xl: `${BUCKET}mediaImages%2Fteam-photo-a1b2c3-xl.webp?alt=media`,
        });
    });

    it('does not mistake a name ending in -s for a size', () => {
        // "photos" ends in "s" but has no hyphen before it: one legacy file.
        const url = `${BUCKET}mediaImages%2Fphotos.jpg?alt=media`;
        expect(imageSizeUrls(url)?.xl).toBe(url);
    });

    it('serves a legacy upload at every size', () => {
        const sizes = imageSizeUrls(LEGACY)!;
        expect(sizes.s).toBe(LEGACY);
        expect(sizes.xl).toBe(LEGACY);
    });

    it('resizes an Unsplash photo through the CDN, bounding both sides', () => {
        const sizes = imageSizeUrls(UNSPLASH)!;
        expect(sizes.s).toContain('w=300');
        expect(sizes.s).toContain('h=300');
        expect(sizes.xl).toContain('w=1200');
        expect(sizes.m).toContain('fit=max');
        expect(sizes.m).toContain('fm=webp');
        expect(sizes.m).toContain('ixid=xyz');
    });

    it('uses the maximum it is given for an Unsplash photo', () => {
        const sizes = imageSizeUrls(UNSPLASH, 1600)!;
        expect(sizes.s).toContain('w=400');
        expect(sizes.xl).toContain('w=1600');
    });

    it('yields nothing for an image it cannot resize', () => {
        expect(imageSizeUrls('https://example.com/pic.jpg')).toBeNull();
        expect(imageSizeUrls('')).toBeNull();
        expect(imageSizeUrls(42)).toBeNull();
    });

    it('unsplashAtSize keeps an existing quality', () => {
        expect(unsplashAtSize('https://images.unsplash.com/photo-1?q=60', 300)).toContain('q=60');
    });

    describe('parity with the Cloud Functions mirror', () => {
        it.each(URLS)('agrees on %s', (_label, url) => {
            expect(imageSizeUrlsServerSide(url)).toEqual(imageSizeUrls(url));
        });
    });
});
