import { RouteMeta } from '@analogjs/router';
import { AfterViewInit, Component, ElementRef, inject, OnDestroy, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { BaseComponent } from '../../shared/components/base/base.component';
import { HeaderComponent } from './page.parts/header.component';
import { FooterComponent } from './page.parts/footer.component';
import { ContentPartialsComponent } from './page.parts/content-partials.component';
import { WaitlistFormService } from './page.parts/waitlist-form.service';
import { AuthService } from './(auth)/auth.service';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';

export const routeMeta: RouteMeta = {
  title: 'Home | Arc CMS',
};

@Component({
  selector: 'arc-home',
  standalone: true,
  templateUrl: '../../../public/index.html',
  styleUrl: '../../../public/assets/css/main.css',
  encapsulation: ViewEncapsulation.None,
  imports: [HeaderComponent, FooterComponent, ContentPartialsComponent, NgOptimizedImage],
})
export default class HomeComponent extends BaseComponent implements AfterViewInit, OnDestroy {
  private elementRef = inject(ElementRef);
  private waitlistFormService = inject(WaitlistFormService);
  private authService = inject(AuthService);
  private setupService = inject(OnboardingSetupService);
  private homeRouter = inject(Router);

  private platformId = inject(PLATFORM_ID);

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Debug mode: bypass onboarding redirect for deployment verification
    if (new URLSearchParams(window.location.search).has('debug')) {
      this.waitlistFormService.initWaitlistForms(this.elementRef.nativeElement, 'index.html');
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
        this.waitlistFormService.initWaitlistForms(this.elementRef.nativeElement, 'index.html');
      });
    });
  }

  ngOnDestroy(): void {
    this.waitlistFormService.cleanup();
  }
}
