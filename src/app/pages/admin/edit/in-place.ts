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
    /** The template's name for it (data-arc-label, VE-D19), else null: the field's own label. */
    label: string | null;
}

/** What a hint on a value the editor cannot change in place says (VE-D17). */
export type HintKind = 'author' | 'date' | 'reading' | 'locked' | 'header' | 'footer' | 'site';

/** The hint for a marked value that is not a spot: where it comes from, or where to change it. */
export function hintKind(key: string): HintKind {
    const k = key.toLowerCase();
    if (k.includes('author')) return 'author';
    if (k.includes('reading')) return 'reading';
    if (/(^|[._-])(published|updated|created)|date/.test(k)) return 'date';
    return 'site';
}

/** Media that shows something: an image with no address does not (an empty image field). */
const SHOWN_MEDIA = 'img[src]:not([src=""]), video, iframe, svg, picture';
/** Elements that cannot hold a placeholder's text. */
const VOID_TAGS = new Set(['img', 'video', 'audio', 'iframe', 'input', 'source', 'picture', 'svg', 'br', 'hr', 'meta', 'link']);

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
    /** An empty field's placeholder, "Add {label}" (VE-D18), in the admin's language. */
    placeholder(field: string, label: string | null): string;
    /** The hover text on a value that is not edited in place (VE-D17). */
    hint(kind: HintKind): string;
    /** Escape, first: the screen closes a box of its own (a picture's) and says so. */
    escape?(): boolean;
}

/**
 * Where a rich spot was clicked, read from the page before the editor took it: the
 * point, and the piece of text under it (its text, which of the spot's pieces with
 * that same text it is, and the offset in it). The editor lays some blocks out a
 * little differently from the page, so the point alone can land lines away.
 */
export interface RichAt {
    x: number;
    y: number;
    text?: { data: string; nth: number; offset: number };
    /** A picture clicked: its address and which of the spot's pictures with that address it is. */
    image?: { src: string; nth: number };
}

