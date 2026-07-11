import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { EntitlementService } from '../entitlement.service';
import { UserShellComponent } from '../user-shell.component';

/**
 * Members-only page. The route is protected by `entitledGuard` (non-members are
 * redirected to /pricing), so reaching this component means the user is Pro. A
 * template for gating real premium features later.
 */
@Component({
    standalone: true,
    imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, UserShellComponent],
    template: `
        <app-user-shell>
            <div class="premium">
                <div class="hero">
                    <i class="fa-solid fa-star"></i>
                    <h1>Premium area</h1>
                    <p class="text-muted">
                        You're on the <strong>{{ entitlements.premiumType() || 'Pro' }}</strong> plan
                        ({{ entitlements.premiumStatus() || 'active' }}). This page is only reachable by members —
                        it's guarded by <code>entitledGuard</code>.
                    </p>
                </div>

                <div class="feature-grid">
                    <mat-card class="feature"><i class="fa-solid fa-bolt"></i><h3>Priority processing</h3><p class="text-muted">Placeholder premium feature.</p></mat-card>
                    <mat-card class="feature"><i class="fa-solid fa-chart-line"></i><h3>Advanced analytics</h3><p class="text-muted">Placeholder premium feature.</p></mat-card>
                    <mat-card class="feature"><i class="fa-solid fa-headset"></i><h3>Priority support</h3><p class="text-muted">Placeholder premium feature.</p></mat-card>
                </div>

                <a mat-stroked-button routerLink="/user/dashboard" class="mt-3">← Back to dashboard</a>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .premium { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
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
