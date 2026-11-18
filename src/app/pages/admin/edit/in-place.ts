/**
 * Editing in place on the edit-on-page screen (specs/visual-editing-spec.md, VE-D16).
 *
 * The page in the frame carries the renderer's field marks (`data-arc-field`,
 * VE-D7). Each mark the editor can change becomes a spot:
 *
 * - text: a text field, the title or the summary, typed in place as plain text;
 * - rich: the body or a rich text field, the TipTap editor mounted on the element;
 * - image: the cover or an image field, the media picker with Replace and Remove;
 * - popover: number, date, dropdown, radio, checkbox, yes/no, colour, icon, file,
 *   and a value in an attribute (`href="{{ link }}"`), the form editor's own
 *   control in a small box on the element;
 * - panel: anything else the editor fills (tags, author, rows of a repeating
 *   field): the Page settings panel, opened on the field.
 *
 * Values the site works out (dates, related entries) are not spots. Tab moves
 * between spots in page order, Enter opens a spot that has the focus, and
 * Escape leaves a spot. While a spot is typed in, the page is not redrawn under
 * the cursor; it is when the spot is left.
 *
 * This runs in the admin document on the frame's document (same origin).
 */
import { resolvePreviewField } from '../../../core/preview/preview-channel';
import { ContentType } from '../contents/content-types/content-types.model';

export type SpotKind = 'text' | 'rich' | 'image' | 'popover' | 'panel';

/** What a marked element on the page edits. */
export interface SpotInfo {
    /** The key the renderer marked. */
    key: string;
    /** The editor's field: a built-in name or a custom field's key. */
    field: string;
    builtin: boolean;
    kind: SpotKind;
    /** The attribute the value is in, '' for the element's content. */
    attr: string;
    /** The row of a repeating field, or null. */
    row: number | null;
}

export interface Spot extends SpotInfo {
    el: HTMLElement;
}

/** Custom field types edited in a popover on the element. */
const POPOVER_TYPES = new Set(['number', 'date', 'datetime', 'dropdown', 'radio', 'checkbox', 'boolean', 'color', 'icon', 'file']);
/** Image attributes: a click there picks an image. */
const IMAGE_ATTRS = new Set(['', 'src', 'srcset', 'href', 'style', 'content', 'data-src', 'poster']);

/** Plain text built-ins, typed in place. */
const TEXT_BUILTINS = new Set(['title', 'summary']);

/**
 * What a marked element edits, or null when it is a value the site works out,
 * or one with no sense in place (the title inside an attribute).
 */
export function spotInfo(el: Element, type: ContentType | null): SpotInfo | null {
    const key = el.getAttribute('data-arc-field') || '';
    const resolved = resolvePreviewField(key, type);
    if (!resolved || !type) return null;
    const attr = (el.getAttribute('data-arc-field-attr') || '').toLowerCase();
    const rowAttr = el.getAttribute('data-arc-row');
    const row = rowAttr !== null && /^\d+$/.test(rowAttr) ? Number(rowAttr) : null;
    const field = resolved.field;
    const base = { key, field, builtin: resolved.builtin, attr, row };
    // The marked key is the field itself, not a value made from it (`price_formatted`).
    const exact = key === field || field === `${type.slug}-${key}` || field === `${type.slug}_${key}`;
    if (row !== null) return { ...base, kind: 'panel' };

    if (resolved.builtin) {
        if (TEXT_BUILTINS.has(field)) return !attr && exact ? { ...base, kind: 'text' } : null;
        if (field === 'content') return !attr && exact ? { ...base, kind: 'rich' } : null;
        if (field === 'coverImage') return IMAGE_ATTRS.has(attr) ? { ...base, kind: 'image' } : null;
        return { ...base, kind: 'panel' };
    }

    const def = (type.fields || []).find((f) => f.key === field);
    if (!def) return null;
    switch (def.type) {
        case 'text':
            return { ...base, kind: !attr && exact ? 'text' : 'popover' };
        case 'richtext':
            return { ...base, kind: !attr && exact ? 'rich' : 'panel' };
        case 'image':
            return { ...base, kind: 'image' };
        default:
            return { ...base, kind: POPOVER_TYPES.has(def.type) ? 'popover' : 'panel' };
    }
}

