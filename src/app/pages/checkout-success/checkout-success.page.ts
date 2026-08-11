import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';
import { PublicNavComponent } from '../payments-ui/public-nav.component';
import { IUser } from '../admin/users/user.model';
import { toJsDate } from '../payments-ui/date-utils';

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 15; // ~45s — entitlement is granted asynchronously by the webhook

/**
 * Dodo `return_url` landing. The webhook grants the entitlement asynchronously,
 * so we poll the user's doc until `isPro` flips (or time out) and confirm the
 * purchase. Point `successUrl` in Settings/dodo-payments at `/checkout/success`.
 */
@Component({
    standalone: true,
    imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, MatProgressSpinnerModule, PublicNavComponent],
    template: `
        <app-public-nav></app-public-nav>

        <div class="success">
            <mat-card class="card">
                <mat-card-content class="text-center py-4">
                    @if (phase() === 'processing') {
                        <mat-spinner diameter="48" class="mx-auto mb-3"></mat-spinner>
                        <h2>Confirming your payment…</h2>
                        <p class="text-muted">This can take a few seconds while we process the confirmation.</p>
                    } @else if (phase() === 'confirmed') {
                        <div class="icon ok"><i class="fa-solid fa-circle-check"></i></div>
                        <h2>You're all set!</h2>
                        <p class="text-muted">
                            Your {{ entitlement()?.premiumType || 'membership' }} is now
                            <strong>{{ entitlement()?.premiumStatus || 'active' }}</strong>.
                            @if (expiresAt()) { Renews / expires {{ expiresAt() }}. }
                        </p>
                    } @else {
                        <div class="icon wait"><i class="fa-solid fa-clock"></i></div>
                        <h2>Payment received</h2>
                        <p class="text-muted">
                            We haven't seen the confirmation land yet. It usually arrives shortly —
                            check your account in a moment.
                        </p>
                    }

                    <div class="actions mt-3">
                        <a mat-raised-button color="primary" routerLink="/account">Go to my account</a>
                        @if (phase() === 'timeout') {
                            <button mat-stroked-button type="button" (click)="startPolling()">Check again</button>
                        }
                    </div>
                </mat-card-content>
            </mat-card>
        </div>
    `,
    styles: [`
        .success { max-width: 560px; margin: 48px auto; padding: 0 24px; }
        .card { border: 1px solid #dee2e6; }
        .icon { font-size: 3rem; margin-bottom: 8px; }
        .icon.ok { color: #198754; }
        .icon.wait { color: #fd7e14; }
        .actions { display: flex; gap: 12px; justify-content: center; }
    `],
})
export default class CheckoutSuccessPageComponent implements OnInit, OnDestroy {
    private authState = inject(AuthState);
    private membership = inject(MembershipService);

    phase = signal<'processing' | 'confirmed' | 'timeout'>('processing');
    entitlement = signal<IUser | null>(null);

    private timer: ReturnType<typeof setTimeout> | null = null;
    private polls = 0;

    uid = computed(() => this.authState.currentUser()?.uid ?? null);
    expiresAt = computed(() => {
        const d = toJsDate(this.entitlement()?.premiumExpiresAt);
        return d ? d.toLocaleDateString() : '';
    });

    ngOnInit(): void {
        this.startPolling();
    }

    ngOnDestroy(): void {
        this.clearTimer();
    }

    startPolling(): void {
        this.clearTimer();
        this.polls = 0;
        this.phase.set('processing');
        this.poll();
    }

    private poll(): void {
        const uid = this.uid();
        if (!uid) {
            // Not signed in on this device — can't verify; send them to account to sign in.
            this.phase.set('timeout');
            return;
        }

        this.membership.getById(uid).subscribe({
            next: (user) => {
                this.entitlement.set(user);
                if (user?.isPro) {
                    this.phase.set('confirmed');
                    this.clearTimer();
                    return;
                }
                this.scheduleNext();
            },
            error: () => this.scheduleNext(),
        });
    }

    private scheduleNext(): void {
        this.polls += 1;
        if (this.polls >= MAX_POLLS) {
            this.phase.set('timeout');
            this.clearTimer();
            return;
        }
        this.timer = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
