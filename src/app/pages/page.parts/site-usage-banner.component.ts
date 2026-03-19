import { Component, inject, OnInit, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SiteUsageService } from '../admin/(settings)/site-usage/site-usage.service';
import { getGradientById, ISiteUsageSettings } from '../admin/(settings)/site-usage/site-usage.model';

/**
 * Site Usage Banner Component
 * Displays at the bottom of public pages when enabled and user hasn't made a choice
 */
@Component({
    selector: 'arc-site-usage-banner',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (showBanner()) {
        <div class="arc-site-usage-banner" [style.background]="getGradient()">
            <div class="arc-site-usage-banner__content" [style.color]="getTextColor()">
                <div class="arc-site-usage-banner__text">
                    <span class="arc-site-usage-banner__message">{{ settings()?.bannerText }}</span>
                    @if (settings()?.privacyPolicyLink) {
                    <a [href]="settings()?.privacyPolicyLink" 
                       class="arc-site-usage-banner__link"
                       [style.color]="getTextColor()">
                        Learn more
                    </a>
                    }
                </div>
                <div class="arc-site-usage-banner__actions">
                    <button class="arc-site-usage-banner__btn arc-site-usage-banner__btn--reject" 
                            [style.borderColor]="getTextColor()"
                            [style.color]="getTextColor()"
                            (click)="rejectCookies()">
                        {{ settings()?.rejectButtonText || 'Reject All' }}
                    </button>
                    <button class="arc-site-usage-banner__btn arc-site-usage-banner__btn--accept" 
                            [style.background]="getTextColor()"
                            [style.color]="getGradient()"
                            (click)="acceptCookies()">
                        {{ settings()?.acceptButtonText || 'Accept All' }}
                    </button>
                </div>
            </div>
        </div>
        }
    `,
    styles: [`
        .arc-site-usage-banner {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 16px 24px;
            z-index: 9998;
            box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
        }

        .arc-site-usage-banner__content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
            flex-wrap: wrap;
        }

        .arc-site-usage-banner__text {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            flex: 1;
            min-width: 280px;
        }

        .arc-site-usage-banner__message {
            font-size: 0.9rem;
            line-height: 1.5;
        }

        .arc-site-usage-banner__link {
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: underline;
            white-space: nowrap;
            opacity: 0.9;
        }

        .arc-site-usage-banner__link:hover {
            opacity: 1;
        }

        .arc-site-usage-banner__actions {
            display: flex;
            gap: 12px;
            flex-shrink: 0;
        }

        .arc-site-usage-banner__btn {
            padding: 10px 24px;
            border-radius: 24px;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .arc-site-usage-banner__btn--reject {
            background: transparent;
            border: 2px solid;
        }

        .arc-site-usage-banner__btn--reject:hover {
            opacity: 0.85;
            transform: translateY(-1px);
        }

        .arc-site-usage-banner__btn--accept {
            border: none;
        }

        .arc-site-usage-banner__btn--accept:hover {
            opacity: 0.9;
            transform: translateY(-1px);
        }

        @media (max-width: 768px) {
            .arc-site-usage-banner {
                padding: 16px;
            }

            .arc-site-usage-banner__content {
                flex-direction: column;
                text-align: center;
                gap: 16px;
            }

            .arc-site-usage-banner__text {
                flex-direction: column;
                gap: 8px;
            }

            .arc-site-usage-banner__message {
                font-size: 0.85rem;
            }

            .arc-site-usage-banner__actions {
                width: 100%;
                justify-content: center;
            }

            .arc-site-usage-banner__btn {
                padding: 10px 20px;
                font-size: 0.8rem;
            }
        }
    `],
})
export class SiteUsageBannerComponent implements OnInit {
    private siteUsageService = inject(SiteUsageService);
    private router = inject(Router);
    private platformId = inject(PLATFORM_ID);

    settings = signal<ISiteUsageSettings | null>(null);
    showBanner = signal(false);
    private isAdminRoute = signal(false);

    ngOnInit(): void {
        // Only run in browser
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        // Check current route
        this.checkRoute(this.router.url);

        // Subscribe to route changes
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: NavigationEnd) => {
            this.checkRoute(event.urlAfterRedirects);
        });

        // Subscribe to real-time settings updates
        this.siteUsageService.settings$.subscribe((settings) => {
            this.settings.set(settings);
            this.updateBannerVisibility();
        });
    }

    private checkRoute(url: string): void {
        // Hide banner on admin routes
        this.isAdminRoute.set(url.startsWith('/admin'));
        this.updateBannerVisibility();
    }

    private updateBannerVisibility(): void {
        const settings = this.settings();
        const isAdmin = this.isAdminRoute();
        const shouldShow = this.siteUsageService.shouldShowBanner(settings);

        const show = !isAdmin && shouldShow;
        this.showBanner.set(show);
    }

    getGradient(): string {
        const gradientId = this.settings()?.gradientId || 'info-blue';
        return getGradientById(gradientId).gradient;
    }

    getTextColor(): string {
        const gradientId = this.settings()?.gradientId || 'info-blue';
        return getGradientById(gradientId).textColor;
    }

    acceptCookies(): void {
        this.siteUsageService.setUserConsentState('accepted');
        this.showBanner.set(false);
    }

    rejectCookies(): void {
        this.siteUsageService.setUserConsentState('rejected');
        this.showBanner.set(false);
    }
}
