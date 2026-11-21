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
 * - panel: anything else the editor fills (tags, author, a file field's rows):
 *   the Page settings panel, opened on the field.
 *
 * A repeating field's rows (VE-D30 to VE-D35) are edited value by value: a row's
 * text is typed in place, its picture is picked, and a section heading is typed
 * in place. The renderer marks each value with the field, the row's id and the
 * value's key; the row itself is not a spot, but hovering it asks the screen for
 * its bar (add, move, remove). An empty list shows "Add the first {row}".
 *
 * Values the site works out (dates, related entries) are not spots. Tab moves
 * between spots in page order, Enter opens a spot that has the focus, and
 * Escape leaves a spot. While a spot is typed in, the page is not redrawn under
 * the cursor; it is when the spot is left.
 *
 * This runs in the admin document on the frame's document (same origin).
 */
import { resolvePreviewField } from '../../../core/preview/preview-channel';
import { headingFieldOf, repeaterFieldOf, rowSubField } from '../../../core/preview/row-fields';
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
    /** The row's id, when the row is edited value by value (VE-D30), else null. */
    rowId?: string | null;
    /** The row value this is (`question`, `image`), or null. */
    sub?: string | null;
    /** The field's section heading (`{key}_heading`), typed in place. */
    heading?: boolean;
    /** Typed over several lines (an FAQ answer): Enter starts a new line. */
    multiline?: boolean;
    /** A map row's address shown as text: in a translation it is typed in place, its point shared (VE-D35). */
    addressText?: boolean;
}

/** A value in a row, or a section heading: typed through the row, not as a field of its own. */
export function isRowPart(info: SpotInfo): boolean {
    return !!info.heading || (info.rowId != null && info.sub != null);
}

export interface Spot extends SpotInfo {
    el: HTMLElement;
    /** The template's name for it (data-arc-label, VE-D19), else null: the field's own label. */
    label: string | null;
}

/** What a hint on a value the editor cannot change in place says (VE-D17). */
export type HintKind = 'author' | 'date' | 'reading' | 'locked' | 'header' | 'footer' | 'site' | 'shared';

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
    const rowId = el.getAttribute('data-arc-row-id');
    if (rowId !== null) return rowSpotInfo(el, key, rowId, attr, row, type);
    // A section heading of a repeating field, typed in place (VE-D31).
    const heading = !attr ? headingFieldOf(key, type) : null;
    if (heading && !VOID_TAGS.has(el.tagName.toLowerCase())) {
        return { key, field: heading.key, builtin: false, attr, row: null, kind: 'text', heading: true };
    }
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

/**
 * A value in a row of a repeating field (VE-D30, VE-D31): its text typed in place
 * (an FAQ answer over several lines, though the page shows it as paragraphs), its
 * picture picked; a map's location in Page settings. Null for the row itself and
 * for a value no row holds.
 */
function rowSpotInfo(el: Element, key: string, rowId: string, attr: string, row: number | null, type: ContentType): SpotInfo | null {
    const ref = repeaterFieldOf(key, type);
    const sub = el.getAttribute('data-arc-sub');
    if (!ref || sub === null) return null;
    const found = rowSubField(ref.schema, sub);
    if (!found) return null;
    const base = { key, field: ref.key, builtin: false, attr, row, rowId, sub: found.sub.key };
    switch (found.sub.type) {
        case 'text':
            return !attr && found.exact ? { ...base, kind: 'text' } : null;
        case 'textarea':
            // `answer_html` shows the answer: the answer is typed there.
            return !attr ? { ...base, kind: 'text', multiline: true } : null;
        case 'media':
            return { ...base, kind: 'image' };
        case 'location':
            // The map, the address and the directions link open the map box (VE-D34).
            return { ...base, kind: 'popover', addressText: found.exact && !attr && !VOID_TAGS.has(el.tagName.toLowerCase()) };
        default:
            return { ...base, kind: 'panel' };
    }
}

/** What the rich text editor is mounted for: the field, and the placed fields as drawn (VE-D28). */
export interface RichContext {
    field: string;
    drawn: Map<string, Element>;
}