/** What the screen does for the spots: the draft's values and the boxes in the admin document. */
export interface InPlaceHost {
    type(): ContentType | null;
    /** A field's value as the draft holds it, in the language on screen. */
    value(field: string): unknown;
    /** Writes a typed value into the draft, as the form editor does. */
    setText(field: string, value: string): void;
    setRich(field: string, html: string): void;
    /** While a spot is typed in, the page is not redrawn. */
    hold(on: boolean): void;
    /** Mounts the rich text editor on the element with the field's HTML. */
    mountRich(el: HTMLElement, html: string, onChange: (html: string) => void): RichHandle;
    image(spot: Spot): void;
    popover(spot: Spot): void;
    panel(spot: Spot): void;
    /** The spot being edited changed (null: none), for the strip's formatting buttons. */
    activeChanged(spot: Spot | null, rich: RichHandle | null): void;
}

export interface RichHandle {
    /** Takes the cursor: where the spot was clicked, else at its start. */
    focus(at?: { x: number; y: number }): void;
    destroy(): void;
}

/** The styles the frame gets: spots outlined on hover, the one edited, the one with the focus. */
export const IN_PLACE_CSS = `
[data-arc-edit-kind] { cursor: pointer; }
[data-arc-edit-kind="text"], [data-arc-edit-kind="rich"] { cursor: text; }
[data-arc-edit-kind]:hover { outline: 2px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-editing], [data-arc-editing]:hover { outline: 2px solid var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-edit-kind]:focus-visible { outline: 3px solid var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-pv-highlight] { outline: 3px solid var(--arc-edit-accent) !important; outline-offset: 2px; }
.ProseMirror { white-space: pre-wrap; word-wrap: break-word; outline: none; }
.ProseMirror [contenteditable="false"] { white-space: normal; }
`;

const STYLE_ID = 'arc-in-place-style';

export class InPlaceEditing {
    private active: Spot | null = null;
    private rich: RichHandle | null = null;
    private observer: MutationObserver | null = null;
    private markTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly listeners: [string, EventListener, boolean][] = [];

    constructor(private readonly doc: Document, private readonly host: InPlaceHost) {}

    attach(): void {
        this.addStyles();
        this.on('click', (e) => this.onClick(e as MouseEvent), true);
        this.on('keydown', (e) => this.onKey(e as KeyboardEvent), true);
        this.on('input', (e) => this.onInput(e), true);
        this.on('submit', (e) => e.preventDefault(), true);
        this.mark();
        const View = this.doc.defaultView as (Window & typeof globalThis) | null;
        if (View?.MutationObserver && this.doc.body) {
            this.observer = new View.MutationObserver(() => this.scheduleMark());
            this.observer.observe(this.doc.body, { childList: true, subtree: true });
        }
    }

    detach(): void {
        this.leave();
        this.observer?.disconnect();
        if (this.markTimer) clearTimeout(this.markTimer);
        for (const [name, fn, capture] of this.listeners) this.doc.removeEventListener(name, fn, capture);
        this.listeners.length = 0;
    }

    /** The spot being edited, if any. */
    current(): Spot | null {
        return this.active;
    }

    private on(name: string, fn: EventListener, capture: boolean): void {
        this.doc.addEventListener(name, fn, capture);
        this.listeners.push([name, fn, capture]);
    }

    /** The frame's head gets the spot styles and TipTap's own (spike fix 1). */
    addStyles(): void {
        const head = this.doc.head;
        if (!head) return;
        if (!this.doc.getElementById(STYLE_ID)) {
            const style = this.doc.createElement('style');
            style.id = STYLE_ID;
            // The admin's own accent (its brand colour), which the site's page does not have.
            style.textContent = `:root { --arc-edit-accent: ${adminAccent()}; }\n${IN_PLACE_CSS}`;
            head.appendChild(style);
        }
        if (typeof document !== 'undefined' && document !== this.doc && !this.doc.querySelector('style[data-tiptap-style]')) {
            const tiptap = document.querySelector('style[data-tiptap-style]');
            if (tiptap) head.appendChild(this.doc.importNode(tiptap, true));
        }
    }

