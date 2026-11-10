/**
 * The page behind older unsubscribe links (/unsubscribe/:waitlistId/:userId): it
 * never unsubscribes from the link's id. It asks for the address, the server emails
 * that address the signed one-click link, and the page says the same thing whatever
 * the server found.
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCall, mockArcCallable } = vi.hoisted(() => {
    const mockCall = vi.fn();
    return { mockCall, mockArcCallable: vi.fn(() => mockCall) };
});
vi.mock('../../../core/config/arc-functions', () => ({ arcCallable: mockArcCallable }));

import { UnsubscribeHandlingComponent } from './unsubscribe-handling.component';
import { GaTrackingService } from '../../../../shared/services/ga-tracking.service';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

describe('UnsubscribeHandlingComponent', () => {
    let ga: { trackUnsubscribeView: ReturnType<typeof vi.fn> };

    async function open(params: Record<string, string>, lang = 'en') {
        await TestBed.configureTestingModule({
            imports: [UnsubscribeHandlingComponent, translocoTestingModule({ lang })],
            providers: [
                { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(params)) } },
                { provide: Functions, useValue: {} },
                { provide: GaTrackingService, useValue: ga },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(UnsubscribeHandlingComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }

    function submit(fixture: Awaited<ReturnType<typeof open>>, email: string) {
        const el = fixture.nativeElement as HTMLElement;
        (el.querySelector('input[type="email"]') as HTMLInputElement).value = email;
        el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    }

    const text = (fixture: Awaited<ReturnType<typeof open>>) => (fixture.nativeElement as HTMLElement).textContent || '';

    beforeEach(() => {
        TestBed.resetTestingModule();
        mockCall.mockReset();
        mockArcCallable.mockClear();
        ga = { trackUnsubscribeView: vi.fn() };
    });

    it('asks for the address and calls nothing on opening, and sends no id to analytics', async () => {
        const fixture = await open({ waitlistId: 'w1', userId: 'u1' });
        expect(text(fixture)).toContain('Enter your email address');
        expect(mockCall).not.toHaveBeenCalled();
        expect(ga.trackUnsubscribeView).toHaveBeenCalledWith('w1');
    });

    it('sends the address with the old link\'s ids, then says the same whatever was found', async () => {
        mockCall.mockResolvedValue({ data: { ok: true } });
        const fixture = await open({ waitlistId: 'w1', userId: 'u1' });

        submit(fixture, ' reader@example.com ');
        await fixture.whenStable();
        fixture.detectChanges();

        expect(mockArcCallable).toHaveBeenCalledWith(expect.anything(), 'unsubscribeLegacyLink');
        expect(mockCall).toHaveBeenCalledWith({ email: 'reader@example.com', userId: 'u1', waitlistId: 'w1' });
        expect(text(fixture)).toContain('If that address is on our list, we sent it a link.');
    });

    it('works from the shorter link too', async () => {
        mockCall.mockResolvedValue({ data: { ok: true } });
        const fixture = await open({ userId: 'u1' });
        submit(fixture, 'reader@example.com');
        await fixture.whenStable();
        expect(mockCall).toHaveBeenCalledWith({ email: 'reader@example.com', userId: 'u1', waitlistId: undefined });
    });

    it('asks again for something that is not an address, without calling the server', async () => {
        const fixture = await open({ userId: 'u1' });
        submit(fixture, 'nope');
        await fixture.whenStable();
        fixture.detectChanges();
        expect(mockCall).not.toHaveBeenCalled();
        expect(text(fixture)).toContain('Enter a valid email address.');
    });

    it('says a limit was reached, and a plain retry otherwise, in its own words', async () => {
        mockCall.mockRejectedValueOnce({ code: 'functions/resource-exhausted', message: 'SERVER ENGLISH' });
        const fixture = await open({ userId: 'u1' });
        submit(fixture, 'reader@example.com');
        await fixture.whenStable();
        fixture.detectChanges();
        expect(text(fixture)).toContain('Too many attempts. Please try again later.');
        expect(text(fixture)).not.toContain('SERVER ENGLISH');

        mockCall.mockRejectedValueOnce({ code: 'functions/internal', message: 'INTERNAL' });
        submit(fixture, 'reader@example.com');
        await fixture.whenStable();
        fixture.detectChanges();
        expect(text(fixture)).toContain('Something went wrong. Please try again.');
        expect(text(fixture)).not.toContain('INTERNAL');
    });

    it('is translated: no English left in Hindi, the error included', async () => {
        const fixture = await open({ userId: 'u1' }, 'hi');
        expect(text(fixture)).toContain('सदस्यता छोड़ें');
        expect(text(fixture)).not.toMatch(/Unsubscribe|Enter your email|Send the link|Email address/);
        submit(fixture, 'nope');
        await fixture.whenStable();
        fixture.detectChanges();
        expect(text(fixture)).toContain('सही ईमेल पता लिखें।');
    });
});
