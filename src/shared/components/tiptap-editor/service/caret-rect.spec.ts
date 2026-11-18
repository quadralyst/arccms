/**
 * Caret menus for an editor inside the edit-on-page screen's frame
 * (specs/visual-editing-spec.md, VE3.2 build note, fix 2): the menu is drawn in
 * the admin's document, so the frame's place is added to the caret's box.
 */
import { describe, expect, it } from 'vitest';
import { caretRect, toHostBox } from './caret-rect';

describe('caret menus', () => {
    const box = { top: 10, bottom: 30, left: 40, right: 40 };

    it('leaves a caret in the admin document where it is', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        expect(toHostBox(el, box)).toEqual(box);
        el.remove();
    });

    it('moves a caret in a frame by the frame\'s place on the screen', () => {
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        frame.getBoundingClientRect = () => ({ top: 100, left: 200 }) as DOMRect;
        const el = frame.contentDocument!.createElement('div');
        frame.contentDocument!.body.appendChild(el);
        expect(toHostBox(el, box)).toEqual({ top: 110, bottom: 130, left: 240, right: 240 });
        const rect = caretRect(el, box);
        expect([rect.x, rect.y, rect.width, rect.height]).toEqual([240, 110, 0, 0]);
        frame.remove();
    });
});
