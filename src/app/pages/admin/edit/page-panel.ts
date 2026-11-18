import { computed, signal } from '@angular/core';

/** How long after the page is drawn the panel peeks. */
export const PEEK_DELAY_MS = 500;
/** How far the panel slides out when it peeks. */
export const PEEK_PX = 48;
/** How long it stays out. */
export const PEEK_HOLD_MS = 1000;
/** A press on the handle that moves less than this is a click, not a drag. */
export const DRAG_SLOP_PX = 4;

/**
 * The Page settings panel's state on the edit-on-page screen
 * (specs/visual-editing-spec.md, VE-D26): one open or closed state for the
 * strip's button, the handle and Escape; dragging the handle pulls the panel
 * out with the pointer; and the peek when the screen opens.
 *
 * Plain state with no DOM, so the rules are tested on their own. The screen
 * draws the panel `shown()` pixels out from the right edge.
 */
export class PagePanel {
    /** Open or closed: the one state the button, the handle and Escape change. */
    readonly open = signal(false);
    /** Pixels shown while the handle is dragged or the panel peeks; null follows `open`. */
    private readonly pulled = signal<number | null>(null);
    /** The panel's width, as last measured. */
    readonly width = signal(320);

    /** Pixels of the panel on screen. */
    readonly shown = computed(() => {
        const pulled = this.pulled();
        if (pulled !== null) return pulled;
        return this.open() ? this.width() : 0;
    });
    /**
     * Where the panel sits, as a CSS transform: fully out or fully in by percentage when
     * settled, so a width changed with the panel's own grip needs no measuring; pixels
     * only while it is dragged or peeks.
     */
    readonly transform = computed(() => {
        const pulled = this.pulled();
        if (pulled === null) return this.open() ? 'translateX(0)' : 'translateX(100%)';
        return `translateX(calc(100% - ${pulled}px))`;
    });
    /** True while the handle is held, so the panel follows the pointer with no animation. */
    readonly dragging = signal(false);
    /** True while the panel is out for the peek. */
    readonly peeking = signal(false);

    /** The editor clicked or typed in the page: the peek has nothing to tell them. */
    private touched = false;
    private peekTimers: ReturnType<typeof setTimeout>[] = [];
    private drag: { startX: number; startShown: number; wasOpen: boolean; moved: boolean } | null = null;

    toggle(): void {
        this.setOpen(!this.open());
    }

    setOpen(open: boolean): void {
        this.stopPeek();
        this.pulled.set(null);
        this.open.set(open);
    }

    /** Escape: closes. Returns whether it did anything. */
    escape(): boolean {
        if (!this.open() && !this.peeking()) return false;
        this.setOpen(false);
        return true;
    }

    /** A click or a key in the page. A click on the page never closes the panel. */
    touch(): void {
        this.touched = true;
        if (this.peeking()) this.stopPeek();
    }

    // ── The handle: click toggles, drag pulls ────────────────────────────────
    press(x: number, width: number): void {
        this.stopPeek();
        if (width > 0) this.width.set(width);
        this.drag = { startX: x, startShown: this.shown(), wasOpen: this.open(), moved: false };
    }

    move(x: number): void {
        const drag = this.drag;
        if (!drag) return;
        const travelled = drag.startX - x;
        if (!drag.moved && Math.abs(travelled) < DRAG_SLOP_PX) return;
        drag.moved = true;
        this.dragging.set(true);
        this.pulled.set(Math.max(0, Math.min(this.width(), drag.startShown + travelled)));
    }

    /**
     * Let go: a press that hardly moved toggles; a drag opens a closed panel
     * pulled past a third of its width and closes an open one pushed past a
     * third, else it slides back to where it was.
     */
    release(): void {
        const drag = this.drag;
        this.drag = null;
        this.dragging.set(false);
        if (!drag) return;
        if (!drag.moved) {
            this.setOpen(!drag.wasOpen);
            return;
        }
        const shown = this.shown();
        const third = this.width() / 3;
        const open = drag.wasOpen ? this.width() - shown <= third : shown > third;
        this.setOpen(open);
    }

    /** The pointer was lost mid-drag: back to where it was. */
    cancel(): void {
        const drag = this.drag;
        this.drag = null;
        this.dragging.set(false);
        if (drag) this.setOpen(drag.wasOpen);
    }

    // ── The peek ─────────────────────────────────────────────────────────────
    /**
     * Once the page is drawn: half a second later the panel slides out a little,
     * holds a second and slides back, so the editor sees it is there. Skipped
     * when they have already clicked or typed in the page, or opened it; no
     * motion when the computer asks for less (the handle simply shows).
     */
    peek(reducedMotion: boolean): void {
        if (reducedMotion || this.touched || this.open()) return;
        this.stopPeek();
        this.peekTimers.push(setTimeout(() => {
            if (this.touched || this.open() || this.drag) return;
            this.peeking.set(true);
            this.pulled.set(PEEK_PX);
            this.peekTimers.push(setTimeout(() => this.stopPeek(), PEEK_HOLD_MS));
        }, PEEK_DELAY_MS));
    }

    private stopPeek(): void {
        this.peekTimers.forEach(clearTimeout);
        this.peekTimers = [];
        if (this.peeking()) {
            this.peeking.set(false);
            if (!this.drag) this.pulled.set(null);
        }
    }

    destroy(): void {
        this.stopPeek();
    }
}
