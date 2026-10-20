import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, ElementRef, Injector, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CropHandle, CropRect, dragCropRect, initialCropRect, roundCropRect } from '../../utils/image-crop';

/** The image's own size, reported once it has loaded. */
export interface CropImageSize {
    width: number;
    height: number;
}

/**
 * A crop frame over an image: drag inside it to move it, drag a corner or an
 * edge to resize it. It only chooses a rectangle; what is done with it (a new
 * upload, an Unsplash URL) is the caller's business.
 *
 *   <arc-image-cropper [src]="url" [ratio]="4 / 3" (rectChange)="rect = $event" />
 *
 * `ratio` is width / height, or null for a free frame. Changing it resets
 * the frame to the largest centred one of that shape. `rectChange` reports
 * the frame in the image's own pixels, rounded, after load and after every
 * change. Arrow keys move the focused frame (Shift for bigger steps).
 *
 * Set `crossOrigin` when the caller will draw the image on a canvas, so the
 * browser loads it in a way the canvas may read.
 *
 * Optional, for the PDF crop step (PI-D19); callers that pass none of these
 * see no change:
 * - `frame` places the frame (image pixels) instead of the centred one,
 *   whenever it changes and when the image loads. The caller owns it: to go
 *   back to the centred frame, set it to null.
 * - `zoom` shows the image larger than fits (1 is fit) in a scrolling view.
 *   The cropper asks for another zoom through `zoomChange` (Ctrl or Cmd with
 *   the wheel, which is also a trackpad pinch, a two-finger pinch, the + and
 *   - keys); the caller decides. Dragging outside the frame pans.
 */
@Component({
    selector: 'arc-image-cropper',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[class.arc-cropper-zoomed]': 'zoomed()' },
    template: `
        <div class="arc-cropper-viewport" #viewport (wheel)="onWheel($event)" (pointerdown)="startGesture($event)">
        <div class="arc-cropper" [class.loaded]="size()" [style.width.px]="shownWidth()">
            <img #image [src]="src()" [attr.crossorigin]="crossOrigin() ? 'anonymous' : null"
                [alt]="'admin.media.crop.image_alt' | transloco" draggable="false"
                [style.width.px]="shownWidth()"
                (load)="onLoad()" (error)="failed.emit()">
            @if (size() && rect(); as r) {
            <div class="arc-cropper-frame" #frameEl tabindex="0" role="group"
                [attr.aria-label]="'admin.media.crop.frame_label' | transloco"
                [style.left.%]="pct(r.x, 'w')" [style.top.%]="pct(r.y, 'h')"
                [style.width.%]="pct(r.width, 'w')" [style.height.%]="pct(r.height, 'h')"
                (pointerdown)="startDrag($event, 'move')" (keydown)="onKey($event)">
                <span class="arc-cropper-grid" aria-hidden="true"></span>
                @for (handle of handles; track handle) {
                <span [class]="'arc-cropper-handle h-' + handle" aria-hidden="true"
                    (pointerdown)="startDrag($event, handle)"></span>
                }
            </div>
            }
        </div>
        </div>
    `,
    styles: [`
        :host {
            display: inline-block;
            max-width: 100%;
            line-height: 0;
        }
        :host(.arc-cropper-zoomed) {
            display: block;
            width: 100%;
            align-self: stretch;
        }
        .arc-cropper-viewport {
            max-width: 100%;
            line-height: 0;
        }
        :host(.arc-cropper-zoomed) .arc-cropper-viewport {
            overflow: auto;
            max-height: var(--arc-cropper-max-height, 60vh);
            text-align: center;
            cursor: grab;
            touch-action: none;
        }
        :host(.arc-cropper-zoomed) .arc-cropper,
        :host(.arc-cropper-zoomed) .arc-cropper img {
            max-width: none;
            max-height: none;
        }
        .arc-cropper {
            position: relative;
            display: inline-block;
            max-width: 100%;
            line-height: 0;
            overflow: hidden;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            background: #e9ecef;
        }
        .arc-cropper img {
            display: block;
            max-width: 100%;
            max-height: var(--arc-cropper-max-height, 60vh);
            width: auto;
            height: auto;
            pointer-events: none;
        }
        .arc-cropper-frame {
            position: absolute;
            box-sizing: border-box;
            border: 2px solid #fff;
            outline: 1px solid rgba(0, 0, 0, 0.45);
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
            cursor: move;
            touch-action: none;
        }
        .arc-cropper-frame:focus-visible {
            outline: 3px solid var(--arc-admin-accent, #2563eb);
        }
        .arc-cropper-grid {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
                linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),
                linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px));
        }
        /* A 24px touch target around a 12px visible square. */
        .arc-cropper-handle {
            position: absolute;
            width: 24px;
            height: 24px;
            margin: -12px 0 0 -12px;
            touch-action: none;
        }
        .arc-cropper-handle::after {
            content: '';
            position: absolute;
            inset: 6px;
            background: #fff;
            border: 1px solid rgba(0, 0, 0, 0.5);
            border-radius: 2px;
        }
        .h-nw { left: 0; top: 0; cursor: nwse-resize; }
        .h-ne { left: 100%; top: 0; cursor: nesw-resize; }
        .h-sw { left: 0; top: 100%; cursor: nesw-resize; }
        .h-se { left: 100%; top: 100%; cursor: nwse-resize; }
        .h-n { left: 50%; top: 0; cursor: ns-resize; }
        .h-s { left: 50%; top: 100%; cursor: ns-resize; }
        .h-w { left: 0; top: 50%; cursor: ew-resize; }
        .h-e { left: 100%; top: 50%; cursor: ew-resize; }
    `],
})
export class ImageCropperComponent {
    readonly src = input.required<string>();
    /** Width / height, or null for a free frame. */
    readonly ratio = input<number | null>(null);
    readonly crossOrigin = input(false);

