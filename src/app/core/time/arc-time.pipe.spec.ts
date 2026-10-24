import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { ArcTimePipe } from './arc-time.pipe';
import { ArcTime, arcTime, localeForLanguage, type ZoneRef } from './arc-time.service';
import { ArcZones } from './arc-zones.service';
import { ArcClock } from './arc-clock';

// Anna in Zurich, Ravi in Pune (specs/clock-and-zones-spec.md, section 2).
const MESSAGE = Date.parse('2026-10-24T20:00:00Z');
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function fakeZones(member: string, site = 'UTC') {
    const memberZone = signal(member);
    return {
        memberZone,
        zones: { member: memberZone.asReadonly(), site: () => site, device: () => 'America/Phoenix' },
    };
}

function fakeClock(now: number) {
    const clockNow = signal(now);
    return { clockNow, clock: { now: clockNow.asReadonly() } };
}

@Component({
    standalone: true,
    imports: [ArcTimePipe],
    template: `<span class="t">{{ at | arcTime: format() : zone() : 'en-GB' }}</span>`,
})
class Host {
    at: unknown = MESSAGE;
    format = signal<string>('time');
    zone = signal<ZoneRef>('member');
}

describe('arcTime pipe and service (specs/clock-and-zones-spec.md, T-D15)', () => {
    let z: ReturnType<typeof fakeZones>;
    let c: ReturnType<typeof fakeClock>;

    beforeEach(() => {
        z = fakeZones('Asia/Kolkata', 'Europe/Zurich');
        c = fakeClock(MESSAGE + 150_000);
        TestBed.configureTestingModule({
            providers: [{ provide: ArcZones, useValue: z.zones }, { provide: ArcClock, useValue: c.clock }],
        });
    });
    afterEach(() => TestBed.resetTestingModule());

    it('resolves member, site, device, a zone name and a place, an unknown place falling back to the site', () => {
        const time = TestBed.inject(ArcTime);
        expect(time.zone()).toBe('Asia/Kolkata');
        expect(time.zone('member')).toBe('Asia/Kolkata');
        expect(time.zone('site')).toBe('Europe/Zurich');
        expect(time.zone('device')).toBe('America/Phoenix');
        expect(time.zone('Asia/Calcutta')).toBe('Asia/Kolkata');
        expect(time.zone({ zone: 'America/Phoenix', name: 'Shop' })).toBe('America/Phoenix');
        expect(time.zone({ zone: undefined })).toBe('Europe/Zurich');
        expect(time.zone('Mars/Olympus')).toBe('Europe/Zurich');
    });

    it("shows each reader their own time, and a place's time with theirs", () => {
        const time = TestBed.inject(ArcTime);
        expect(plain(time.format(MESSAGE, 'time', 'member', 'en-GB'))).toBe('01:30');
        expect(plain(arcTime(MESSAGE, 'place', 'Europe/Zurich', 'en-GB'))).toBe('22:00 Zurich (Sun 01:30 for you)');
        expect(plain(arcTime(MESSAGE, 'place', { zone: 'Europe/Zurich', name: 'Main Street' }, 'en-GB'))).toBe('22:00 Main Street (Sun 01:30 for you)');
        expect(plain(time.format(MESSAGE, 'ago', 'member', 'en-GB'))).toBe('2 minutes ago');
    });

    it('words the place label in the language on screen', () => {
        const transloco = TestBed.inject(TranslocoService);
        transloco.setActiveLang('hi');
        try {
            expect(plain(TestBed.inject(ArcTime).format(MESSAGE, 'place', 'Europe/Zurich', 'en-GB'))).toBe('22:00 Zurich (आपके लिए Sun 01:30)');
        } finally {
            transloco.setActiveLang('en');
        }
    });

    it("takes the browser's regional variant of the language on screen", () => {
        expect(localeForLanguage('en', ['de-CH', 'en-GB'])).toBe('en-GB');
        expect(localeForLanguage('en', ['fr-FR'])).toBe('en-US');
        expect(localeForLanguage('hi', ['hi-IN'])).toBe('hi-IN');
        expect(localeForLanguage('hi', [])).toBe('hi');
        expect(localeForLanguage('pt-BR', ['pt-PT'])).toBe('pt-BR');
    });

    it('renders in a template and follows a change of zone', async () => {
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        const text = () => plain(fixture.nativeElement.querySelector('.t').textContent);
        expect(text()).toBe('01:30');
        z.memberZone.set('Europe/Zurich');
        fixture.detectChanges();
        expect(text()).toBe('22:00');
        fixture.componentInstance.zone.set('America/Phoenix');
        fixture.detectChanges();
        expect(text()).toBe('13:00');
    });

    it('formats "ago" again only when the minute changes', () => {
        const time = TestBed.inject(ArcTime);
        const format = vi.spyOn(time, 'format');
        const fixture = TestBed.createComponent(Host);
        fixture.componentInstance.format.set('ago');
        fixture.detectChanges();
        const text = () => plain(fixture.nativeElement.querySelector('.t').textContent);
        expect(text()).toBe('2 minutes ago');
        const calls = format.mock.calls.length;
        c.clockNow.set(MESSAGE + 151_000);
        fixture.detectChanges();
        c.clockNow.set(MESSAGE + 170_000);
        fixture.detectChanges();
        expect(format.mock.calls.length).toBe(calls);
        c.clockNow.set(MESSAGE + 181_000);
        fixture.detectChanges();
        expect(text()).toBe('3 minutes ago');
        expect(format.mock.calls.length).toBe(calls + 1);
    });

    it('shows nothing for an empty moment', () => {
        const fixture = TestBed.createComponent(Host);
        fixture.componentInstance.at = null;
        fixture.detectChanges();
        expect(plain(fixture.nativeElement.querySelector('.t').textContent)).toBe('');
    });
});
