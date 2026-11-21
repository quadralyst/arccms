/**
 * Showing what can be changed on a Visual Editor's page (the entry's and a page's).
 *
 * - `flash()`: for two seconds every part that can be changed and is in view gets a
 *   moving dashed outline ("marching ants"), then they fade. It runs when the screen
 *   opens and when someone clicks something that cannot be changed. The outlines are
 *   drawn on a layer of their own over the page, so the page's layout never moves
 *   and they cannot be taken for a border of the design. With less motion asked for,
 *   they show and fade without moving.
 * - `setShown(true)`: the top bar's switch, a faint still outline on every part
 *   until it is turned off; remembered for each person (`readShowEditable`).
 * - `explainFixed()`: a click on words or a picture that cannot be changed says so
 *   in a small note by the click, and flashes the parts that can.
 *
 * This runs in the admin document on the frame's document (same origin).
 */

/** How long the moving outlines show before they fade. */
export const FLASH_MS = 2000;
const FADE_MS = 400;
/** How long the note by a click stays. */
export const NOTE_MS = 4500;
/** The page may still be marking its parts: the flash waits this long for the first one. */
const WAIT_TRIES = 12;
const WAIT_STEP_MS = 250;
/** At most this many outlines at once: a long list stays quick. */
const MAX_BOXES = 300;

const STYLE_ATTR = 'data-arc-reveal-style';
const SHOWN_ATTR = 'data-arc-show-edit';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STORE_KEY = 'arc.visualEditor.showEditable';

export interface RevealOptions {
    /** The parts that can be changed. */
    selector: string;
    /** The same parts for the switch's still outline, when a CSS selector must say more (header cards left out). */
    outlineSelector?: string;
    /** A part matched but not changed here. */
    skip?: (el: Element) => boolean;
}

/** The words a note says; `lead` is what the clicked part is, the rest where to look. */
export interface FixedWords {
    lead: string;
    outlined: string;
    scroll: string;
}

/** The layer's styles in the frame: the moving outline, its fade, the note, the switch's still outline. */
export function revealCss(outlineSelector: string): string {
    return `
[data-arc-reveal] { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; opacity: 1; transition: opacity ${FADE_MS}ms ease; }
[data-arc-reveal][data-arc-fading] { opacity: 0; }
[data-arc-reveal] svg { position: absolute; overflow: visible; }
[data-arc-reveal] .arc-reveal-halo { fill: none; stroke: rgba(255,255,255,.85); stroke-width: 4; }
[data-arc-reveal] .arc-reveal-ants { fill: none; stroke: var(--arc-edit-accent, #444); stroke-width: 2; stroke-dasharray: 7 5; animation: arc-reveal-ants .6s linear infinite; }
@keyframes arc-reveal-ants { to { stroke-dashoffset: -12; } }
@media (prefers-reduced-motion: reduce) { [data-arc-reveal] .arc-reveal-ants { animation: none; } }
[data-arc-reveal-note] { position: fixed; z-index: 2147483647; max-width: 280px; padding: 8px 10px; border-radius: 6px; pointer-events: none;
  font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; font-style: normal; letter-spacing: normal; text-transform: none; text-align: left;
  color: #fff; background: #1f2328; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
:where(html[${SHOWN_ATTR}]) :is(${outlineSelector}):not([data-arc-editing]):not(:hover):not(:focus-visible) { outline: 1px dashed var(--arc-edit-accent, #444); outline-offset: 2px; }
`;
}

