import { describe, expect, it } from 'vitest';
import { inScreenshot } from './screenshot';

function box(el: Element, top: number, height = 50, left = 0, width = 100) {
    el.getBoundingClientRect = () => ({ top, bottom: top + height, left, right: left + width, width, height } as DOMRect);
    return el;
}

describe('inScreenshot', () => {
    it('keeps what is in view and leaves out what is not', () => {
        expect(inScreenshot(box(document.createElement('div'), 100), 400, 800)).toBe(true);
        expect(inScreenshot(box(document.createElement('div'), 900), 400, 800)).toBe(false);
        expect(inScreenshot(box(document.createElement('div'), -200), 400, 800)).toBe(false);
    });

    it('leaves out the feedback panel and images that have not loaded', () => {
        const panel = box(document.createElement('section'), 100);
        panel.setAttribute('data-feedback-ignore', '');
        expect(inScreenshot(panel, 400, 800)).toBe(false);

        const lazy = box(document.createElement('img'), 100) as HTMLImageElement;
        Object.defineProperty(lazy, 'complete', { value: false });
        expect(inScreenshot(lazy, 400, 800)).toBe(false);
    });

    it('keeps text and wrappers with no size of their own', () => {
        expect(inScreenshot(document.createTextNode('hi'), 400, 800)).toBe(true);
        expect(inScreenshot(box(document.createElement('span'), 0, 0, 0, 0), 400, 800)).toBe(true);
    });
});
