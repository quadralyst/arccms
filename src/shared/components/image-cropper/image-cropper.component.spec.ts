import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropRect } from '../../utils/image-crop';
import { CropImageSize, CropMark, ImageCropperComponent } from './image-cropper.component';

@Component({
    standalone: true,
    imports: [ImageCropperComponent],
    template: `<arc-image-cropper [src]="src()" [ratio]="ratio()" [crossOrigin]="cors()"
        [frame]="frame()" [zoom]="zoom()" [zoomable]="zoomable()" [marks]="marks()"
        (rectChange)="rects.push($event)" (loaded)="sizes.push($event)" (failed)="failures = failures + 1"
        (zoomChange)="zooms.push($event)" (markPicked)="picked.push($event)" />`,
})
class HostComponent {
    src = signal('https://example.com/photo.webp');
    ratio = signal<number | null>(null);
    cors = signal(false);
    rects: CropRect[] = [];
    sizes: CropImageSize[] = [];
    failures = 0;
    frame = signal<CropRect | null>(null);
    zoom = signal(1);
    zoomable = signal(false);
    marks = signal<CropMark[]>([]);
    zooms: number[] = [];
    picked: number[] = [];
}

/** jsdom never loads images: give the element a size and fire its load. */
function load(fixture: ComponentFixture<HostComponent>, width = 1200, height = 800): HTMLImageElement {
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
    img.dispatchEvent(new Event('load'));
    fixture.detectChanges();
    return img;
}

function pointer(type: string, target: EventTarget, x: number, y: number): void {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }) as any;
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    target.dispatchEvent(event);
}

