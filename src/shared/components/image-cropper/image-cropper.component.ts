import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, ElementRef, input, output, signal, viewChild } from '@angular/core';
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
 */
@Component({
    selector: 'arc-image-cropper',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="arc-cropper" [class.loaded]="size()">
            <img #image [src]="src()" [attr.crossorigin]="crossOrigin() ? 'anonymous' : null"
                [alt]="'admin.media.crop.image_alt' | transloco" draggable="false"
                (load)="onLoad()" (error)="failed.emit()">
            @if (size() && rect(); as r) {
            <div class="arc-cropper-frame" tabindex="0" role="group"
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
    `,
    styles: [`
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

    readonly size = signal<CropImageSize | null>(null);
    readonly rect = signal<CropRect | null>(null);

    /** Every handle. Edges stay with a ratio too: they resize about the opposite edge's middle. */
    readonly handles: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    private readonly image = viewChild.required<ElementRef<HTMLImageElement>>('image');
    private drag: { handle: CropHandle; startX: number; startY: number; start: CropRect; pointerId: number; target: Element } | null = null;
    /** Removes the window listeners of the drag in progress, if any. */
    private stopDrag: (() => void) | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => this.stopDrag?.());
        // A new ratio (or a new image) starts a fresh frame.
        effect(() => {
            const ratio = this.ratio();
            const size = this.size();
            if (!size) return;
            this.setRect(initialCropRect(ratio, size.width, size.height));
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
        const delta = moves[event.key];
        if (!delta) return;
        event.preventDefault();
        this.setRect(dragCropRect(rect, 'move', delta[0], delta[1], this.ratio(), size.width, size.height));
    }

    private setRect(rect: CropRect): void {
        const size = this.size();
        if (!size) return;
        this.rect.set(rect);
        this.rectChange.emit(roundCropRect(rect, size.width, size.height));
    }
}
