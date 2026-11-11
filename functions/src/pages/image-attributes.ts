/**
 * Images on a published page, made kinder to load (RF6 6.8): added at publish time to
 * each <img> of the page, never changing what the author wrote.
 *
 * Inside the page's <main> (or, on a page without one, outside its <header>, <nav> and
 * <footer>):
 * - `width` and `height`, from the media library, for an image uploaded through it
 *   (its stored sizes, `media/{id}.variants`), so the page does not jump as it loads.
 *   An image with either one already keeps its own.
 * - `srcset` with every stored size and `sizes`, so a phone downloads a smaller copy.
 *   Only for such an image without a srcset of its own.
 * Header, nav and footer images (a logo with a height from the site's CSS) are left alone.
 *
 * `loading="lazy"` on every image after the first one in <main>: the first is usually
 * above the fold. A page without <main> gets none, since its first image is most often
 * the logo and the hero would load late. An image that says how it loads keeps that.
 *
 * Images inside <script>, <template> and comments are not touched. The page's markup is
 * edited as text, tag by tag, so nothing else on it changes.
  */
import { db } from '../init.js';

const escapeAttr = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One stored size of an upload. */
interface StoredSize {
    url: string;
    path: string;
    width: number;
    height: number;
}

/** What publishing knows about an image: its own size, and every stored size. */
export interface KnownImage {
    width: number;
    height: number;
    sizes: StoredSize[];
}

const SIZE_KEYS = ['s', 'm', 'l', 'xl'] as const;
/** A sized upload's file name ends in its size: photo-a1b2c3-m.webp. */
const SIZED_PATH = /-(s|m|l|xl)\.[a-z0-9]+$/i;
/** Firestore's `in` takes at most 30 values. */
const IN_LIMIT = 30;

/** Stays for as long as the function instance: a stored size never changes its file. */
const known = new Map<string, KnownImage>();

