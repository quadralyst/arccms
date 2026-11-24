import { LAZY_PICTURE_SIZES, LAZY_PICTURE_SRC, safePageTextUrl, sanitizeRichText } from '../../../core/utils/page-text-model';
import type { AreaView } from './page-text-editor.model';
import { adminAccent } from '../edit/in-place';
import type { CardRef } from './page-card-actions';

/**
 * Editing a page's marked areas where they are, on the Visual Editor
 * (specs/visual-editing-spec.md, VE-D49, VE-D50, VE-D55).
 *
 * The frame draws the page once with the marks kept (`data-arc-edit`); this runs
 * in the admin's document on the frame's document (same origin):
 *
 * - words (text, rich text, a link's words) are typed in place; Enter ends a
 *   line of plain text, Escape puts back what was there, a click elsewhere or
 *   Done saves (VE-D37);
 * - a picture, a background, a link's address and a card block's section title
 *   open a small box on the screen (`open`);
 * - after every save, the screen's own or another editor's, `patch` puts each
 *   area's value on the page, never into the one being typed in, so the page
 *   does not jump under the cursor.
 *
 * Cards in a card block (VE-D54) are edited like an entry: a card's title or text
 * field is typed in place, anything else on it opens the card's form in the
 * panel; hovering a card shows its bar. Cards in the header and footer are not
 * edited (VE-D20).
 *
 * Links never navigate inside the editor.
 */
export interface PageInPlaceHost {
    /** The area a key marks, in the language chosen, or null. */
    areaFor(key: string): AreaView | null;
    /** Saves an area's words (an emptied area uses the file's again). */
    saveWords(view: AreaView, value: string): void;
    /** Opens the box for what is not typed in place: a picture, a background, an address, a section title. */
    open(view: AreaView, el: HTMLElement): void;
    /** The area being typed in changed (null when none): the strip shows the formatting buttons, the spot its Done and Cancel. */
    typing(view: AreaView | null, el: HTMLElement | null): void;
    /** The field a card's marked value is typed into in place, or null when it is changed in the form. */
    cardText(card: CardRef, sub: string): string | null;
    /**
     * Opens a card's form in the panel, on the field a value shows when there is
     * one; `typing` when its words are typed on the page, so the panel need not
     * slide over the card.
     */
    openCard(card: CardRef, sub: string | null, typing?: boolean): void;
    /** Saves what was typed into a card's field. */
    saveCardText(card: CardRef, field: string, value: string): void;
    /** The pointer is over a card (null when it left every card): the card bar follows it. */
    cardHover(el: HTMLElement | null): void;
    /** A click on the page that opens nothing: words or a picture fixed by the design. */
    fixedClick?(target: Element, x: number, y: number): void;
}

function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** The card a page element is in, outside the header and footer (VE-D20), or null. */
export function cardOf(target: Element | null): { el: HTMLElement; card: CardRef } | null {
    const el = target?.closest<HTMLElement>('[data-arc-card-id]') ?? null;
    if (!el || el.closest('arc-header, arc-footer')) return null;
    const type = el.getAttribute('data-arc-card-type') || '';
    const id = el.getAttribute('data-arc-card-id') || '';
    return type && id ? { el, card: { type, id } } : null;
}

/** What is being typed in: a marked area, or a card's field. */
interface Typing {
    view: AreaView | null;
    card?: { card: CardRef; field: string };
    el: HTMLElement;
    /** The element's HTML before typing, put back by Cancel. */
    before: string;
}

