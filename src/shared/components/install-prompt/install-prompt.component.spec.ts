import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
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

    it('sends other iPhone browsers to Safari', () => {
        mode.set('ios-other');
        expect(render().textContent).toContain('open this page in Safari');
    });

    it('hides on "Not now"', () => {
        mode.set('prompt');
        const el = render();
        [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Not now')!.click();
        expect(pwa.dismiss).toHaveBeenCalled();
    });
});
