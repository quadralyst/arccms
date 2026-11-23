/**
 * What can be changed on a Visual Editor's page: two seconds of moving outlines, the
 * top bar's still outline, and the note on a click that changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditableReveal, FLASH_MS, NOTE_MS, readShowEditable, revealCss, wordsOrMedia, writeShowEditable } from './editable-reveal';

const words = { lead: 'Worked out by the site', outlined: 'The outlined parts can be changed.', scroll: 'Scroll to find the parts you can change.' };

/** jsdom draws no layout: each element gets a box, in view unless it says otherwise. */
function boxes(map: Map<Element, { top: number; height?: number }>): void {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
        return (map.has(this) ? [{}] : []) as unknown as DOMRectList;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const at = map.get(this);
        const top = at?.top ?? 0;
        const height = at ? at.height ?? 20 : 0;
        return { top, left: 10, right: 210, bottom: top + height, width: at ? 200 : 0, height, x: 10, y: top, toJSON: () => ({}) } as DOMRect;
    });
}

describe('EditableReveal', () => {
    let reveal: EditableReveal;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <h1 id="title" data-arc-edit-kind="text">Title</h1>
            <p id="fixed">Words the design fixes</p>
            <p id="far" data-arc-edit-kind="text">Further down</p>
            <section id="empty"><p>inner</p></section>`;
        reveal = new EditableReveal(document, { selector: '[data-arc-edit-kind]' });
        reveal.attach();
    });

    afterEach(() => {
        reveal.detach();
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
        document.documentElement.removeAttribute('data-arc-show-edit');
    });

    it('outlines the parts in view for two seconds on a layer of its own, then fades and goes', () => {
        boxes(new Map([[document.getElementById('title')!, { top: 10 }], [document.getElementById('far')!, { top: 5000 }]]));
        expect(reveal.flash()).toBe(true);
        const layer = document.querySelector('[data-arc-reveal]')!;
        expect(layer.getAttribute('aria-hidden')).toBe('true');
        // Only the part in the window; the one further down is not drawn.
        expect(layer.querySelectorAll('svg')).toHaveLength(1);
        expect(layer.querySelectorAll('rect.arc-reveal-ants')).toHaveLength(1);
        // A second flash while it shows does not start it again.
        expect(reveal.flash()).toBe(false);
        vi.advanceTimersByTime(FLASH_MS);
        expect(layer.hasAttribute('data-arc-fading')).toBe(true);
        vi.advanceTimersByTime(500);
        expect(document.querySelector('[data-arc-reveal]')).toBeNull();
        expect(reveal.showing).toBe(false);
    });

    it('follows a part that moves while the outlines show, a font arriving or a section sliding up', () => {
        const title = document.getElementById('title')!;
        const at = { top: 300 };
        boxes(new Map([[title, at]]));
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
        reveal.flash();
        const svg = document.querySelector('[data-arc-reveal] svg') as SVGSVGElement;
        expect(svg.style.top).toBe('297px');
        // The section slides up into place: the next frame moves the same outline with it.
        at.top = 120;
        frames.shift()!(0);
        expect(document.querySelector('[data-arc-reveal] svg')).toBe(svg);
        expect(svg.style.top).toBe('117px');
    });

    it('waits for the page\'s fonts before outlining, but never long', async () => {
        boxes(new Map([[document.getElementById('title')!, { top: 10 }]]));
        let arrive!: () => void;
        const ready = new Promise<void>((resolve) => { arrive = resolve; });
        Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready } });
        try {
            reveal.flash();
            expect(document.querySelector('[data-arc-reveal]')).toBeNull();
            arrive();
            await ready;
            await Promise.resolve();
            expect(document.querySelectorAll('[data-arc-reveal] svg')).toHaveLength(1);
            reveal.detach();
            // A font that never arrives holds the outlines back a second at most.
            Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready: new Promise(() => undefined) } });
            reveal.attach();
            reveal.flash();
            expect(document.querySelector('[data-arc-reveal]')).toBeNull();
            vi.advanceTimersByTime(1000);
            expect(document.querySelectorAll('[data-arc-reveal] svg')).toHaveLength(1);
        } finally {
            delete (document as any).fonts;
        }
    });

    it('waits for the page to mark its parts before outlining them', () => {
        boxes(new Map());
        reveal.flash();
        expect(document.querySelector('[data-arc-reveal]')).toBeNull();
        boxes(new Map([[document.getElementById('title')!, { top: 10 }]]));
        vi.advanceTimersByTime(300);
        expect(document.querySelectorAll('[data-arc-reveal] svg')).toHaveLength(1);
    });

    it('moves the outline unless less motion is asked for, and keeps the switch outline still', () => {
        const css = revealCss('[data-arc-edit-kind]');
        expect(css).toContain('animation: arc-reveal-ants');
        expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none/);
        expect(css).toContain(':where(html[data-arc-show-edit]) :is([data-arc-edit-kind]):not([data-arc-editing]):not(:hover):not(:focus-visible)');
        reveal.setShown(true);
        expect(document.documentElement.hasAttribute('data-arc-show-edit')).toBe(true);
        reveal.setShown(false);
        expect(document.documentElement.hasAttribute('data-arc-show-edit')).toBe(false);
    });

    it('says a fixed part cannot be changed, points to the outlines and shows them', () => {
        boxes(new Map([[document.getElementById('title')!, { top: 10 }]]));
        expect(reveal.explainFixed(document.getElementById('fixed')!, 100, 100, words)).toBe(true);
        const note = document.querySelector('[data-arc-reveal-note]')!;
        expect(note.getAttribute('role')).toBe('status');
        expect(note.textContent).toBe('Worked out by the site. The outlined parts can be changed.');
        expect(document.querySelector('[data-arc-reveal]')).not.toBeNull();
        vi.advanceTimersByTime(NOTE_MS);
        expect(document.querySelector('[data-arc-reveal-note]')).toBeNull();
    });

    it('asks to scroll when no part that can be changed is in view, and says only what it is with none at all', () => {
        boxes(new Map([[document.getElementById('far')!, { top: 5000 }]]));
        reveal.explainFixed(document.getElementById('fixed')!, 100, 100, words);
        expect(document.querySelector('[data-arc-reveal-note]')!.textContent).toBe('Worked out by the site. Scroll to find the parts you can change.');
        boxes(new Map());
        reveal.explainFixed(document.getElementById('fixed')!, 100, 100, words);
        expect(document.querySelector('[data-arc-reveal-note]')!.textContent).toBe('Worked out by the site.');
    });

    it('says nothing for a click on empty space around the words', () => {
        boxes(new Map([[document.getElementById('title')!, { top: 10 }]]));
        expect(reveal.explainFixed(document.getElementById('empty')!, 5, 5, words)).toBe(false);
        expect(document.querySelector('[data-arc-reveal-note]')).toBeNull();
        expect(wordsOrMedia(document.getElementById('fixed')!)).toBe(true);
    });

    it('puts the note away at the next click', () => {
        boxes(new Map([[document.getElementById('title')!, { top: 10 }]]));
        reveal.explainFixed(document.getElementById('fixed')!, 100, 100, words);
        vi.advanceTimersByTime(1);
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(document.querySelector('[data-arc-reveal-note]')).toBeNull();
    });
});

describe('the switch is remembered for each person', () => {
    afterEach(() => localStorage.clear());

    it('reads back what was written, off by default', () => {
        expect(readShowEditable()).toBe(false);
        writeShowEditable(true);
        expect(readShowEditable()).toBe(true);
        writeShowEditable(false);
        expect(readShowEditable()).toBe(false);
    });
});
