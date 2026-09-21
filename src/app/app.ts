import { Component, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalMessageBannerComponent } from './pages/page.parts/global-message-banner.component';
import { SiteUsageBannerComponent } from './pages/page.parts/site-usage-banner.component';
import { GaTrackingService } from '../shared/services/ga-tracking.service';
import { PoweredByFooterComponent } from './pages/page.parts/powered-by-footer.component';
import { NavProgressComponent } from './pages/page.parts/nav-progress.component';

@Component({
  selector: 'arc-root',
  imports: [RouterOutlet, GlobalMessageBannerComponent, SiteUsageBannerComponent, PoweredByFooterComponent, NavProgressComponent],
  template: `
    <arc-global-message-banner />
    @if (navigating()) {
      <arc-nav-progress />
    }
    <main class="arc-route-host">
      <router-outlet />
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
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
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

  /**
   * True while the router is between pages, when the lazy chunk of the next
   * route may still be downloading. Shown as a fixed top bar
   * (NavProgressComponent) rather than an in-flow spinner, so the page being
   * left, or the server-rendered page being hydrated, is never pushed down.
   */
  navigating = signal(false);

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
