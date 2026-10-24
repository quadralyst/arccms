import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ArcClockComponent, clockDrift } from './arc-clock.component';
import { ArcClock } from '../../../app/core/time/arc-clock';
import { ArcZones } from '../../../app/core/time/arc-zones.service';

const NOW = Date.parse('2026-10-24T20:00:05Z');

describe('arc-clock (specs/clock-and-zones-spec.md, T-D16)', () => {
    const offset = signal(0);
    const skewed = signal(false);

    beforeEach(() => {
        offset.set(0);
        skewed.set(false);
        TestBed.configureTestingModule({
            providers: [
                { provide: ArcClock, useValue: { now: () => NOW, offset, skewed } },
                { provide: ArcZones, useValue: { member: () => 'Asia/Kolkata', site: () => 'UTC', device: () => 'UTC' } },
            ],
        });
    });
    afterEach(() => TestBed.resetTestingModule());

    function render(zone?: string) {
        const fixture = TestBed.createComponent(ArcClockComponent);
        if (zone) fixture.componentRef.setInput('zone', zone);
        fixture.componentRef.setInput('format', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('shows the true time in the reader\'s zone, or a zone it is given, with no warning when the clock is right', () => {
        expect(render().querySelector('time')?.textContent).toContain('01:30:05');
        expect(render('Europe/Zurich').querySelector('time')?.textContent).toContain('22:00:05');
        expect(render().querySelector('time')?.getAttribute('datetime')).toBe('2026-10-24T20:00:05.000Z');
        expect(render().querySelector('.arc-clock-warning')).toBeNull();
    });

    it('says how far the device is fast or slow when it is off', () => {
        offset.set(-7 * 60_000);
        skewed.set(true);
        expect(render().querySelector('.arc-clock-warning')?.textContent).toContain("This device's clock is 7 minutes fast");
        offset.set(3 * 3_600_000);
        expect(render().querySelector('.arc-clock-warning')?.textContent).toContain("This device's clock is 3 hours slow");
    });

    it('words the drift in minutes, then hours from two hours', () => {
        expect(clockDrift(-7 * 60_000, 'en-GB')).toBe('7 minutes');
        expect(clockDrift(90 * 60_000, 'en-GB')).toBe('90 minutes');
        expect(clockDrift(5 * 3_600_000, 'en-GB')).toBe('5 hours');
        expect(clockDrift(30_000, 'en-GB')).toBe('30 seconds');
        expect(clockDrift(7 * 60_000, 'de-CH')).toBe('7 Minuten');
    });
});
