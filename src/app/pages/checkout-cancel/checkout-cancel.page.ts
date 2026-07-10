import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { PublicNavComponent } from '../payments-ui/public-nav.component';

/**
 * Dodo `cancel_url` landing — shown when a buyer abandons checkout. Point
 * `cancelUrl` in Settings/dodo-payments at `/checkout/cancel`.
 */
@Component({
    standalone: true,
    imports: [RouterLink, MatButtonModule, MatCardModule, PublicNavComponent],
    template: `
        <app-public-nav></app-public-nav>

        <div class="cancel">
            <mat-card class="card">
                <mat-card-content class="text-center py-4">
                    <div class="icon"><i class="fa-solid fa-circle-xmark"></i></div>
                    <h2>Checkout cancelled</h2>
                    <p class="text-muted">No charge was made. You can pick a plan again whenever you're ready.</p>
                    <div class="actions mt-3">
                        <a mat-raised-button color="primary" routerLink="/pricing">Back to pricing</a>
                        <a mat-stroked-button routerLink="/account">My account</a>
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
