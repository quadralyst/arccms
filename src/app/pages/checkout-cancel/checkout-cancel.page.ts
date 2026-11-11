import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { PublicNavComponent } from '../payments-ui/public-nav.component';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Dodo `cancel_url` landing, shown when a buyer leaves checkout. Point
 * `cancelUrl` in Settings/dodo-payments at `/checkout/cancel`.
 */
@Component({
    standalone: true,
    imports: [RouterLink, MatButtonModule, MatCardModule, PublicNavComponent, TranslocoPipe],
    template: `
        <app-public-nav></app-public-nav>

        <div class="cancel">
            <mat-card class="card">
                <mat-card-content class="text-center py-4">
                    <div class="icon" aria-hidden="true"><i class="fa-solid fa-circle-xmark"></i></div>
                    <h1 class="h2">{{ 'member.checkout.cancelled_title' | transloco }}</h1>
                    <p class="text-muted">{{ 'member.checkout.cancelled_body' | transloco }}</p>
                    <div class="actions mt-3">
                        <a mat-raised-button color="primary" routerLink="/pricing">{{ 'member.checkout.back_to_pricing' | transloco }}</a>
                        <a mat-stroked-button routerLink="/account">{{ 'member.checkout.my_account' | transloco }}</a>
                    </div>
                </mat-card-content>
            </mat-card>
        </div>
    `,
    styles: [`
        .cancel { max-width: 560px; margin: 48px auto; padding: 0 24px; }
        .card { border: 1px solid #dee2e6; }
        .icon { font-size: 3rem; color: #6c757d; margin-bottom: 8px; }
        .actions { display: flex; gap: 12px; justify-content: center; }
    `],
})
export default class CheckoutCancelPageComponent {}
