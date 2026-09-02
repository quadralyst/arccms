import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { EntitlementService } from '../entitlement.service';
import { UserShellComponent } from '../user-shell.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';

/**
 * Members-only page. The route is protected by `entitledGuard` (non-members are
 * redirected to /pricing), so reaching this component means the user is Pro. A
 * template for gating real premium features later.
 */
@Component({
    standalone: true,
    imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, UserShellComponent, PageHeaderComponent, TranslocoPipe],
    template: `
        <app-user-shell>
            <div class="premium">
                <arc-page-header [title]="'user.premium.title' | transloco"></arc-page-header>
                <div class="hero">
                    <i class="fa-solid fa-star"></i>
                    <p class="text-muted">
                        <span [innerHTML]="'user.premium.on_plan' | transloco: {
                            plan: (entitlements.premiumType() || 'Pro'),
                            type: (entitlements.premiumStatus() || 'active')
                        }"></span>
                    </p>
                </div>

                <div class="feature-grid">
                    <mat-card class="feature"><i class="fa-solid fa-bolt"></i><h3>{{ 'user.premium.priority_processing' | transloco }}</h3><p class="text-muted">{{ 'user.premium.placeholder' | transloco }}</p></mat-card>
                    <mat-card class="feature"><i class="fa-solid fa-chart-line"></i><h3>{{ 'user.premium.advanced_analytics' | transloco }}</h3><p class="text-muted">{{ 'user.premium.placeholder' | transloco }}</p></mat-card>
                    <mat-card class="feature"><i class="fa-solid fa-headset"></i><h3>{{ 'user.premium.priority_support' | transloco }}</h3><p class="text-muted">{{ 'user.premium.placeholder' | transloco }}</p></mat-card>
                </div>

                <a mat-stroked-button routerLink="/user/dashboard" class="mt-3">{{ 'user.premium.back' | transloco }}</a>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .premium { max-width: 900px; margin: 0 auto; padding: 24px; }
        .hero { text-align: center; padding: 24px 0; }
        .hero > i { font-size: 2.4rem; color: #1b98e0; }
        .hero h1 { margin: 8px 0 4px; }
        .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
        .feature { padding: 20px; text-align: center; border: 1px solid #e3e8ee; }
        .feature i { font-size: 1.5rem; color: #1b98e0; }
        .feature h3 { font-size: 1rem; margin: 8px 0 4px; }
    `],
})
export default class PremiumPageComponent {
    entitlements = inject(EntitlementService);
}