/** The Storage path inside a Firebase download URL, or null. */
export function storagePathOf(url: string): string | null {
    const match = /\/o\/([^?#"'\s<>]+)/.exec(url);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

/** An <img> tag, a `>` inside a quoted value included. */
const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
/** One attribute of a tag: its name, and its value in double, single or no quotes. */
const ATTRIBUTE = /\s([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** A tag's attributes by lower-case name; a value's own text never counts as one. */
function attributesOf(tag: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const match of tag.replace(/^<img\b/i, '').replace(/\/?>$/, '').matchAll(ATTRIBUTE)) {
        found.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    return found;
}

/** Adds attributes before the tag's end, keeping a self-closing slash. */
function withAttrs(tag: string, attrs: string[]): string {
    if (!attrs.length) return tag;
    const end = /\s*\/?>$/.exec(tag)!;
    return `${tag.slice(0, end.index)} ${attrs.join(' ')}${end[0]}`;
}

function storedSizes(variants: unknown): StoredSize[] {
    if (!variants || typeof variants !== 'object') return [];
    return SIZE_KEYS
        .map((key) => (variants as Record<string, unknown>)[key] as Partial<StoredSize> | undefined)
        .filter((v): v is StoredSize => !!v && typeof v.url === 'string' && typeof v.path === 'string'
            && Number.isFinite(v.width) && Number.isFinite(v.height) && v.width! > 0 && v.height! > 0);
}

/**
 * The media library's sizes for these Storage paths, by path. Looked up by the size
 * each path names (`variants.m.path`), a few at a time; a failed read leaves the
 * images as they are.
 */
export async function lookUpImages(paths: string[]): Promise<Map<string, KnownImage>> {
    const found = new Map<string, KnownImage>();
    const bySize = new Map<string, string[]>();
    for (const path of new Set(paths)) {
        const hit = known.get(path);
        if (hit) { found.set(path, hit); continue; }
        const size = SIZED_PATH.exec(path)?.[1]?.toLowerCase();
        if (!size) continue;
        bySize.set(size, [...(bySize.get(size) ?? []), path]);
    }
    for (const [size, wanted] of bySize) {
        for (let i = 0; i < wanted.length; i += IN_LIMIT) {
            try {
                const snap = await db.collection('media').where(`variants.${size}.path`, 'in', wanted.slice(i, i + IN_LIMIT)).get();
                for (const doc of snap.docs) {
                    const sizes = storedSizes(doc.data()?.['variants']);
                    for (const stored of sizes) {
                        const image = { width: stored.width, height: stored.height, sizes };
                        known.set(stored.path, image);
                        if (wanted.includes(stored.path)) found.set(stored.path, image);
                    }
                }
            } catch (error) {
                console.warn(`Image sizes could not be read for ${wanted.length} image(s); they are published without them.`, error);
            }
        }
    }
    return found;
}

type Range = [number, number];

/** Where each element of these names starts and ends (the first close after each open). */
function rangesOf(html: string, names: string[]): Range[] {
    const ranges: Range[] = [];
    for (const name of names) {
        const open = new RegExp(`<${name}\\b`, 'gi');
        for (let match = open.exec(html); match; match = open.exec(html)) {
            const close = html.toLowerCase().indexOf(`</${name}>`, match.index);
            const end = close === -1 ? html.length : close + name.length + 3;
            ranges.push([match.index, end]);
            open.lastIndex = end;
        }
    }
    return ranges;
}

/** Comments, scripts and templates: text that is not the page's own images. */
function hiddenRanges(html: string): Range[] {
    const ranges = rangesOf(html, ['script', 'template']);
    const comment = /<!--[\s\S]*?(?:-->|$)/g;
    for (let match = comment.exec(html); match; match = comment.exec(html)) ranges.push([match.index, match.index + match[0].length]);
    return ranges;
}

const inside = (offset: number, ranges: Range[]) => ranges.some(([from, to]) => offset >= from && offset < to);

/** The images publishing may change: the tags and where each is. */
function imagesOf(html: string): { tag: string; offset: number }[] {
    const hidden = hiddenRanges(html);
    return [...html.matchAll(IMG_TAG)]
        .filter((match) => !inside(match.index!, hidden))
        .map((match) => ({ tag: match[0], offset: match.index! }));
}

/**
 * The page with its images' attributes added (see the top of this file). Pure: the
 * sizes come from `images`, by Storage path.
 */
export function addImageAttributes(html: string, images: Map<string, KnownImage>): string {
    const hidden = hiddenRanges(html);
    const main = rangesOf(html, ['main']).filter(([from]) => !inside(from, hidden));
    // Images that may be sized: in <main>, or, without one, outside the header, nav and footer.
    const chrome = main.length ? [] : rangesOf(html, ['header', 'nav', 'footer']);
    const sizable = (offset: number) => (main.length ? inside(offset, main) : !inside(offset, chrome));
    let firstInMain = true;
    let sized = false;
    const out = html.replace(IMG_TAG, (tag: string, offset: number) => {
        if (inside(offset, hidden)) return tag;
        const attrs = attributesOf(tag);
        const add: string[] = [];
        if (main.length && inside(offset, main)) {
            if (!firstInMain && !attrs.has('loading')) add.push('loading="lazy"');
            firstInMain = false;
        }
        const path = attrs.get('src') ? storagePathOf(attrs.get('src')!) : null;
        const image = path && sizable(offset) ? images.get(path) : undefined;
        if (image) {
            if (!attrs.has('width') && !attrs.has('height')) {
                add.push(`width="${image.width}"`, `height="${image.height}"`);
                sized = true;
            }
            const widths = new Set(image.sizes.map((s) => s.width));
            if (!attrs.has('srcset') && widths.size > 1) {
                const set = [...image.sizes].sort((a, b) => a.width - b.width)
                    .filter((s, i, all) => i === 0 || s.width !== all[i - 1].width)
                    .map((s) => `${s.url} ${s.width}w`).join(', ');
                add.push(`srcset="${escapeAttr(set)}"`);
                if (!attrs.has('sizes')) add.push(`sizes="(max-width: ${image.width}px) 100vw, ${image.width}px"`);
            }
        }
        return withAttrs(tag, add);
    });
    // The height an image now says must not stretch it where the page's styles narrow
    // it: height follows the width, unless a style of the page's own sets one.
    if (!sized) return out;
    const style = '<style>:where(img[width][height]){height:auto}</style>';
    return /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${style}\n</head>`) : out;
}

/** The page with its images' attributes added, their sizes read from the media library. */
export async function withImageAttributes(html: string): Promise<string> {
    const paths: string[] = [];
    for (const { tag } of imagesOf(html)) {
        const src = attributesOf(tag).get('src');
        const path = src ? storagePathOf(src) : null;
        if (path) paths.push(path);
    }
    const images = paths.length ? await lookUpImages(paths) : new Map<string, KnownImage>();
    return addImageAttributes(html, images);
}

/** For the tests: forget what was read. */
export function forgetImageSizes(): void {
    known.clear();
}
