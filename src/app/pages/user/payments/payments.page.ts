import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Functions } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthState } from '../../(auth)/auth.store';
import { EntitlementService } from '../entitlement.service';
import { UserShellComponent } from '../user-shell.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { IfEntitledDirective } from '../if-entitled.directive';
import { userGuard } from '../user.guards';
import { TransactionsService } from '../../admin/(transactions)/transactions.service';
import { ITransaction } from '../../admin/(transactions)/transaction.model';
import { CreditLedgerService } from '../../payments-ui/credit-ledger.service';
import { ICreditLedgerEntry } from '../../payments-ui/credit-ledger.model';
import { toJsDate } from '../../payments-ui/date-utils';
import { formatMoney } from '../../payments-ui/pricing-utils';
import { arcCallable } from '../../../core/config/arc-functions';
import { injectT } from '../../../core/i18n/inject-t';
import { memberLocaleNow } from '../../../core/i18n/member-language-now';

export const routeMeta: RouteMeta = {
    title: 'Payments | Arc CMS',
    canActivate: [userGuard],
};

interface ActivityItem {
    id: string;
    date: Date | null;
    icon: string;
    label: string;
    amount: string;
    positive: boolean;
}

/**
 * The member's payments page, /user/payments (the payments feature): live status
 * tiles, quick actions (use/buy credits, upgrade), a compact membership summary, a
 * members-only card, and a merged "recent activity" feed (transactions + credit
 * ledger). Full history lives on /account; this is a summary + actions surface.
 */
