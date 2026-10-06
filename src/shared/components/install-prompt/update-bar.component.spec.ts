import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { PwaService } from '../../../app/core/pwa/pwa.service';
import { PwaUpdateRouteService } from '../../../app/core/pwa/pwa-update-route';
import { PwaUpdateBarComponent } from './update-bar.component';

describe('PwaUpdateBarComponent', () => {
    const ready = signal(false);
    const closed = signal(false);
    const appOwns = signal(false);
    const pwa = { updateReady: ready, updateBarClosed: closed, applyUpdate: vi.fn(), dismissUpdate: vi.fn() };

    function render(): HTMLElement {
        TestBed.configureTestingModule({
            imports: [PwaUpdateBarComponent, translocoTestingModule()],
            providers: [
                { provide: PwaService, useValue: pwa },
                { provide: PwaUpdateRouteService, useValue: { appOwns } },
            ],
        });
        const fixture = TestBed.createComponent(PwaUpdateBarComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        ready.set(false);
        closed.set(false);
        appOwns.set(false);
    });

    it('shows nothing until a version is waiting', () => {
        expect(render().querySelector('.update-bar')).toBeNull();
    });

    it('offers the update, and applies it when the person taps Update', () => {
        ready.set(true);
        const el = render();
        const update = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Update')!;
        update.click();
        expect(pwa.applyUpdate).toHaveBeenCalled();
    });

    it('closes without applying', () => {
        ready.set(true);
        render().querySelector<HTMLButtonElement>('.btn-close')!.click();
        expect(pwa.dismissUpdate).toHaveBeenCalled();
        expect(pwa.applyUpdate).not.toHaveBeenCalled();
    });

    it('stays hidden after it was closed', () => {
        ready.set(true);
        closed.set(true);
        expect(render().querySelector('.update-bar')).toBeNull();
    });

    it('stays out of the way on a page where the app shows the update itself', () => {
        ready.set(true);
        appOwns.set(true);
        expect(render().querySelector('.update-bar')).toBeNull();
    });
});
