import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResizableDirective } from './resizable.directive';

@Component({
    standalone: true,
    imports: [ResizableDirective],
    template: `
        <div class="row">
            <div class="pane"></div>
            <div
                class="handle"
                [arcResizable]="key"
                [resizeVar]="'--panel-w'"
                [resizeEdge]="edge"
                [resizeMin]="200"
                [resizeMax]="600"
                [resizeDefault]="320"
                (resizeChange)="committed.push($event)"
            ></div>
            <aside class="panel"></aside>
        </div>
    `,
})
class HostComponent {
    key = 'spec.panel';
    edge: 'start' | 'end' = 'end';
    committed: number[] = [];
}

describe('ResizableDirective', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;
    let handle: HTMLElement;
    let row: HTMLElement;

    /** jsdom 22 has no PointerEvent, so stand one up from MouseEvent. */
    function pointerEvent(type: string, init: MouseEventInit = {}): Event {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        return event;
    }

    /** Inputs are read on init, so overrides are applied before the first pass. */
    function build(overrides: Partial<HostComponent> = {}): void {
        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        Object.assign(host, overrides);
        fixture.detectChanges();
        handle = fixture.nativeElement.querySelector('.handle');
        row = fixture.nativeElement.querySelector('.row');
    }

    /** Width currently published to the container, in px. */
    function panelWidth(): number {
        return parseInt(row.style.getPropertyValue('--panel-w'), 10);
    }

    /** Press on the handle and move the pointer to `toX`, without releasing. */
    function drag(fromX: number, toX: number): void {
        handle.dispatchEvent(pointerEvent('pointerdown', { clientX: fromX, button: 0 }));
        handle.dispatchEvent(pointerEvent('pointermove', { clientX: toX }));
    }

    function release(): void {
        handle.dispatchEvent(pointerEvent('pointerup'));
    }

    beforeEach(async () => {
        localStorage.clear();
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
        build();
    });

    describe('initial width', () => {
        it('publishes the default width as a custom property on the container', () => {
            expect(panelWidth()).toBe(320);
        });

        it('restores a previously stored width', () => {
            localStorage.setItem('arc:resizable:spec.panel', '450');
            build();
            expect(panelWidth()).toBe(450);
        });

        it('re-clamps a stored width that is out of bounds', () => {
            // Saved from a wider monitor — must not come back oversized.
            localStorage.setItem('arc:resizable:spec.panel', '5000');
            build();
            expect(panelWidth()).toBe(600);
        });

        it('falls back to the default when the stored width is corrupt', () => {
            localStorage.setItem('arc:resizable:spec.panel', 'not-a-number');
            build();
            expect(panelWidth()).toBe(320);
        });
    });

    describe('dragging', () => {
        it('widens a trailing panel as the pointer moves towards the start', () => {
            drag(800, 700);
            expect(panelWidth()).toBe(420);
        });

        it('narrows a trailing panel as the pointer moves towards the end', () => {
            drag(800, 860);
            expect(panelWidth()).toBe(260);
        });

        it('inverts the direction for a leading panel', () => {
            build({ edge: 'start' });
            drag(800, 700);
            expect(panelWidth()).toBe(220);
        });

        it('clamps at the maximum', () => {
            drag(800, 0);
            expect(panelWidth()).toBe(600);
        });

        it('clamps at the minimum', () => {
            drag(800, 1600);
            expect(panelWidth()).toBe(200);
        });

        it('ignores pointer movement when no drag is in progress', () => {
            handle.dispatchEvent(pointerEvent('pointermove', { clientX: 100 }));
            expect(panelWidth()).toBe(320);
        });

        it('ignores non-primary buttons', () => {
            handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 800, button: 2 }));
            handle.dispatchEvent(pointerEvent('pointermove', { clientX: 700 }));
            expect(panelWidth()).toBe(320);
        });

        it('stops the browser starting a text selection with the same gesture', () => {
            const event = pointerEvent('pointerdown', { clientX: 800, button: 0 });
            handle.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        });

        it('captures the pointer so the drag survives leaving the handle', () => {
            const capture = vi.fn();
            (handle as HTMLElement & { setPointerCapture: unknown }).setPointerCapture = capture;
            handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 800, button: 0 }));
            expect(capture).toHaveBeenCalledWith(1);
        });
    });

    describe('document lock', () => {
        it('suppresses selection and pins the cursor while dragging', () => {
            drag(800, 700);
            expect(document.body.style.userSelect).toBe('none');
            expect(document.body.style.cursor).toBe('col-resize');
        });

        it('restores the previous body styles on release', () => {
            document.body.style.cursor = 'wait';
            drag(800, 700);
            release();
            expect(document.body.style.userSelect).toBe('');
            expect(document.body.style.cursor).toBe('wait');
        });

        it('releases the lock when the drag is cancelled', () => {
            drag(800, 700);
            handle.dispatchEvent(pointerEvent('pointercancel'));
            expect(document.body.style.cursor).toBe('');
        });
    });

    describe('committing', () => {
        it('persists the width on release', () => {
            drag(800, 700);
            release();
            expect(localStorage.getItem('arc:resizable:spec.panel')).toBe('420');
        });

        it('emits the committed width once per drag', () => {
            drag(800, 700);
            release();
            expect(host.committed).toEqual([420]);
        });

        it('does not emit while the drag is still in progress', () => {
            drag(800, 700);
            expect(host.committed).toEqual([]);
        });

        it('skips persistence when no storage key is given', () => {
            build({ key: '' });
            drag(800, 700);
            release();
            expect(localStorage.length).toBe(0);
        });
    });

    describe('reset and keyboard', () => {
        it('restores the default width on double-click', () => {
            drag(800, 700);
            release();
            handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            expect(panelWidth()).toBe(320);
            expect(localStorage.getItem('arc:resizable:spec.panel')).toBe('320');
        });

        it('widens a trailing panel with ArrowLeft', () => {
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
            expect(panelWidth()).toBe(336);
        });

        it('narrows a trailing panel with ArrowRight', () => {
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            expect(panelWidth()).toBe(304);
        });

        it('inverts the arrow keys for a leading panel', () => {
            build({ edge: 'start' });
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
            expect(panelWidth()).toBe(304);
        });

        it('restores the default width with Home', () => {
            drag(800, 700);
            release();
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
            expect(panelWidth()).toBe(320);
        });

        it('leaves unrelated keys alone', () => {
            const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
            handle.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(panelWidth()).toBe(320);
        });
    });

    describe('accessibility', () => {
        it('exposes the handle as a separator with its current width', () => {
            expect(handle.getAttribute('role')).toBe('separator');
            expect(handle.getAttribute('aria-orientation')).toBe('vertical');
            expect(handle.getAttribute('tabindex')).toBe('0');
            expect(handle.getAttribute('aria-valuemin')).toBe('200');
            expect(handle.getAttribute('aria-valuemax')).toBe('600');
            expect(handle.getAttribute('aria-valuenow')).toBe('320');
        });

        it('keeps aria-valuenow in step with the width', () => {
            drag(800, 700);
            release();
            fixture.detectChanges();
            expect(handle.getAttribute('aria-valuenow')).toBe('420');
        });
    });
});
