import { describe, expect, it } from 'vitest';
import { imageSizeUrls, imageSizeWidths, unsplashAtWidth } from './image-sizes';
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

describe('imageSizeWidths', () => {
    it('quarters the maximum width', () => {
        expect(imageSizeWidths(1200)).toEqual({ s: 300, m: 600, l: 900, xl: 1200 });
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

    it('resizes an Unsplash photo through the CDN', () => {
        const sizes = imageSizeUrls(UNSPLASH, 1200)!;
        expect(sizes.s).toContain('w=300');
        expect(sizes.xl).toContain('w=1200');
        expect(sizes.m).toContain('fm=webp');
        expect(sizes.m).toContain('ixid=xyz');
    });

    it('yields nothing for an image it cannot resize', () => {
        expect(imageSizeUrls('https://example.com/pic.jpg')).toBeNull();
        expect(imageSizeUrls('')).toBeNull();
        expect(imageSizeUrls(42)).toBeNull();
    });

    it('unsplashAtWidth keeps an existing quality', () => {
        expect(unsplashAtWidth('https://images.unsplash.com/photo-1?q=60', 300)).toContain('q=60');
    });

    describe('parity with the Cloud Functions mirror', () => {
        it.each(URLS)('agrees on %s', (_label, url) => {
            expect(imageSizeUrlsServerSide(url)).toEqual(imageSizeUrls(url));
        });
    });
});