@Component({
    selector: 'arc-user-payments',
    standalone: true,
    imports: [
        CommonModule,
        RouterLink,
        MatButtonModule,
        MatCardModule,
        MatProgressSpinnerModule,
        UserShellComponent,
        IfEntitledDirective,
        PageHeaderComponent, TranslocoPipe],
    template: `
        <app-user-shell>
            <div class="dash">
                <arc-page-header [title]="'user.payments.title' | transloco" [subtitle]="'user.payments.subtitle' | transloco"></arc-page-header>

                <!-- Onboarding empty state -->
                @if (isNewUser()) {
                    <mat-card class="welcome-banner animate-slide-up">
                        <mat-card-content class="w-body">
                            <div class="banner-icon"><i class="fa-solid fa-rocket"></i></div>
                            <div class="banner-text">
                                <h3>{{ 'user.dashboard.get_started' | transloco }}</h3>
                                <p class="text-muted">{{ 'user.dashboard.free_note' | transloco }}</p>
                            </div>
                            <a mat-flat-button class="action-accent-btn" routerLink="/pricing">{{ 'user.dashboard.see_plans' | transloco }}</a>
                        </mat-card-content>
                    </mat-card>
                }

                <!-- Status Tiles -->
                <div class="status-tiles-grid animate-slide-up">
                    <mat-card class="status-tile-card">
                        <div class="tile-header">
                            <span class="tile-label">{{ 'user.payments.membership' | transloco }}</span>
                            <span class="tile-icon icon-blue"><i class="fa-solid fa-crown"></i></span>
                        </div>
                        <div class="tile-content">
                            @if (entitlements.isPro()) {
                                <span class="tile-value value-pro">{{ entitlements.premiumType() || ('user.pro' | transloco) }}</span>
                                <span class="tile-sub badge-active">{{ entitlements.premiumStatus() || ('user.active' | transloco) }}</span>
                            } @else {
                                <span class="tile-value">{{ 'user.payments.free_tier' | transloco }}</span>
                                <a class="tile-action-link" routerLink="/pricing">{{ 'user.payments.upgrade_plan' | transloco }}</a>
                            }
                        </div>
                    </mat-card>

                    <mat-card class="status-tile-card">
                        <div class="tile-header">
                            <span class="tile-label">{{ 'user.payments.available_credits' | transloco }}</span>
                            <span class="tile-icon icon-yellow"><i class="fa-solid fa-coins"></i></span>
                        </div>
                        <div class="tile-content">
                            <span class="tile-value">{{ entitlements.creditBalance() }}</span>
                            <a class="tile-action-link" routerLink="/account">{{ 'user.payments.view_ledger' | transloco }}</a>
                        </div>
                    </mat-card>

                    <mat-card class="status-tile-card">
                        <div class="tile-header">
                            <span class="tile-label">{{ 'user.payments.plan_tier' | transloco }}</span>
                            <span class="tile-icon icon-purple"><i class="fa-solid fa-arrow-up-right-dots"></i></span>
                        </div>
                        <div class="tile-content">
                            <span class="tile-value">{{ entitlements.tierRank() >= 0 ? '#' + entitlements.tierRank() : '—' }}</span>
                            <span class="tile-sub text-truncate">{{ entitlement()?.premiumTierLabel || ('user.payments.no_active_plan' | transloco) }}</span>
                        </div>
                    </mat-card>
                </div>

                <!-- Quick actions -->
                <div class="quick-actions-bar animate-slide-up">
                    <button mat-flat-button class="use-credit-btn" type="button" (click)="useCredit()" [disabled]="spending() || entitlements.creditBalance() < 1">
                        @if (spending()) { 
                            <mat-spinner diameter="16" class="me-2 spinner-light"></mat-spinner> 
                        } @else {
                            <i class="fa-solid fa-bolt me-1"></i>
                        }
                        {{ 'user.payments.use_credit' | transloco }}
                    </button>
                    <a mat-stroked-button routerLink="/pricing"><i class="fa-solid fa-plus me-1"></i>{{ 'user.dashboard.buy_credits' | transloco }}</a>
                    <a mat-stroked-button routerLink="/account"><i class="fa-solid fa-receipt me-1"></i>{{ 'user.dashboard.manage_billing' | transloco }}</a>
                </div>
                @if (creditError()) { 
                    <div class="error-banner animate-fade-in">
                        <i class="fa-solid fa-circle-exclamation me-2"></i>{{ creditError() }}
                    </div> 
                }

                <!-- Compact membership detail (members only) -->
                @if (entitlements.isPro()) {
                    <mat-card class="mdetail">
                        <div class="md"><span class="k">{{ 'user.dashboard.renews' | transloco }}</span><span class="v">{{ fmtDate(entitlement()?.premiumExpiresAt) }}</span></div>
                        <div class="md"><span class="k">{{ 'user.dashboard.updates_until' | transloco }}</span><span class="v">{{ fmtDate(entitlement()?.updatesUntil) }}</span></div>
                        <div class="md"><span class="k">{{ 'user.dashboard.deal' | transloco }}</span><span class="v">{{ entitlement()?.premiumTierLabel || '—' }}</span></div>
                        <div class="md"><span class="k">{{ 'user.dashboard.discount' | transloco }}</span><span class="v mono">{{ entitlement()?.premiumDiscountCode || '—' }}</span></div>
                    </mat-card>
                }

                <!-- Members-only card (gated by *appIfEntitled) -->
                <mat-card class="premium-card" *appIfEntitled>
                    <div class="pc-body">
                        <i class="fa-solid fa-star pc-icon"></i>
                        <div>
                            <h3>{{ 'user.dashboard.premium_unlocked' | transloco }}</h3>
                            <p class="text-muted">{{ 'user.dashboard.premium_note' | transloco }}</p>
                        </div>
                        <a mat-raised-button color="primary" routerLink="/user/premium">{{ 'user.dashboard.open_premium' | transloco }}</a>
                    </div>
                </mat-card>

                <!-- Recent activity (summary; full history on /account) -->
                <div class="section-head">
                    <h2>{{ 'user.dashboard.recent_activity' | transloco }}</h2>
                    <a routerLink="/account" class="link">{{ 'user.dashboard.view_all' | transloco }}</a>
                </div>
                @if (loadingActivity()) {
                    <div class="py-3"><mat-spinner diameter="24"></mat-spinner></div>
                } @else if (activity().length === 0) {
                    <p class="text-muted">{{ 'user.dashboard.no_activity' | transloco }}</p>
                } @else {
                    <mat-card class="activity">
                        @for (a of activity(); track a.id) {
                            <div class="arow">
                                <i [class]="a.icon"></i>
                                <span class="al">{{ a.label }}</span>
                                <span class="aa" [class.pos]="a.positive" [class.neg]="!a.positive">{{ a.amount }}</span>
                                <span class="ad">{{ fmtDate(a.date) }}</span>
                            </div>
                        }
                    </mat-card>
                }

                <div class="section-layout animate-slide-up">
                    <h2 class="section-title">{{ 'user.payments.quick_navigation' | transloco }}</h2>
                    <div class="quick-links-grid">
                        <a class="quick-link-item" routerLink="/account">
                            <span class="ql-icon"><i class="fa-solid fa-credit-card"></i></span>
                            <div class="ql-text">
                                <span class="ql-title">{{ 'user.payments.account_billing' | transloco }}</span>
                                <span class="ql-desc">{{ 'user.payments.account_billing_hint' | transloco }}</span>
                            </div>
                        </a>
                        <a class="quick-link-item" routerLink="/user/profile">
                            <span class="ql-icon"><i class="fa-solid fa-user-gear"></i></span>
                            <div class="ql-text">
                                <span class="ql-title">{{ 'user.payments.profile_settings' | transloco }}</span>
                                <span class="ql-desc">{{ 'user.payments.profile_hint' | transloco }}</span>
                            </div>
                        </a>
                        <a class="quick-link-item" routerLink="/pricing">
                            <span class="ql-icon"><i class="fa-solid fa-tags"></i></span>
                            <div class="ql-text">
                                <span class="ql-title">{{ 'user.payments.membership_plans' | transloco }}</span>
                                <span class="ql-desc">{{ 'user.payments.plans_hint' | transloco }}</span>
                            </div>
                        </a>
                    </div>
                </div>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .dash-container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 40px 24px;
            font-family: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif;
            color: #1e293b;
        }

        /* Header */
        .dash-header {
            margin-bottom: 28px;
        }
        .dash-header h1 {
            font-size: 2.1rem;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 6px;
            letter-spacing: -0.03em;
        }
        .dash-header .subtitle {
            margin: 0;
            font-size: 0.98rem;
        }

        /* Welcome Banner */
        .welcome-banner {
            border: 1px solid #cbd5e1;
            background: #f8fafc;
            margin-bottom: 28px;
            border-radius: 16px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }
        .w-body {
            display: flex;
            align-items: center;
            gap: 20px;
            padding: 12px 16px;
        }
        .banner-icon {
            width: 48px;
            height: 48px;
            background: #e2e8f0;
            color: #475569;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            font-size: 1.25rem;
        }
        .banner-icon.premium-color {
            background: #d1e7dd;
            color: #0f5132;
        }
        .banner-text h3 {
            margin: 0 0 4px;
            font-size: 1.05rem;
            font-weight: 700;
            color: #0f172a;
        }
        .banner-text p {
            margin: 0;
            font-size: 0.9rem;
        }
        .action-accent-btn {
            margin-left: auto;
            background: #0f172a !important;
            color: #ffffff !important;
            font-weight: 600 !important;
            border-radius: 8px !important;
        }
        .premium-banner {
            border-color: #a3cfbb;
            background: #f4fbf7;
            margin-top: 24px;
        }
        .premium-action-btn {
            margin-left: auto;
            background: #198754 !important;
            color: #ffffff !important;
            font-weight: 600 !important;
            border-radius: 8px !important;
        }

        /* Status Tiles Grid */
        .status-tiles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 24px;
            margin-bottom: 28px;
        }
        .status-tile-card {
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.01);
            background: #ffffff;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .status-tile-card:hover {
            border-color: #cbd5e1;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
        }
        .tile-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .tile-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            font-weight: 600;
        }
        .tile-icon {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            font-size: 0.95rem;
        }
        .tile-icon.icon-blue {
            background: #eff6ff;
            color: #3b82f6;
        }
        .tile-icon.icon-yellow {
            background: #fef9c3;
            color: #ca8a04;
        }
        .tile-icon.icon-purple {
            background: #f5f3ff;
            color: #7c3aed;
        }
        .tile-content {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .tile-value {
            font-size: 1.8rem;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.03em;
        }
        .tile-value.value-pro {
            color: #3b82f6;
            text-transform: capitalize;
        }
        .tile-sub {
            font-size: 0.8rem;
            color: #64748b;
            font-weight: 500;
        }
        .tile-sub.badge-active {
            color: #16a34a;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 0.72rem;
            letter-spacing: 0.04em;
        }
        .tile-action-link {
            font-size: 0.82rem;
            color: #2563eb;
            text-decoration: none;
            font-weight: 600;
        }
        .tile-action-link:hover {
            text-decoration: underline;
        }

        /* Quick actions */
        .quick-actions-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 28px;
        }
        .use-credit-btn {
            background: #0f172a !important;
            color: #ffffff !important;
            border-radius: 10px !important;
            padding: 8px 18px !important;
            font-weight: 600 !important;
        }
        .action-btn {
            border: 1px solid #cbd5e1 !important;
            color: #334155 !important;
            border-radius: 10px !important;
            padding: 8px 18px !important;
            font-weight: 600 !important;
            background: #ffffff !important;
        }
        .action-btn:hover {
            background: #f8fafc !important;
        }
        .spinner-light ::ng-deep circle {
            stroke: #ffffff !important;
        }

        /* Error banner */
        .error-banner {
            background: #fef2f2;
            color: #991b1b;
            border: 1px solid #fee2e2;
            padding: 12px 16px;
            border-radius: 10px;
            font-size: 0.88rem;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
        }

        /* Membership details compact card */
        .membership-details-card {
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            background: #fafafa;
            margin-bottom: 28px;
        }
        .md-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            padding: 16px;
        }
        .md-item {
            display: flex;
            flex-direction: column;
        }
        .md-item .k {
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            margin-bottom: 3px;
        }
        .md-item .v {
            font-size: 0.92rem;
            color: #1e293b;
            font-weight: 600;
        }
        .mono {
            font-family: monospace;
            font-size: 0.85rem;
        }

        /* Sections Layout */
        .section-layout {
            margin-top: 36px;
        }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 16px;
        }
        .section-header h2, .section-title {
            font-size: 1.25rem;
            font-weight: 800;
            color: #0f172a;
            margin: 0;
        }
        .view-all-link {
            font-size: 0.85rem;
            color: #2563eb;
            text-decoration: none;
            font-weight: 600;
        }
        .view-all-link:hover {
            text-decoration: underline;
        }

        /* Activity Card styling */
        .activity-card {
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: none;
        }
        .activity-list {
            display: flex;
            flex-direction: column;
        }
        .activity-row {
            display: flex;
            align-items: center;
            padding: 14px 20px;
            border-bottom: 1px solid #f1f5f9;
        }
        .activity-row:last-child {
            border-bottom: none;
        }
        .activity-icon {
            width: 28px;
            color: #64748b;
            font-size: 0.95rem;
        }
        .activity-label {
            flex: 1;
            font-size: 0.9rem;
            font-weight: 600;
            color: #1e293b;
        }
        .activity-amount {
            font-weight: 700;
            font-size: 0.9rem;
            margin-right: 20px;
        }
        .activity-amount.pos {
            color: #16a34a;
        }
        .activity-amount.neg {
            color: #dc2626;
        }
        .activity-date {
            font-size: 0.8rem;
            color: #64748b;
            min-width: 100px;
            text-align: right;
        }

        /* Quick Navigation Links */
        .quick-links-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-top: 16px;
        }
        .quick-link-item {
            display: flex;
            align-items: flex-start;
            gap: 16px;
            padding: 20px;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            background: #ffffff;
            text-decoration: none;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .quick-link-item:hover {
            border-color: #cbd5e1;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
        }
        .ql-icon {
            font-size: 1.25rem;
            color: #3b82f6;
            margin-top: 2px;
        }
        .ql-text {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .ql-title {
            font-weight: 700;
            color: #0f172a;
            font-size: 0.95rem;
        }
        .ql-desc {
            font-size: 0.82rem;
            color: #64748b;
            line-height: 1.4;
        }

        .loading-container {
            padding: 24px 0;
            display: flex;
            justify-content: center;
        }

        /* Animations */
        .animate-fade-in {
            animation: fadeIn 0.4s ease forwards;
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
        /* Kept from the earlier layout: the parts of the template that still use it. */
        .dash { max-width: 960px; margin: 0 auto; padding: 24px; }
        .tile .sub.link { color: #0d6efd; text-decoration: none; }
        .mdetail { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; padding: 16px; margin-top: 16px; border: 1px solid #e3e8ee; }
        .md { display: flex; flex-direction: column; }
        .md .k { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #6c757d; }
        .md .v { font-size: 0.95rem; color: #212529; }
        .premium-card { margin-top: 16px; border: 1px solid #1b98e0; background: #eaf6fd; }
        .pc-body { display: flex; align-items: center; gap: 16px; padding: 8px; }
        .pc-icon { font-size: 1.6rem; color: #1b98e0; }
        .pc-body h3 { margin: 0; font-size: 1.05rem; }
        .pc-body > a { margin-left: auto; }
        .section-head { display: flex; align-items: baseline; justify-content: space-between; margin-top: 24px; }
        .section-head .link { color: #0d6efd; text-decoration: none; font-size: 0.9rem; }
        .arow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f3f5; }
        .arow:last-child { border-bottom: none; }
        .arow > i { width: 20px; text-align: center; color: #6c757d; }
        .arow .al { flex: 1; color: #212529; text-transform: capitalize; }
        .arow .aa { font-weight: 600; }
        .arow .aa.pos { color: #0f5132; }
        .arow .aa.neg { color: #842029; }
        .arow .ad { font-size: 0.8rem; color: #6c757d; min-width: 130px; text-align: right; }
    `],
})
export default class UserPaymentsComponent implements OnInit {
    authState = inject(AuthState);
    entitlements = inject(EntitlementService);
    private transactionsService = inject(TransactionsService);
    private creditLedger = inject(CreditLedgerService);
    private functions = inject(Functions);
    private readonly t = injectT();

