import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
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
});