describe('ImageCropperComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HostComponent, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
        }).compileComponents();
        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('shows no frame until the image has loaded', () => {
        expect(fixture.nativeElement.querySelector('.arc-cropper-frame')).toBeNull();
        expect(host.rects).toEqual([]);
    });

    it('reports the image size and a frame over the whole image when free', () => {
        load(fixture);
        expect(host.sizes).toEqual([{ width: 1200, height: 800 }]);
        expect(host.rects.at(-1)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
        const frame: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-frame');
        expect(frame.style.width).toBe('100%');
        expect(fixture.nativeElement.querySelectorAll('.arc-cropper-handle').length).toBe(8);
    });

    it('starts a fresh centred frame when the ratio changes', () => {
        load(fixture);
        host.ratio.set(1);
        fixture.detectChanges();
        expect(host.rects.at(-1)).toEqual({ x: 200, y: 0, width: 800, height: 800 });
        const frame: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-frame');
        expect(parseFloat(frame.style.left)).toBeCloseTo(16.667, 2);
    });

    it('moves the frame with the arrow keys, inside the image', () => {
        host.ratio.set(1);
        fixture.detectChanges();
        load(fixture);
        const frame: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-frame');
        frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        // One step is 1% of the longest side: 12 px.
        expect(host.rects.at(-1)!.x).toBe(212);
        frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
        frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
        frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
        frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
        expect(host.rects.at(-1)!.x).toBe(0);
    });

    it('resizes from a corner by dragging, in image pixels', () => {
        load(fixture);
        const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
        // Shown at half size, so a 50 px drag is 100 image pixels.
        Object.defineProperty(img, 'clientWidth', { value: 600, configurable: true });
        const handle: HTMLElement = fixture.nativeElement.querySelector('.h-se');
        pointer('pointerdown', handle, 600, 400);
        pointer('pointermove', window, 550, 380);
        expect(host.rects.at(-1)).toEqual({ x: 0, y: 0, width: 1100, height: 760 });
        pointer('pointerup', window, 550, 380);
        const count = host.rects.length;
        pointer('pointermove', window, 100, 100);
        expect(host.rects.length).toBe(count);
    });

    it('asks for a canvas-readable image only when told to', () => {
        const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
        expect(img.getAttribute('crossorigin')).toBeNull();
        host.cors.set(true);
        fixture.detectChanges();
        expect(img.getAttribute('crossorigin')).toBe('anonymous');
    });

    it('reports an image that will not load', () => {
        fixture.nativeElement.querySelector('img').dispatchEvent(new Event('error'));
        expect(host.failures).toBe(1);
    });

    it('drops the frame when the image changes', () => {
        load(fixture);
        host.src.set('https://example.com/other.webp');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.arc-cropper-frame')).toBeNull();
    });

    describe('for the PDF crop step (PI-D19)', () => {
        it('places the frame it is given, kept inside the image, and the centred one again on null', () => {
            host.frame.set({ x: 100, y: 50, width: 300, height: 200 });
            fixture.detectChanges();
            load(fixture);
            expect(host.rects.at(-1)).toEqual({ x: 100, y: 50, width: 300, height: 200 });
            host.frame.set({ x: 1100, y: 700, width: 400, height: 400 });
            fixture.detectChanges();
            expect(host.rects.at(-1)).toEqual({ x: 1100, y: 700, width: 100, height: 100 });
            host.frame.set(null);
            fixture.detectChanges();
            expect(host.rects.at(-1)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
        });

        it('draws marks, says which one the frame is on, and reports a click', () => {
            host.marks.set([
                { rect: { x: 0, y: 0, width: 600, height: 400 }, label: 'Picture 1 of 2', taken: true },
                { rect: { x: 600, y: 400, width: 600, height: 400 }, label: 'Picture 2 of 2' },
            ]);
            host.frame.set({ x: 600, y: 400, width: 600, height: 400 });
            fixture.detectChanges();
            load(fixture);
            const marks: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.arc-cropper-mark'));
            expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual(['Picture 1 of 2', 'Picture 2 of 2']);
            expect(marks[0].classList).toContain('taken');
            expect(marks[1].classList).toContain('current');
            expect(marks[0].style.width).toBe('50%');
            marks[0].click();
            expect(host.picked).toEqual([0]);
        });

        it('leaves the wheel and the + and - keys alone unless zoom is asked for', () => {
            load(fixture);
            const frame: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-frame');
            frame.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
            const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
            fixture.nativeElement.querySelector('.arc-cropper-viewport').dispatchEvent(wheel);
            expect(host.zooms).toEqual([]);
            expect(wheel.defaultPrevented).toBe(false);
        });

        it('asks for more or less zoom with the keys and with Ctrl and the wheel', () => {
            host.zoomable.set(true);
            fixture.detectChanges();
            load(fixture);
            const frame: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-frame');
            frame.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
            frame.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
            expect(host.zooms).toEqual([1.25, 0.8]);
            const viewport: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-viewport');
            viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
            expect(host.zooms).toHaveLength(2);
            const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
            viewport.dispatchEvent(wheel);
            expect(host.zooms.at(-1)).toBeCloseTo(Math.exp(0.25));
            expect(wheel.defaultPrevented).toBe(true);
        });

        it('shows the image larger when zoomed, and keeps the frame in image pixels', async () => {
            load(fixture);
            const viewport: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-viewport');
            Object.defineProperty(viewport, 'clientWidth', { value: 600, configurable: true });
            host.zoom.set(2);
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
            const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
            expect(fixture.nativeElement.querySelector('arc-image-cropper').classList).toContain('arc-cropper-zoomed');
            // Fits at 600 px wide, so twice that.
            expect(img.style.width).toBe('1200px');
            expect(host.rects.at(-1)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
        });

        it('pans a zoomed image by dragging outside the frame', async () => {
            load(fixture);
            host.zoom.set(2);
            fixture.detectChanges();
            await fixture.whenStable();
            const viewport: HTMLElement = fixture.nativeElement.querySelector('.arc-cropper-viewport');
            viewport.scrollLeft = 0;
            pointer('pointerdown', fixture.nativeElement.querySelector('img'), 300, 300);
            pointer('pointermove', window, 250, 300);
            expect(viewport.scrollLeft).toBe(50);
            pointer('pointerup', window, 250, 300);
        });

        it('moves the frame when it is pressed over an outline, and picks only on a click outside it or on the number', () => {
            host.marks.set([{ rect: { x: 0, y: 0, width: 1200, height: 800 }, label: 'Picture 1 of 1' }]);
            host.frame.set({ x: 100, y: 100, width: 200, height: 200 });
            fixture.detectChanges();
            const img = load(fixture);
            Object.defineProperty(img, 'clientWidth', { value: 1200, configurable: true });
            vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
            const mark: HTMLButtonElement = fixture.nativeElement.querySelector('.arc-cropper-mark');
            // Inside the frame: a drag, not a pick.
            pointer('pointerdown', mark, 150, 150);
            pointer('pointermove', window, 170, 160);
            pointer('pointerup', window, 170, 160);
            mark.click();
            expect(host.rects.at(-1)).toEqual({ x: 120, y: 110, width: 200, height: 200 });
            expect(host.picked).toEqual([]);
            // Outside the frame: a pick.
            pointer('pointerdown', mark, 900, 600);
            mark.click();
            expect(host.picked).toEqual([0]);
            // The number always picks.
            const badge: HTMLElement = mark.querySelector('.arc-cropper-mark-badge')!;
            pointer('pointerdown', badge, 150, 150);
            badge.click();
            expect(host.picked).toEqual([0, 0]);
        });

        it('places a frame only once the image it was meant for has loaded', () => {
            load(fixture);
            const before = host.rects.length;
            host.src.set('https://example.com/sharper.webp');
            host.frame.set({ x: 400, y: 300, width: 900, height: 600 });
            fixture.detectChanges();
            expect(host.rects.length).toBe(before);
            load(fixture, 2400, 1600);
            expect(host.rects.at(-1)).toEqual({ x: 400, y: 300, width: 900, height: 600 });
        });
    });
});
