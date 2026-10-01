import { Component, DOCUMENT, effect, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GlobalMessageBannerComponent } from './pages/page.parts/global-message-banner.component';
import { SiteUsageBannerComponent } from './pages/page.parts/site-usage-banner.component';
import { GaTrackingService } from '../shared/services/ga-tracking.service';
import { PoweredByFooterComponent } from './pages/page.parts/powered-by-footer.component';
import { NavProgressComponent } from './pages/page.parts/nav-progress.component';
import { PwaUpdateBarComponent } from '../shared/components/install-prompt/update-bar.component';
import { FeedbackComponent } from '../shared/components/feedback/feedback.component';
import { FullScreenService } from './core/layout/full-screen.service';

@Component({
  selector: 'arc-root',
  imports: [RouterOutlet, GlobalMessageBannerComponent, SiteUsageBannerComponent, PoweredByFooterComponent, NavProgressComponent, PwaUpdateBarComponent, FeedbackComponent],
  host: { '[class.arc-full-screen]': 'fullScreen.active()' },
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
    <arc-pwa-update-bar />
    <arc-feedback />
  `,
  styles: [
    `
      /* A flex column the height of the viewport: the routed page takes the
         room and the powered-by footer stays at the bottom, even while the
         page has nothing to show yet. The routed page is not in this
         template, so these styles cannot reach it: src/styles.css stretches it. */
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

      /* A full-screen route (data: { fullScreen: true }): the page is exactly one
         screen tall and owns all of it. The banners, footer and update bar stay
         alive but out of sight, so the site-usage banner and the update bar come
         back on the next normal page; the feedback button hides itself. */
      :host.arc-full-screen {
        height: 100vh;
        height: 100dvh;
        min-height: 0;
        overflow: hidden;
      }

      :host.arc-full-screen .arc-route-host {
        min-height: 0;
      }

      :host.arc-full-screen arc-global-message-banner,
      :host.arc-full-screen arc-powered-by-footer,
      :host.arc-full-screen arc-site-usage-banner,
      :host.arc-full-screen arc-pwa-update-bar {
        display: none;
      }
    `,
  ],
})
export class App {
  private gaTracking = inject(GaTrackingService);
  private router = inject(Router);
  private document = inject(DOCUMENT);
  readonly fullScreen = inject(FullScreenService);

  /**
   * True while the router is between pages, when the lazy chunk of the next
   * route may still be downloading. Shown as a fixed top bar
   * (NavProgressComponent) rather than an in-flow spinner, so the page being
   * left, or the server-rendered page being hydrated, is never pushed down.
   */
  navigating = signal(false);

  constructor() {
    this.gaTracking.initializeTracking();

    // The class on <html> lets the global styles drop page scroll and margins
    // (src/styles.css), on the server render as well as in the browser.
    effect(() => {
      this.document.documentElement.classList.toggle('arc-full-screen', this.fullScreen.active());
    });

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
