import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { memberLocaleNow } from '../../core/i18n/member-language-now';
import { TranslocoPipe } from '@jsverse/transloco';
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
const MAX_POLLS = 15; // about 45s: the webhook grants the plan after the payment

/**
 * Dodo `return_url` landing. The webhook grants the entitlement asynchronously,
 * so we poll the user's doc until `isPro` flips (or time out) and confirm the
 * purchase. Point `successUrl` in Settings/dodo-payments at `/checkout/success`.
 */
@Component({
    standalone: true,
    imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, MatProgressSpinnerModule, PublicNavComponent, TranslocoPipe],
    template: `
        <app-public-nav></app-public-nav>

        <div class="success">
            <mat-card class="card">
                <mat-card-content class="text-center py-4">
                    @if (phase() === 'processing') {
                        <div role="status">
                            <mat-spinner diameter="48" class="mx-auto mb-3" [attr.aria-label]="'common.state.loading' | transloco"></mat-spinner>
                            <h1 class="h2">{{ 'member.checkout.confirming' | transloco }}</h1>
                            <p class="text-muted">{{ 'member.checkout.confirming_hint' | transloco }}</p>
                        </div>
                    } @else if (phase() === 'confirmed') {
                        <div class="icon ok" aria-hidden="true"><i class="fa-solid fa-circle-check"></i></div>
                        <h1 class="h2">{{ 'member.checkout.all_set' | transloco }}</h1>
                        <p class="text-muted">
                            {{ 'member.checkout.plan_ready' | transloco: { plan: entitlement()?.premiumType || ('member.checkout.membership' | transloco) } }}
                            @if (expiresAt()) { {{ 'member.checkout.renews' | transloco: { date: expiresAt() } }} }
                        </p>
                    } @else {
                        <div class="icon wait" aria-hidden="true"><i class="fa-solid fa-clock"></i></div>
                        <h1 class="h2">{{ 'member.checkout.received_title' | transloco }}</h1>
                        <p class="text-muted">{{ 'member.checkout.received_body' | transloco }}</p>
                    }

                    <div class="actions mt-3">
                        <a mat-raised-button color="primary" routerLink="/account">{{ 'member.checkout.go_to_account' | transloco }}</a>
                        @if (phase() === 'timeout') {
                            <button mat-stroked-button type="button" (click)="startPolling()">{{ 'member.checkout.check_again' | transloco }}</button>
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
        // The member's locale now, not the one the app started in (as the account page does).
        return d ? d.toLocaleDateString(memberLocaleNow()) : '';
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
            // Not signed in on this device: nothing to check, so the page points to the account.
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
