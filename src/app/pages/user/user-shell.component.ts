import { CommonModule } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Component, computed, inject, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';
import { isOn } from '../../core/features/features';
import { homeFor, USER_DASHBOARD } from '../../core/home/home';
import { memberMenu } from '../../core/nav/member-menu';
import { CUSTOM_NAV_CHANGES } from '../../../custom/nav';
import { memberPagesOpen } from '../../core/app-accounts/app-account-lock';
import { SiteBrandService } from '../../core/brand/site-brand';

/**
 * Sidebar layout for the signed-in member area (dashboard, profile, and with the
 * payments feature payments, account, premium and plans). The menu is data
 * (src/app/core/nav/member-menu.ts) with the app's changes. Projects page content via
 * <ng-content>. With payments, loads the shared entitlement once so every page, the
 * Pro badge, and the *appIfEntitled directive react to it.
 *
 * Gates on currentUser() (not the buggy isAuthenticated() signal).
 */
@Component({
    selector: 'app-user-shell',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, MatButtonModule, TranslocoPipe],
    template: `
        <div class="shell">
            <aside class="sidebar">
                <a routerLink="/" class="brand">{{ brandName() }}</a>

                <div class="userbox">
                    <div class="avatar">{{ initial() }}</div>
                    <div class="who">
                        <span class="name">{{ displayName() || ('user.member' | transloco) }}</span>
                        @if (paymentsOn) {
                            @if (entitlements.isPro()) {
                                <span class="badge pro">{{ entitlements.premiumType() || ('user.pro' | transloco) }}</span>
                            } @else {
                                <span class="badge free">{{ 'user.free' | transloco }}</span>
                            }
                        }
                    </div>
                </div>

                <!-- The member menu (src/app/core/nav/member-menu.ts), with the app's changes. -->
                <nav class="menu">
                    @for (item of menu(); track item.id ?? $index) {
                        @if (item.separator) {
                            <hr>
                        } @else {
                            <ng-container *ngTemplateOutlet="entry; context: { $implicit: item }"></ng-container>
                            @for (sub of item.subItems ?? []; track sub.id ?? $index) {
                                <ng-container *ngTemplateOutlet="entry; context: { $implicit: sub, sub: true }"></ng-container>
                            }
                        }
                    }
                </nav>

                <ng-template #entry let-item let-sub="sub">
                    @if (item.externalUrl) {
                        <a [href]="item.externalUrl" target="_blank" rel="noopener noreferrer" [class.sub]="sub"><i class="{{ item.icon }}"></i> {{ item.labelKey ? (item.labelKey | transloco) : item.label }}</a>
                    } @else if (item.route) {
                        <!-- Home is never marked as the current page. -->
                        <a [routerLink]="item.route" [queryParams]="item.queryParams || null" [routerLinkActive]="item.id === 'home' ? [] : 'active'" [class.sub]="sub"><i class="{{ item.icon }}"></i> {{ item.labelKey ? (item.labelKey | transloco) : item.label }}</a>
                    } @else {
                        <span class="group" [class.sub]="sub"><i class="{{ item.icon }}"></i> {{ item.labelKey ? (item.labelKey | transloco) : item.label }}</span>
                    }
                </ng-template>

                <div class="foot">
                    @if (paymentsOn) {
                    <span class="credits"><i class="fa-solid fa-coins me-1"></i>{{ entitlements.creditBalance() }} {{ 'user.credits' | transloco }}</span>
                    }
                    <button mat-stroked-button type="button" (click)="signOut()">{{ 'user.nav.sign_out' | transloco }}</button>
                </div>
            </aside>

            <main class="content">
                <ng-content></ng-content>
            </main>
        </div>
    `,
    styles: [`
        .shell { display: flex; min-height: 100vh; align-items: stretch; }
        .sidebar { width: 240px; flex-shrink: 0; background: #0d1b2a; color: #e0e6ed; display: flex; flex-direction: column; padding: 20px 16px; position: sticky; top: 0; height: 100vh; }
        .brand { color: #fff; font-weight: 700; font-size: 1.2rem; text-decoration: none; }
        .userbox { display: flex; align-items: center; gap: 10px; margin: 20px 0; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; background: #1b98e0; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
        .who { display: flex; flex-direction: column; }
        .who .name { font-size: 0.9rem; }
        .badge { font-size: 0.68rem; padding: 1px 8px; border-radius: 10px; width: fit-content; margin-top: 2px; }
        .badge.pro { background: #1b98e0; color: #fff; text-transform: capitalize; }
        .badge.free { background: #33415522; color: #adb5bd; }
        .menu { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
        .menu a { color: #cdd6e0; text-decoration: none; padding: 10px 12px; border-radius: 8px; font-size: 0.92rem; display: flex; align-items: center; gap: 10px; }
        .menu a i { width: 18px; text-align: center; opacity: 0.85; }
        .menu a:hover { background: #ffffff12; }
        .menu .group { color: #8a99a8; padding: 10px 12px 4px; font-size: 0.8rem; display: flex; align-items: center; gap: 10px; }
        .menu .sub { padding-left: 28px; }
        .menu hr { border-color: #ffffff22; margin: 6px 0; }
        .menu a.active { background: #1b98e0; color: #fff; }
        .foot { margin-top: auto; display: flex; flex-direction: column; gap: 12px; padding-top: 16px; }
        .foot .credits { font-size: 0.85rem; color: #adb5bd; }
        .content { flex: 1; min-width: 0; background: #f6f8fa; }
        @media (max-width: 768px) {
            .shell { flex-direction: column; }
            .sidebar { width: 100%; height: auto; position: static; }
        }
    `],
})
export class UserShellComponent implements OnInit {
    authState = inject(AuthState);
    entitlements = inject(EntitlementService);
    private router = inject(Router);
    private transloco = inject(TranslocoService);
    private siteBrand = inject(SiteBrandService);
    /** The site's own name (core/brand/site-brand.ts), as on the sign-in page; nothing until it is in, so Arc CMS's never flashes. */
    readonly brandName = this.siteBrand.name;
    readonly paymentsOn = isOn('payments');

    /** The app's own home page for this person (src/custom/home.ts), when it is not this area's dashboard. */
    readonly appHome = computed(() => {
        const home = homeFor(this.authState.currentUser()?.role);
        return home === USER_DASHBOARD || home.startsWith('/admin') ? null : home;
    });

    /** Whether this person may open Arc CMS's member pages (src/custom/app-accounts.ts). */
    readonly memberPages = computed(() => memberPagesOpen(this.authState.currentUser()));

    /** The member menu for this person, with the app's changes for their role (src/custom/nav.ts). */
    readonly menu = computed(() => memberMenu(
        { home: this.appHome(), memberPages: this.memberPages(), role: this.authState.currentUser()?.role },
        CUSTOM_NAV_CHANGES.member,
    ));

    displayName(): string {
        const u = this.authState.currentUser();
        return u?.name || u?.email || '';
    }

    initial(): string {
        return (this.displayName().trim()[0] || this.transloco.translate('user.member')[0] || '').toUpperCase();
    }

    ngOnInit(): void {
        void this.siteBrand.load();
        if (this.paymentsOn) this.entitlements.load().subscribe();
    }

    signOut(): void {
        this.authState.logout().subscribe(() => this.router.navigate(['/']));
    }
}
