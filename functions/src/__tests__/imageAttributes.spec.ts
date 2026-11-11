/**
 * RF6 6.8: images on a published page get their size, a srcset with the stored sizes,
 * and lazy loading after the first one in the content, at publish time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queries, media } = vi.hoisted(() => ({
    queries: [] as { field: string; values: string[] }[],
    media: [] as Record<string, unknown>[],
}));

vi.mock('../init', () => ({
    db: {
        collection: vi.fn(() => ({
            where: (field: string, _op: string, values: string[]) => ({
                get: async () => {
                    queries.push({ field, values });
                    const size = field.split('.')[1];
                    const docs = media.filter((m) => values.includes((m['variants'] as any)?.[size]?.path));
                    return { docs: docs.map((m) => ({ data: () => m })) };
                },
            }),
        })),
    },
}));

const { addImageAttributes, forgetImageSizes, withImageAttributes } = await import('../pages/image-attributes.js');

const BASE = 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/';
const url = (size: string) => `${BASE}mediaImages%2Fphoto-a1b2-${size}.webp?alt=media&token=t-${size}`;
const PHOTO = {
    variants: {
        s: { url: url('s'), path: 'mediaImages/photo-a1b2-s.webp', width: 300, height: 200 },
        m: { url: url('m'), path: 'mediaImages/photo-a1b2-m.webp', width: 600, height: 400 },
        l: { url: url('l'), path: 'mediaImages/photo-a1b2-l.webp', width: 900, height: 600 },
        xl: { url: url('xl'), path: 'mediaImages/photo-a1b2-xl.webp', width: 1200, height: 800 },
    },
};

const page = (body: string) => `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;
const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

describe('image attributes on published pages', () => {
    beforeEach(() => {
        queries.length = 0;
        media.length = 0;
        media.push(PHOTO);
        forgetImageSizes();
    });

    it('sizes a media library image, offers its stored sizes, and lazy-loads all but the first in <main>', async () => {
        const html = await withImageAttributes(page(
            '<nav><img src="/assets/logo.png" alt="Logo"></nav>'
            + `<main><img src="${url('m').replace(/&/g, '&amp;')}" alt="Cover"><p>Text</p><img src="https://example.com/x.jpg" alt="X"></main>`
            + '<footer><img src="/assets/badge.png" alt=""></footer>',
        ));
        const [logo, cover, other, badge] = imgs(html);

        expect(logo).toBe('<img src="/assets/logo.png" alt="Logo">');
        expect(cover).toContain('width="600" height="400"');
        expect(cover).not.toContain('loading=');
        expect(cover).toContain(`srcset="${url('s').replace(/&/g, '&amp;')} 300w, `);
        expect(cover).toContain(`${url('xl').replace(/&/g, '&amp;')} 1200w"`);
        expect(cover).toContain('sizes="(max-width: 600px) 100vw, 600px"');
        expect(other).toBe('<img src="https://example.com/x.jpg" alt="X" loading="lazy">');
        // Outside <main>: left as written.
        expect(badge).toBe('<img src="/assets/badge.png" alt="">');
        // A height never stretches an image the page's styles narrow.
        expect(html).toContain('<style>:where(img[width][height]){height:auto}</style>\n</head>');
        expect(queries).toEqual([{ field: 'variants.m.path', values: ['mediaImages/photo-a1b2-m.webp'] }]);
    });

    it('keeps what the author wrote: their own size, srcset and loading', () => {
        const images = new Map([['mediaImages/photo-a1b2-m.webp', { width: 600, height: 400, sizes: PHOTO.variants.s ? Object.values(PHOTO.variants) : [] }]]);
        const html = addImageAttributes(page(
            `<img src="${url('m')}" width="320" srcset="a.jpg 1x" loading="eager">`
            + `<img src="${url('m')}" loading="eager" />`,
        ), images);
        const [first, second] = imgs(html);
        expect(first).toBe(`<img src="${url('m')}" width="320" srcset="a.jpg 1x" loading="eager">`);
        expect(second).toContain('loading="eager"');
        expect(second).not.toContain('loading="lazy"');
        expect(second).toMatch(/width="600" height="400" srcset="[^"]+" sizes="[^"]+" \/>$/);
    });

    // M2: a logo whose height the site's CSS sets is never given a width and height.
    it('leaves header, nav and footer images alone, a media library logo included', () => {
        const images = new Map([['mediaImages/photo-a1b2-m.webp', { width: 600, height: 400, sizes: Object.values(PHOTO.variants) }]]);
        const logo = `<img class="logo" style="height:40px" src="${url('m')}" alt="Logo">`;
        for (const body of [
            `<header>${logo}</header><main><p>Hi</p></main>`,
            `<nav>${logo}</nav><img src="${url('m')}" alt="Hero"><footer>${logo}</footer>`,
        ]) {
            const html = addImageAttributes(page(body), images);
            for (const tag of imgs(html).filter((t) => t.includes('Logo'))) expect(tag).toBe(logo);
        }
        // Without <main>, an image outside the header, nav and footer is still sized.
        const hero = imgs(addImageAttributes(page(`<nav>${logo}</nav><img src="${url('m')}" alt="Hero">`), images))[1];
        expect(hero).toContain('width="600" height="400"');
    });

    // M3: without <main>, the first image is most often the logo, so nothing is made lazy.
    it('makes nothing lazy on a page without <main>', () => {
        const html = addImageAttributes(page('<nav><img src="logo.png"></nav><img src="hero.jpg"><img src="b.jpg">'), new Map());
        expect(html).not.toContain('loading=');
        expect(html).not.toContain(':where(img');
    });

    // L4: only the page's own images, read whole.
    it('skips images in scripts, templates and comments, and keeps an alt with ">" in one piece', () => {
        const html = addImageAttributes(page(
            '<main><img src="first.jpg" alt="a > b">'
            + '<script>var s = \'<img src="x.jpg">\';</script>'
            + '<template><img src="t.jpg"></template>'
            + '<!-- <img src="c.jpg"> -->'
            + '<img alt="2 > 1" src="second.jpg"></main>',
        ), new Map());
        expect(html).toContain('<img src="first.jpg" alt="a > b">');
        expect(html).toContain('<script>var s = \'<img src="x.jpg">\';</script>');
        expect(html).toContain('<template><img src="t.jpg"></template>');
        expect(html).toContain('<!-- <img src="c.jpg"> -->');
        expect(html).toContain('<img alt="2 > 1" src="second.jpg" loading="lazy">');
    });

    it('reads each image once, and publishes without sizes when the read fails', async () => {
        await withImageAttributes(page(`<main><img src="${url('m')}"></main>`));
        await withImageAttributes(page(`<main><img src="${url('l')}"></main>`));
        expect(queries).toHaveLength(1);

        forgetImageSizes();
        queries.length = 0;
        media.length = 0;
        media.push({ variants: { m: { path: 'mediaImages/photo-a1b2-m.webp' } } });
        const html = await withImageAttributes(page(`<main><img src="${url('m')}"></main>`));
        expect(imgs(html)[0]).toBe(`<img src="${url('m')}">`);
    });
});
