import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
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

export const routeMeta: RouteMeta = {
    title: 'Dashboard | Arc CMS',
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
 * The signed-in user's home. Shows a greeting, live status tiles, quick actions
 * (use/buy credits, upgrade), a compact membership summary, a members-only card,
 * and a merged "recent activity" feed (transactions + credit ledger). Full history
 * lives on /account — this is a summary + actions surface.
 */
@Component({
    selector: 'arc-user-dashboard',
    standalone: true,
    imports: [
        CommonModule,
        RouterLink,
        MatButtonModule,
        MatCardModule,
        MatProgressSpinnerModule,
        UserShellComponent,
        IfEntitledDirective,
        PageHeaderComponent,
    ],
    template: `
        <app-user-shell>
            <div class="dash">
                <arc-page-header [title]="'Welcome back, ' + firstName()" subtitle="Here's your account at a glance."></arc-page-header>

                <!-- Onboarding empty state -->
                @if (isNewUser()) {
                    <mat-card class="welcome-banner animate-slide-up">
                        <mat-card-content class="w-body">
                            <div class="banner-icon"><i class="fa-solid fa-rocket"></i></div>
                            <div class="banner-text">
                                <h3>Get Started</h3>
                                <p class="text-muted">You are currently on the Free plan. Upgrade to unlock premium features and credit allocation.</p>
                            </div>
                            <a mat-flat-button class="action-accent-btn" routerLink="/pricing">Explore Plans</a>
                        </mat-card-content>
                    </mat-card>
                }

                <!-- Status Tiles -->
                <div class="status-tiles-grid animate-slide-up">
                    <mat-card class="status-tile-card">
                        <div class="tile-header">
                            <span class="tile-label">Membership</span>
                            <span class="tile-icon icon-blue"><i class="fa-solid fa-crown"></i></span>
                        </div>
                        <div class="tile-content">
                            @if (entitlements.isPro()) {
                                <span class="tile-value value-pro">{{ entitlements.premiumType() || 'Pro' }}</span>
                                <span class="tile-sub badge-active">{{ entitlements.premiumStatus() || 'active' }}</span>
                            } @else {
                                <span class="tile-value">Free Tier</span>
                                <a class="tile-action-link" routerLink="/pricing">Upgrade Plan →</a>
                            }
                        </div>
                    </mat-card>

                    <mat-card class="status-tile-card">
                        <div class="tile-header">
                            <span class="tile-label">Available Credits</span>
                            <span class="tile-icon icon-yellow"><i class="fa-solid fa-coins"></i></span>
                        </div>
                        <div class="tile-content">
                            <span class="tile-value">{{ entitlements.creditBalance() }}</span>
                            <a class="tile-action-link" routerLink="/account">View Ledger →</a>
                        </div>
                    </mat-card>

                    <mat-card class="status-tile-card">
                        <div class="tile-header">
                            <span class="tile-label">Plan Tier</span>
                            <span class="tile-icon icon-purple"><i class="fa-solid fa-arrow-up-right-dots"></i></span>
                        </div>
                        <div class="tile-content">
                            <span class="tile-value">{{ entitlements.tierRank() >= 0 ? '#' + entitlements.tierRank() : '—' }}</span>
                            <span class="tile-sub text-truncate">{{ entitlement()?.premiumTierLabel || 'No Active Plan' }}</span>
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
                        Use 1 Credit
                    </button>
                    <a mat-stroked-button class="action-btn" routerLink="/pricing"><i class="fa-solid fa-plus me-1"></i>Buy Credits / Upgrade</a>
                    <a mat-stroked-button class="action-btn" routerLink="/account"><i class="fa-solid fa-receipt me-1"></i>Billing &amp; Invoices</a>
                </div>
                @if (creditError()) { 
                    <div class="error-banner animate-fade-in">
                        <i class="fa-solid fa-circle-exclamation me-2"></i>{{ creditError() }}
                    </div> 
                }

                <!-- Compact membership detail (members only) -->
                @if (entitlements.isPro()) {
                    <mat-card class="membership-details-card animate-slide-up">
                        <mat-card-content class="md-grid">
                            <div class="md-item"><span class="k">Renews / expires</span><span class="v font-semibold">{{ fmtDate(entitlement()?.premiumExpiresAt) }}</span></div>
                            <div class="md-item"><span class="k">Free updates until</span><span class="v">{{ fmtDate(entitlement()?.updatesUntil) }}</span></div>
                            <div class="md-item"><span class="k">Plan Deal</span><span class="v">{{ entitlement()?.premiumTierLabel || '—' }}</span></div>
                            <div class="md-item"><span class="k">Discount Code</span><span class="v mono">{{ entitlement()?.premiumDiscountCode || '—' }}</span></div>
                        </mat-card-content>
                    </mat-card>
                }

                <!-- Members-only card -->
                <mat-card class="welcome-banner premium-banner animate-slide-up" *appIfEntitled>
                    <mat-card-content class="w-body">
                        <div class="banner-icon premium-color"><i class="fa-solid fa-circle-check"></i></div>
                        <div class="banner-text">
                            <h3>Premium Features Unlocked</h3>
                            <p class="text-muted">You have full developer & writer access to members-only tools.</p>
                        </div>
                        <a mat-flat-button class="premium-action-btn" routerLink="/user/premium">Open Premium Area</a>
                    </mat-card-content>
                </mat-card>

                <!-- Recent activity -->
                <div class="section-layout animate-slide-up">
                    <div class="section-header">
                        <h2>Recent Activity</h2>
                        <a routerLink="/account" class="view-all-link">View Full History →</a>
                    </div>
                    
                    @if (loadingActivity()) {
                        <div class="loading-container"><mat-spinner diameter="24"></mat-spinner></div>
                    } @else if (activity().length === 0) {
                        <div class="empty-state">
                            <p class="text-muted">No transactions or ledger history yet.</p>
                        </div>
                    } @else {
                        <mat-card class="activity-card">
                            <div class="activity-list">
                                @for (a of activity(); track a.id) {
                                    <div class="activity-row">
                                        <span class="activity-icon"><i [class]="a.icon"></i></span>
                                        <span class="activity-label">{{ a.label }}</span>
                                        <span class="activity-amount" [class.pos]="a.positive" [class.neg]="!a.positive">{{ a.amount }}</span>
                                        <span class="activity-date">{{ fmtDate(a.date) }}</span>
                                    </div>
                                }
                            </div>
                        </mat-card>
                    }
                </div>

                <div class="section-layout animate-slide-up">
                    <h2 class="section-title">Quick Navigation</h2>
                    <div class="quick-links-grid">
                        <a class="quick-link-item" routerLink="/account">
                            <span class="ql-icon"><i class="fa-solid fa-credit-card"></i></span>
                            <div class="ql-text">
                                <span class="ql-title">Account &amp; Billing</span>
                                <span class="ql-desc">View invoices, subscription, and check credit ledger.</span>
                            </div>
                        </a>
                        <a class="quick-link-item" routerLink="/user/profile">
                            <span class="ql-icon"><i class="fa-solid fa-user-gear"></i></span>
                            <div class="ql-text">
                                <span class="ql-title">Profile Settings</span>
                                <span class="ql-desc">Update your name, contact email, and security credentials.</span>
                            </div>
                        </a>
                        <a class="quick-link-item" routerLink="/pricing">
                            <span class="ql-icon"><i class="fa-solid fa-tags"></i></span>
                            <div class="ql-text">
                                <span class="ql-title">Membership Plans</span>
                                <span class="ql-desc">Upgrade, downgrade or adjust your billing frequency.</span>
                            </div>
                        </a>
                    </div>
                </div>
            </div>
        </app-user-shell>
    `,
    styles: [`
        .dash { max-width: 960px; margin: 0 auto; padding: 24px; }
        h1 { margin-bottom: 2px; }
        .welcome { border: 1px solid #1b98e0; background: #eaf6fd; margin: 16px 0; }
        .w-body { display: flex; align-items: center; gap: 16px; padding: 8px; }
        .w-body > i { font-size: 1.6rem; color: #1b98e0; }
        .w-body h3 { margin: 0; font-size: 1.05rem; }
        .w-body > a { margin-left: auto; }
        .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 16px; }
        .tile { display: flex; flex-direction: column; padding: 16px; border: 1px solid #e3e8ee; }
        .tile .k { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6c757d; }
        .tile .v { font-size: 1.8rem; font-weight: 700; color: #212529; }
        .tile .v.pro { color: #1b98e0; text-transform: capitalize; }
        .tile .sub { font-size: 0.82rem; color: #6c757d; }
        .tile .sub.link { color: #0d6efd; text-decoration: none; }
        .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
        .err { color: #842029; font-size: 0.9rem; margin-top: 8px; }
        .mdetail { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; padding: 16px; margin-top: 16px; border: 1px solid #e3e8ee; }
        .md { display: flex; flex-direction: column; }
        .md .k { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #6c757d; }
        .md .v { font-size: 0.95rem; color: #212529; }
        .mono { font-family: monospace; font-size: 0.85rem; }
        .premium-card { margin-top: 16px; border: 1px solid #1b98e0; background: #eaf6fd; }
        .pc-body { display: flex; align-items: center; gap: 16px; padding: 8px; }
        .pc-icon { font-size: 1.6rem; color: #1b98e0; }
        .pc-body h3 { margin: 0; font-size: 1.05rem; }
        .pc-body > a { margin-left: auto; }
        .section-head { display: flex; align-items: baseline; justify-content: space-between; margin-top: 24px; }
        .section-head .link { color: #0d6efd; text-decoration: none; font-size: 0.9rem; }
        .activity { padding: 4px 16px; border: 1px solid #e3e8ee; }
        .arow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f3f5; }
        .arow:last-child { border-bottom: none; }
        .arow > i { width: 20px; text-align: center; color: #6c757d; }
        .arow .al { flex: 1; color: #212529; text-transform: capitalize; }
        .arow .aa { font-weight: 600; }
        .arow .aa.pos { color: #0f5132; }
        .arow .aa.neg { color: #842029; }
        .arow .ad { font-size: 0.8rem; color: #6c757d; min-width: 130px; text-align: right; }
        .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
        .ql { display: flex; flex-direction: column; gap: 4px; padding: 18px; border: 1px solid #e3e8ee; border-radius: 10px; background: #fff; text-decoration: none; }
        .ql:hover { border-color: #1b98e0; box-shadow: 0 2px 10px #0d1b2a12; }
        .ql i { font-size: 1.2rem; color: #1b98e0; }
        .ql .t { font-weight: 600; color: #212529; }
        .ql .d { font-size: 0.82rem; color: #6c757d; }
    `],
})
export default class UsersDashboardComponent implements OnInit {
    authState = inject(AuthState);
    entitlements = inject(EntitlementService);
    private transactionsService = inject(TransactionsService);
    private creditLedger = inject(CreditLedgerService);
    private functions = inject(Functions);

    private recentTxns = signal<ITransaction[]>([]);
    private recentLedger = signal<ICreditLedgerEntry[]>([]);
    loadingActivity = signal(true);
    spending = signal(false);
    creditError = signal('');

    entitlement = computed(() => this.entitlements.entitlement());

    firstName = computed(() => {
        const u = this.authState.currentUser();
        return (u?.name || u?.email || 'there').split(' ')[0].split('@')[0];
    });

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
            label: `Credits · ${e.reason}`,
            amount: `${e.delta > 0 ? '+' : ''}${e.delta} cr`,
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
            const consume = httpsCallable(this.functions, 'consumeCredits');
            await consume({ amount: 1, note: 'dashboard' });
            this.entitlements.load().subscribe(); // refresh balance
            this.loadActivity();
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? '';
            this.creditError.set(msg.includes('Insufficient') ? 'Insufficient credits.' : 'Could not use a credit.');
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
        return d ? d.toLocaleDateString() : '—';
    }
}