/** Outlines that say what can be changed, drawn in the frame's document. */
export const IN_PLACE_CSS = `
[data-arc-edit]:not([data-arc-fixed]) { cursor: pointer; }
[data-arc-edit]:not([data-arc-fixed]):hover { outline: 2px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-editing], [data-arc-editing]:hover { outline: 2px solid var(--arc-edit-accent); outline-offset: 2px; cursor: text; }
[data-arc-editing]:empty { min-width: 4ch; min-height: 1em; display: inline-block; }
/* An empty area: a faint box with its placeholder, so it can be found and clicked. */
[data-arc-edit]:not(img):not([data-arc-edit-kind="background"]):not([data-arc-editing]):empty { display: inline-block; min-width: 8ch; min-height: 1.2em; opacity: .65;
  outline: 1px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-edit]:not(img):not([data-arc-edit-kind="background"]):not([data-arc-editing]):empty::before { content: attr(data-arc-placeholder); font-style: italic; opacity: .7; }
a[data-arc-edit], a[data-arc-edit] * { cursor: pointer; }
[data-arc-card-id] { cursor: pointer; }
[data-arc-card-id]:hover, [data-arc-card-open] { outline: 2px dashed var(--arc-edit-accent); outline-offset: 4px; }
[data-arc-card-open] { outline-style: solid; }
[data-arc-card-id] [data-arc-sub]:hover { outline: 1px dotted var(--arc-edit-accent); outline-offset: 1px; }
[data-arc-card-id] [data-arc-editing] { outline: 2px solid var(--arc-edit-accent); outline-offset: 2px; cursor: text; }
[data-arc-leaving] { opacity: .45; }
[data-arc-card-id]:is([data-arc-held], [data-arc-elsewhere], [data-arc-theirs]) { outline: 2px dashed #b45309; outline-offset: 4px; }
:is([data-arc-leaving], [data-arc-held], [data-arc-elsewhere])[data-arc-note]::after { content: attr(data-arc-note); display: block; margin-top: 4px; padding: 2px 6px; border-radius: 4px;
  font: 600 12px/1.4 system-ui, sans-serif; color: #fff; background: #333; opacity: 1; }
arc-header [data-arc-card-id], arc-footer [data-arc-card-id] { cursor: auto; outline: none; }
`;

