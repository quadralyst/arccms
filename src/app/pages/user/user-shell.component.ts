import { BreakpointObserver } from '@angular/cdk/layout';
import { CommonModule } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';
import { isOn } from '../../core/features/features';
import { homeFor, USER_DASHBOARD } from '../../core/home/home';
import { memberMenu } from '../../core/nav/member-menu';
import { appNavChanges } from '../../core/nav/app-nav-changes';
import { memberPagesOpen } from '../../core/app-accounts/app-account-lock';
import { SiteBrandService } from '../../core/brand/site-brand';

/**
 * Sidebar layout for the signed-in member area (dashboard, profile, and with the
 * payments feature payments, account, premium and plans). The menu is data
 * (src/app/core/nav/member-menu.ts) with the app's changes. Projects page content via
 * <ng-content>. With payments, loads the shared entitlement once so every page, the
 * Pro badge, and the *appIfEntitled directive react to it.
 *
 * The button at the top is always in reach: on a wide screen it collapses the menu to
 * its icons (remembered in this browser), and on a phone, where the menu folds into a bar
 * that stays at the top, it opens and closes it.
 *
 * Gates on currentUser() (not the buggy isAuthenticated() signal).
 */
@Component({
    selector: 'app-user-shell',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, MatButtonModule, TranslocoPipe],
    template: `
        <div class="shell" [class.collapsed]="rail()" [class.phone]="phone()" [class.phone-open]="phone() && phoneOpen()">
            <aside class="sidebar">
                <!-- The top row stays put while the menu scrolls under it, so the button is always in reach. -->
                <div class="top">
                    <a routerLink="/" class="brand">{{ brandName() }}</a>
                    <button type="button" class="menu-toggle" (click)="toggleMenu()" [attr.aria-label]="toggleLabel() | transloco"
                        [attr.title]="toggleLabel() | transloco" [attr.aria-expanded]="menuShown()">
                        <i class="fa-solid" [ngClass]="toggleIcon()"></i>
                    </button>
                </div>

                <div class="body">
                    <div class="userbox">
                        <div class="avatar" [attr.title]="rail() ? displayName() : null">{{ initial() }}</div>
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
                </div>

                <!-- Collapsed, an entry shows its icon and names itself on hover. -->
                <ng-template #entry let-item let-sub="sub">
                    @let label = item.labelKey ? (item.labelKey | transloco) : item.label;
                    @if (item.externalUrl) {
                        <a [href]="item.externalUrl" target="_blank" rel="noopener noreferrer" [class.sub]="sub" [attr.title]="rail() ? label : null"><i class="{{ item.icon }}"></i> <span class="label">{{ label }}</span></a>
                    } @else if (item.route) {
                        <!-- Home is never marked as the current page. -->
                        <a [routerLink]="item.route" [queryParams]="item.queryParams || null" [routerLinkActive]="item.id === 'home' ? [] : 'active'" [class.sub]="sub" [attr.title]="rail() ? label : null"><i class="{{ item.icon }}"></i> <span class="label">{{ label }}</span></a>
                    } @else {
                        <span class="group" [class.sub]="sub" [attr.title]="rail() ? label : null"><i class="{{ item.icon }}"></i> <span class="label">{{ label }}</span></span>
                    }
                </ng-template>

                <div class="foot">
                    @if (paymentsOn) {
                    <span class="credits"><i class="fa-solid fa-coins me-1"></i>{{ entitlements.creditBalance() }} {{ 'user.credits' | transloco }}</span>
                    }
                    <button mat-stroked-button type="button" class="sign-out" (click)="signOut()" [attr.title]="rail() ? ('user.nav.sign_out' | transloco) : null"><i class="fa-solid fa-right-from-bracket"></i><span class="label">{{ 'user.nav.sign_out' | transloco }}</span></button>
                </div>
            </aside>

            <main class="content">
                <ng-content></ng-content>
            </main>
        </div>
    `,
    // Colours from --arc-member-* (docs/app/member-area.html#colours), each falling back to Arc CMS's own.
    styles: [`
        .shell { display: flex; min-height: 100vh; align-items: stretch; }
        .sidebar { width: 240px; flex-shrink: 0; background: var(--arc-member-panel-background, #0d1b2a); color: var(--arc-member-panel-color, #e0e6ed); display: flex; flex-direction: column; padding: 20px 16px; position: sticky; top: 0; height: 100vh; height: 100dvh; transition: width 0.3s ease; }
        .top { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .brand { color: #fff; font-weight: 700; font-size: 1.2rem; text-decoration: none; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .menu-toggle { flex-shrink: 0; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1rem; }
        .menu-toggle:hover { background: #ffffff12; }
        .menu-toggle:focus-visible { outline: 2px solid var(--arc-member-panel-color, #e0e6ed); outline-offset: 1px; }
        .body { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #ffffff33 transparent; }
        .userbox { display: flex; align-items: center; gap: 10px; margin: 20px 0; }
        .avatar { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; background: var(--arc-member-accent, #1b98e0); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
        .who { display: flex; flex-direction: column; }
        .who .name { font-size: 0.9rem; }
        .badge { font-size: 0.68rem; padding: 1px 8px; border-radius: 10px; width: fit-content; margin-top: 2px; }
        .badge.pro { background: var(--arc-member-accent, #1b98e0); color: #fff; text-transform: capitalize; }
        .badge.free { background: #33415522; color: #adb5bd; }
        .menu { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
        .menu a { color: #cdd6e0; text-decoration: none; padding: 10px 12px; border-radius: 8px; font-size: 0.92rem; display: flex; align-items: center; gap: 10px; }
        .menu a i { width: 18px; text-align: center; opacity: 0.85; }
        .menu a:hover { background: var(--arc-member-menu-hover-background, #ffffff12); }
        .menu .group { color: #8a99a8; padding: 10px 12px 4px; font-size: 0.8rem; display: flex; align-items: center; gap: 10px; }
        .menu .sub { padding-left: 28px; }
        .menu hr { border-color: #ffffff22; margin: 6px 0; }
        .menu a.active { background: var(--arc-member-accent, #1b98e0); color: #fff; }
        .foot { flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; padding-top: 16px; }
        /* Light on the dark panel */
        .sign-out { --mat-button-outlined-label-text-color: var(--arc-member-panel-color, #e0e6ed); --mat-button-outlined-outline-color: #ffffff40; }
        .sign-out i { display: none; }
        .foot .credits { font-size: 0.85rem; color: #adb5bd; }
        .content { flex: 1; min-width: 0; background: #f6f8fa; }
        /* Collapsed: the menu's icons only, each naming itself on hover */
        .collapsed .sidebar { width: 72px; padding: 20px 12px; }
        .collapsed .top { justify-content: center; }
        .collapsed .brand, .collapsed .who, .collapsed .label, .collapsed .credits { display: none; }
        .collapsed .userbox { justify-content: center; }
        .collapsed .menu a, .collapsed .menu .group { justify-content: center; padding: 10px 0; }
        .collapsed .menu a i, .collapsed .menu .group i { width: auto; font-size: 1.05rem; }
        .collapsed .sign-out { min-width: 0; padding: 0; }
        .collapsed .sign-out i { display: inline; }
        /* A phone: a bar at the top that stays put, with the menu folded into it */
        .phone.shell { flex-direction: column; }
        .phone .sidebar { width: 100%; height: auto; max-height: 100dvh; padding: 6px 12px; z-index: 30; }
        .phone .menu-toggle { order: -1; }
        .phone .body, .phone .foot { display: none; }
        .phone-open .body, .phone-open .foot { display: flex; flex-direction: column; }
        .phone-open .foot { padding-bottom: 12px; }
    `],
})
export class UserShellComponent implements OnInit {
    authState = inject(AuthState);
    entitlements = inject(EntitlementService);
    private router = inject(Router);
    private transloco = inject(TranslocoService);
    private destroyRef = inject(DestroyRef);

