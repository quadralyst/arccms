/**
 * Where the Visual Editor's small boxes go on the page: Done and Cancel beside the value
 * being typed in (VE-D37) and the row bar (VE-D32). Each has a few places it may go; the
 * first that covers no words on the page wins, so the boxes never sit over the text an
 * editor is reading or typing (review M10). With no place clear, the first is used.
 *
 * Boxes are in the frame's window coordinates.
 */
export interface Box {
    top: number;
    left: number;
    right: number;
    bottom: number;
}

/** A box of a width and height whose right edge is at `right` and top at `top`. */
export function boxAt(right: number, top: number, width: number, height: number): Box {
    return { top, left: right - width, right, bottom: top + height };
}

export function intersects(a: Box, b: Box): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The first place that is in the window and covers nothing, else the first in the window, else the first. */
export function firstClear(places: Box[], view: { width: number; height: number }, covers: (box: Box) => boolean): Box {
    const inView = places.filter((b) => b.top >= 0 && b.left >= 0 && b.right <= view.width && b.bottom <= view.height);
    return inView.find((b) => !covers(b)) ?? inView[0] ?? places[0];
}

/** At most this many text pieces are looked at for one place: a long page stays quick. */
const MAX_TEXTS = 400;

/**
 * Whether a box over the frame's page would cover words: the words of the elements
 * under its corners and middle, each line by its own rectangle, so the empty end of a
 * line or a card's padding is not counted. A document that cannot say covers nothing.
 */
export function coversWords(doc: Document, box: Box): boolean {
    if (typeof doc.elementFromPoint !== 'function' || typeof doc.createRange !== 'function') return false;
    const points: [number, number][] = [
        [box.left + 2, box.top + 2], [box.right - 2, box.top + 2],
        [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2],
        [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
    ];
    const seen = new Set<Element>();
    let looked = 0;
    for (const [x, y] of points) {
        const hit = doc.elementFromPoint(x, y);
        if (!hit || seen.has(hit) || hit === doc.body || hit === doc.documentElement) continue;
        seen.add(hit);
        const walker = doc.createTreeWalker(hit, 4 /* NodeFilter.SHOW_TEXT */);
        for (let node = walker.nextNode(); node && looked < MAX_TEXTS; node = walker.nextNode()) {
            if (!(node as Text).data.trim()) continue;
            looked++;
            const range = doc.createRange();
            range.selectNodeContents(node);
            const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
            if (rects.some((r) => r.width > 0 && intersects(box, r))) return true;
        }
    }
    return false;
}
