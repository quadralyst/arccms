import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthState } from '../(auth)/auth.store';
import { ProductsService } from '../admin/(products)/products.service';
import { IProduct } from '../admin/(products)/product.model';
import { PublicNavComponent } from '../payments-ui/public-nav.component';

@Component({
    standalone: true,
    imports: [CommonModule, MatButtonModule, MatCardModule, MatProgressSpinnerModule, PublicNavComponent],
    template: `
        <app-public-nav></app-public-nav>

        <div class="pricing">
            <h1 class="text-center">Pricing</h1>
            <p class="text-center text-muted mb-4">Choose a plan that works for you.</p>

            @if (isLoading()) {
                <div class="d-flex justify-content-center py-5"><mat-spinner diameter="40"></mat-spinner></div>
            } @else if (products().length === 0) {
                <p class="text-center text-muted">No plans are available right now.</p>
            } @else {
                <div class="plans">
                    @for (p of products(); track p.id) {
                        <mat-card class="plan-card">
                            <mat-card-header><mat-card-title>{{ p.name }}</mat-card-title></mat-card-header>
                            <mat-card-content class="pt-2">
                                <p class="desc">{{ p.description }}</p>
                                @if (p.type === 'subscription') {
                                    <p class="meta">{{ p.interval === 'year' ? 'Billed yearly' : 'Billed monthly' }}@if (p.trialDays) { · {{ p.trialDays }}-day free trial }</p>
                                } @else {
                                    <p class="meta">One-time · lifetime access@if (p.updatesYears) { · {{ p.updatesYears }} {{ p.updatesYears === 1 ? 'year' : 'years' }} of free updates }</p>
                                }
                                @for (feat of p.features ?? []; track feat) { <div class="feature"><i class="fa-solid fa-check me-2"></i>{{ feat }}</div> }
                            </mat-card-content>
                            <mat-card-actions>
                                <button mat-raised-button color="primary" class="w-100" (click)="buy(p)" [disabled]="buyingId() === p.id">
                                    @if (buyingId() === p.id) { <mat-spinner diameter="18" class="me-2"></mat-spinner> Redirecting… }
                                    @else { {{ p.type === 'subscription' ? 'Subscribe' : 'Buy' }} }
                                </button>
                            </mat-card-actions>
                        </mat-card>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        .pricing { max-width: 1000px; margin: 0 auto; padding: 48px 24px; }
        .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
        .plan-card { border: 1px solid #dee2e6; }
        .desc { color: #495057; min-height: 40px; }
        .meta { font-size: 0.85rem; color: #6c757d; }
        .feature { font-size: 0.9rem; color: #212529; margin: 4px 0; }
    `],
})
export default class PricingPageComponent implements OnInit {
    private productsService = inject(ProductsService);
    private functions = inject(Functions);
    private authState = inject(AuthState);
    private router = inject(Router);

    products = signal<IProduct[]>([]);
    isLoading = signal(true);
    buyingId = signal<string | null>(null);

    ngOnInit(): void {
        this.productsService.getAll({ limitCount: 100, currentPageNumber: 0, previousPageNumber: 0 }).subscribe({
            next: (result) => {
                this.products.set((result.collectionData ?? []).filter((p) => p.active));
                this.isLoading.set(false);
            },
            error: () => this.isLoading.set(false),
        });
    }

    async buy(product: IProduct): Promise<void> {
        // Gate on the actual signed-in user, NOT authState.isAuthenticated() —
        // that signal is false for plain `user`-role accounts (see auth.store).
        if (!this.authState.currentUser()) {
            this.router.navigate(['/signup'], { queryParams: { redirect: '/pricing' } });
            return;
        }

        this.buyingId.set(product.id);
        try {
            const createSession = httpsCallable(this.functions, 'createCheckoutSession');
            const result = await createSession({ productId: product.id });
            const data = result.data as { checkoutUrl?: string };
            if (data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
            } else {
                this.buyingId.set(null);
            }
        } catch (e) {
            console.error('Checkout failed', e);
            this.buyingId.set(null);
        }
    }
}
