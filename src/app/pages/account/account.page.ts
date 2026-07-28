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
        <div class="account">
            @if (!uid()) {
                <mat-card class="signin-card">
                    <mat-card-content class="text-center py-4">
                        <p class="mb-3">{{ 'user.account.sign_in_prompt' | transloco }}</p>
                        <a mat-raised-button color="primary" routerLink="/signup" [queryParams]="{ redirect: '/account' }">{{ 'user.account.sign_in' | transloco }}</a>
                    </mat-card-content>
                </mat-card>
            } @else {
                <arc-page-header [title]="'user.account.title' | transloco">
                    <button mat-stroked-button type="button" (click)="refresh()" [disabled]="loadingEntitlement()">
                        <i class="fa-solid fa-rotate-right me-2"></i>{{ 'admin.dashboard.refresh' | transloco }}
                    </button>
                </arc-page-header>

                <!-- Entitlement -->
                <mat-card class="entitlement-card">
                    @if (loadingEntitlement()) {
                        <div class="d-flex justify-content-center py-4"><mat-spinner diameter="32"></mat-spinner></div>
                    } @else {
                        <mat-card-content>
                            <div class="status-row">
                                <span class="label">{{ 'common.table.status' | transloco }}</span>
                                @if (entitlement()?.isPro) {
                                    <mat-chip class="chip pro">{{ 'user.account.pro_chip' | transloco: { type: (entitlement()?.premiumType || '—') } }}</mat-chip>
                                    <mat-chip class="chip" [class]="statusClass()">{{ entitlement()?.premiumStatus || 'active' }}</mat-chip>
                                } @else {
                                    <mat-chip class="chip free">{{ 'user.free' | transloco }}</mat-chip>
                                }
                            </div>

                            <div class="grid">
                                <div class="field"><span class="k">{{ 'user.account.tier_rank' | transloco }}</span><span class="v">{{ entitlement()?.premiumTierRank ?? '—' }}</span></div>
                                <div class="field"><span class="k">{{ 'user.account.plan_deal' | transloco }}</span><span class="v">{{ entitlement()?.premiumTierLabel || '—' }}</span></div>
                                <div class="field"><span class="k">{{ 'user.account.discount_code' | transloco }}</span><span class="v mono">{{ entitlement()?.premiumDiscountCode || '—' }}</span></div>
                                <div class="field"><span class="k">{{ 'user.dashboard.renews' | transloco }}</span><span class="v">{{ fmtDate(entitlement()?.premiumExpiresAt) }}</span></div>
                                <div class="field"><span class="k">{{ 'user.dashboard.updates_until' | transloco }}</span><span class="v">{{ fmtDate(updatesUntil()) }}</span></div>
                                <div class="field"><span class="k">{{ 'user.account.subscription_id' | transloco }}</span><span class="v mono">{{ entitlement()?.providerSubscriptionId || '—' }}</span></div>
                                <div class="field"><span class="k">{{ 'user.account.customer_id' | transloco }}</span><span class="v mono">{{ entitlement()?.providerCustomerId || '—' }}</span></div>
                            </div>

                            @if (!entitlement()?.isPro) {
                                <div class="mt-3"><a mat-raised-button color="primary" routerLink="/pricing">{{ 'user.account.view_plans' | transloco }}</a></div>
                            }
                        </mat-card-content>
                    }
                </mat-card>

                <!-- Prepaid credits -->
                <h2 class="mt-4">{{ 'user.dashboard.credits' | transloco }}</h2>
                <mat-card class="credits-card">
                    <mat-card-content>
                        <div class="credits-row">
                            <div class="balance">
                                <span class="num">{{ creditBalance() }}</span>
                                <span class="unit">credits</span>
                            </div>
                            <div class="credit-actions">
                                <button mat-stroked-button type="button" (click)="useCredit()" [disabled]="spending() || creditBalance() < 1">
                                    @if (spending()) { <mat-spinner diameter="16" class="me-2"></mat-spinner> }
                                    Use 1 credit
                                </button>
                            </div>
                        </div>
                        @if (creditError()) { <p class="credit-error mt-2">{{ creditError() }}</p> }

                        @if (ledger().length > 0) {
                            <table class="ledger mt-3">
                                <thead><tr><th>{{ 'admin.dashboard.col_date' | transloco }}</th><th>{{ 'user.account.change' | transloco }}</th><th>{{ 'user.account.reason' | transloco }}</th><th>{{ 'user.account.balance' | transloco }}</th></tr></thead>
                                <tbody>
                                    @for (e of ledger(); track e.id) {
                                        <tr>
                                            <td>{{ fmtDate(e.createdAt) }}</td>
                                            <td [class.pos]="e.delta > 0" [class.neg]="e.delta < 0">{{ e.delta > 0 ? '+' : '' }}{{ e.delta }}</td>
                                            <td>{{ e.reason }}</td>
                                            <td>{{ e.balanceAfter }}</td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        }
                    </mat-card-content>
                </mat-card>

                <!-- Transactions -->
                <h2 class="mt-4">{{ 'user.account.transaction_history' | transloco }}</h2>
                @if (loadingTxns()) {
                    <div class="d-flex justify-content-center py-4"><mat-spinner diameter="28"></mat-spinner></div>
                } @else if (transactions().length === 0) {
                    <p class="text-muted">{{ 'user.account.no_transactions' | transloco }}</p>
                } @else {
                    <div class="table-wrap">
                        <table mat-table [dataSource]="transactions()" class="w-100">
                            <ng-container matColumnDef="date">
                                <th mat-header-cell *matHeaderCellDef>{{ 'admin.dashboard.col_date' | transloco }}</th>
                                <td mat-cell *matCellDef="let t">{{ fmtDate(t.createdAt) }}</td>
                            </ng-container>
                            <ng-container matColumnDef="amount">
                                <th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_amount' | transloco }}</th>
                                <td mat-cell *matCellDef="let t">{{ t.amount | number: '1.2-2' }} {{ t.currency }}</td>
                            </ng-container>
                            <ng-container matColumnDef="plan">
                                <th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_plan' | transloco }}</th>
                                <td mat-cell *matCellDef="let t">{{ t.premiumType }}{{ t.tierApplied ? ' · ' + t.tierApplied : '' }}</td>
                            </ng-container>
                            <ng-container matColumnDef="status">
                                <th mat-header-cell *matHeaderCellDef>{{ 'common.table.status' | transloco }}</th>
                                <td mat-cell *matCellDef="let t"><span class="txn-status" [class]="t.status">{{ t.status }}</span></td>
                            </ng-container>
                            <ng-container matColumnDef="event">
                                <th mat-header-cell *matHeaderCellDef>{{ 'admin.transactions.col_event' | transloco }}</th>
                                <td mat-cell *matCellDef="let t" class="mono">{{ t.eventType }}</td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="columns"></tr>
                            <tr mat-row *matRowDef="let row; columns: columns"></tr>
                        </table>
                    </div>
                }
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
