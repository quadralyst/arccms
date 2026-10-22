/**
 * The sign-up notice on the app's own sign-up pages (the sign-up page, the onboarding
 * wizard), with an app's own notices file (docs/app/sign-up-notice.html).
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LegalNoticeComponent } from './legal-notice.component';
import { SitePagesService } from '../../../app/core/site/site-pages.service';
import { LocalizationService } from '../../../app/core/services/localization.service';
import { TranslocoService } from '@jsverse/transloco';

// This spec is about an app's own file, so it mocks the file (src/test/setup.ts gives core specs the empty one).
vi.mock('../../../custom/notices', () => ({
    CUSTOM_NOTICES: {
        signup: {
            en: 'By signing up you accept the {terms} of Acme Ltd.',
            hi: 'साइन अप करके आप Acme की {terms} मानते हैं।',
            de: 'Mit der Anmeldung akzeptierst du die [AGB]({terms}) und den [Datenschutz](https://acme.example/datenschutz). [Mehr](javascript:alert`x`)',
        },
        contact: {},
    },
}));

function render(lang: string | undefined, defaultLanguage = 'en') {
    const load = vi.fn().mockResolvedValue({});
    TestBed.configureTestingModule({
        imports: [LegalNoticeComponent],
        providers: [
            { provide: SitePagesService, useValue: { pages: signal([{ url: '/info/terms' }]), load: vi.fn().mockResolvedValue([]) } },
            { provide: LocalizationService, useValue: { known: () => ({ defaultLanguage }), load } },
        ],
    });
    const fixture = TestBed.createComponent(LegalNoticeComponent);
    if (lang) fixture.componentRef.setInput('lang', lang);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, load };
}

const links = (el: HTMLElement) => Array.from(el.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);

describe('LegalNoticeComponent with the app\'s notices', () => {
    it('shows the app\'s German notice on a German sign-up page, with its links, and reads the default language', () => {
        const { el, load } = render('de');
        expect(el.textContent?.trim()).toBe('Mit der Anmeldung akzeptierst du die AGB und den Datenschutz. Mehr');
        expect(links(el)).toEqual([['AGB', '/info/terms'], ['Datenschutz', 'https://acme.example/datenschutz']]);
        expect(load).toHaveBeenCalled();
    });

    it('finds de for de-CH', () => {
        expect(render('de-CH').el.textContent).toContain('Mit der Anmeldung');
    });

    it('shows the app\'s English for a language it lacks', () => {
        const { el } = render('ta');
        expect(el.textContent?.trim()).toBe('By signing up you accept the Terms of Service of Acme Ltd.');
        expect(links(el)).toEqual([['Terms of Service', '/info/terms']]);
    });

    it('falls back on the site\'s default language before English', () => {
        expect(render('ta', 'de').el.textContent).toContain('Mit der Anmeldung');
    });

    it('speaks the language the page is shown in, as the member chose it', () => {
        const { el } = render(undefined);
        expect(el.textContent).toContain('By signing up you accept');
        TestBed.inject(TranslocoService).setActiveLang('hi');
        TestBed.tick();
        expect(el.textContent).toContain('साइन अप करके आप Acme की सेवा की शर्तें मानते हैं।');
    });
});
