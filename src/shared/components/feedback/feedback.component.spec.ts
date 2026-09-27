import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { FeedbackService } from '../../../app/core/feedback/feedback.service';
import { clock, FeedbackComponent, routeHidesFeedback } from './feedback.component';

describe('routeHidesFeedback and clock', () => {
    it('finds feedbackButton: false anywhere on the way to the page', () => {
        const leaf: any = { data: { feedbackButton: false }, firstChild: null };
        expect(routeHidesFeedback({ data: {}, firstChild: { data: {}, firstChild: leaf } } as any)).toBe(true);
        expect(routeHidesFeedback({ data: {}, firstChild: null } as any)).toBe(false);
    });

    it('shows minutes and seconds', () => {
        expect(clock(0)).toBe('0:00');
        expect(clock(75)).toBe('1:15');
    });
});

describe('FeedbackComponent', () => {
    const available = signal(true);
    const panelOpen = signal(false);
    const service = {
        start: vi.fn(),
        available: computed(() => available()),
        panelOpen,
        capturing: signal(false),
        screenshot: signal<Blob | null>(null),
        openPanel: vi.fn(() => panelOpen.set(true)),
        closePanel: vi.fn(() => panelOpen.set(false)),
        removeScreenshot: vi.fn(() => service.screenshot.set(null)),
        screenshotReady: vi.fn(async () => undefined),
        send: vi.fn(async () => undefined),
    };

    async function render() {
        TestBed.configureTestingModule({
            imports: [FeedbackComponent, translocoTestingModule()],
            providers: [provideRouter([]), { provide: FeedbackService, useValue: service }],
        });
        const fixture = TestBed.createComponent(FeedbackComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }
    const buttonNamed = (el: HTMLElement, text: string) =>
        [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        available.set(true);
        panelOpen.set(false);
        service.screenshot.set(null);
    });

    it('shows the button only when feedback is available', async () => {
        const fixture = await render();
        expect(fixture.nativeElement.querySelector('.fb-button')).not.toBeNull();
        available.set(false);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.fb-button')).toBeNull();
    });

    it('opens the panel, sends the message, and thanks', async () => {
        const fixture = await render();
        const el = fixture.nativeElement as HTMLElement;
        (el.querySelector('.fb-button') as HTMLButtonElement).click();
        await fixture.whenStable();
        fixture.detectChanges();

        const send = buttonNamed(el, 'Send');
        expect(send.disabled).toBe(true); // nothing to send yet

        const text = el.querySelector('textarea')!;
        text.value = 'The lesson froze';
        text.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(send.disabled).toBe(false);

        send.click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(service.send).toHaveBeenCalledWith({ message: 'The lesson froze', screenshot: null, voice: null });
        expect(el.textContent).toContain('Thank you!');
    });

    it('shows the screenshot and lets it be removed', async () => {
        service.screenshot.set(new Blob(['jpg'], { type: 'image/jpeg' }));
        panelOpen.set(true);
        const fixture = await render();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.fb-shot img')).not.toBeNull();
        buttonNamed(el, 'Remove').click();
        fixture.detectChanges();
        expect(service.screenshot()).toBeNull();
        expect(el.querySelector('.fb-shot img')).toBeNull();
    });

    it('says so when sending fails, and keeps the message', async () => {
        service.send.mockRejectedValueOnce(new Error('offline'));
        panelOpen.set(true);
        const fixture = await render();
        const el = fixture.nativeElement as HTMLElement;
        const text = el.querySelector('textarea')!;
        text.value = 'Hello';
        text.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        buttonNamed(el, 'Send').click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(el.textContent).toContain('Could not send');
        expect(el.querySelector('textarea')!.value).toBe('Hello');
    });
});