    private recentTxns = signal<ITransaction[]>([]);
    private recentLedger = signal<ICreditLedgerEntry[]>([]);
    loadingActivity = signal(true);
    spending = signal(false);
    creditError = signal('');

    entitlement = computed(() => this.entitlements.entitlement());

    /** Merged, newest-first feed of the most recent transactions + credit entries. */
    activity = computed<ActivityItem[]>(() => {
        const txns: ActivityItem[] = this.recentTxns().map((t) => ({
            id: 'txn:' + t.id,
            date: toJsDate(t.createdAt),
            icon: this.txnIcon(t.status),
            label: `${t.status} · ${t.premiumType || t.type}`,
            amount: formatMoney(t.amount, t.currency),
            positive: t.status === 'succeeded',
        }));
        const credits: ActivityItem[] = this.recentLedger().map((e) => ({
            id: 'led:' + e.id,
            date: toJsDate(e.createdAt),
            icon: 'fa-solid fa-coins',
            label: this.t('user.payments.credits_activity', { reason: e.reason }),
            amount: this.t('user.payments.credits_amount', { amount: `${e.delta > 0 ? '+' : ''}${e.delta}` }),
            positive: e.delta > 0,
        }));
        return [...txns, ...credits]
            .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
            .slice(0, 6);
    });

