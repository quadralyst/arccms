import { CommonModule } from '@angular/common';
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
    ],
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
        .account-container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 40px 24px;
            font-family: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif;
            color: #1e293b;
        }

        /* Signin Styling */
        .signin-wrapper {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 60vh;
        }
        .signin-card {
            width: 100%;
            max-width: 460px;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.02);
            background: #ffffff;
            overflow: hidden;
        }
        .signin-icon {
            width: 56px;
            height: 56px;
            background: #f1f5f9;
            color: #64748b;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            font-size: 20px;
            margin: 0 auto 20px;
        }

        /* Header */
        .dashboard-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
            gap: 20px;
            flex-wrap: wrap;
        }
        .dashboard-header h1 {
            font-size: 2.1rem;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 6px;
            letter-spacing: -0.03em;
        }
        .dashboard-header .subtitle {
            margin: 0;
            font-size: 0.98rem;
        }
        .refresh-btn {
            background: #ffffff !important;
            border: 1px solid #cbd5e1 !important;
            color: #334155 !important;
            border-radius: 10px !important;
            padding: 8px 18px !important;
            font-weight: 600 !important;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease !important;
        }
        .refresh-btn:hover {
            background: #f8fafc !important;
        }

        /* Grid */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
            gap: 28px;
            margin-bottom: 36px;
        }
        @media (max-width: 600px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
            }
        }

        .status-card {
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.01);
            background: #ffffff;
            padding: 0;
            overflow: hidden;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .status-card:hover {
            border-color: #cbd5e1;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
        }

        .card-header {
            padding: 20px 24px;
            border-bottom: 1px solid #e2e8f0;
        }
        .header-main {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .icon-box {
            width: 44px;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 10px;
            font-size: 1.1rem;
        }
        .icon-box.icon-blue {
            background: #eff6ff;
            color: #3b82f6;
        }
        .icon-box.icon-yellow {
            background: #fef9c3;
            color: #ca8a04;
        }
        .tier-info h3 {
            font-size: 1.15rem;
            font-weight: 700;
            margin: 0 0 4px;
            color: #0f172a;
        }

        /* Badges */
        .badge-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .plan-badge {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            letter-spacing: 0.02em;
        }
        .plan-badge.pro {
            background: #3b82f6;
            color: #ffffff;
        }
        .plan-badge.free {
            background: #f1f5f9;
            color: #475569;
        }
        .status-badge {
            font-size: 0.72rem;
            font-weight: 700;
            background: #e6f4ea;
            color: #137333;
            padding: 3px 8px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            gap: 4px;
            text-transform: uppercase;
        }
        .pulse-dot {
            width: 6px;
            height: 6px;
            background-color: #137333;
            border-radius: 50%;
        }

        /* Card Content */
        .card-content {
            padding: 24px;
        }
        .info-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .info-item {
            display: flex;
            align-items: center;
            gap: 14px;
        }
        .info-icon {
            color: #94a3b8;
            font-size: 1rem;
            width: 20px;
            display: flex;
            justify-content: center;
        }
        .info-data {
            display: flex;
            flex-direction: column;
        }
        .info-label {
            font-size: 0.72rem;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 1px;
        }
        .info-val {
            font-size: 0.92rem;
            font-weight: 600;
            color: #1e293b;
        }
        .info-val.font-semibold {
            font-weight: 700;
            color: #0f172a;
        }
        .mono {
            font-family: monospace;
            font-size: 0.85rem;
            color: #475569;
        }

        /* Upgrade section */
        .upgrade-section {
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid #e2e8f0;
        }
        .upgrade-btn {
            background: #3b82f6 !important;
            color: #ffffff !important;
            font-weight: 600 !important;
            border-radius: 8px !important;
        }

        /* Credits */
        .balance-display {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 20px;
        }
        .balance-count {
            display: flex;
            flex-direction: column;
        }
        .balance-count .count {
            font-size: 2.2rem;
            font-weight: 800;
            color: #0f172a;
            line-height: 1;
            letter-spacing: -0.03em;
        }
        .balance-count .label {
            font-size: 0.8rem;
            color: #64748b;
            font-weight: 600;
            margin-top: 2px;
        }
        .use-credit-btn {
            background: #0f172a !important;
            color: #ffffff !important;
            border-radius: 8px !important;
            font-weight: 600 !important;
            padding: 6px 14px !important;
        }
        .spinner-light ::ng-deep circle {
            stroke: #ffffff !important;
        }

        /* Error */
        .error-banner {
            background: #fef2f2;
            color: #991b1b;
            border: 1px solid #fee2e2;
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 16px;
        }

        /* Ledger */
        .ledger-summary h4 {
            font-size: 0.85rem;
            font-weight: 700;
            margin: 0 0 10px;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .ledger-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .ledger-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #f8fafc;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
        }
        .ledger-main {
            display: flex;
            flex-direction: column;
        }
        .ledger-main .reason {
            font-size: 0.85rem;
            font-weight: 700;
            color: #1e293b;
        }
        .ledger-main .date {
            font-size: 0.7rem;
            color: #64748b;
        }
        .ledger-item .delta {
            font-weight: 700;
            font-size: 0.9rem;
        }
        .ledger-item .delta.pos {
            color: #16a34a;
        }
        .ledger-item .delta.neg {
            color: #dc2626;
        }

        /* History Section */
        .history-container {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.01);
            margin-top: 36px;
        }
        .history-header h2 {
            font-size: 1.25rem;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 20px;
        }
        .table-section h3 {
            font-size: 0.95rem;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin: 0 0 12px;
        }

        /* Table */
        .premium-table-wrap {
            overflow-x: auto;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
        }
        .premium-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }
        .premium-table th {
            background: #f8fafc;
            padding: 12px 16px;
            font-size: 0.72rem;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid #e2e8f0;
        }
        .premium-table td {
            padding: 12px 16px;
            font-size: 0.88rem;
            border-bottom: 1px solid #e2e8f0;
            color: #334155;
        }
        .premium-table tr:last-child td {
            border-bottom: none;
        }
        .amount-cell {
            font-weight: 700;
            color: #0f172a;
        }
        .plan-indicator {
            font-weight: 700;
            text-transform: uppercase;
            font-size: 0.75rem;
            color: #2563eb;
            background: #eff6ff;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .tier-indicator {
            font-size: 0.78rem;
            color: #475569;
            margin-left: 4px;
        }
        .status-indicator-pill {
            display: inline-block;
            font-size: 0.7rem;
            font-weight: 700;
            text-transform: uppercase;
            padding: 3px 8px;
            border-radius: 6px;
        }
        .status-indicator-pill.succeeded {
            background: #e6f4ea;
            color: #137333;
        }
        .status-indicator-pill.failed {
            background: #fef2f2;
            color: #991b1b;
        }
        .status-indicator-pill.refunded {
            background: #fff9c4;
            color: #ca8a04;
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 32px 0;
            color: #94a3b8;
        }
        .empty-state i {
            font-size: 32px;
            margin-bottom: 8px;
        }
        .empty-state p {
            font-size: 0.9rem;
            margin: 0;
        }
        .spinner-container {
            display: flex;
            justify-content: center;
            padding: 32px 0;
        }

        /* Animations */
        .animate-fade-in {
            animation: fadeIn 0.3s ease forwards;
        }
        .animate-slide-up {
            opacity: 0;
            animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(12px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
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
