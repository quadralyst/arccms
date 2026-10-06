/**
 * Member screens rendered in a pseudo language (specs/app-member-language-spec.md, L-D12):
 * every word on them must come from the language, so an app's German reaches all of it.
 * The scan in member-screens-translated.spec.ts reads the source; this renders it.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BehaviorSubject, of } from 'rxjs';
import { pseudo } from '../../../../scripts/i18n-pseudo.mjs';
import { pseudoTestingModule, textNotInPseudo } from '../../../test/pseudo-language';
import NotFoundComponent from '../../pages/not-found.page';
import { SiteUsageBannerComponent } from '../../pages/page.parts/site-usage-banner.component';
import { SiteUsageService } from '../../pages/admin/(settings)/site-usage/site-usage.service';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings } from '../../pages/admin/(settings)/site-usage/site-usage.model';
import { SitePagesService } from '../site/site-pages.service';
import { SignInMethodsComponent } from '../../pages/(auth)/(profile)/sign-in-methods.component';
import { SignInService } from '../../pages/(auth)/sign-in.service';
import { AuthState } from '../../pages/(auth)/auth.store';
import { ToastService } from '../../../shared/services/toast.service';
import { UserSettingService } from '../../pages/admin/(settings)/user-setting/user-setting.service';
import { UserShellComponent } from '../../pages/user/user-shell.component';
import { EntitlementService } from '../../pages/user/entitlement.service';
import { SiteIdentityService } from '../services/site-identity.service';

async function render<T>(component: Type<T>, providers: unknown[] = []) {
    await TestBed.configureTestingModule({
        imports: [component, pseudoTestingModule()],
        providers: [provideRouter([]), ...(providers as never[])],
    }).compileComponents();
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
}

describe('member screens in a pseudo language', () => {
    it('the pseudo language marks text, and the check finds plain English', () => {
        expect(pseudo('Go to Home')).toBe('[Gö tö Hömé]');
        const box = document.createElement('div');
        box.innerHTML = `<p>${pseudo('Go to Home')}</p><p>Go to Home</p><p>404</p>`;
        expect(textNotInPseudo(box)).toEqual(['Go to Home']);
    });

    it('an app\'s own keys are in the pseudo language too', async () => {
        TestBed.configureTestingModule({ imports: [pseudoTestingModule({ till: { open: 'Open the till' } })] });
        const transloco = TestBed.inject(TranslocoService);
        expect(transloco.translate('till.open')).toBe(pseudo('Open the till'));
        expect(transloco.translate('member.not_found.home')).toBe(pseudo('Go to Home'));
    });

    it('page not found', async () => {
        const fixture = await render(NotFoundComponent);
        expect(fixture.nativeElement.textContent).toContain(pseudo('Go to Home'));
        expect(textNotInPseudo(fixture.nativeElement)).toEqual([]);
    });

    it('the cookie banner, with the admin\'s button text left empty', async () => {
        const settings: ISiteUsageSettings = {
            ...DEFAULT_SITE_USAGE_SETTINGS,
            isEnabled: true,
            bannerText: 'Our own words about cookies.',
            acceptButtonText: '',
            rejectButtonText: '',
            privacyPolicyLink: '/p/cookie-policy',
        };
        const fixture = await render(SiteUsageBannerComponent, [
            {
                provide: SiteUsageService,
                useValue: {
                    settings$: new BehaviorSubject(settings).asObservable(),
                    shouldShowBanner: () => true,
                    setUserConsentState: vi.fn(),
                    consent: signal('pending'),
                },
            },
            { provide: SitePagesService, useValue: { pages: signal([]), load: async () => [] } },
        ]);
        expect(fixture.nativeElement.textContent).toContain(pseudo('Accept All'));
        // The banner's message is the admin's own text, the site's content.
        expect(textNotInPseudo(fixture.nativeElement, ['Our own words about cookies.'])).toEqual([]);
    });

    describe('sign-in methods', () => {
        const providers = [
            { provide: SignInService, useValue: { hasGoogle: () => false } },
            { provide: AuthState, useValue: { currentUser: signal({ email: '', phone: '', emailVerified: false }) } },
            { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
            { provide: UserSettingService, useValue: { getSettings: () => of({ googleSignIn: true, phoneSignIn: true }) } },
        ];

        it('with nothing added yet', async () => {
            const fixture = await render(SignInMethodsComponent, providers);
            expect(fixture.nativeElement.textContent).toContain(pseudo('Sign-in methods'));
            expect(fixture.nativeElement.textContent).toContain(pseudo('Not added'));
            expect(textNotInPseudo(fixture.nativeElement)).toEqual([]);
        });

        it('while adding an email', async () => {
            const fixture = await render(SignInMethodsComponent, providers);
            fixture.componentInstance.start('email');
            fixture.detectChanges();
            expect(textNotInPseudo(fixture.nativeElement)).toEqual([]);
        });
    });

    it('the member area\'s menu, for a member with no name', async () => {
        const fixture = await render(UserShellComponent, [
            { provide: AuthState, useValue: { currentUser: signal({ name: '', email: '', role: 'user' }), logout: () => of(null) } },
            {
                provide: EntitlementService,
                useValue: { isPro: () => true, premiumType: () => '', creditBalance: () => 3, load: () => of(null) },
            },
            {
                provide: SiteIdentityService,
                useValue: { loaded: signal(true), identity: signal({ name: 'Corner Shop', logoUrl: '' }), load: async () => ({}) },
            },
        ]);
        const text = fixture.nativeElement.textContent;
        expect(text).toContain(pseudo('Member'));
        expect(text).toContain(pseudo('Pro'));
        expect(text).toContain('Corner Shop');
        expect(textNotInPseudo(fixture.nativeElement, ['Corner Shop'])).toEqual([]);
    });
});