    // ── Spots ────────────────────────────────────────────────────────────────
    private scheduleMark(): void {
        if (this.markTimer) return;
        this.markTimer = setTimeout(() => {
            this.markTimer = null;
            this.mark();
        }, 40);
    }

    /** Marks every spot on the page with its kind; the page may have been redrawn. */
    mark(): void {
        if (this.active && !this.active.el.isConnected) this.dropActive();
        const type = this.host.type();
        // The type is still loading: marked once it is there.
        if (!type) {
            this.markTimer = setTimeout(() => {
                this.markTimer = null;
                this.mark();
            }, 250);
            return;
        }
        for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-field]'))) {
            if (this.active?.el === el || el.closest('[data-arc-editing]') && el !== this.active?.el) continue;
            const info = spotInfo(el, type);
            if (!info) {
                el.removeAttribute('data-arc-edit-kind');
                continue;
            }
            if (el.getAttribute('data-arc-edit-kind') !== info.kind) el.setAttribute('data-arc-edit-kind', info.kind);
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        }
    }

    /** The spots in page order, visible ones only. */
    spots(): HTMLElement[] {
        return Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))
            .filter((el) => !el.parentElement?.closest('[data-arc-editing]') && (el.getClientRects?.().length ?? 1) > 0);
    }

    private spotAt(el: HTMLElement): Spot | null {
        const info = spotInfo(el, this.host.type());
        return info ? { ...info, el } : null;
    }

    // ── Events ───────────────────────────────────────────────────────────────
    onClick(event: MouseEvent): void {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== 'function') return;
        if (this.active && this.active.el.contains(target)) {
            // A link inside the text being edited is edited, not followed.
            if (target.closest('a[href]')) event.preventDefault();
            return;
        }
        // Nothing on the page leaves it while editing.
        if (target.closest('a[href]')) event.preventDefault();
        const el = target.closest<HTMLElement>('[data-arc-edit-kind]') ?? soleSpot(target);
        if (!el) {
            this.leave();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.open(el, { x: event.clientX, y: event.clientY });
    }

    onKey(event: KeyboardEvent): void {
        const active = this.active;
        if (event.key === 'Escape') {
            // A menu at the caret (slash commands, emoji) closes first; the spot stays open.
            if (active?.kind === 'rich' && caretMenuOpen()) return;
            if (active) {
                event.preventDefault();
                event.stopPropagation();
                const el = active.el;
                this.leave();
                el.focus?.({ preventScroll: true });
            }
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            this.step(event.shiftKey ? -1 : 1);
            return;
        }
        if (active?.kind === 'text' && event.key === 'Enter') {
            // A one-line value: Enter is done.
            event.preventDefault();
            this.leave();
            return;
        }
        const focused = this.doc.activeElement as HTMLElement | null;
        if (!active && focused?.hasAttribute?.('data-arc-edit-kind') && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            this.open(focused);
        }
    }

    onInput(event: Event): void {
        const active = this.active;
        if (!active || active.kind !== 'text') return;
        if (!active.el.contains(event.target as Node)) return;
        this.host.setText(active.field, plainText(active.el));
    }

    /** Tab: the next spot in page order (Shift: the one before), opened when it is typed in. */
    step(direction: 1 | -1): void {
        const spots = this.spots();
        if (!spots.length) return;
        const from = this.active?.el ?? (this.doc.activeElement as HTMLElement | null);
        const index = from ? spots.indexOf(from) : -1;
        const next = spots[index < 0 ? (direction > 0 ? 0 : spots.length - 1) : (index + direction + spots.length) % spots.length];
        this.leave();
        next.scrollIntoView?.({ block: 'nearest' });
        const kind = next.getAttribute('data-arc-edit-kind');
        if (kind === 'text' || kind === 'rich') this.open(next);
        else next.focus({ preventScroll: true });
    }

    // ── Opening and leaving a spot ───────────────────────────────────────────
    /** Opens a spot: typing for text and rich text, a box or the panel for the rest. */
    open(el: HTMLElement, at?: { x: number; y: number }): void {
        const spot = this.spotAt(el);
        if (!spot) return;
        if (this.active?.el === el) return;
        this.leave();
        switch (spot.kind) {
            case 'text':
                this.startText(spot, at);
                break;
            case 'rich':
                this.startRich(spot, at);
                break;
            case 'image':
                this.host.image(spot);
                break;
            case 'popover':
                this.host.popover(spot);
                break;
            default:
                this.host.panel(spot);
        }
    }

    private startText(spot: Spot, at?: { x: number; y: number }): void {
        const el = spot.el;
        this.active = spot;
        this.host.hold(true);
        el.setAttribute('data-arc-editing', '');
        el.setAttribute('contenteditable', 'plaintext-only');
        // A browser without plain-text editing gets ordinary editing; what is kept is the text.
        if ((el as HTMLElement).contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'true');
        el.focus({ preventScroll: true });
        placeCaret(this.doc, el, at);
        this.host.activeChanged(spot, null);
    }

    private startRich(spot: Spot, at?: { x: number; y: number }): void {
        const el = spot.el;
        this.active = spot;
        this.host.hold(true);
        el.setAttribute('data-arc-editing', '');
        const html = String(this.host.value(spot.field) ?? '');
        el.innerHTML = '';
        this.rich = this.host.mountRich(el, html, (value) => this.host.setRich(spot.field, value));
        this.addStyles();
        this.rich.focus(at);
        this.host.activeChanged(spot, this.rich);
    }

    /** Leaves the spot being edited; the page is drawn again with the draft. */
    leave(): void {
        const active = this.active;
        if (!active) return;
        if (active.kind === 'text') this.host.setText(active.field, plainText(active.el));
        this.dropActive();
    }

    private dropActive(): void {
        const active = this.active;
        if (!active) return;
        this.active = null;
        this.rich?.destroy();
        this.rich = null;
        active.el.removeAttribute('contenteditable');
        active.el.removeAttribute('data-arc-editing');
        active.el.removeAttribute('spellcheck');
        this.host.activeChanged(null, null);
        this.host.hold(false);
    }
}