/** What the screen does for the spots: the draft's values and the boxes in the admin document. */
export interface InPlaceHost {
    type(): ContentType | null;
    /** A field's value as the draft holds it, in the language on screen. */
    value(field: string): unknown;
    /** Writes a typed value into the draft, as the form editor does. */
    setText(field: string, value: string): void;
    /** A row's value or a section heading as the draft holds it, in the language on screen (VE-D31). */
    partText?(info: SpotInfo): string;
    /** Writes a row's value or a section heading, as the form editor's row boxes do. */
    setPartText?(info: SpotInfo, value: string): void;
    /** In a translation, a row value not translated yet: drawn faintly, typed in from empty (VE-D35). */
    untranslated?(info: SpotInfo): boolean;
    /** A translation is on screen: a map row's address is typed in place instead of picked (VE-D35). */
    translating?(): boolean;
    /** The pointer (or the keyboard) is on a row of a repeating field, or on none: its bar (VE-D32). */
    rowHover?(row: HTMLElement | null): void;
    /** An empty list's line: "Add the first {row}", or in a translation where rows are arranged (VE-D33, VE-D35). */
    emptyList?(field: string): { text: string; add: boolean } | null;
    /** The empty list's line was clicked: its first row. */
    addFirst?(field: string): void;
    setRich(field: string, html: string): void;
    /** While a spot is typed in, the page is not redrawn. */
    hold(on: boolean): void;
    /**
     * Mounts the rich text editor on the element with the field's HTML. `drawn` holds
     * the fields the text places (VE-D28) as the page drew them, for their cards.
     */
    mountRich(el: HTMLElement, html: string, onChange: (html: string) => void, context?: RichContext): RichHandle;
    image(spot: Spot): void;
    popover(spot: Spot): void;
    panel(spot: Spot): void;
    /** A spot was cancelled (VE-D37): a row just added and still blank goes. */
    cancelled?(spot: Spot): void;
    /** The spot being edited changed (null: none), for the strip's formatting buttons. */
    activeChanged(spot: Spot | null, rich: RichHandle | null): void;
    /** An empty field's placeholder, "Add {label}" (VE-D18), in the admin's language; a row value's or a heading's from `info`. */
    placeholder(field: string, label: string | null, info?: SpotInfo): string;
    /** The hover text on a value that is not edited in place (VE-D17). */
    hint(kind: HintKind): string;
    /** A spot's name for a screen reader: the field's label, else the template's. */
    fieldName?(info: SpotInfo, label: string | null): string;
    /** A click on the page that opens nothing (words fixed by the design, a date the site works out). */
    fixedClick?(target: Element, x: number, y: number): void;
    /** Escape, first: the screen closes a box of its own (a picture's) and says so. */
    escape?(): boolean;
    /**
     * While a translation is on screen, a field every language shares (a picture, a
     * number, a choice): shown, marked "Same in every language", not edited here (VE3.8).
     */
    shared?(field: string, builtin: boolean, info?: SpotInfo): boolean;
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
/* The keyboard on a spot, not typing in it (after Escape): dashed, as a spot that can be changed; solid is for the one typed in. */
[data-arc-edit-kind]:focus-visible:not([data-arc-editing]) { outline: 3px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-pv-highlight] { outline: 3px solid var(--arc-edit-accent) !important; outline-offset: 2px; }
/* An empty field kept for the editor (VE-D18): faint, outlined, saying what it is for. */
[data-arc-empty] { opacity: .65; outline: 1px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-empty] img:not([src]), [data-arc-empty] img[src=""] { display: none; }
[data-arc-empty][data-arc-ph] { padding: 8px 12px; }
[data-arc-ph]::before { content: attr(data-arc-ph); font-style: italic; opacity: .6; }
[data-arc-editing] { text-transform: none !important; }
/* An FAQ answer typed in place: its lines as typed (VE-D31). */
[data-arc-editing][data-arc-multiline] { white-space: pre-wrap; }
/* A row value not translated yet: the default language's words, faint (VE-D35). */
[data-arc-untranslated] { opacity: .6; }
/* A row's empty picture: a box to click (VE-D31). */
img[data-arc-empty][data-arc-sub] { display: block !important; width: 100%; min-width: 48px; min-height: 48px; aspect-ratio: 4 / 3; max-height: 200px; object-fit: cover;
  background: repeating-linear-gradient(45deg, rgba(0,0,0,.04) 0 8px, rgba(0,0,0,.08) 8px 16px); }
/* A map in a row: a click reaches the page, which opens the map box (VE-D34); the row shows it. */
iframe[data-arc-sub][data-arc-edit-kind] { pointer-events: none; }
[data-arc-row]:hover > iframe[data-arc-sub][data-arc-edit-kind] { outline: 2px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-row]:has(> iframe[data-arc-sub][data-arc-edit-kind]) { cursor: pointer; }
/* An empty list: the line that adds its first row (VE-D33). */
[data-arc-empty-loop][data-arc-ph] { display: block !important; padding: 12px 16px; outline: 1px dashed var(--arc-edit-accent); outline-offset: 2px; opacity: .75; }
[data-arc-empty-loop][data-arc-edit-kind="add"] { cursor: pointer; }
/* A site sheet may hide an empty element (:empty): on this screen such a spot shows, to be filled in. */
[data-arc-unhide] { display: revert !important; }
/* An empty spot being typed in keeps the page's layout (a headline stays on its own line);
   only a value inside a line of text gets room for the cursor. */
[data-arc-editing]:empty { min-height: 1em; }
[data-arc-editing][data-arc-inline]:empty, [data-arc-editing][data-arc-inline][data-arc-unhide]:empty { display: inline-block !important; min-width: 1ch; }
[data-arc-editing]:empty:not([data-arc-inline]) { min-width: 4ch; }
/* A value worked out by the site (VE-D17): its title says where it comes from. */
[data-arc-field][data-arc-hint] { cursor: help; }
/* Shared by every language, while a translation is on screen (VE3.8). */
[data-arc-shared] { cursor: not-allowed; }
[data-arc-shared]:hover { outline: 2px dotted var(--arc-edit-accent); outline-offset: 2px; }
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

/** How far the pointer moves after a row is removed before a row's bar shows again. */
const ROW_HOLD_MOVE_PX = 8;

export class InPlaceEditing {
    private active: Spot | null = null;
    private rich: RichHandle | null = null;
    /**
     * The rich spot's page as drawn before the editor took it, and the HTML typed
     * since (null: nothing). Leaving puts one of them back: the editor empties the
     * spot when it goes, and an unchanged value is never drawn again by the page.
     */
    private richShown: { before: string; typed: string | null } | null = null;
    /** The text spot's words when it was opened: leaving writes them back only when changed. */
    private textAtStart: string | null = null;
    /** What the spot held when opened, as stored and as drawn: Cancel puts it back (VE-D37). */
    private opened: { value: string; html: string } | null = null;
    /** A text spot drawn differently while typed (an FAQ answer's paragraphs): put back when left unchanged. */
    private textShown: string | null = null;
    /** A row just added: its first text spot opens once the page draws it (VE-D32). */
    private pendingRow: { id: string; until: number } | null = null;
    /** The row the pointer is on, for its bar. */
    private hoverRow: HTMLElement | null = null;
    /** Just after a row was removed: no bar until the pointer moves (`holdRowsUntilMoved`); where it was first seen. */
    private rowsHeld: { at: { x: number; y: number } | null } | null = null;
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
        this.on('pointerover', (e) => this.onPointer(e as PointerEvent), true);
        // Only while rows wait for the pointer to move: a move then shows the bar of the row it is on.
        this.on('pointermove', (e) => {
            if (this.rowsHeld) this.onPointer(e as PointerEvent);
        }, true);
        this.on('pointerout', (e) => {
            // Out of the page altogether: no row.
            if (!(e as PointerEvent).relatedTarget) this.setHoverRow(null);
        }, true);
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
            if (this.markTimer) clearTimeout(this.markTimer);
            this.markTimer = setTimeout(() => {
                this.markTimer = null;
                this.mark();
            }, 250);
            return;
        }
        this.markEmpty(type);
        this.markEmptyLists(type);
        const hiddenRules = emptyHidingRules(this.doc);
        // Every FAQ answer shows on the Visual Editor (VE-D31).
        for (const details of Array.from(this.doc.querySelectorAll<HTMLDetailsElement>('details:not([open])'))) {
            if (details.closest('[data-arc-editing], .ProseMirror')) continue;
            if (details.querySelector('[data-arc-row-id]') || details.hasAttribute('data-arc-row-id')) details.open = true;
        }
        for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-field]'))) {
            if (this.active?.el === el || el.closest('[data-arc-editing]') && el !== this.active?.el) continue;
            // A row edited value by value is not a spot itself; its bar is found from it (VE-D32).
            if (el.hasAttribute('data-arc-row-id') && !el.hasAttribute('data-arc-sub')) continue;
            const locked = !!el.closest('[data-arc-locked]');
            const found = locked ? null : this.resolve(el, type);
            const shared = !!found && this.isShared(found);
            const info = shared ? null : found;
            if (!info) {
                el.removeAttribute('data-arc-edit-kind');
                el.removeAttribute('data-arc-ph');
                if (el.hasAttribute('data-arc-named')) {
                    el.removeAttribute('role');
                    el.removeAttribute('aria-label');
                    el.removeAttribute('data-arc-named');
                }
                el.toggleAttribute('data-arc-shared', shared);
                this.setHint(el, locked ? 'locked' : shared ? 'shared' : hintKind(el.getAttribute('data-arc-field') || ''));
                continue;
            }
            if (el.hasAttribute('data-arc-shared')) {
                el.removeAttribute('data-arc-shared');
                if (el.getAttribute('data-arc-hint') === 'shared') {
                    el.removeAttribute('title');
                    el.removeAttribute('data-arc-hint');
                }
            }
            if (el.getAttribute('data-arc-edit-kind') !== info.kind) el.setAttribute('data-arc-edit-kind', info.kind);
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            this.nameSpot(el, info);
            // An empty value shows what it is for, so there is something to click (VE-D18).
            const empty = !info.attr && !VOID_TAGS.has(el.tagName.toLowerCase()) && !el.textContent?.trim() && !el.querySelector(SHOWN_MEDIA);
            const placeholder = empty ? placeholderText(el) ?? this.host.placeholder(info.field, labelOf(el), info) : null;
            if (placeholder === null) el.removeAttribute('data-arc-ph');
            else if (el.getAttribute('data-arc-ph') !== placeholder) el.setAttribute('data-arc-ph', placeholder);
            // Shown when the site hides it only for being empty, never when it hides it on purpose.
            const unhide = placeholder !== null && hiddenRules.some((selector) => matchesSafely(el, selector));
            if (el.hasAttribute('data-arc-unhide') !== unhide) el.toggleAttribute('data-arc-unhide', unhide);
            el.toggleAttribute('data-arc-untranslated', info.kind === 'text' && !empty && !!this.host.untranslated?.(info));
        }
        this.openPending();
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
            // A list's section: its empty list says how to add the first row (VE-D33).
            if (box.querySelector('[data-arc-empty-loop]')) continue;
            const inside = Array.from(box.querySelectorAll<HTMLElement>('[data-arc-field]'))
                .some((el) => !VOID_TAGS.has(el.tagName.toLowerCase()) && !el.getAttribute('data-arc-field-attr') && spotInfo(el, type)?.field === field);
            if (!inside) box.setAttribute('data-arc-field', key);
        }
    }

    /**
     * An empty repeating field's list (`data-arc-empty-loop`, VE-D33): a line that adds
     * its first row, or, in a translation, says where rows are added (VE-D35).
     */
    private markEmptyLists(type: ContentType): void {
        for (const list of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-empty-loop]'))) {
            const ref = repeaterFieldOf(list.getAttribute('data-arc-empty-loop') || '', type);
            const line = ref && this.host.emptyList?.(ref.key);
            if (!ref || !line) continue;
            if (list.getAttribute('data-arc-ph') !== line.text) list.setAttribute('data-arc-ph', line.text);
            list.setAttribute('data-arc-list', ref.key);
            if (line.add) {
                list.setAttribute('data-arc-edit-kind', 'add');
                if (!list.hasAttribute('tabindex')) list.setAttribute('tabindex', '-1');
                list.setAttribute('role', 'button');
                list.removeAttribute('title');
            } else {
                list.removeAttribute('data-arc-edit-kind');
                list.removeAttribute('role');
                list.setAttribute('title', line.text);
            }
        }
    }

    /** Opens a row just added once the page draws it: its first text, else it is shown (VE-D32). */
    openWhenDrawn(rowId: string): void {
        this.pendingRow = { id: rowId, until: Date.now() + 5000 };
        this.openPending();
    }

    private openPending(): void {
        const pending = this.pendingRow;
        if (!pending) return;
        if (Date.now() > pending.until) {
            this.pendingRow = null;
            return;
        }
        const id = cssEscapeId(pending.id);
        const row = this.doc.querySelector<HTMLElement>(`[data-arc-row][data-arc-row-id="${id}"]`);
        if (!row) return;
        this.pendingRow = null;
        const first = this.doc.querySelector<HTMLElement>(`[data-arc-row-id="${id}"][data-arc-edit-kind="text"]`);
        (first ?? row).scrollIntoView?.({ block: 'nearest' });
        if (first) this.open(first);
        this.setHoverRow(row);
    }

    // ── Rows ─────────────────────────────────────────────────────────────────
    private onPointer(event: PointerEvent): void {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== 'function') return;
        if (this.rowsHeld && !this.movedSinceHeld(event)) return;
        // Inside the text being typed in (a placed field's card there): the card stands for the field (VE-D36).
        if (target.closest('[data-arc-editing], .ProseMirror')) {
            this.setHoverRow(null);
            return;
        }
        this.setHoverRow(target.closest<HTMLElement>('[data-arc-row][data-arc-row-id]'));
    }

    /**
     * A row was just removed and the next one is now under the pointer: its bar (with its
     * own Remove in the same place) waits until the pointer moves, so a quick second
     * click does not remove that row too.
     */
    holdRowsUntilMoved(): void {
        this.rowsHeld = { at: null };
        this.hoverRow = null;
    }

    /** The first pointer event after the hold is where the pointer rests; a move away from it ends the hold. */
    private movedSinceHeld(event: PointerEvent): boolean {
        const held = this.rowsHeld;
        if (!held) return true;
        if (!held.at) {
            held.at = { x: event.clientX, y: event.clientY };
            return false;
        }
        if (Math.hypot(event.clientX - held.at.x, event.clientY - held.at.y) < ROW_HOLD_MOVE_PX) return false;
        this.rowsHeld = null;
        return true;
    }

    /** The row whose bar shows; the screen keeps it while the pointer is on the bar. */
    private setHoverRow(row: HTMLElement | null): void {
        if (row === this.hoverRow) return;
        this.hoverRow = row;
        this.host.rowHover?.(row);
    }

    /** The row of a spot or element, edited value by value, or null. */
    rowOf(el: Element | null): HTMLElement | null {
        return el?.closest?.<HTMLElement>('[data-arc-row][data-arc-row-id]') ?? null;
    }

    /** The hover text on a value that is not edited in place, unless the template gave it a title of its own. */
    private setHint(el: HTMLElement, kind: HintKind): void {
        if (el.hasAttribute('title') && !el.hasAttribute('data-arc-hint')) return;
        const text = this.host.hint(kind);
        if (el.getAttribute('title') !== text) el.setAttribute('title', text);
        el.setAttribute('data-arc-hint', kind);
    }

    /**
     * A spot says what it is to a screen reader (review M6): a button named for its
     * field and what it holds while it waits, a text box named for its field while typed in.
     */
    private nameSpot(el: HTMLElement, info: SpotInfo, typing = false): void {
        const name = this.host.fieldName?.(info, labelOf(el)) ?? labelOf(el) ?? info.field;
        const words = typing ? '' : (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const label = words ? `${name}: ${words}` : name;
        const role = typing ? 'textbox' : 'button';
        if (el.getAttribute('role') !== role) el.setAttribute('role', role);
        if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
        el.setAttribute('data-arc-named', '');
        if (typing && info.multiline) el.setAttribute('aria-multiline', 'true');
        else el.removeAttribute('aria-multiline');
    }

    /**
     * The same spot after the page was drawn again (a change made in a box redraws it):
     * the element with the same mark, or null when it is gone.
     */
    find(info: SpotInfo): Spot | null {
        for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))) {
            if (!el.isConnected) continue;
            const spot = this.spotAt(el);
            if (spot && spot.key === info.key && spot.attr === info.attr && spot.row === info.row && (spot.rowId ?? null) === (info.rowId ?? null)
                && (spot.sub ?? null) === (info.sub ?? null) && !!spot.heading === !!info.heading) return spot;
        }
        return null;
    }

    /** The spots in page order, visible ones only. */
    spots(): HTMLElement[] {
        return Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-edit-kind]'))
            .filter((el) => !el.parentElement?.closest('[data-arc-editing]') && (el.getClientRects?.().length ?? 1) > 0);
    }

    private spotAt(el: HTMLElement): Spot | null {
        if (el.closest('[data-arc-locked]')) return null;
        const info = this.resolve(el, this.host.type());
        return info && !this.isShared(info) ? { ...info, el, label: labelOf(el) } : null;
    }

    /** What a marked element edits on this screen: a map row's address is typed in a translation (VE-D35). */
    private resolve(el: Element, type: ContentType | null): SpotInfo | null {
        const info = spotInfo(el, type);
        if (info?.addressText && this.host.translating?.()) return { ...info, kind: 'text' };
        return info;
    }

    /**
     * A field every language shares, while a translation is on screen; rows still open the
     * panel, which locks what it must. A row's picture is shared, its text is not (VE-D35).
     */
    private isShared(info: SpotInfo): boolean {
        return info.kind !== 'panel' && !!this.host.shared?.(info.field, info.builtin, info);
    }

    // ── Events ───────────────────────────────────────────────────────────────
    onClick(event: MouseEvent): void {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== 'function') return;
        if (this.active && this.active.el.contains(target)) {
            // A link inside the text being edited is edited, not followed; a question does not fold its answer.
            if (target.closest('a[href], summary')) event.preventDefault();
            return;
        }
        // Nothing on the page leaves it while editing, and an FAQ answer does not fold away.
        if (target.closest('a[href], summary')) event.preventDefault();
        const el = target.closest<HTMLElement>('[data-arc-edit-kind]') ?? this.frameSpotAt(target, event.clientX, event.clientY) ?? soleSpot(target);
        if (!el) {
            // A click away from the value being typed in only finishes it; with none open,
            // the screen says this part cannot be changed and shows the parts that can.
            const typing = !!this.active;
            this.leave();
            if (!typing) this.host.fixedClick?.(target, event.clientX, event.clientY);
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
            // In a list, Tab indents and Shift+Tab outdents, as in the form editor.
            if (active?.kind === 'rich' && this.selectionInList(active.el)) return;
            // Past the last spot (or before the first), Tab goes on to the rest of the
            // page and out of the frame: the strip and the panel stay in reach.
            if (!this.step(event.shiftKey ? -1 : 1)) return;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (active?.kind === 'text' && event.key === 'Enter' && !active.multiline) {
            // A one-line value: Enter is done.
            event.preventDefault();
            this.leave();
            return;
        }
        // A space typed in an FAQ question would fold its answer: it is typed as text instead.
        if (active?.kind === 'text' && event.key === ' ' && active.el.closest('summary')) {
            event.preventDefault();
            this.doc.execCommand?.('insertText', false, ' ');
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
        // A translation's faint default words go once something is typed (VE-D35).
        if (active.el.hasAttribute('data-arc-ph') && active.el.textContent) active.el.removeAttribute('data-arc-ph');
        this.writeText(active, this.typedText(active));
    }

    /** What a text spot holds: one line, or an FAQ answer's lines. */
    private typedText(spot: Spot): string {
        return spot.multiline ? linesText(spot.el) : plainText(spot.el);
    }

    private writeText(spot: Spot, text: string): void {
        if (isRowPart(spot)) this.host.setPartText?.(spot, text);
        else this.host.setText(spot.field, text);
    }

    /**
     * A row's map under the point, inside what was clicked: it takes no clicks itself, so
     * the page finds it (VE-D34). Something drawn over the map (a sticky header) is not it.
     */
    frameSpotAt(target: Element, x: number, y: number): HTMLElement | null {
        for (const frame of Array.from(target.querySelectorAll<HTMLElement>('iframe[data-arc-sub][data-arc-edit-kind]'))) {
            const box = frame.getBoundingClientRect();
            if (box.width && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return frame;
        }
        return null;
    }

    /** The caret is in a list item of the rich text spot. */
    private selectionInList(el: HTMLElement): boolean {
        const node = this.doc.getSelection?.()?.anchorNode ?? null;
        const at = node && (node.nodeType === 1 ? node as Element : node.parentElement);
        const item = at?.closest?.('li');
        return !!item && el.contains(item);
    }

    /**
     * Tab: the next spot in page order (Shift: the one before), opened when it is typed in.
     * False past the last spot (or before the first): the spot is left and Tab carries on.
     */
    step(direction: 1 | -1): boolean {
        const spots = this.spots();
        if (!spots.length) return false;
        const from = this.active?.el ?? (this.doc.activeElement as HTMLElement | null);
        const index = from ? spots.indexOf(from) : -1;
        const target = index >= 0 ? index + direction : nearestSpot(spots, from, direction, this.doc);
        if (target < 0 || target >= spots.length) {
            this.leave();
            return false;
        }
        const next = spots[target];
        this.leave();
        next.scrollIntoView?.({ block: 'nearest' });
        const kind = next.getAttribute('data-arc-edit-kind');
        if (kind === 'text' || kind === 'rich') this.open(next);
        else next.focus({ preventScroll: true });
        return true;
    }

    // ── Opening and leaving a spot ───────────────────────────────────────────
    /** Opens a spot: typing for text and rich text, a box or the panel for the rest. */
    open(el: HTMLElement, at?: { x: number; y: number }): void {
        // An empty list's line adds its first row (VE-D33).
        if (el.getAttribute('data-arc-edit-kind') === 'add') {
            const field = el.getAttribute('data-arc-list');
            this.leave();
            if (field) this.host.addFirst?.(field);
            return;
        }
        const spot = this.spotAt(el);
        if (!spot) return;
        if (this.active?.el === el) return;
        this.leave();
        const row = this.rowOf(el);
        if (row) this.setHoverRow(row);
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
        // The page shows something other than the stored words (a link's label, a formatted
        // date, words with markup or line breaks): typing there would write what is shown over
        // what is stored, so the value opens in its own box instead (review H1, M4).
        if (!isRowPart(spot) && spot.field !== 'title') {
            const stored = String(this.host.value(spot.field) ?? '');
            const untranslated = !stored && !!this.host.translating?.();
            if (!untranslated && !typedAsShown(stored, el.textContent ?? '')) {
                if (spot.builtin) this.host.panel(spot);
                else this.host.popover({ ...spot, kind: 'popover' });
                return;
            }
        }
        this.active = spot;
        this.host.hold(true);
        this.opened = {
            value: isRowPart(spot) ? this.host.partText?.(spot) ?? plainText(el) : String(this.host.value(spot.field) ?? ''),
            html: el.innerHTML,
        };
        this.markInline(el);
        el.setAttribute('data-arc-editing', '');
        el.removeAttribute('data-arc-ph');
        el.setAttribute('contenteditable', 'plaintext-only');
        // A browser without plain-text editing gets ordinary editing; what is kept is the text.
        if ((el as HTMLElement).contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'true');
        // Typed as stored: an FAQ answer's lines rather than its paragraphs, and a value
        // not translated yet from empty, not over the default language's words (VE-D35;
        // the title, summary and text fields too, review M5).
        const stored = isRowPart(spot) ? this.host.partText?.(spot) ?? plainText(el) : this.opened.value;
        const shown = spot.multiline ? linesText(el) : plainText(el);
        const fromEmpty = !stored && !!this.host.translating?.();
        if (stored !== shown && (isRowPart(spot) || fromEmpty)) {
            this.textShown = el.innerHTML;
            el.textContent = stored;
        }
        el.removeAttribute('data-arc-untranslated');
        if (!stored && (isRowPart(spot) || fromEmpty || !shown)) el.setAttribute('data-arc-ph', this.host.placeholder(spot.field, spot.label, spot));
        el.toggleAttribute('data-arc-multiline', !!spot.multiline);
        this.nameSpot(el, spot, true);
        this.textAtStart = this.typedText(spot);
        el.focus({ preventScroll: true });
        placeCaret(this.doc, el, at);
        this.host.activeChanged(spot, null);
    }

    private startRich(spot: Spot, at?: { x: number; y: number }): void {
        const el = spot.el;
        this.active = spot;
        this.host.hold(true);
        this.markInline(el);
        el.setAttribute('data-arc-editing', '');
        el.removeAttribute('data-arc-ph');
        const html = String(this.host.value(spot.field) ?? '');
        this.opened = { value: html, html: el.innerHTML };
        const point: RichAt | undefined = at
            ? { ...at, text: textAt(this.doc, el, at) ?? undefined, image: pictureAt(this.doc, el, at) ?? undefined }
            : undefined;
        const shown = { before: el.innerHTML, typed: null as string | null };
        this.richShown = shown;
        // The fields the text places, as drawn, for their cards in the editor (VE-D28).
        const drawn = new Map<string, Element>();
        for (const marker of Array.from(el.querySelectorAll('[data-arc-place]'))) {
            const key = marker.getAttribute('data-arc-place') || '';
            if (key && !drawn.has(key) && marker.firstElementChild) drawn.set(key, marker.cloneNode(true) as Element);
        }
        el.innerHTML = '';
        this.rich = this.host.mountRich(el, html, (value) => {
            shown.typed = value;
            this.host.setRich(spot.field, value);
        }, { field: spot.field, drawn });
        this.addStyles();
        this.rich.focus(point);
        this.host.activeChanged(spot, this.rich);
    }

    /** A value drawn inside a line of text: while empty and typed in, it gets room for the cursor. */
    private markInline(el: HTMLElement): void {
        const display = this.doc.defaultView?.getComputedStyle?.(el).display ?? '';
        el.toggleAttribute('data-arc-inline', display === 'inline');
    }

    /**
     * Cancel (VE-D37): the spot goes back to what it held when it was opened, in the draft
     * and on the page, and is left. Nothing typed in it is kept.
     */
    cancel(): void {
        const active = this.active;
        const opened = this.opened;
        if (!active || !opened) return;
        if (active.kind === 'text') {
            // Whatever is stored now (typing writes as it goes), the value goes back to what it was.
            const now = isRowPart(active) ? this.host.partText?.(active) : String(this.host.value(active.field) ?? '');
            if (now !== opened.value) {
                if (isRowPart(active)) this.host.setPartText?.(active, opened.value);
                else this.host.setText(active.field, opened.value);
            }
            active.el.innerHTML = opened.html;
            this.textShown = null;
        } else if (active.kind === 'rich' && this.richShown) {
            if (this.richShown.typed !== null) this.host.setRich(active.field, opened.value);
            this.richShown.typed = null;
        }
        this.dropActive();
        this.host.cancelled?.(active);
    }

    /** Leaves the spot being edited; the page is drawn again with the draft. */
    leave(): void {
        const active = this.active;
        if (!active) return;
        if (active.kind === 'text') {
            const text = this.typedText(active);
            // Unchanged: the stored value stays as it is (and a change made meanwhile in Page settings with it).
            if (text !== this.textAtStart) this.writeText(active, text);
            // Unchanged, the page is not drawn again: it shows what it showed.
            else if (this.textShown !== null) active.el.innerHTML = this.textShown;
        }
        this.dropActive();
    }

    private dropActive(): void {
        const active = this.active;
        if (!active) return;
        this.active = null;
        this.textAtStart = null;
        this.textShown = null;
        this.opened = null;
        active.el.removeAttribute('data-arc-multiline');
        active.el.removeAttribute('data-arc-inline');
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

/**
 * Tab from something on the page that is not a spot (a link in the header or footer):
 * the nearest spot that way in page order, or -1 when there is none, so Tab carries on
 * to the rest of the page and out of the frame (review M6). From nothing, the first or last.
 */
export function nearestSpot(spots: HTMLElement[], from: Element | null, direction: 1 | -1, doc: Document): number {
    if (!from || from === doc.body || from === doc.documentElement) return direction > 0 ? 0 : spots.length - 1;
    const FOLLOWING = 4;
    const PRECEDING = 2;
    if (direction > 0) return spots.findIndex((spot) => (from.compareDocumentPosition(spot) & FOLLOWING) !== 0);
    for (let i = spots.length - 1; i >= 0; i--) {
        if ((from.compareDocumentPosition(spots[i]) & PRECEDING) !== 0 && !spots[i].contains(from)) return i;
    }
    return -1;
}

/** The admin's accent colour, for the spots' outlines; a dark grey when it has none. */
export function adminAccent(): string {
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

/**
 * The site's rules that hide an element for being empty (`:empty { display: none }`),
 * as selectors. A sheet the page cannot read is skipped.
 */
export function emptyHidingRules(doc: Document): string[] {
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            const style = (rule as CSSStyleRule).style;
            const selector = (rule as CSSStyleRule).selectorText;
            if (selector && selector.includes(':empty') && style?.display === 'none') {
                for (const part of selector.split(',')) if (part.includes(':empty')) found.push(part.trim());
            }
            const inner = (rule as CSSGroupingRule).cssRules;
            if (inner && !selector) walk(inner);
        }
    };
    for (const sheet of Array.from(doc.styleSheets)) {
        try {
            walk(sheet.cssRules);
        } catch {
            // A sheet from another origin: its rules cannot be read.
        }
    }
    return found;
}

function matchesSafely(el: Element, selector: string): boolean {
    try {
        return el.matches(selector);
    } catch {
        return false;
    }
}

/** An FAQ answer typed in place: its lines, with no line breaks at its ends. */
export function linesText(el: HTMLElement): string {
    const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
    return text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
}

function cssEscapeId(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
}

/**
 * The stored words are what the page shows, so typing over what is shown loses nothing:
 * the same words once spaces are evened out, and no line breaks in what is stored.
 */
export function typedAsShown(stored: string, shown: string): boolean {
    if (/[\r\n]/.test(stored.trim())) return false;
    const even = (text: string) => text.replace(/\s+/g, ' ').trim();
    return even(stored) === even(shown);
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
