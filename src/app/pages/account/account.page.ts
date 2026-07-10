import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';
import { PublicNavComponent } from '../payments-ui/public-nav.component';
import { IUser } from '../admin/users/user.model';
import { TransactionsService } from '../admin/(transactions)/transactions.service';
import { ITransaction } from '../admin/(transactions)/transaction.model';
import { toJsDate } from '../payments-ui/date-utils';

/**
 * Public account / membership page. Shows the signed-in user's entitlement
 * (written by the payment Cloud Functions) plus their own transaction history.
 * This is the primary surface for verifying that a payment granted access.
 */
@Component({
    standalone: true,
    imports: [
        CommonModule,
        RouterLink,
        MatButtonModule,
        MatCardModule,
        MatProgressSpinnerModule,
        MatTableModule,
        MatChipsModule,
        PublicNavComponent,
    ],
    template: `
        <app-public-nav></app-public-nav>

        <div class="account">
            @if (!uid()) {
                <mat-card class="signin-card">
                    <mat-card-content class="text-center py-4">
                        <p class="mb-3">Please sign in to view your membership.</p>
                        <a mat-raised-button color="primary" routerLink="/signup" [queryParams]="{ redirect: '/account' }">Sign in</a>
                    </mat-card-content>
                </mat-card>
            } @else {
                <div class="header">
                    <h1>My Membership</h1>
                    <button mat-stroked-button type="button" (click)="refresh()" [disabled]="loadingEntitlement()">
                        <i class="fa-solid fa-rotate-right me-2"></i>Refresh
                    </button>
                </div>

                <!-- Entitlement -->
                <mat-card class="entitlement-card">
                    @if (loadingEntitlement()) {
                        <div class="d-flex justify-content-center py-4"><mat-spinner diameter="32"></mat-spinner></div>
                    } @else {
                        <mat-card-content>
                            <div class="status-row">
                                <span class="label">Status</span>
                                @if (entitlement()?.isPro) {
                                    <mat-chip class="chip pro">PRO · {{ entitlement()?.premiumType || '—' }}</mat-chip>
                                    <mat-chip class="chip" [class]="statusClass()">{{ entitlement()?.premiumStatus || 'active' }}</mat-chip>
                                } @else {
                                    <mat-chip class="chip free">Free</mat-chip>
                                }
                            </div>

                            <div class="grid">
                                <div class="field"><span class="k">Tier rank</span><span class="v">{{ entitlement()?.premiumTierRank ?? '—' }}</span></div>
                                <div class="field"><span class="k">Renews / expires</span><span class="v">{{ fmtDate(entitlement()?.premiumExpiresAt) }}</span></div>
                                <div class="field"><span class="k">Free updates until</span><span class="v">{{ fmtDate(updatesUntil()) }}</span></div>
                                <div class="field"><span class="k">Subscription ID</span><span class="v mono">{{ entitlement()?.dodoSubscriptionId || '—' }}</span></div>
                                <div class="field"><span class="k">Customer ID</span><span class="v mono">{{ entitlement()?.dodoCustomerId || '—' }}</span></div>
                            </div>

                            @if (!entitlement()?.isPro) {
                                <div class="mt-3"><a mat-raised-button color="primary" routerLink="/pricing">View plans</a></div>
                            }
                        </mat-card-content>
                    }
                </mat-card>

                <!-- Transactions -->
                <h2 class="mt-4">Transaction history</h2>
                @if (loadingTxns()) {
                    <div class="d-flex justify-content-center py-4"><mat-spinner diameter="28"></mat-spinner></div>
                } @else if (transactions().length === 0) {
                    <p class="text-muted">No transactions yet.</p>
                } @else {
                    <div class="table-wrap">
                        <table mat-table [dataSource]="transactions()" class="w-100">
                            <ng-container matColumnDef="date">
                                <th mat-header-cell *matHeaderCellDef>Date</th>
                                <td mat-cell *matCellDef="let t">{{ fmtDate(t.createdAt) }}</td>
                            </ng-container>
                            <ng-container matColumnDef="amount">
                                <th mat-header-cell *matHeaderCellDef>Amount</th>
                                <td mat-cell *matCellDef="let t">{{ t.amount | number: '1.2-2' }} {{ t.currency }}</td>
                            </ng-container>
                            <ng-container matColumnDef="plan">
                                <th mat-header-cell *matHeaderCellDef>Plan</th>
                                <td mat-cell *matCellDef="let t">{{ t.premiumType }}{{ t.tierApplied ? ' · ' + t.tierApplied : '' }}</td>
                            </ng-container>
                            <ng-container matColumnDef="status">
                                <th mat-header-cell *matHeaderCellDef>Status</th>
                                <td mat-cell *matCellDef="let t"><span class="txn-status" [class]="t.status">{{ t.status }}</span></td>
                            </ng-container>
                            <ng-container matColumnDef="event">
                                <th mat-header-cell *matHeaderCellDef>Event</th>
                                <td mat-cell *matCellDef="let t" class="mono">{{ t.eventType }}</td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="columns"></tr>
                            <tr mat-row *matRowDef="let row; columns: columns"></tr>
                        </table>
                    </div>
                }
            }
        </div>
    `,
    styles: [`
        .account { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
        .signin-card { max-width: 420px; margin: 48px auto; }
        .header { display: flex; align-items: center; justify-content: space-between; }
        .entitlement-card { border: 1px solid #dee2e6; }
        .status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
        .label { font-weight: 600; margin-right: 8px; }
        .chip.pro { background: #0d6efd; color: #fff; }
        .chip.free { background: #e9ecef; color: #495057; }
        .chip.active { background: #d1e7dd; color: #0f5132; }
        .chip.trialing { background: #cff4fc; color: #055160; }
        .chip.past_due { background: #fff3cd; color: #664d03; }
        .chip.cancelled, .chip.expired { background: #f8d7da; color: #842029; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .field { display: flex; flex-direction: column; padding: 8px 0; border-bottom: 1px solid #f1f3f5; }
        .field .k { font-size: 0.75rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.03em; }
        .field .v { font-size: 0.95rem; color: #212529; }
        .mono { font-family: monospace; font-size: 0.85rem; word-break: break-all; }
        .table-wrap { overflow-x: auto; border: 1px solid #dee2e6; border-radius: 4px; }
        .txn-status { text-transform: capitalize; font-weight: 600; }
        .txn-status.succeeded { color: #0f5132; }
        .txn-status.failed { color: #842029; }
        .txn-status.refunded { color: #664d03; }
    `],
})
export default class AccountPageComponent implements OnInit {
    private authState = inject(AuthState);
    private membership = inject(MembershipService);
    private transactionsService = inject(TransactionsService);

