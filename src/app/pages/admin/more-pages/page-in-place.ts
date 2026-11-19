import { safePageTextUrl, sanitizeRichText } from '../../../core/utils/page-text-model';
import type { AreaView } from './page-text-editor.model';
import { adminAccent } from '../edit/in-place';

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
}

/** What is being typed in. */
interface Typing {
    view: AreaView;
    el: HTMLElement;
    /** The element's HTML before typing, put back by Cancel. */
    before: string;
}

/** Outlines that say what can be changed, drawn in the frame's document. */
export const IN_PLACE_CSS = `
[data-arc-edit] { cursor: pointer; }
[data-arc-edit]:hover { outline: 2px dashed var(--arc-edit-accent); outline-offset: 2px; }
[data-arc-editing], [data-arc-editing]:hover { outline: 2px solid var(--arc-edit-accent); outline-offset: 2px; cursor: text; }
[data-arc-editing]:empty { min-width: 4ch; min-height: 1em; display: inline-block; }
a[data-arc-edit], a[data-arc-edit] * { cursor: pointer; }
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
    }

    detach(): void {
        this.done();
        this.style?.remove();
        this.doc.removeEventListener('click', this.onClick, true);
        this.doc.removeEventListener('keydown', this.onKey, true);
        this.doc.removeEventListener('submit', this.stop, true);
    }

    /** The area being typed in, if any. */
    get typing(): AreaView | null {
        return this.current?.view ?? null;
    }

    private stop = (event: Event): void => event.preventDefault();

    private onClick = (event: MouseEvent): void => {
        // Not `instanceof Element`: the page's elements belong to the frame's window, not this one.
        const target = event.target && typeof (event.target as Element).closest === 'function' ? (event.target as Element) : null;
        // Nothing on the page navigates or submits inside the editor.
        if (target?.closest('a, button, [type="submit"]')) event.preventDefault();
        const el = target?.closest<HTMLElement>('[data-arc-edit]') ?? null;
        if (this.current && el === this.current.el) return;
        this.done();
        if (!el) return;
        const view = this.host.areaFor(el.getAttribute('data-arc-edit') || '');
        if (!view) return;
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

    private onKey = (event: KeyboardEvent): void => {
        const current = this.current;
        if (!current) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancel();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (current.view.area.kind === 'rich') this.doc.execCommand('insertLineBreak');
            else this.done();
        }
    };

    private startTyping(view: AreaView, el: HTMLElement, event?: MouseEvent): void {
        el.setAttribute('contenteditable', view.area.kind === 'rich' ? 'true' : 'plaintext-only');
        el.setAttribute('data-arc-editing', '');
        this.current = { view, el, before: el.innerHTML };
        el.focus();
        // The caret where the click was, as in any text box.
        const at = event && (this.doc as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
        if (at && el.contains(at.startContainer)) {
            const selection = this.doc.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(at);
        }
        this.host.typing(view, el);
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
        const value = typedValue(current.view, current.el);
        const before = current.view.words || '';
        // Unchanged: as saved, or still the words shown from the file (or a translation).
        if (value === before || (!before && value === typedValue(current.view, this.fallbackElement(current)))) return;
        this.host.saveWords(current.view, value);
    }

    /** Cancel (VE-D37): what was there before typing comes back, nothing is saved. */
    cancel(): void {
        const current = this.stopTyping();
        if (current) current.el.innerHTML = current.before;
    }

    /** An element holding the words shown when nothing is saved, to compare what was typed with. */
    private fallbackElement(current: Typing): HTMLElement {
        const el = this.doc.createElement('div');
        if (current.view.area.kind === 'rich') el.innerHTML = current.view.wordsFallback;
        else el.textContent = current.view.wordsFallback;
        return el;
    }

    /** Puts each area's value on the page; the one being typed in is left alone (VE-D52). */
    patch(views: AreaView[]): void {
        for (const view of views) {
            for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>(`[data-arc-edit="${view.area.key}"]`))) {
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
                    for (const attr of ['srcset', 'sizes', 'width', 'height']) el.removeAttribute(attr);
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
