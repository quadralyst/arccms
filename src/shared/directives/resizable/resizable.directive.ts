import { isPlatformBrowser } from '@angular/common';
import {
    Directive,
    ElementRef,
    EventEmitter,
    HostListener,
    inject,
    Input,
    OnInit,
    Output,
    PLATFORM_ID,
} from '@angular/core';

/** Namespace for the remembered widths so the keys stay recognisable. */
const STORAGE_PREFIX = 'arc:resizable:';

/**
 * Turns the host element into a vertical drag handle that resizes the panel
 * beside it.
 *
 * The width is published as a CSS custom property on the handle's parent; the
 * panel itself stays styled by the stylesheet:
 *
 * ```scss
 * .settings-sidebar { width: var(--sidebar-w, 320px); flex: 0 0 auto; }
 * ```
 *
 * Publishing a *variable* rather than an inline `width` is deliberate. An
 * inline width beats every stylesheet rule, so a width stored on the desktop
 * would leak into a stacked mobile layout and silently break it. A custom
 * property resolves through the normal cascade, so a `@media` block that
 * re-declares `width` still wins.
 *
 * Usage:
 * `<div arcResizable="editor.sidebar" resizeVar="--sidebar-w" [resizeMax]="640"></div>`
 */
@Directive({
    selector: '[arcResizable]',
    standalone: true,
    host: {
        role: 'separator',
        'aria-orientation': 'vertical',
        tabindex: '0',
        '[attr.aria-valuenow]': 'width',
        '[attr.aria-valuemin]': 'resizeMin',
        '[attr.aria-valuemax]': 'resizeMax',
        '[class.arc-resizing]': 'dragging',
    },
})
export class ResizableDirective implements OnInit {
    /** localStorage key for the remembered width. Empty disables persistence. */
    @Input('arcResizable') storageKey = '';

    /** Custom property written onto the parent element. */
    @Input() resizeVar = '--arc-panel-w';

    /** Lower bound, in px. Below this the panel's own contents start breaking. */
    @Input() resizeMin = 280;

    /** Upper bound, in px. Stops the panel swallowing the whole viewport. */
    @Input() resizeMax = 640;

    /** Width used on first run, and restored by double-click or Home. */
    @Input() resizeDefault = 320;

    /** Which side of the handle the resized panel sits on. */
    @Input() resizeEdge: 'start' | 'end' = 'end';

    /** Keyboard nudge step, in px. */
    @Input() resizeStep = 16;

    /** Emits the committed width when a drag, nudge or reset finishes. */
    @Output() resizeChange = new EventEmitter<number>();

    /** Current width of the panel, in px. Mirrored to `aria-valuenow`. */
    width = 320;

    /** True for the duration of a pointer drag. */
    dragging = false;

    private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly platformId = inject(PLATFORM_ID);

    private startX = 0;
    private startWidth = 0;
    private previousUserSelect = '';
    private previousCursor = '';

    ngOnInit(): void {
        // Re-clamp on read, not only on write: a width stored from a wider
        // monitor (or a corrupted entry) must not come back out of bounds.
        this.apply(this.restore() ?? this.resizeDefault);
    }

    @HostListener('pointerdown', ['$event'])
    onPointerDown(event: PointerEvent): void {
        if (event.button !== 0) return;

        // Stop the browser starting a text selection with the same gesture —
        // without this, dragging smears a highlight across the editor and
        // moves the caret out from under the user.
        event.preventDefault();

        this.startX = event.clientX;
        this.startWidth = this.width;
        this.dragging = true;
        this.capturePointer(event);
        this.lockBody();
    }

    @HostListener('pointermove', ['$event'])
    onPointerMove(event: PointerEvent): void {
        if (!this.dragging) return;
        const travelled = event.clientX - this.startX;
        // A panel to the right of the handle grows as the pointer moves left.
        const delta = this.resizeEdge === 'end' ? -travelled : travelled;
        this.apply(this.startWidth + delta);
    }

    @HostListener('pointerup')
    @HostListener('pointercancel')
    @HostListener('lostpointercapture')
    onPointerUp(): void {
        if (!this.dragging) return;
        this.dragging = false;
        this.unlockBody();
        this.commit();
    }

    /** Double-clicking the handle is the conventional way back to the default. */
    @HostListener('dblclick')
    onDoubleClick(): void {
        this.apply(this.resizeDefault);
        this.commit();
    }

    @HostListener('keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        const towardsStart = event.key === 'ArrowLeft';
        const towardsEnd = event.key === 'ArrowRight';
        if (!towardsStart && !towardsEnd && event.key !== 'Home') return;

        event.preventDefault();
        if (event.key === 'Home') {
            this.apply(this.resizeDefault);
        } else {
            // Moving the separator towards the start widens a panel that sits
            // at the end, and vice versa.
            const step = towardsStart ? this.resizeStep : -this.resizeStep;
            this.apply(this.width + (this.resizeEdge === 'end' ? step : -step));
        }
        this.commit();
    }

    /** The element carrying the custom property — the row holding both panes. */
    private get container(): HTMLElement {
        return this.el.nativeElement.parentElement ?? this.el.nativeElement;
    }

    private apply(next: number): void {
        this.width = this.clamp(next);
        this.container.style.setProperty(this.resizeVar, `${this.width}px`);
    }

    private clamp(value: number): number {
        if (!Number.isFinite(value)) return this.resizeDefault;
        return Math.min(this.resizeMax, Math.max(this.resizeMin, Math.round(value)));
    }

    private commit(): void {
        this.persist();
        this.resizeChange.emit(this.width);
    }

    /**
     * Retargets every later pointer event to the handle, so a drag survives the
     * pointer leaving the 8px hit area — or the window entirely.
     */
    private capturePointer(event: PointerEvent): void {
        const host = this.el.nativeElement;
        if (event.pointerId == null || typeof host.setPointerCapture !== 'function') return;
        try {
            host.setPointerCapture(event.pointerId);
        } catch {
            // Older engines fall back to plain bubbling; the drag still works
            // while the pointer stays over the handle.
        }
    }

    /**
     * Suppresses selection document-wide for the drag, and pins the cursor so
     * it stops flickering as it crosses the editor and the panel.
     */
    private lockBody(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        const { style } = document.body;
        this.previousUserSelect = style.userSelect;
        this.previousCursor = style.cursor;
        style.userSelect = 'none';
        style.cursor = 'col-resize';
    }

    private unlockBody(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        const { style } = document.body;
        style.userSelect = this.previousUserSelect;
        style.cursor = this.previousCursor;
    }

    private restore(): number | null {
        if (!this.storageKey || !isPlatformBrowser(this.platformId)) return null;
        try {
            const stored = localStorage.getItem(STORAGE_PREFIX + this.storageKey);
            if (stored === null) return null;
            const parsed = Number(stored);
            return Number.isFinite(parsed) ? parsed : null;
        } catch {
            return null; // Private mode, or storage disabled.
        }
    }

    private persist(): void {
        if (!this.storageKey || !isPlatformBrowser(this.platformId)) return;
        try {
            localStorage.setItem(STORAGE_PREFIX + this.storageKey, String(this.width));
        } catch {
            // Nothing to do — the width just won't survive a reload.
        }
    }
}
