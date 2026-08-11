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
import { displayPrice, isDiscounted, formatMoney, resolveDisplayTier } from '../payments-ui/pricing-utils';

@Component({
    standalone: true,
    imports: [CommonModule, MatButtonModule, MatCardModule, MatProgressSpinnerModule, PublicNavComponent],
    template: `
        <app-public-nav></app-public-nav>

        <div class="pricing-container animate-fade-in">
            <div class="pricing-header">
                <h1>Simple, Transparent Pricing</h1>
                <p class="subtitle text-muted">Choose the perfect plan to unlock advanced CMS capabilities and power your website.</p>
            </div>

            @if (isLoading()) {
                <div class="loading-container"><mat-spinner diameter="40"></mat-spinner></div>
            } @else if (products().length === 0) {
                <div class="empty-state">
                    <p class="text-muted">No plans are available right now. Please check back later.</p>
                </div>
            } @else {
                <div class="plans-grid">
                    @for (p of products(); track p.id) {
                        <mat-card class="plan-card" [class.highlighted]="p.name.toLowerCase().includes('pro')">
                            @if (p.name.toLowerCase().includes('pro')) {
                                <div class="popular-badge">RECOMMENDED</div>
                            }
                            <mat-card-content class="plan-content">
                                <div class="plan-type">{{ p.type === 'subscription' ? 'Subscription' : 'One-time Plan' }}</div>
                                <h2 class="plan-name">{{ p.name }}</h2>
                                
                                @if (price(p) !== null) {
                                    <div class="price-display">
                                        <span class="price-amount">{{ money(price(p), p.currency) }}</span>
                                        @if (p.type === 'subscription') { 
                                            <span class="price-period">/{{ p.interval === 'year' ? 'year' : 'month' }}</span> 
                                        }
                                        @if (discounted(p)) { 
                                            <span class="original-price">{{ money(p.price, p.currency) }}</span> 
                                        }
                                    </div>
                                    @if (tierLabel(p); as label) { 
                                        <div class="discount-label">
                                            <i class="fa-solid fa-tag me-1"></i>{{ label }}
                                        </div> 
                                    }
                                }

                                <p class="plan-description">{{ p.description }}</p>
                                
                                <div class="plan-meta">
                                    @if (p.type === 'subscription') {
                                        <span>Billed {{ p.interval === 'year' ? 'yearly' : 'monthly' }}</span>
                                        @if (p.trialDays) { 
                                            <span class="meta-dot"></span>
                                            <span>{{ p.trialDays }}-day free trial</span> 
                                        }
                                    } @else {
                                        <span>One-time billing</span>
                                        @if (p.updatesYears) { 
                                            <span class="meta-dot"></span>
                                            <span>{{ p.updatesYears }} {{ p.updatesYears === 1 ? 'year' : 'years' }} updates</span> 
                                        }
                                    }
                                </div>

                                <div class="features-list">
                                    @for (feat of p.features ?? []; track feat) { 
                                        <div class="feature-item">
                                            <span class="check-icon"><i class="fa-solid fa-check"></i></span>
                                            <span class="feature-text">{{ feat }}</span>
                                        </div> 
                                    }
                                </div>
                            </mat-card-content>
                            <mat-card-actions class="plan-actions">
                                <button mat-flat-button class="buy-btn" (click)="buy(p)" [disabled]="buyingId() === p.id">
                                    <span class="btn-content">
                                        @if (buyingId() === p.id) { 
                                            <mat-spinner diameter="18" class="spinner-light"></mat-spinner>
                                            <span>Redirecting…</span>
                                        } @else { 
                                            <span>{{ p.type === 'subscription' ? 'Get Started' : 'Buy Now' }}</span>
                                        }
                                    </span>
                                </button>
                            </mat-card-actions>
                        </mat-card>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        .pricing-container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 64px 24px;
            font-family: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif;
            color: #1e293b;
        }
        
        /* Header */
        .pricing-header {
            text-align: center;
            margin-bottom: 48px;
        }
        .pricing-header h1 {
            font-size: 2.5rem;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.03em;
            margin: 0 0 12px;
        }
        .pricing-header .subtitle {
            font-size: 1.05rem;
            max-width: 600px;
            margin: 0 auto;
            line-height: 1.5;
        }

        /* Plans Grid */
        .plans-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 32px;
            align-items: stretch;
        }

        /* Plan Card */
        .plan-card {
            border: 1px solid #e2e8f0;
            border-radius: 20px;
            background: #ffffff;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.01);
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .plan-card:hover {
            border-color: #cbd5e1;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.03);
        }
        .plan-card.highlighted {
            border: 2px solid #2563eb;
            box-shadow: 0 8px 30px rgba(37, 99, 235, 0.05);
        }

        .popular-badge {
            position: absolute;
            top: 16px;
            right: 16px;
            background: #2563eb;
            color: #ffffff;
            font-size: 0.68rem;
            font-weight: 800;
            padding: 4px 10px;
            border-radius: 30px;
            letter-spacing: 0.05em;
        }

        .plan-content {
            padding: 32px;
            display: flex;
            flex-direction: column;
            flex: 1;
        }

        .plan-type {
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            margin-bottom: 8px;
        }

        .plan-name {
            font-size: 1.5rem;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 16px;
        }

        /* Pricing Display */
        .price-display {
            display: flex;
            align-items: baseline;
            gap: 4px;
            margin-bottom: 8px;
        }
        .price-amount {
            font-size: 2.4rem;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.02em;
        }
        .price-period {
            font-size: 0.95rem;
            color: #64748b;
            font-weight: 500;
        }
        .original-price {
            font-size: 1.1rem;
            color: #94a3b8;
            text-decoration: line-through;
            margin-left: 8px;
            font-weight: 500;
        }

        .discount-label {
            display: inline-flex;
            align-items: center;
            align-self: flex-start;
            background: #fef3c7;
            color: #d97706;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 6px;
            margin-bottom: 16px;
        }

        .plan-description {
            font-size: 0.95rem;
            color: #475569;
            line-height: 1.5;
            margin: 0 0 16px;
            min-height: 48px;
        }

        .plan-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.8rem;
            color: #64748b;
            font-weight: 600;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #e2e8f0;
        }
        .meta-dot {
            width: 4px;
            height: 4px;
            background: #cbd5e1;
            border-radius: 50%;
        }

        /* Features List */
        .features-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 32px;
        }
        .feature-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }
        .check-icon {
            color: #16a34a;
            font-size: 0.9rem;
            margin-top: 2px;
        }
        .feature-text {
            font-size: 0.9rem;
            color: #334155;
            line-height: 1.4;
        }

        /* Actions */
        .plan-actions {
            padding: 0 32px 32px;
            background: transparent;
        }
        .buy-btn {
            width: 100%;
            background: #0f172a !important;
            color: #ffffff !important;
            font-weight: 600 !important;
            border-radius: 12px !important;
            padding: 12px 0 !important;
            transition: background 0.2s ease !important;
        }
        .buy-btn:hover:not([disabled]) {
            background: #1e293b !important;
        }
        .btn-content {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
        }
        .plan-card.highlighted .buy-btn {
            background: #2563eb !important;
        }
        .plan-card.highlighted .buy-btn:hover:not([disabled]) {
            background: #1d4ed8 !important;
        }

        .spinner-light ::ng-deep circle {
            stroke: #ffffff !important;
        }

        .loading-container {
            display: flex;
            justify-content: center;
            padding: 64px 0;
        }
        .empty-state {
            text-align: center;
            padding: 48px 0;
        }

        /* Animations */
        .animate-fade-in {
            animation: fadeIn 0.4s ease forwards;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
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

    // Display-only pricing (authoritative tier/discount is resolved server-side at checkout).
    price(p: IProduct): number | null { return displayPrice(p); }
    discounted(p: IProduct): boolean { return isDiscounted(p); }
    money(amount: number | null | undefined, currency?: string): string { return formatMoney(amount, currency); }
    tierLabel(p: IProduct): string | null {
        const tier = resolveDisplayTier(p);
        return tier && tier.price != null && this.discounted(p) ? tier.label : null;
    }

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
