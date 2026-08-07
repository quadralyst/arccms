/**
 * Tests for the Hindi home page.
 *
 * The template is a whole translated document, so what is worth asserting is
 * not its markup but the contract every translated home page shares with
 * HomeBaseComponent: the head metadata it claims, and the switcher state it
 * publishes while on screen.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { of } from 'rxjs';
import HomeHiComponent from './home.hi.component';
import { HOME_PAGE_LANGUAGES } from '../page.parts/home-base.component';
import { GlobalService } from '../../../shared/services/global.service';
import { ToastService } from '../../../shared/services/toast.service';
import { EmailConfigStatusService } from '../../../shared/services/email-config-status.service';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentPartialsComponent } from '../page.parts/content-partials.component';
import { WaitlistService } from '../waitlist/waitlist.service';
import { WaitlistFormService } from '../page.parts/waitlist-form.service';
import { AuthService } from '../(auth)/auth.service';
import { OnboardingSetupService } from '../(onboarding)/onboarding-setup.service';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';

describe('HomeHiComponent', () => {
    let fixture: ComponentFixture<HomeHiComponent>;
    let document: Document;
    let localization: { load: ReturnType<typeof vi.fn>; languageVariants: ReturnType<typeof signal<string[] | null>> };
    let uiStrings: { use: ReturnType<typeof vi.fn>; translate: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        const mockStore = {
            items: signal([]),
            isLoading: signal(false),
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        // The header partial renders <arc-language-switcher>, which reads the
        // enabled list as well as the variants this page publishes.
        localization = {
            load: vi.fn().mockResolvedValue({}),
            languageVariants: signal<string[] | null>(null),
            enabledLanguages: signal([
                { code: 'en', label: 'English', nativeLabel: 'English', rtl: false },
                { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', rtl: false },
            ]),
            defaultLanguage: signal('en'),
        } as never;
        // `translate` is exercised by [data-arc-t] in the header partial, and
        // `activeLang` by [LangHrefDirective] on its links.
        uiStrings = {
            use: vi.fn().mockResolvedValue({}),
            strings: signal<Record<string, string>>({}),
            activeLang: signal(''),
            translate: vi.fn((_key: string, fallback: string) => fallback),
        } as never;

        await TestBed.configureTestingModule({
            imports: [HomeHiComponent],
            providers: [
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { params: {}, paramMap: { get: () => null } },
                        paramMap: of({ get: () => null, keys: [] }),
                        queryParams: of({}),
                    },
                },
                GlobalService,
                ToastService,
                { provide: WaitlistService, useValue: { getWaitlist: vi.fn(), createWaitlistWithId: vi.fn(), getWaitlistBySlug: vi.fn() } },
                { provide: WaitlistFormService, useValue: { initWaitlistForms: vi.fn(), cleanup: vi.fn() } },
                {
                    provide: EmailConfigStatusService,
                    useValue: {
                        isEmailConfigured: vi.fn().mockReturnValue(true),
                        isLoading: vi.fn().mockReturnValue(false),
                        bannerDismissed: vi.fn().mockReturnValue(false),
                        shouldShowBanner: vi.fn().mockReturnValue(false),
                        dismissBanner: vi.fn(),
                    },
                },
                { provide: ContentsStore, useValue: mockStore },
                { provide: ContentTypesStore, useValue: mockStore },
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of('<div>Template</div>')) } },
                { provide: AuthService, useValue: { isFirstRun: vi.fn().mockReturnValue(of(false)) } },
                { provide: OnboardingSetupService, useValue: { shouldShowOnboarding: vi.fn().mockReturnValue(of(false)) } },
                { provide: LocalizationService, useValue: localization },
                { provide: UiStringsService, useValue: uiStrings },
            ],
        })
            // See index.page.spec.ts: ContentPartialsComponent declares its own
            // ContentsStore provider, which would shadow the mock above.
            .overrideComponent(ContentPartialsComponent, {
                set: { providers: [{ provide: ContentsStore, useValue: mockStore }] },
            })
            .compileComponents();

        document = TestBed.inject(DOCUMENT);
        document.documentElement.lang = 'en';
        fixture = TestBed.createComponent(HomeHiComponent);
    });

    it('labels the document as Hindi so search engines and screen readers agree', () => {
        fixture.detectChanges();
        expect(document.documentElement.lang).toBe('hi');
    });

    it('replaces the shell title with the translated one', () => {
        fixture.detectChanges();
        expect(TestBed.inject(Title).getTitle()).toContain('स्केलेबल');
    });

    it('sets a translated description', () => {
        fixture.detectChanges();
        const description = document.querySelector('meta[name="description"]');
        expect(description?.getAttribute('content')).toContain('ओपन-सोर्स');
    });

    it('loads its chrome strings in Hindi', () => {
        fixture.detectChanges();
        expect(uiStrings.use).toHaveBeenCalledWith('hi');
    });

    it('offers the switcher exactly the languages the home page has files for', () => {
        fixture.detectChanges();
        expect(localization.languageVariants()).toEqual(HOME_PAGE_LANGUAGES);
    });

    it('restores the shell language on the way out', () => {
        fixture.detectChanges();
        fixture.destroy();

        // Otherwise the next SPA route inherits lang="hi".
        expect(document.documentElement.lang).toBe('en');
        expect(localization.languageVariants()).toBeNull();
    });
});
