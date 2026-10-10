import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { beforeEach, describe, expect, it } from 'vitest';
import { CropRect } from '../../utils/image-crop';
import { CropImageSize, ImageCropperComponent } from './image-cropper.component';

@Component({
    standalone: true,
    imports: [ImageCropperComponent],
    template: `<arc-image-cropper [src]="src()" [ratio]="ratio()" [crossOrigin]="cors()"
        (rectChange)="rects.push($event)" (loaded)="sizes.push($event)" (failed)="failures = failures + 1" />`,
})
class HostComponent {
    src = signal('https://example.com/photo.webp');
    ratio = signal<number | null>(null);
    cors = signal(false);
    rects: CropRect[] = [];
    sizes: CropImageSize[] = [];
    failures = 0;
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
});
