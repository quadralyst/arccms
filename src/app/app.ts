import { Component, computed, DOCUMENT, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalMessageBannerComponent } from './pages/page.parts/global-message-banner.component';
import { SiteUsageBannerComponent } from './pages/page.parts/site-usage-banner.component';
import { GaTrackingService } from '../shared/services/ga-tracking.service';
import { PoweredByFooterComponent } from './pages/page.parts/powered-by-footer.component';
import { PageSpinnerComponent } from './pages/page.parts/page-spinner.component';

@Component({
  selector: 'arc-root',
  imports: [RouterOutlet, GlobalMessageBannerComponent, SiteUsageBannerComponent, PoweredByFooterComponent, PageSpinnerComponent],
  template: `
    <arc-global-message-banner />
    <main class="arc-route-host">
      @if (showSpinner()) {
        <arc-page-spinner class="arc-route-spinner" />
      }
      <router-outlet (activate)="onOutletActivate()" (deactivate)="outletActive.set(false)" />
    </main>
    <arc-powered-by-footer />
    <arc-site-usage-banner />
  `,
  styles: [
    `
      /* A flex column the height of the viewport: the routed page takes the
         room and the powered-by footer stays at the bottom, even while the
         page has nothing to show yet. */
      :host {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }

      .arc-route-host {
        position: relative;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
      }

      /* Laid over the routed area, not before it: whatever is (or is about to
         be) there keeps its place, so nothing shifts when the page arrives. */
      .arc-route-spinner {
        position: absolute;
        inset: 0;
        min-height: 0;
        background: #fff;
        z-index: 1;
      }

      /* The routed component is a sibling of <router-outlet>, not a child. */
      .arc-route-host > :not(router-outlet) {
        flex: 1 1 auto;
      }
    `,
  ],
})
export class App {
  private gaTracking = inject(GaTrackingService);
  private router = inject(Router);

  private document = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);

  /**
   * True while the router is between pages — the lazy chunk of the next
   * route may still be downloading. The spinner only shows once the outlet
   * is empty, so the page being left is not covered while its replacement
   * loads; on first load the outlet starts empty.
   */
  navigating = signal(false);
  outletActive = signal(false);
  /**
   * Set once the outlet has rendered anything. Before that, on a page the
   * server rendered, the markup is already on screen (dehydrated, waiting to
   * be claimed) — a spinner then would sit on top of a page that is visibly
   * there. Only the plain SPA shell, which has nothing to show, gets one.
   */
  private outletEverActive = signal(false);
  private readonly serverRendered =
    isPlatformBrowser(this.platformId) && !!this.document.getElementById('ng-state');

  showSpinner = computed(
    () => this.navigating() && !this.outletActive() && (this.outletEverActive() || !this.serverRendered),
  );

  onOutletActivate(): void {
    this.outletActive.set(true);
    this.outletEverActive.set(true);
  }

  constructor() {
    this.gaTracking.initializeTracking();

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.navigating.set(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.navigating.set(false);
      }
    });
  }
}