    uid = computed(() => this.authState.currentUser()?.uid ?? null);

    entitlement = signal<IUser | null>(null);
    transactions = signal<ITransaction[]>([]);
    loadingEntitlement = signal(false);
    loadingTxns = signal(false);

    columns = ['date', 'amount', 'plan', 'status', 'event'];

    updatesUntil = computed(() => this.entitlement()?.updatesUntil ?? null);
    statusClass = computed(() => this.entitlement()?.premiumStatus ?? 'active');

    ngOnInit(): void {
        this.refresh();
    }

    refresh(): void {
        const uid = this.uid();
        if (!uid) return;
        this.loadEntitlement(uid);
        this.loadTransactions(uid);
    }

    private loadEntitlement(uid: string): void {
        this.loadingEntitlement.set(true);
        this.membership.getById(uid).subscribe({
            next: (user) => {
                this.entitlement.set(user);
                this.loadingEntitlement.set(false);
            },
            error: () => this.loadingEntitlement.set(false),
        });
    }

    private loadTransactions(uid: string): void {
        this.loadingTxns.set(true);
        this.transactionsService
            .getAll({
                whereConditions: [{ field: 'userId', operator: '==', value: uid }],
                limitCount: 50,
                currentPageNumber: 0,
                previousPageNumber: 0,
                getOnce: true,
            })
            .subscribe({
                next: (result) => {
                    const rows = (result.collectionData ?? []).slice();
                    // Sort newest-first client-side to avoid a composite index requirement.
                    rows.sort((a, b) => (toJsDate(b.createdAt)?.getTime() ?? 0) - (toJsDate(a.createdAt)?.getTime() ?? 0));
                    this.transactions.set(rows);
                    this.loadingTxns.set(false);
                },
                error: () => this.loadingTxns.set(false),
            });
    }

    fmtDate(value: unknown): string {
        const d = toJsDate(value);
        return d ? d.toLocaleString() : '—';
    }
}