export interface RichHandle {
    /** Takes the cursor: on the clicked text, else at the point, else at its start. */
    focus(at?: RichAt): void;
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
/* An empty field kept for the editor (VE-D18): faint, outlined, saying what it is for. */
[data-arc-empty] { opacity: .65; outline: 1px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-empty] img:not([src]), [data-arc-empty] img[src=""] { display: none; }
[data-arc-empty][data-arc-ph] { padding: 8px 12px; }
[data-arc-ph]::before { content: attr(data-arc-ph); font-style: italic; opacity: .6; }
[data-arc-editing]:empty { display: inline-block; min-width: 1ch; }
/* A value worked out by the site (VE-D17): its title says where it comes from. */
[data-arc-field][data-arc-hint] { cursor: help; }
/* The page's own wrapping: TipTap's break-spaces lets a space at a line's end push a word down. */
.ProseMirror.arc-in-place-rich { white-space: pre-wrap; word-wrap: break-word; outline: none; }
/* An empty line the cursor is not in, drawn as the page draws it: not at all (empty-lines.ts). */
.ProseMirror.arc-in-place-rich .arc-empty-line { display: none; }
/* A picture selected in the body: outlined, with its box beside it (VE-D16). */
.ProseMirror.arc-in-place-rich img { cursor: pointer; }
.ProseMirror.arc-in-place-rich img.ProseMirror-selectednode { outline: 3px solid var(--arc-edit-accent); outline-offset: 2px; }
.ProseMirror [contenteditable="false"] { white-space: normal; }
`;

const STYLE_ID = 'arc-in-place-style';

export class InPlaceEditing {
    private active: Spot | null = null;
    private rich: RichHandle | null = null;
    /**
     * The rich spot's page as drawn before the editor took it, and the HTML typed
     * since (null: nothing). Leaving puts one of them back: the editor empties the
     * spot when it goes, and an unchanged value is never drawn again by the page.
     */
    private richShown: { before: string; typed: string | null } | null = null;
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
        this.markEmpty(type);
        for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-field]'))) {
            if (this.active?.el === el || el.closest('[data-arc-editing]') && el !== this.active?.el) continue;
            const locked = !!el.closest('[data-arc-locked]');
            const info = locked ? null : spotInfo(el, type);
            if (!info) {
                el.removeAttribute('data-arc-edit-kind');
                el.removeAttribute('data-arc-ph');
                this.setHint(el, locked ? 'locked' : hintKind(el.getAttribute('data-arc-field') || ''));
                continue;
            }
            if (el.getAttribute('data-arc-edit-kind') !== info.kind) el.setAttribute('data-arc-edit-kind', info.kind);
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            // An empty value shows what it is for, so there is something to click (VE-D18).
            const empty = !info.attr && !VOID_TAGS.has(el.tagName.toLowerCase()) && !el.textContent?.trim() && !el.querySelector(SHOWN_MEDIA);
            const placeholder = empty ? placeholderText(el) ?? this.host.placeholder(info.field, labelOf(el)) : null;
            if (placeholder === null) el.removeAttribute('data-arc-ph');
            else if (el.getAttribute('data-arc-ph') !== placeholder) el.setAttribute('data-arc-ph', placeholder);
        }
        for (const [selector, kind] of [['arc-header', 'header'], ['arc-footer', 'footer']] as const) {
            const part = this.doc.querySelector<HTMLElement>(selector);
            if (part) this.setHint(part, kind);
        }
    }

    /**
     * An element kept by the renderer only because its field is empty
     * (data-arc-empty, VE-D18) with nothing in it to click: it becomes the
     * field's spot itself, so the placeholder opens the field.
     */
    private markEmpty(type: ContentType): void {
        for (const box of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-empty]'))) {
            const key = box.getAttribute('data-arc-empty') || '';
            const field = resolvePreviewField(key, type)?.field;
            if (!field || box.hasAttribute('data-arc-field')) continue;
            const inside = Array.from(box.querySelectorAll<HTMLElement>('[data-arc-field]'))
                .some((el) => !VOID_TAGS.has(el.tagName.toLowerCase()) && !el.getAttribute('data-arc-field-attr') && spotInfo(el, type)?.field === field);
            if (!inside) box.setAttribute('data-arc-field', key);
        }
    }

    /** The hover text on a value that is not edited in place, unless the template gave it a title of its own. */
    private setHint(el: HTMLElement, kind: HintKind): void {
        if (el.hasAttribute('title') && !el.hasAttribute('data-arc-hint')) return;
        const text = this.host.hint(kind);
        if (el.getAttribute('title') !== text) el.setAttribute('title', text);
        el.setAttribute('data-arc-hint', kind);
    }

    /** The spots in page order, visible ones only. */
    spots(): HTMLElement[] {
        return Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))
            .filter((el) => !el.parentElement?.closest('[data-arc-editing]') && (el.getClientRects?.().length ?? 1) > 0);
    }

    private spotAt(el: HTMLElement): Spot | null {
        if (el.closest('[data-arc-locked]')) return null;
        const info = spotInfo(el, this.host.type());
        return info ? { ...info, el, label: labelOf(el) } : null;
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
            // Then a box the screen shows for the spot (a selected picture's).
            if (active && this.host.escape?.()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
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
        el.removeAttribute('data-arc-ph');
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
        el.removeAttribute('data-arc-ph');
        const html = String(this.host.value(spot.field) ?? '');
        const point: RichAt | undefined = at
            ? { ...at, text: textAt(this.doc, el, at) ?? undefined, image: pictureAt(this.doc, el, at) ?? undefined }
            : undefined;
        const shown = { before: el.innerHTML, typed: null as string | null };
        this.richShown = shown;
        el.innerHTML = '';
        this.rich = this.host.mountRich(el, html, (value) => {
            shown.typed = value;
            this.host.setRich(spot.field, value);
        });
        this.addStyles();
        this.rich.focus(point);
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
        const shown = this.richShown;
        this.richShown = null;
        // The editor left the spot empty: what the page showed, or what was typed until the page draws it.
        if (shown) active.el.innerHTML = shown.typed ?? shown.before;
        active.el.removeAttribute('contenteditable');
        active.el.removeAttribute('data-arc-editing');
        active.el.removeAttribute('spellcheck');
        this.host.activeChanged(null, null);
        this.host.hold(false);
        // Left empty: its placeholder comes back, whether or not the page is drawn again.
        this.scheduleMark();
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
/** The picture under a point in `el`: see RichAt. Null when the point is not on one. */
export function pictureAt(doc: Document, el: HTMLElement, at: { x: number; y: number }): RichAt['image'] | null {
    const hit = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(at.x, at.y) : null;
    if (!hit || hit.tagName !== 'IMG' || !el.contains(hit)) return null;
    const src = hit.getAttribute('src') || '';
    const same = Array.from(el.querySelectorAll('img')).filter((img) => (img.getAttribute('src') || '') === src);
    return { src, nth: Math.max(0, same.indexOf(hit as HTMLImageElement)) };
}

/** The text under a point in `el`: see RichAt. Null when the point is on no text. */
export function textAt(doc: Document, el: HTMLElement, at: { x: number; y: number }): RichAt['text'] | null {
    const fromPoint = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
    const found = fromPoint?.call(doc, at.x, at.y);
    const node = found?.startContainer;
    if (!found || !node || node.nodeType !== 3 || !el.contains(node)) return null;
    const data = (node as Text).data;
    if (!data.trim()) return null;
    let nth = 0;
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n && n !== node; n = walker.nextNode()) {
        if ((n as Text).data === data) nth++;
    }
    return { data, nth, offset: found.startOffset };
}

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

/** The template's name for a spot (data-arc-label on it, or on the element kept for it, VE-D19). */
export function labelOf(el: Element): string | null {
    const own = el.getAttribute('data-arc-label') ?? el.closest('[data-arc-empty]')?.getAttribute('data-arc-label');
    return own?.trim() || null;
}

/** The template's own placeholder for an empty spot (data-arc-placeholder, VE-D19). */
function placeholderText(el: Element): string | null {
    const own = el.getAttribute('data-arc-placeholder') ?? el.closest('[data-arc-empty]')?.getAttribute('data-arc-placeholder');
    return own?.trim() || null;
}
