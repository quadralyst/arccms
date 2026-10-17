/**
 * Keeping a form's button in sight above a phone's on-screen keyboard.
 *
 * Safari on an iPhone leaves the page its full height when the keyboard opens and shrinks
 * only the visual viewport, so the focused field is scrolled into view but the button
 * under it is not. `trackKeyboard` measures the visual viewport, tells the page how much
 * room the keyboard takes (`--arc-keyboard-height`, and a `keyboard-open` class) so the
 * page can give itself that much room at the foot, and scrolls the form's submit button
 * to just above the keyboard.
 */

/** Less than this is a browser bar moving, not a keyboard. */
export const KEYBOARD_MIN_PX = 120;
/** The room kept between the button and the keyboard. */
export const KEYBOARD_GAP_PX = 12;

/** What the keyboard takes of the page: the layout viewport less the visual one, or 0 for a browser bar. */
export function keyboardHeight(layoutHeight: number, visualHeight: number): number {
    const taken = layoutHeight - visualHeight;
    return taken >= KEYBOARD_MIN_PX ? Math.round(taken) : 0;
}

/** How far to scroll so a button's bottom clears the keyboard; 0 when it already does. */
export function scrollNeeded(buttonBottom: number, visualTop: number, visualHeight: number): number {
    return Math.max(0, Math.ceil(buttonBottom - (visualTop + visualHeight - KEYBOARD_GAP_PX)));
}

const FIELD = 'input, textarea, select, [contenteditable="true"]';

/** Starts tracking inside `host`; returns the function that stops it. Does nothing without a visual viewport. */
export function trackKeyboard(host: HTMLElement, win: Window = window): () => void {
    const viewport = win.visualViewport;
    if (!viewport) return () => undefined;
    const doc = host.ownerDocument;

    const update = () => {
        const focused = !!doc.activeElement && host.contains(doc.activeElement) && doc.activeElement.matches(FIELD);
        const height = focused ? keyboardHeight(win.innerHeight, viewport.height) : 0;
        host.style.setProperty('--arc-keyboard-height', `${height}px`);
        host.classList.toggle('keyboard-open', height > 0);
        if (height === 0) return;
        const button = host.querySelector<HTMLElement>('button[type="submit"]:not([disabled])');
        if (!button) return;
        const delta = scrollNeeded(button.getBoundingClientRect().bottom, viewport.offsetTop, viewport.height);
        if (delta > 0) win.scrollBy({ top: delta, behavior: 'smooth' });
    };

    // Moving from one field to the next blurs before it focuses: look after the move, so the page does not drop its room and take it back.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const afterBlur = () => {
        clearTimeout(settle);
        settle = setTimeout(update, 50);
    };

    viewport.addEventListener('resize', update);
    host.addEventListener('focusin', update);
    host.addEventListener('focusout', afterBlur);
    return () => {
        clearTimeout(settle);
        viewport.removeEventListener('resize', update);
        host.removeEventListener('focusin', update);
        host.removeEventListener('focusout', afterBlur);
        host.style.removeProperty('--arc-keyboard-height');
        host.classList.remove('keyboard-open');
    };
}
