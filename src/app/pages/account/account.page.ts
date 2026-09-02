import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';
import { UserShellComponent } from '../user/user-shell.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { IUser } from '../admin/users/user.model';
import { TransactionsService } from '../admin/(transactions)/transactions.service';
import { ITransaction } from '../admin/(transactions)/transaction.model';
import { CreditLedgerService } from '../payments-ui/credit-ledger.service';
import { ICreditLedgerEntry } from '../payments-ui/credit-ledger.model';
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
        UserShellComponent,
        PageHeaderComponent, TranslocoPipe],
    template: `
        <app-user-shell>
        <div class="account-container animate-fade-in">
            @if (!uid()) {
                <div class="signin-wrapper">
                    <mat-card class="signin-card">
                        <mat-card-content class="text-center py-5">
                            <div class="signin-icon">
                                <i class="fa-solid fa-lock"></i>
                            </div>
                            <h2>Access Restricted</h2>
                            <p class="mb-4 text-muted">Please sign in to manage your premium membership and credits.</p>
                            <a mat-raised-button color="primary" routerLink="/signup" [queryParams]="{ redirect: '/account' }" class="signin-btn">
                                Sign In / Register
                            </a>
                        </mat-card-content>
                    </mat-card>
                </div>
            } @else {
                <div class="dashboard-header">
                    <div class="header-info">
                        <h1>Membership & Billing</h1>
                        <p class="subtitle text-muted">Manage your subscription, credits, and view past billing transactions.</p>
                    </div>
                    <button mat-flat-button class="refresh-btn" type="button" (click)="refresh()" [disabled]="loadingEntitlement()">
                        <i class="fa-solid fa-rotate" [class.fa-spin]="loadingEntitlement()"></i>
                        <span>Refresh Data</span>
                    </button>
                </div>

                <div class="dashboard-grid">
                    <!-- Entitlement Card -->
                    <mat-card class="status-card">
                        @if (loadingEntitlement()) {
                            <div class="spinner-container"><mat-spinner diameter="40"></mat-spinner></div>
                        } @else {
                            <div class="card-header">
                                <div class="header-main">
                                    <div class="icon-box icon-blue">
                                        <i class="fa-solid fa-crown"></i>
                                    </div>
                                    <div class="tier-info">
                                        <h3>Current Plan</h3>
                                        <div class="badge-row">
                                            @if (entitlement()?.isPro) {
                                                <span class="plan-badge pro">{{ entitlement()?.premiumType | uppercase }}</span>
                                                <span class="status-badge active"><span class="pulse-dot"></span>Active</span>
                                            } @else {
                                                <span class="plan-badge free">FREE TIER</span>
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="card-content">
                                <div class="info-list">
                                    <div class="info-item">
                                        <div class="info-icon"><i class="fa-solid fa-calendar-days"></i></div>
                                        <div class="info-data">
                                            <span class="info-label">Renews / Expires</span>
                                            <span class="info-val font-semibold">{{ fmtDate(entitlement()?.premiumExpiresAt) }}</span>
                                        </div>
                                    </div>

                                    <div class="info-item">
                                        <div class="info-icon"><i class="fa-solid fa-arrow-up-right-dots"></i></div>
                                        <div class="info-data">
                                            <span class="info-label">Tier Rank</span>
                                            <span class="info-val">{{ entitlement()?.premiumTierRank ?? '—' }}</span>
                                        </div>
                                    </div>

                                    <div class="info-item">
                                        <div class="info-icon"><i class="fa-solid fa-receipt"></i></div>
                                        <div class="info-data">
                                            <span class="info-label">Subscription ID</span>
                                            <span class="info-val mono">{{ entitlement()?.providerSubscriptionId || '—' }}</span>
                                        </div>
                                    </div>

                                    <div class="info-item">
                                        <div class="info-icon"><i class="fa-solid fa-id-card"></i></div>
                                        <div class="info-data">
                                            <span class="info-label">Customer ID</span>
                                            <span class="info-val mono">{{ entitlement()?.providerCustomerId || '—' }}</span>
                                        </div>
                                    </div>
                                </div>

                                @if (!entitlement()?.isPro) {
                                    <div class="upgrade-section">
                                        <p class="text-muted mb-3">Unlock advanced CMS capabilities and credits by upgrading.</p>
                                        <a mat-flat-button class="upgrade-btn" routerLink="/pricing">
                                            Upgrade Plan <i class="fa-solid fa-arrow-right ms-2"></i>
                                        </a>
                                    </div>
                                }
                            </div>
                        }
                    </mat-card>

                    <!-- Credits Card -->
                    <mat-card class="status-card">
                        <div class="card-header">
                            <div class="header-main">
                                <div class="icon-box icon-yellow">
                                    <i class="fa-solid fa-coins"></i>
                                </div>
                                <div class="tier-info">
                                    <h3>Prepaid Credits</h3>
                                    <p class="subtitle text-muted">Use credits for querying AI and generation tools.</p>
                                </div>
                            </div>
                        </div>

                        <div class="card-content">
                            <div class="balance-display">
                                <div class="balance-count">
                                    <span class="count">{{ creditBalance() }}</span>
                                    <span class="label">Available Credits</span>
                                </div>
                                <button mat-flat-button class="use-credit-btn" type="button" (click)="useCredit()" [disabled]="spending() || creditBalance() < 1">
                                    @if (spending()) { 
                                        <mat-spinner diameter="18" class="me-2 spinner-light"></mat-spinner> 
                                    } @else {
                                        <i class="fa-solid fa-bolt me-2"></i>
                                    }
                                    Use 1 Credit
                                </button>
                            </div>
                            
                            @if (creditError()) { 
                                <div class="error-banner">
                                    <i class="fa-solid fa-triangle-exclamation me-2"></i>
                                    {{ creditError() }}
                                </div>
                            }

                            <!-- Ledger Sub-list -->
                            @if (ledger().length > 0) {
                                <div class="ledger-summary">
                                    <h4>Recent Ledger Activity</h4>
                                    <div class="ledger-list">
                                        @for (e of ledger().slice(0, 3); track e.id) {
                                            <div class="ledger-item">
                                                <div class="ledger-main">
                                                    <span class="reason">{{ e.reason }}</span>
                                                    <span class="date">{{ fmtDate(e.createdAt) }}</span>
                                                </div>
                                                <span class="delta" [class.pos]="e.delta > 0" [class.neg]="e.delta < 0">
                                                    {{ e.delta > 0 ? '+' : '' }}{{ e.delta }}
                                                </span>
                                            </div>
                                        }
                                    </div>
                                </div>
                            }
                        </div>
                    </mat-card>
                </div>

                <!-- Transaction History -->
                <div class="history-container animate-slide-up" style="animation-delay: 0.1s;">
                    <div class="history-header">
                        <h2>Billing & Activity History</h2>
                    </div>

                    <div class="history-tables">
                        <!-- Transactions Table -->
                        <div class="table-section">
                            <h3>Transactions</h3>
                            @if (loadingTxns()) {
                                <div class="spinner-container"><mat-spinner diameter="32"></mat-spinner></div>
                            } @else if (transactions().length === 0) {
                                <div class="empty-state">
                                    <i class="fa-solid fa-receipt"></i>
                                    <p>No billing transactions found.</p>
                                </div>
                            } @else {
                                <div class="premium-table-wrap">
                                    <table class="premium-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Amount</th>
                                                <th>Plan</th>
                                                <th>Status</th>
                                                <th>Event</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (t of transactions(); track t.id) {
                                                <tr>
                                                    <td>{{ fmtDate(t.createdAt) }}</td>
                                                    <td class="amount-cell">{{ t.amount | number: '1.2-2' }} {{ t.currency }}</td>
                                                    <td>
                                                        <span class="plan-indicator">{{ t.premiumType }}</span>
                                                        @if (t.tierApplied) {
                                                            <span class="tier-indicator">{{ t.tierApplied }}</span>
                                                        }
                                                    </td>
                                                    <td>
                                                        <span class="status-indicator-pill" [class]="t.status">
                                                            {{ t.status }}
                                                        </span>
                                                    </td>
                                                    <td class="mono font-xs text-muted">{{ t.eventType }}</td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        </div>
                    </div>
                </div>
            }
        </div>
        </app-user-shell>
    `,
    styles: [`
        .account { max-width: 900px; margin: 0 auto; padding: 24px; }
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
        .credits-card { border: 1px solid #dee2e6; }
        .credits-row { display: flex; align-items: center; justify-content: space-between; }
        .balance .num { font-size: 2rem; font-weight: 700; color: #212529; }
        .balance .unit { margin-left: 6px; color: #6c757d; }
        .credit-error { color: #842029; font-size: 0.9rem; }
        .ledger { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .ledger th, .ledger td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f1f3f5; }
        .ledger th { color: #6c757d; font-weight: 600; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.03em; }
        .ledger .pos { color: #0f5132; font-weight: 600; }
        .ledger .neg { color: #842029; font-weight: 600; }
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
    private creditLedger = inject(CreditLedgerService);
    private functions = inject(Functions);

    uid = computed(() => this.authState.currentUser()?.uid ?? null);

    entitlement = signal<IUser | null>(null);
    transactions = signal<ITransaction[]>([]);
    ledger = signal<ICreditLedgerEntry[]>([]);
    loadingEntitlement = signal(false);
    loadingTxns = signal(false);
    spending = signal(false);
    creditError = signal('');

    columns = ['date', 'amount', 'plan', 'status', 'event'];

    updatesUntil = computed(() => this.entitlement()?.updatesUntil ?? null);
    statusClass = computed(() => this.entitlement()?.premiumStatus ?? 'active');
    creditBalance = computed(() => this.entitlement()?.creditBalance ?? 0);

    ngOnInit(): void {
        this.refresh();
    }

    refresh(): void {
        const uid = this.uid();
        if (!uid) return;
        this.loadEntitlement(uid);
        this.loadTransactions(uid);
        this.loadLedger(uid);
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

    private loadLedger(uid: string): void {
        this.creditLedger
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
                    rows.sort((a, b) => (toJsDate(b.createdAt)?.getTime() ?? 0) - (toJsDate(a.createdAt)?.getTime() ?? 0));
                    this.ledger.set(rows);
                },
                error: () => this.ledger.set([]),
            });
    }

    async useCredit(): Promise<void> {
        this.spending.set(true);
        this.creditError.set('');
        try {
            const consume = httpsCallable(this.functions, 'consumeCredits');
            await consume({ amount: 1, note: 'account page test' });
            this.refresh();
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? 'Could not use a credit.';
            this.creditError.set(msg.includes('Insufficient') ? 'Insufficient credits.' : 'Could not use a credit.');
        } finally {
            this.spending.set(false);
        }
    }

    fmtDate(value: unknown): string {
        const d = toJsDate(value);
        return d ? d.toLocaleString() : '—';
    }
}
