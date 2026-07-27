/**
 * Shared behaviour for the home page in every language.
 *
 * `templateUrl` is resolved at build time, so a translated home page needs its
 * own component pointing at its own file — see `public/i18n/README.md`. Rather
 * than duplicate the waitlist wiring and onboarding redirect per language,
 * they live here and each language component is a few lines of template
 * binding.
 *
 * The alternative — fetching the translated HTML and injecting it — would stop
 * Angular compiling `<arc-content-partials>` and break the article cards, so
 * the extra class per language is the cheaper trade.
 *
 * Spec: docs/multilingual-spec.md — Phase M5.3.
 */

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { AfterViewInit, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { AuthService } from '../(auth)/auth.service';
import { OnboardingSetupService } from '../(onboarding)/onboarding-setup.service';
import { WaitlistFormService } from './waitlist-form.service';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';

// A @Component rather than a @Directive: BaseComponent is itself a
// component, and Angular refuses to let a directive inherit one (NG0903).
// Abstract and never instantiated directly, so the empty template is inert.
/**
 * Languages the home page has been translated into — i.e. those with a file at
 * public/i18n/{lang}/index.html and a component under home-i18n/. Kept beside
 * those files rather than read from settings, because enabling a language does
 * not conjure a translated home page.
 */
export const HOME_PAGE_LANGUAGES = ['en', 'hi'];

@Component({ selector: 'arc-home-base', standalone: true, template: '' })
export abstract class HomeBaseComponent extends BaseComponent implements OnInit, AfterViewInit, OnDestroy {
  protected elementRef = inject(ElementRef);
  protected waitlistFormService = inject(WaitlistFormService);
  protected authService = inject(AuthService);
  protected setupService = inject(OnboardingSetupService);
  protected homeRouter = inject(Router);
  protected localization = inject(LocalizationService);
  protected platformId = inject(PLATFORM_ID);
  protected uiStrings = inject(UiStringsService);

  /**
   * Language this home page is written in. The default-language page leaves
   * this empty; a translated one sets its own code.
   */
  protected abstract readonly pageLang: string;

  constructor() {
    super();
    this.localization.load();
    // The switcher only offers languages a page actually exists in, and the
    // home page exists exactly in the languages that have a file under
    // public/i18n — a build-time fact, unlike the enabled list in Firestore.
    this.localization.languageVariants.set(HOME_PAGE_LANGUAGES);
  }

  ngOnInit(): void {
    // Chrome for this page's language — the header nav lives in the shared
    // partial, so it is annotated (data-arc-t) rather than translated inside
    // the page file.
    this.uiStrings.use(this.pageLang);
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Debug mode: bypass onboarding redirect for deployment verification
    if (new URLSearchParams(window.location.search).has('debug')) {
      this.initForms();
      return;
    }

    // On first run (no users yet), redirect to the onboarding wizard
    this.authService.isFirstRun().pipe(take(1)).subscribe((firstRun) => {
      if (firstRun) {
        this.homeRouter.navigate(['/onboarding']);
        return;
      }
      // Also redirect if onboarding wizard was started but not completed
      this.setupService.isOnboardingComplete().pipe(take(1)).subscribe((complete) => {
        if (!complete) {
          this.homeRouter.navigate(['/onboarding']);
          return;
        }
        this.initForms();
      });
    });
  }

  private initForms(): void {
    this.waitlistFormService.initWaitlistForms(this.elementRef.nativeElement, 'index.html');
  }

  ngOnDestroy(): void {
    this.waitlistFormService.cleanup();
    // The next page may have no variants at all.
    this.localization.languageVariants.set(null);
  }
}