    isNewUser = computed(
        () => !this.loadingActivity() && !this.entitlements.isPro() && this.entitlements.creditBalance() === 0 && this.activity().length === 0,
    );

    ngOnInit(): void {
        this.loadActivity();
    }

    private uid(): string | null {
        return this.authState.currentUser()?.uid ?? null;
    }

    private loadActivity(): void {
        const uid = this.uid();
        if (!uid) {
            this.loadingActivity.set(false);
            return;
        }
        this.loadingActivity.set(true);
        let pending = 2;
        const done = () => {
            if (--pending === 0) this.loadingActivity.set(false);
        };
        const params = {
            whereConditions: [{ field: 'userId', operator: '==' as const, value: uid }],
            limitCount: 5,
            currentPageNumber: 0,
            previousPageNumber: 0,
            getOnce: true,
        };
        this.transactionsService.getAll(params).subscribe({
            next: (r) => {
                this.recentTxns.set(r.collectionData ?? []);
                done();
            },
            error: () => done(),
        });
        this.creditLedger.getAll(params).subscribe({
            next: (r) => {
                this.recentLedger.set(r.collectionData ?? []);
                done();
            },
            error: () => done(),
        });
    }

    async useCredit(): Promise<void> {
        this.spending.set(true);
        this.creditError.set('');
        try {
            const consume = arcCallable(this.functions, 'consumeCredits');
            await consume({ amount: 1, note: 'dashboard' });
            this.entitlements.load().subscribe(); // refresh balance
            this.loadActivity();
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? '';
            this.creditError.set(this.t(msg.includes('Insufficient') ? 'user.account.credit_insufficient' : 'user.account.credit_failed'));
        } finally {
            this.spending.set(false);
        }
    }

    private txnIcon(status: string): string {
        if (status === 'succeeded') return 'fa-solid fa-circle-check';
        if (status === 'refunded') return 'fa-solid fa-rotate-left';
        if (status === 'failed') return 'fa-solid fa-circle-xmark';
        return 'fa-solid fa-clock';
    }

    fmtDate(value: unknown): string {
        const d = toJsDate(value);
        return d ? d.toLocaleDateString(memberLocaleNow()) : '—';
    }
}
