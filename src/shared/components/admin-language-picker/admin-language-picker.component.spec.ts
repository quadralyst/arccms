import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminLanguagePickerComponent } from './admin-language-picker.component';
import { AdminLanguageService } from '../../../app/core/i18n/admin-language.service';

const state = vi.hoisted(() => ({ declared: false }));

vi.mock('../../../app/core/i18n/member-language.service', () => ({
    LanguageAreaService: class {},
    get MEMBER_LANGUAGES_DECLARED() {
        return state.declared;
    },
}));

const { LanguageAreaService } = await import('../../../app/core/i18n/member-language.service');

function render(inAdmin: boolean) {
    TestBed.configureTestingModule({
        imports: [AdminLanguagePickerComponent],
        providers: [
            {
                provide: AdminLanguageService,
                useValue: { languages: [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिन्दी' }], activeLang: signal('en'), use: vi.fn() },
            },
            { provide: LanguageAreaService, useValue: { inAdmin: signal(inAdmin) } },
        ],
    });
    const fixture = TestBed.createComponent(AdminLanguagePickerComponent);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.lang-btn');
}

describe('AdminLanguagePickerComponent', () => {
    it('shows everywhere when the app declares no member languages, as always', () => {
        state.declared = false;
        expect(render(false)).toBeTruthy();
    });

    it('shows in the admin area when the app declares member languages', () => {
        state.declared = true;
        expect(render(true)).toBeTruthy();
    });

    it('hides on member pages then: the admin\'s choice would not change them', () => {
        state.declared = true;
        expect(render(false)).toBeNull();
    });
});
