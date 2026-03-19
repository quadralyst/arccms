import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GlobalMessageBannerComponent } from './pages/page.parts/global-message-banner.component';
import { SiteUsageBannerComponent } from './pages/page.parts/site-usage-banner.component';
import { GaTrackingService } from '../shared/services/ga-tracking.service';
import { PoweredByFooterComponent } from './pages/page.parts/powered-by-footer.component';

@Component({
  selector: 'arc-root',
  imports: [RouterOutlet, GlobalMessageBannerComponent, SiteUsageBannerComponent, PoweredByFooterComponent],
  template: `
    <arc-global-message-banner />
    <router-outlet />
    <arc-powered-by-footer />
    <arc-site-usage-banner />
  `,
  styles: [
    `
      :host {
        width: 100vw;
        height: 100vh;
      }
    `,
  ],
})
export class App {
  private gaTracking = inject(GaTrackingService);

  constructor() {
    this.gaTracking.initializeTracking();
  }
}