    /** The frame in image pixels, rounded. */
    readonly rectChange = output<CropRect>();
    /** The image's own size, once it has loaded. */
    readonly loaded = output<CropImageSize>();
    /** The image could not be loaded. */
    readonly failed = output<void>();
    /** A frame to place, in image pixels; null for the centred one. */
    readonly frame = input<CropRect | null>(null);
    /** 1 shows the whole image; 2 shows it twice as large, scrolling. */
    readonly zoom = input(1);
    /** Let the wheel, a pinch and the + and - keys ask for zoom. Off, they keep their usual meaning. */
    readonly zoomable = input(false);
    /** The zoom the admin asked for with the wheel, a pinch or a key. */
    readonly zoomChange = output<number>();

    readonly size = signal<CropImageSize | null>(null);
    /** The `src` whose image has loaded: a frame is placed only on the image it was meant for. */
    private readonly loadedSrc = signal<string | null>(null);
    readonly rect = signal<CropRect | null>(null);

    /** Every handle. Edges stay with a ratio too: they resize about the opposite edge's middle. */
    readonly handles: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    private readonly image = viewChild.required<ElementRef<HTMLImageElement>>('image');
    private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
    private readonly frameEl = viewChild<ElementRef<HTMLElement>>('frameEl');
    private readonly injector = inject(Injector);

