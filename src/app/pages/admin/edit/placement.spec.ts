/**
 * Where Done and Cancel and the row bar go (review M10): the first place in the window
 * that covers no words on the page.
 */
import { describe, expect, it } from 'vitest';
import { boxAt, coversWords, firstClear, intersects } from './placement';

describe('placement', () => {
    it('measures a box from its right edge', () => {
        expect(boxAt(200, 10, 50, 20)).toEqual({ top: 10, left: 150, right: 200, bottom: 30 });
    });

    it('tells boxes that overlap from boxes that only touch', () => {
        const a = { top: 0, left: 0, right: 10, bottom: 10 };
        expect(intersects(a, { top: 5, left: 5, right: 15, bottom: 15 })).toBe(true);
        expect(intersects(a, { top: 10, left: 0, right: 10, bottom: 20 })).toBe(false);
    });

    it('takes the first place in the window that covers nothing, else the first in the window', () => {
        const view = { width: 100, height: 100 };
        const below = boxAt(90, 50, 40, 20);
        const above = boxAt(90, 10, 40, 20);
        const offTop = boxAt(90, -5, 40, 20);
        expect(firstClear([below, above], view, (b) => b === below)).toBe(above);
        expect(firstClear([below, above], view, () => true)).toBe(below);
        expect(firstClear([offTop, above], view, () => false)).toBe(above);
        expect(firstClear([offTop], view, () => false)).toBe(offTop);
    });

    it('counts only the words under the box, line by line, not the empty end of a line', () => {
        document.body.innerHTML = '<p id="p">Some words</p>';
        const p = document.getElementById('p')!;
        const doc = document as Document & { elementFromPoint: unknown };
        const realRange = document.createRange.bind(document);
        doc.elementFromPoint = () => p;
        (document as Document & { createRange: () => Range }).createRange = () => {
            const range = realRange();
            (range as Range & { getClientRects: () => DOMRect[] }).getClientRects = () => [{ top: 0, left: 0, right: 80, bottom: 16, width: 80, height: 16 } as DOMRect];
            return range;
        };
        try {
            expect(coversWords(document, { top: 4, left: 60, right: 120, bottom: 20 })).toBe(true);
            expect(coversWords(document, { top: 4, left: 100, right: 160, bottom: 20 })).toBe(false);
        } finally {
            (document as Document & { createRange: () => Range }).createRange = realRange;
            delete (doc as { elementFromPoint?: unknown }).elementFromPoint;
            document.body.innerHTML = '';
        }
    });
});