    /** A phone: the menu folds into a bar at the top. */
    readonly phone = toSignal(
        inject(BreakpointObserver).observe('(max-width: 768px)').pipe(map((state) => state.matches)),
        { initialValue: false },
    );
    /** On a phone, whether the menu is open; it closes on every page change. */
    readonly phoneOpen = signal(false);
    /** On a wider screen, whether the menu shows its icons only; this browser remembers it. */
    readonly collapsed = signal(readCollapsed());
    /** The menu as a rail of icons: collapsed, on a wider screen. */
    readonly rail = computed(() => this.collapsed() && !this.phone());
    /** Whether the menu's entries show, for the button's aria-expanded. */
    readonly menuShown = computed(() => (this.phone() ? this.phoneOpen() : !this.collapsed()));
    /** What the button does. */
    readonly toggleLabel = computed(() => this.phone()
        ? (this.phoneOpen() ? 'user.nav.close_menu' : 'user.nav.open_menu')
        : (this.rail() ? 'user.nav.expand_menu' : 'user.nav.collapse_menu'));
    readonly toggleIcon = computed(() => this.phone()
        ? (this.phoneOpen() ? 'fa-xmark' : 'fa-bars')
        : (this.rail() ? 'fa-chevron-right' : 'fa-chevron-left'));
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

    /** The member menu for this person, with the app's changes for their role (src/custom/nav-changes.ts). */
    readonly menu = computed(() => memberMenu(
        { home: this.appHome(), memberPages: this.memberPages(), role: this.authState.currentUser()?.role },
        appNavChanges().member,
    ));

    displayName(): string {
        const u = this.authState.currentUser();
        return u?.name || u?.email || '';
    }

    initial(): string {
        return (this.displayName().trim()[0] || this.transloco.translate('user.member')[0] || '').toUpperCase();
    }

    toggleMenu(): void {
        if (this.phone()) {
            this.phoneOpen.update((open) => !open);
            return;
        }
        const collapsed = !this.collapsed();
        this.collapsed.set(collapsed);
        try {
            localStorage.setItem(MEMBER_MENU_COLLAPSED, String(collapsed));
        } catch {
            // Storage blocked: the choice lasts for this visit only.
        }
    }

    ngOnInit(): void {
        this.router.events
            .pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.phoneOpen.set(false));
        void this.siteBrand.load();
        if (this.paymentsOn) this.entitlements.load().subscribe();
    }

    signOut(): void {
        this.authState.logout().subscribe(() => this.router.navigate(['/']));
    }
}

/** Where this browser remembers a collapsed member menu. */
const MEMBER_MENU_COLLAPSED = 'memberMenuCollapsed';

function readCollapsed(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(MEMBER_MENU_COLLAPSED) === 'true';
    } catch {
        return false;
    }
}