/** Words as typed: plain text with its spaces tidied, or rich text through the allow-list. */
export function typedValue(view: AreaView, el: HTMLElement): string {
    if (view.area.kind === 'rich') return sanitizeRichText(el.innerHTML).replace(/^(<br>)+$/, '').trim();
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** The `background-image` of a style, replaced; the rest of the style kept. */
function withBackground(style: string, url: string): string {
    const kept = style.replace(/(^|;)\s*background-image\s*:[^;]*/gi, '$1').trim().replace(/;+\s*$/, '');
    return `${kept ? `${kept}; ` : ''}background-image: url("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

export class PageInPlace {
    private current: Typing | null = null;
    private style: HTMLStyleElement | null = null;

    constructor(private doc: Document, private host: PageInPlaceHost) {}

    attach(): void {
        this.style = this.doc.createElement('style');
        this.style.setAttribute('data-arc-in-place', '');
        // The admin's own accent, as the entry's Visual Editor uses it (in-place.ts).
        this.style.textContent = `:root { --arc-edit-accent: ${adminAccent()}; }\n${IN_PLACE_CSS}`;
        this.doc.head.appendChild(this.style);
        this.doc.addEventListener('click', this.onClick, true);
        this.doc.addEventListener('keydown', this.onKey, true);
        this.doc.addEventListener('submit', this.stop, true);
        this.doc.addEventListener('mouseover', this.onOver, true);
        this.doc.documentElement.addEventListener('mouseleave', this.onLeave);
    }

    detach(): void {
        this.done();
        this.style?.remove();
        this.doc.removeEventListener('click', this.onClick, true);
        this.doc.removeEventListener('keydown', this.onKey, true);
        this.doc.removeEventListener('submit', this.stop, true);
        this.doc.removeEventListener('mouseover', this.onOver, true);
        this.doc.documentElement.removeEventListener('mouseleave', this.onLeave);
    }

    /** The area being typed in, if any. */
    get typing(): AreaView | null {
        return this.current?.view ?? null;
    }

    /** Words are being typed on a card. */
    get typingCard(): boolean {
        return !!this.current?.card;
    }

    private stop = (event: Event): void => event.preventDefault();

    private onClick = (event: MouseEvent): void => {
        // Not `instanceof Element`: the page's elements belong to the frame's window, not this one.
        const target = event.target && typeof (event.target as Element).closest === 'function' ? (event.target as Element) : null;
        // Nothing on the page navigates or submits inside the editor.
        if (target?.closest('a, button, [type="submit"]')) event.preventDefault();
        const marked = target?.closest<HTMLElement>('[data-arc-edit]') ?? null;
        // A card inside a marked block (its section title marks the whole block) is the card's (VE-D54).
        const card = cardOf(target);
        const el = marked && card && marked.contains(card.el) ? null : marked;
        if (this.current && (el === this.current.el || (target && this.current.card && this.current.el.contains(target)))) return;
        const typing = !!this.current;
        this.done();
        if (!el) {
            // A click away from the words being typed in only finishes them; with none open,
            // a click on what cannot be changed says so and shows what can.
            if (!this.onCardClick(target, event) && !typing && target) this.host.fixedClick?.(target, event.clientX, event.clientY);
            return;
        }
        const view = this.host.areaFor(el.getAttribute('data-arc-edit') || '');
        if (!view) {
            // A marked area the page keeps as its file has it (it holds other areas).
            if (!typing && target) this.host.fixedClick?.(target, event.clientX, event.clientY);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (view.hasWords && (view.area.kind === 'text' || view.area.kind === 'rich' || view.area.kind === 'link')) {
            this.startTyping(view, el, event);
            // A link's address is in the box, beside its words typed in place.
            if (view.area.kind === 'link') this.host.open(view, el);
        } else {
            this.host.open(view, el);
        }
    };

    /** A click on a card (VE-D54): its value typed in place, or its form opened. */
    private onCardClick(target: Element | null, event: MouseEvent): boolean {
        const found = cardOf(target);
        if (!found) return false;
        event.preventDefault();
        event.stopPropagation();
        const subEl = target?.closest<HTMLElement>('[data-arc-sub]') ?? null;
        const sub = subEl && found.el.contains(subEl) ? subEl.getAttribute('data-arc-sub') || '' : '';
        const field = sub && !subEl!.hasAttribute('data-arc-field-attr') && !found.el.hasAttribute('data-arc-leaving')
            ? this.host.cardText(found.card, sub) : null;
        if (field && subEl) this.startCardTyping(found.card, field, subEl, event);
        else this.host.openCard(found.card, sub || null);
        return true;
    }

    private startCardTyping(card: CardRef, field: string, el: HTMLElement, event: MouseEvent): void {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.setAttribute('data-arc-editing', '');
        this.current = { view: null, card: { card, field }, el, before: el.innerHTML };
        el.focus();
        this.caretAt(el, event);
        this.host.openCard(card, null, true);
        this.host.typing(null, el);
    }

    private onOver = (event: MouseEvent): void => {
        const target = event.target && typeof (event.target as Element).closest === 'function' ? (event.target as Element) : null;
        const el = cardOf(target)?.el ?? null;
        if (el === this.hovered) return;
        this.hovered = el;
        this.host.cardHover(el);
    };

    private onLeave = (): void => {
        if (!this.hovered) return;
        this.hovered = null;
        this.host.cardHover(null);
    };

    private hovered: HTMLElement | null = null;

    private onKey = (event: KeyboardEvent): void => {
        const current = this.current;
        if (!current) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancel();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (current.view?.area.kind === 'rich') this.doc.execCommand('insertLineBreak');
            else this.done();
        }
    };

    private startTyping(view: AreaView, el: HTMLElement, event?: MouseEvent): void {
        el.setAttribute('contenteditable', view.area.kind === 'rich' ? 'true' : 'plaintext-only');
        el.setAttribute('data-arc-editing', '');
        this.current = { view, el, before: el.innerHTML };
        el.focus();
        this.caretAt(el, event);
        this.host.typing(view, el);
    }

    /** The caret where the click was, as in any text box. */
    private caretAt(el: HTMLElement, event?: MouseEvent): void {
        const at = event && (this.doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
        if (at && el.contains(at.startContainer)) {
            const selection = this.doc.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(at);
        }
    }

    private stopTyping(): Typing | null {
        const current = this.current;
        if (!current) return null;
        current.el.removeAttribute('contenteditable');
        current.el.removeAttribute('data-arc-editing');
        this.current = null;
        this.host.typing(null, null);
        return current;
    }

    /** Done (VE-D37): the words typed are saved, unless nothing changed. */
    done(): void {
        const current = this.stopTyping();
        if (!current) return;
        if (current.card) {
            const typed = (current.el.textContent || '').replace(/\s+/g, ' ').trim();
            const holder = this.doc.createElement('div');
            holder.innerHTML = current.before;
            if (typed !== (holder.textContent || '').replace(/\s+/g, ' ').trim()) this.host.saveCardText(current.card.card, current.card.field, typed);
            return;
        }
        const view = current.view!;
        const value = typedValue(view, current.el);
        const before = view.words || '';
        // Unchanged: as saved, or still the words shown from the file (or a translation).
        if (value === before || (!before && value === typedValue(view, this.fallbackElement(view)))) return;
        this.host.saveWords(view, value);
    }

    /** Cancel (VE-D37): what was there before typing comes back, nothing is saved. */
    cancel(): void {
        const current = this.stopTyping();
        if (current) current.el.innerHTML = current.before;
    }

    /** An element holding the words shown when nothing is saved, to compare what was typed with. */
    private fallbackElement(view: AreaView): HTMLElement {
        const el = this.doc.createElement('div');
        // The file's own words are trusted; saved words go through the allow-list.
        if (view.area.kind === 'rich') el.innerHTML = view.wordsFallback === view.area.fileText ? view.area.fileText : sanitizeRichText(view.wordsFallback);
        else el.textContent = view.wordsFallback;
        return el;
    }

    /** Puts each area's value on the page; the one being typed in is left alone (VE-D52). */
    patch(views: AreaView[]): void {
        // A marked area the editor does not offer (it holds other areas, review M2, M3) is
        // fixed: no outline, and a click on it says so.
        const offered = new Set(views.map((view) => view.area.key));
        for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>('[data-arc-edit]'))) {
            const fixed = !offered.has(el.getAttribute('data-arc-edit') || '');
            if (el.hasAttribute('data-arc-fixed') !== fixed) el.toggleAttribute('data-arc-fixed', fixed);
        }
        for (const view of views) {
            for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>(`[data-arc-edit="${cssEscape(view.area.key)}"]`))) {
                if (el === this.current?.el) continue;
                this.patchOne(view, el);
            }
        }
    }

    private patchOne(view: AreaView, el: HTMLElement): void {
        const words = view.words || view.wordsFallback;
        const url = safePageTextUrl(view.url) || view.fileUrl;
        switch (view.area.kind) {
            case 'text':
                if (el.textContent !== words) el.textContent = words;
                break;
            case 'rich': {
                // The file's own HTML is the developer's; anything saved goes through the allow-list.
                const html = view.words ? sanitizeRichText(view.words) : view.wordsFallback === view.area.fileText ? view.area.fileText : sanitizeRichText(view.wordsFallback);
                if (el.innerHTML !== html) el.innerHTML = html;
                break;
            }
            case 'link':
                if (url && el.getAttribute('href') !== url) el.setAttribute('href', url);
                if (view.hasWords && el.textContent !== words) el.textContent = words;
                break;
            case 'picture':
                if (url && el.getAttribute('src') !== url) {
                    el.setAttribute('src', url);
                    for (const attr of ['srcset', 'sizes', 'width', 'height', ...LAZY_PICTURE_SIZES]) el.removeAttribute(attr);
                    for (const attr of LAZY_PICTURE_SRC) if (el.hasAttribute(attr)) el.setAttribute(attr, url);
                    if (el.parentElement?.tagName === 'PICTURE') el.parentElement.querySelectorAll('source').forEach((source) => source.remove());
                }
                if (el.getAttribute('alt') !== words) el.setAttribute('alt', words);
                break;
            case 'background':
                if (url) {
                    const style = withBackground(el.getAttribute('style') || '', url);
                    if (el.getAttribute('style') !== style) el.setAttribute('style', style);
                }
                break;
            case 'section-title':
                if (el.getAttribute('section-title') !== words) el.setAttribute('section-title', words);
                break;
        }
    }
}
