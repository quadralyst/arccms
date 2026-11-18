/**
 * Where a caret menu (slash commands, emoji, merge tags) goes. The menus are drawn
 * in the admin's own document; an editor mounted on the page inside the edit-on-page
 * screen's frame (specs/visual-editing-spec.md, VE3.2 build note, fix 2) reports its
 * caret in the frame's coordinates, so the frame's place on the screen is added.
 */
export interface CaretBox {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/** The frame an element is in, when that is not the document the menus are drawn in. */
function hostFrame(el: Element | null | undefined): Element | null {
    const doc = el?.ownerDocument;
    if (!doc || typeof document === 'undefined' || doc === document) return null;
    try {
        return (doc.defaultView?.frameElement as Element | null) ?? null;
    } catch {
        return null;
    }
}

/** A box in the editor's own document, moved into the admin document's coordinates. */
export function toHostBox(el: Element | null | undefined, box: CaretBox): CaretBox {
    const frame = hostFrame(el);
    if (!frame) return box;
    const at = frame.getBoundingClientRect();
    return { top: box.top + at.top, bottom: box.bottom + at.top, left: box.left + at.left, right: box.right + at.left };
}

/** A zero-size rect at the caret, for tippy's getReferenceClientRect. */
export function caretRect(el: Element | null | undefined, box: CaretBox): DOMRect {
    const b = toHostBox(el, box);
    return { width: 0, height: 0, top: b.top, bottom: b.bottom, left: b.left, right: b.right, x: b.left, y: b.top, toJSON: () => '' } as DOMRect;
}