/**
 * A click beside a value rather than on it (`<h1><span data-arc-field="title">`, clicked
 * past the end of the line): the element's one spot when it holds nothing else.
 */
export function soleSpot(target: Element): HTMLElement | null {
    const spots = target.querySelectorAll<HTMLElement>('[data-arc-edit-kind]');
    if (spots.length !== 1) return null;
    const only = spots[0];
    return (target.textContent || '').trim() === (only.textContent || '').trim() ? only : null;
}

/** The admin's accent colour, for the spots' outlines; a dark grey when it has none. */
function adminAccent(): string {
    if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return '#1f2937';
    const value = getComputedStyle(document.documentElement).getPropertyValue('--arc-admin-accent').trim();
    return /^[#\w(),.%\s-]+$/.test(value) && value ? value : '#1f2937';
}

/** A caret menu of the rich text editor is showing, in the admin document. */
function caretMenuOpen(): boolean {
    if (typeof document === 'undefined') return false;
    return Array.from(document.querySelectorAll<HTMLElement>('[data-tippy-root]'))
        .some((menu) => menu.getBoundingClientRect().height > 0 && getComputedStyle(menu).visibility !== 'hidden');
}

/** The text of a spot typed in place, on one line. */
export function plainText(el: HTMLElement): string {
    const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
    return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/** The caret where the spot was clicked, else at its end. */
function placeCaret(doc: Document, el: HTMLElement, at?: { x: number; y: number }): void {
    const selection = doc.getSelection?.();
    if (!selection) return;
    let range: Range | null = null;
    const fromPoint = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
    if (at && fromPoint) {
        const found = fromPoint.call(doc, at.x, at.y);
        if (found && el.contains(found.startContainer)) range = found;
    }
    if (!range) {
        range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
}