    readonly zoomed = computed(() => this.zoom() > 1.001);
    /** The width the whole image fits in, measured once zoomed. */
    private readonly fitWidth = signal<number | null>(null);
    /** The image's width on screen when zoomed; null leaves it to the stylesheet. */
    readonly shownWidth = computed(() => {
        const fit = this.fitWidth();
        return this.zoomed() && fit ? fit * this.zoom() : null;
    });
    /** Where a zoom gesture was, so that point stays under the pointer. */
    private anchor: { fx: number; fy: number; ax: number; ay: number } | null = null;
    private pointers = new Map<number, { x: number; y: number }>();
    private gesture: { kind: 'pan'; x: number; y: number; left: number; top: number } | { kind: 'pinch'; distance: number; zoom: number } | null = null;
    private stopGesture: (() => void) | null = null;
    private drag: { handle: CropHandle; startX: number; startY: number; start: CropRect; pointerId: number; target: Element } | null = null;
    /** Removes the window listeners of the drag in progress, if any. */
    private stopDrag: (() => void) | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.stopDrag?.();
            this.stopGesture?.();
            if (typeof window !== 'undefined') window.removeEventListener('resize', this.onResize);
        });
        if (typeof window !== 'undefined') window.addEventListener('resize', this.onResize);

        // A new ratio (or a new image) starts a fresh frame, unless the
        // caller placed one.
        effect(() => {
            const ratio = this.ratio();
            const size = this.size();
            const placed = this.frame();
            // A new image and its frame can arrive together, before the
            // old image has gone: wait for the new one, or the frame would be
            // measured against the old image and reported wrongly.
            if (!size || this.loadedSrc() !== this.src()) return;
            if (!placed) {
                this.setRect(initialCropRect(ratio, size.width, size.height));
                return;
            }
            this.setRect(roundCropRect(placed, size.width, size.height));
            // A placed frame may be outside the part shown when zoomed.
            if (untracked(this.zoomed)) {
                afterNextRender(() => this.frameEl()?.nativeElement.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }), { injector: this.injector });
            }
        });

        // Zoomed, or a new image while zoomed: measure what fits.
        effect(() => {
            const zoomed = this.zoomed();
            const size = this.size();
            if (!zoomed || !size) return;
            afterNextRender(() => this.measureFit(), { injector: this.injector });
        });

        // A new zoom keeps the gesture's point, or the frame's middle, in place.
        effect(() => {
            const width = this.shownWidth();
            if (width === null) return;
            const anchor = untracked(() => this.anchor ?? this.frameAnchor());
            this.anchor = null;
            if (!anchor) return;
            afterNextRender(() => {
                const view = this.viewport().nativeElement;
                view.scrollLeft = anchor.fx * view.scrollWidth - anchor.ax;
                view.scrollTop = anchor.fy * view.scrollHeight - anchor.ay;
            }, { injector: this.injector });
        });
        effect(() => {
            this.src();
            this.size.set(null);
            this.rect.set(null);
        });
    }

    onLoad(): void {
        const img = this.image().nativeElement;
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        this.size.set(size);
        this.loadedSrc.set(this.src());
        this.loaded.emit(size);
    }

    /** `value` image pixels as a percentage of the image's width or height. */
    pct(value: number, axis: 'w' | 'h'): number {
        const size = this.size();
        if (!size) return 0;
        return (value / (axis === 'w' ? size.width : size.height)) * 100;
    }

    startDrag(event: PointerEvent, handle: CropHandle): void {
        const rect = this.rect();
        if (!rect || (event.pointerType === 'mouse' && event.button !== 0)) return;
        // A handle sits inside the frame; only the innermost one may start a drag.
        event.stopPropagation();
        event.preventDefault();

        const target = event.currentTarget as Element;
        target.setPointerCapture?.(event.pointerId);
        this.stopDrag?.();
        this.drag = { handle, startX: event.clientX, startY: event.clientY, start: rect, pointerId: event.pointerId, target };

        const move = (e: PointerEvent) => this.onDrag(e);
        const end = (e: PointerEvent) => {
            if (e.pointerId !== this.drag?.pointerId) return;
            this.drag.target.releasePointerCapture?.(e.pointerId);
            this.stopDrag?.();
        };
        this.stopDrag = () => {
            this.drag = null;
            this.stopDrag = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }

    private onDrag(event: PointerEvent): void {
        const drag = this.drag;
        const size = this.size();
        if (!drag || !size || event.pointerId !== drag.pointerId) return;
        // Screen pixels to image pixels: the image is usually shown smaller.
        const scale = size.width / (this.image().nativeElement.clientWidth || size.width);
        const dx = (event.clientX - drag.startX) * scale;
        const dy = (event.clientY - drag.startY) * scale;
        this.setRect(dragCropRect(drag.start, drag.handle, dx, dy, this.ratio(), size.width, size.height));
    }

    onKey(event: KeyboardEvent): void {
        const rect = this.rect();
        const size = this.size();
        if (!rect || !size) return;
        const step = Math.max(1, Math.round(Math.max(size.width, size.height) * (event.shiftKey ? 0.05 : 0.01)));
        const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        };
        if (this.zoomable() && (event.key === '+' || event.key === '=')) {
            event.preventDefault();
            this.zoomChange.emit(this.zoom() * 1.25);
            return;
        }
        if (this.zoomable() && (event.key === '-' || event.key === '_')) {
            event.preventDefault();
            this.zoomChange.emit(this.zoom() / 1.25);
            return;
        }
        const delta = moves[event.key];
        if (!delta) return;
        event.preventDefault();
        this.setRect(dragCropRect(rect, 'move', delta[0], delta[1], this.ratio(), size.width, size.height));
    }

    /** Ctrl or Cmd with the wheel zooms about the pointer; a trackpad pinch arrives this way too. */
    onWheel(event: WheelEvent): void {
        if (!this.zoomable() || !(event.ctrlKey || event.metaKey) || !this.size()) return;
        event.preventDefault();
        // About 1.3 times a mouse wheel notch (deltaY 100); a trackpad pinch sends small steps.
        this.requestZoom(this.zoom() * Math.exp(-event.deltaY * 0.0025), event.clientX, event.clientY);
    }

    /**
     * Outside the frame: one pointer pans a zoomed image, two pinch to zoom.
     * The frame, its handles and the marks keep their own pointers.
     */
    startGesture(event: PointerEvent): void {
        if (!this.size() || (event.pointerType === 'mouse' && event.button !== 0)) return;
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (this.pointers.size === 2 && this.zoomable()) {
            this.gesture = { kind: 'pinch', distance: this.pointerDistance(), zoom: this.zoom() };
        } else if (this.pointers.size === 1 && this.zoomed()) {
            const view = this.viewport().nativeElement;
            this.gesture = { kind: 'pan', x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop };
            event.preventDefault();
        } else {
            this.gesture = null;
        }
        if (this.stopGesture) return;

        const move = (e: PointerEvent) => {
            if (!this.pointers.has(e.pointerId)) return;
            this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const gesture = this.gesture;
            if (gesture?.kind === 'pan') {
                const view = this.viewport().nativeElement;
                view.scrollLeft = gesture.left - (e.clientX - gesture.x);
                view.scrollTop = gesture.top - (e.clientY - gesture.y);
            } else if (gesture?.kind === 'pinch' && gesture.distance > 0) {
                const [a, b] = [...this.pointers.values()];
                const next = gesture.zoom * (this.pointerDistance() / gesture.distance);
                if (Math.abs(next - this.zoom()) / this.zoom() > 0.01) this.requestZoom(next, (a.x + b.x) / 2, (a.y + b.y) / 2);
            }
        };
        const end = (e: PointerEvent) => {
            this.pointers.delete(e.pointerId);
            // One finger left after a pinch: no pan, or the view would jump.
            this.gesture = null;
            if (!this.pointers.size) this.stopGesture?.();
        };
        this.stopGesture = () => {
            this.pointers.clear();
            this.gesture = null;
            this.stopGesture = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }

    private pointerDistance(): number {
        const [a, b] = [...this.pointers.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }

    /** Asks the caller for `zoom`, keeping the point at (clientX, clientY) where it is. */
    private requestZoom(zoom: number, clientX: number, clientY: number): void {
        const view = this.viewport().nativeElement;
        const box = view.getBoundingClientRect();
        const ax = clientX - box.left;
        const ay = clientY - box.top;
        if (view.scrollWidth > 0 && view.scrollHeight > 0) {
            this.anchor = { fx: (view.scrollLeft + ax) / view.scrollWidth, fy: (view.scrollTop + ay) / view.scrollHeight, ax, ay };
        }
        this.zoomChange.emit(zoom);
    }

    /** The frame's middle, kept in the middle of the view. */
    private frameAnchor(): { fx: number; fy: number; ax: number; ay: number } | null {
        const rect = this.rect();
        const size = this.size();
        if (!rect || !size) return null;
        const view = this.viewport().nativeElement;
        return {
            fx: (rect.x + rect.width / 2) / size.width,
            fy: (rect.y + rect.height / 2) / size.height,
            ax: view.clientWidth / 2,
            ay: view.clientHeight / 2,
        };
    }

    /** The width the whole image fits in: the view's width and its tallest height. */
    private measureFit(): void {
        const size = this.size();
        if (!size || !this.zoomed()) return;
        const view = this.viewport().nativeElement;
        const width = view.clientWidth;
        let height = parseFloat(getComputedStyle(view).maxHeight);
        if (!(height > 0)) height = window.innerHeight * 0.6;
        if (!(width > 0)) return;
        this.fitWidth.set(Math.min(1, width / size.width, height / size.height) * size.width);
    }

    private readonly onResize = () => this.measureFit();

    private setRect(rect: CropRect): void {
        const size = this.size();
        if (!size) return;
        this.rect.set(rect);
        this.rectChange.emit(roundCropRect(rect, size.width, size.height));
    }
}
