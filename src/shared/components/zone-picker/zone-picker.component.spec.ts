import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ZonePickerComponent } from './zone-picker.component';
import { ArcZones } from '../../../app/core/time/arc-zones.service';
import { deviceZone } from '../../../app/core/time/zones';

@Component({
    standalone: true,
    imports: [ZonePickerComponent],
    template: `<arc-zone-picker [(value)]="zone" [allowAutomatic]="automatic()" label="Time zone" />`,
})
class Host {
    zone = signal<string | null>(null);
    automatic = signal(true);
}

describe('arc-zone-picker (specs/clock-and-zones-spec.md, T-D16)', () => {
    let fixture: ComponentFixture<Host>;
    const el = () => fixture.nativeElement as HTMLElement;
    const options = () => [...el().querySelectorAll('li[role="option"]')] as HTMLElement[];
    const type = (text: string) => {
        const box = el().querySelector('input') as HTMLInputElement;
        box.value = text;
        box.dispatchEvent(new Event('input'));
        fixture.detectChanges();
    };
    const open = () => {
        (el().querySelector('button.change') as HTMLButtonElement).click();
        fixture.detectChanges();
    };

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [{ provide: ArcZones, useValue: { member: () => 'UTC', site: () => 'UTC', device: () => 'UTC' } }] });
        fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
    });
    afterEach(() => TestBed.resetTestingModule());

    it('shows "Automatic" with the device\'s zone when nothing is chosen', () => {
        expect(el().textContent).toContain('Automatic:');
        expect(el().querySelector('[data-zone="automatic"]')).not.toBeNull();
    });

    it('says "Not set" when Automatic is not offered and nothing is chosen', () => {
        fixture.componentInstance.automatic.set(false);
        fixture.detectChanges();
        expect(el().textContent).toContain('Not set');
    });

    it('finds a zone by city, by its long name and by its offset, and chooses it', () => {
        open();
        expect(options()[0].textContent).toContain('Automatic');
        expect(options().some((o) => o.dataset['zone'] === deviceZone())).toBe(true);

        type('zur');
        expect(options()[0].dataset['zone']).toBe('Europe/Zurich');
        type('india');
        expect(options().map((o) => o.dataset['zone'])).toContain('Asia/Kolkata');
        type('phoenix');
        options()[0].click();
        fixture.detectChanges();
        expect(fixture.componentInstance.zone()).toBe('America/Phoenix');
        expect(el().querySelector('input')).toBeNull();
        expect(el().textContent).toContain('Phoenix, GMT-7');
    });

    it('goes back to Automatic (null), by keyboard', () => {
        fixture.componentInstance.zone.set('Europe/Zurich');
        fixture.detectChanges();
        open();
        const box = el().querySelector('input') as HTMLInputElement;
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        fixture.detectChanges();
        expect(fixture.componentInstance.zone()).toBeNull();
    });

    it('closes on Escape without changing the value, and says when nothing matches', () => {
        fixture.componentInstance.zone.set('Asia/Kolkata');
        fixture.detectChanges();
        open();
        type('qqqq');
        expect(el().textContent).toContain('No time zone matches');
        (el().querySelector('input') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        expect(el().querySelector('input')).toBeNull();
        expect(fixture.componentInstance.zone()).toBe('Asia/Kolkata');
    });
});