/** The switch, as this person left it last time; off when it cannot be read. */
export function readShowEditable(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORE_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeShowEditable(on: boolean): void {
    try {
        if (on) globalThis.localStorage?.setItem(STORE_KEY, '1');
        else globalThis.localStorage?.removeItem(STORE_KEY);
    } catch {
        // Not remembered: it still works on this screen.
    }
}

/** Words or a picture under a click, not the empty space of a section around them. */
export function wordsOrMedia(target: Element): boolean {
    if (target.closest('img, svg, picture, video')) return true;
    return Array.from(target.childNodes).some((node) => node.nodeType === 3 && !!(node as Text).data.trim());
}

/** A sentence ends in a full stop (a hint's words may not). */
function sentence(text: string): string {
    const t = text.trim();
    return !t || /[.!?।]$/.test(t) ? t : `${t}.`;
}

export class EditableReveal {
    private layer: HTMLElement | null = null;
    private noteEl: HTMLElement | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    private noteTimer: ReturnType<typeof setTimeout> | null = null;
    private flashing = false;
    private readonly redraw = () => this.draw();
    private readonly dropNote = () => this.hideNote();

    constructor(private readonly doc: Document, private readonly options: RevealOptions) {}

    attach(): void {
        const head = this.doc.head;
        if (head && !head.querySelector(`style[${STYLE_ATTR}]`)) {
            const style = this.doc.createElement('style');
            style.setAttribute(STYLE_ATTR, '');
            style.textContent = revealCss(this.options.outlineSelector ?? this.options.selector);
            head.appendChild(style);
        }
    }

    detach(): void {
        this.endFlash();
        this.hideNote();
        this.doc.head?.querySelector(`style[${STYLE_ATTR}]`)?.remove();
    }

    /** The switch's still outline on every part, or off. */
    setShown(on: boolean): void {
        this.doc.documentElement?.toggleAttribute(SHOWN_ATTR, on);
    }

    get showing(): boolean {
        return this.flashing;
    }

    /** The parts that can be changed, with a box on the page. */
    targets(): HTMLElement[] {
        return Array.from(this.doc.querySelectorAll<HTMLElement>(this.options.selector))
            .filter((el) => !this.options.skip?.(el) && !el.closest('[data-arc-editing]') && (el.getClientRects?.().length ?? 0) > 0);
    }

    /** The parts in the window now. */
    inView(): HTMLElement[] {
        const view = this.view();
        return this.targets().filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < view.height && r.left < view.width;
        });
    }

    /**
     * Two seconds of moving outlines on the parts in view. False while they already
     * show: a second click does not start them again.
     */
    flash(tries = WAIT_TRIES): boolean {
        if (this.flashing) return false;
        this.flashing = true;
        const start = (left: number) => {
            if (!this.flashing) return;
            // The page may still be marking its parts (its content type loading).
            if (!this.targets().length && left > 0) {
                this.timers.push(setTimeout(() => start(left - 1), WAIT_STEP_MS));
                return;
            }
            if (!this.targets().length) {
                this.flashing = false;
                return;
            }
            this.layer = this.doc.createElement('div');
            this.layer.setAttribute('data-arc-reveal', '');
            this.layer.setAttribute('aria-hidden', 'true');
            this.doc.body?.appendChild(this.layer);
            this.draw();
            this.doc.defaultView?.addEventListener('scroll', this.redraw, { passive: true });
            this.doc.defaultView?.addEventListener('resize', this.redraw);
            this.timers.push(setTimeout(() => {
                this.layer?.setAttribute('data-arc-fading', '');
                this.timers.push(setTimeout(() => this.endFlash(), FADE_MS));
            }, FLASH_MS));
        };
        start(tries);
        return true;
    }

    /**
     * A click on something that cannot be changed: a note by the click saying so, and
     * the parts that can, outlined. False when the click was not on words or a picture.
     */
    explainFixed(target: Element, x: number, y: number, words: FixedWords): boolean {
        if (!wordsOrMedia(target)) return false;
        const any = this.targets().length > 0;
        const seen = this.inView().length > 0;
        if (any) this.flash(0);
        const lead = sentence(words.lead);
        this.note(any ? `${lead} ${seen ? words.outlined : words.scroll}` : lead, x, y);
        return true;
    }

    /** A small note by a point of the page, gone after a few seconds or at the next click. */
    note(text: string, x: number, y: number): void {
        this.hideNote();
        const note = this.doc.createElement('div');
        note.setAttribute('data-arc-reveal-note', '');
        note.setAttribute('role', 'status');
        note.textContent = text;
        this.doc.body?.appendChild(note);
        this.noteEl = note;
        const view = this.view();
        const width = Math.min(280, note.offsetWidth || 280);
        const height = note.offsetHeight || 40;
        const left = Math.max(8, Math.min(x - width / 2, view.width - width - 8));
        const below = y + 18;
        const top = below + height > view.height - 8 ? Math.max(8, y - height - 12) : below;
        note.style.left = `${left}px`;
        note.style.top = `${top}px`;
        this.noteTimer = setTimeout(() => this.hideNote(), NOTE_MS);
        // The click that made it is still on its way: the next one puts it away.
        setTimeout(() => {
            if (this.noteEl === note) this.doc.addEventListener('pointerdown', this.dropNote, true);
        }, 0);
    }

    private hideNote(): void {
        if (this.noteTimer) clearTimeout(this.noteTimer);
        this.noteTimer = null;
        this.doc.removeEventListener('pointerdown', this.dropNote, true);
        this.noteEl?.remove();
        this.noteEl = null;
    }

    private view(): { width: number; height: number } {
        const win = this.doc.defaultView;
        return {
            width: this.doc.documentElement?.clientWidth || win?.innerWidth || 0,
            height: this.doc.documentElement?.clientHeight || win?.innerHeight || 0,
        };
    }

    /** The outlines of the parts in view, drawn again as the page scrolls. */
    private draw(): void {
        const layer = this.layer;
        if (!layer) return;
        layer.textContent = '';
        for (const el of this.inView().slice(0, MAX_BOXES)) layer.appendChild(this.box(el));
    }

    private box(el: HTMLElement): SVGSVGElement {
        const r = el.getBoundingClientRect();
        const pad = 3;
        const radius = parseFloat(this.doc.defaultView?.getComputedStyle?.(el).borderTopLeftRadius || '0') || 0;
        const svg = this.doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svg.setAttribute('width', String(Math.round(r.width + pad * 2)));
        svg.setAttribute('height', String(Math.round(r.height + pad * 2)));
        svg.style.left = `${Math.round(r.left - pad)}px`;
        svg.style.top = `${Math.round(r.top - pad)}px`;
        for (const cls of ['arc-reveal-halo', 'arc-reveal-ants']) {
            const rect = this.doc.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('class', cls);
            rect.setAttribute('x', '1');
            rect.setAttribute('y', '1');
            rect.setAttribute('width', String(Math.max(0, Math.round(r.width + pad * 2 - 2))));
            rect.setAttribute('height', String(Math.max(0, Math.round(r.height + pad * 2 - 2))));
            if (radius) rect.setAttribute('rx', String(Math.round(radius + pad)));
            svg.appendChild(rect);
        }
        return svg;
    }

    private endFlash(): void {
        for (const t of this.timers) clearTimeout(t);
        this.timers = [];
        this.doc.defaultView?.removeEventListener('scroll', this.redraw);
        this.doc.defaultView?.removeEventListener('resize', this.redraw);
        this.layer?.remove();
        this.layer = null;
        this.flashing = false;
    }
}
