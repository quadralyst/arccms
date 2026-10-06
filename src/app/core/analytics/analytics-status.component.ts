import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { environment } from '../../../environments/environment';
import { arcConfig } from '../config/arc-config';
import { isOn } from '../features/features';
import { SiteUsageService } from '../../pages/admin/(settings)/site-usage/site-usage.service';
import { analyticsTrackingState } from './analytics-status';

/**
 * Says in plain words whether Google Analytics is recording visitors
 * (docs/features/analytics.html), on Settings, Analytics and above the dashboard's numbers.
 * Warns when nobody can be tracked: consent is required and the banner is off.
 */
@Component({
    selector: 'arc-analytics-tracking-status',
    standalone: true,
    imports: [RouterLink, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @switch (state()) {
            @case ('all-visitors') {
                <p class="tracking-status text-muted" data-state="all-visitors">
                    <i class="fa-solid fa-circle-info me-1" aria-hidden="true"></i>
                    {{ 'admin.settings.analytics.tracking.all_visitors' | transloco }}
                    <span class="tracking-hint">{{ 'admin.settings.analytics.tracking.how_to_change' | transloco }}</span>
                </p>
            }
            @case ('consenting-visitors') {
                <p class="tracking-status text-muted" data-state="consenting-visitors">
                    <i class="fa-solid fa-circle-info me-1" aria-hidden="true"></i>
                    {{ 'admin.settings.analytics.tracking.consenting_visitors' | transloco }}
                    <span class="tracking-hint">{{ 'admin.settings.analytics.tracking.how_to_change' | transloco }}</span>
                </p>
            }
            @case ('nobody-banner-off') {
                <div class="alert alert-warning tracking-status" role="status" data-state="nobody-banner-off">
                    <i class="fa-solid fa-triangle-exclamation me-1" aria-hidden="true"></i>
                    {{ 'admin.settings.analytics.tracking.nobody_banner_off' | transloco }}
                    <a routerLink="/admin/settings/site-usage" class="alert-link ms-1">{{ 'admin.settings.analytics.tracking.turn_on_banner' | transloco }}</a>
                </div>
            }
            @case ('no-measurement-id') {
                <div class="alert alert-warning tracking-status" role="status" data-state="no-measurement-id">
                    <i class="fa-solid fa-triangle-exclamation me-1" aria-hidden="true"></i>
                    {{ 'admin.settings.analytics.tracking.no_measurement_id' | transloco }}
                </div>
            }
        }
    `,
    styles: [`
        .tracking-status { font-size: 0.875rem; }
        .tracking-hint { display: block; font-size: 0.8rem; opacity: 0.85; }
    `],
})
export class AnalyticsTrackingStatusComponent {
    private readonly siteUsage = inject(SiteUsageService);

    readonly state = computed(() => {
        // Whether the banner is on is not known for a moment: say nothing rather than warn wrongly.
        if (arcConfig.analyticsConsent === 'required' && !this.siteUsage.settingsLoaded()) return null;
        return analyticsTrackingState({
            featureOn: isOn('analytics'),
            measurementId: (environment.firebaseConfig as { measurementId?: string })?.measurementId,
            mode: arcConfig.analyticsConsent,
            bannerEnabled: this.siteUsage.bannerEnabled(),
        });
    });
}
