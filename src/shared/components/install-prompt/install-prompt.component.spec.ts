import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, computed, signal, ViewEncapsulation } from '@angular/core';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { PwaService, type InstallMode } from '../../../app/core/pwa/pwa.service';
import { InstallPromptComponent } from './install-prompt.component';

describe('InstallPromptComponent', () => {
    const mode = signal<InstallMode | null>(null);
    const pwa = {
        installMode: mode,
        showInstall: computed(() => mode() !== null),
        install: vi.fn(),
        dismiss: vi.fn(),
        shown: vi.fn(),
    };

    function render() {
        TestBed.configureTestingModule({
            imports: [InstallPromptComponent, translocoTestingModule()],
            providers: [{ provide: PwaService, useValue: pwa }],
        });
        const fixture = TestBed.createComponent(InstallPromptComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        mode.set(null);
    });

    it('shows nothing when the app cannot be installed here', () => {
        expect(render().textContent?.trim()).toBe('');
        expect(pwa.shown).not.toHaveBeenCalled();
    });

    it('offers an Install button where the browser has its own dialog', () => {
        mode.set('prompt');
        const el = render();
        const install = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Install')!;
        install.click();
        expect(pwa.install).toHaveBeenCalled();
        expect(pwa.shown).toHaveBeenCalled();
    });

    it('walks an iPhone through Share, then Add to Home Screen', () => {
        mode.set('ios-safari');
        const steps = render().querySelectorAll('.install-steps li');
        expect(steps).toHaveLength(2);
        expect(steps[1].textContent).toContain('Add to Home Screen');
    });

    it('walks Chrome on iPhone through its own Share button, not off to Safari', () => {
        mode.set('ios-browser');
        const el = render();
        const steps = el.querySelectorAll('.install-steps li');
        expect(steps).toHaveLength(2);
        expect(steps[0].textContent).toContain('Tap the Share button in your browser.');
        expect(steps[1].textContent).toContain('Add to Home Screen');
        expect(el.textContent).not.toContain('Safari');
    });

    it('sends only a web view inside another app to Safari', () => {
        mode.set('ios-other');
        expect(render().textContent).toContain('open this page in Safari');
    });

    it('needs no Bootstrap or Font Awesome: its buttons and icons are its own', () => {
        for (const value of ['prompt', 'ios-safari', 'ios-browser', 'ios-other'] as const) {
            TestBed.resetTestingModule();
            mode.set(value);
            const el = render();
            expect(el.querySelectorAll('[class*="btn"], [class*="fa-"], i')).toHaveLength(0);
            expect(el.querySelector('.install-icon svg')).not.toBeNull();
        }
    });

    it('renders its buttons, icons and styles inside a Shadow DOM host', () => {
        @Component({
            selector: 'arc-shadow-host',
            standalone: true,
            imports: [InstallPromptComponent],
            encapsulation: ViewEncapsulation.ShadowDom,
            template: '<arc-install-prompt />',
        })
        class ShadowHostComponent {}

        mode.set('ios-safari');
        TestBed.configureTestingModule({
            imports: [ShadowHostComponent, translocoTestingModule()],
            providers: [{ provide: PwaService, useValue: pwa }],
        });
        const fixture = TestBed.createComponent(ShadowHostComponent);
        fixture.detectChanges();
        const root = (fixture.nativeElement as HTMLElement).shadowRoot!;
        expect(root).not.toBeNull();
        expect(root.querySelectorAll('.install-steps svg.step-icon')).toHaveLength(2);
        expect(root.querySelector('button.install-button')).not.toBeNull();
        // The card's own styles are inside the shadow root, where they apply.
        const styles = [...root.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        expect(styles).toContain('.install-button-quiet');
        expect(styles).toContain('.step-icon');
    });

    it('hides on "Not now"', () => {
        mode.set('prompt');
        const el = render();
        [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Not now')!.click();
        expect(pwa.dismiss).toHaveBeenCalled();
    });
});
