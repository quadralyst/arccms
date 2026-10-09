import { describe, expect, it, vi } from 'vitest';
import { Component, signal, ViewEncapsulation } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MemberLanguagePickerComponent } from './member-language-picker.component';
import { MemberLanguageService } from '../../../app/core/i18n/member-language.service';

const ENGLISH = { code: 'en', label: 'English', locale: 'en-US' };
const GERMAN = { code: 'de', label: 'Deutsch', locale: 'de-CH' };

function render(languages: unknown[]) {
    const activeLang = signal('en');
    const use = vi.fn((code: string) => activeLang.set(code));
    TestBed.configureTestingModule({
        imports: [MemberLanguagePickerComponent],
        providers: [{ provide: MemberLanguageService, useValue: { languages, activeLang, use } }],
    });
    const fixture = TestBed.createComponent(MemberLanguagePickerComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, use };
}

describe('MemberLanguagePickerComponent', () => {
    it('shows nothing when the app declares no member languages', () => {
        expect(render([ENGLISH]).el.querySelector('button')).toBeNull();
    });

    it('shows the language now in use, in its own name, with a translated label', () => {
        const button = render([ENGLISH, GERMAN]).el.querySelector('button')!;
        expect(button.textContent).toContain('English');
        expect(button.getAttribute('aria-label')).toBe('Choose a language');
    });

    it('switches to the language chosen from the menu', () => {
        const { fixture, el, use } = render([ENGLISH, GERMAN]);
        el.querySelector<HTMLButtonElement>('button')!.click();
        fixture.detectChanges();
        const german = [...document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')].find((b) => b.textContent?.includes('Deutsch'))!;
        expect(german.getAttribute('lang')).toBe('de');
        german.click();
        fixture.detectChanges();
        expect(use).toHaveBeenCalledWith('de');
        expect(el.querySelector('button')!.textContent).toContain('Deutsch');
    });

    it('works inside a Shadow DOM host: its own icon and styles, no Font Awesome', () => {
        @Component({
            selector: 'arc-shadow-host',
            standalone: true,
            imports: [MemberLanguagePickerComponent],
            encapsulation: ViewEncapsulation.ShadowDom,
            template: '<arc-member-language-picker />',
        })
        class ShadowHostComponent {}

        const activeLang = signal('en');
        TestBed.configureTestingModule({
            imports: [ShadowHostComponent],
            providers: [{ provide: MemberLanguageService, useValue: { languages: [ENGLISH, GERMAN], activeLang, use: vi.fn() } }],
        });
        const fixture = TestBed.createComponent(ShadowHostComponent);
        fixture.detectChanges();
        const root = (fixture.nativeElement as HTMLElement).shadowRoot!;
        const button = root.querySelector('button.member-lang-btn')!;
        expect(button.querySelector('svg')).not.toBeNull();
        expect(root.querySelectorAll('[class*="fa-"], i')).toHaveLength(0);
        const styles = [...root.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        expect(styles).toContain('.member-lang-btn');
    });
});
