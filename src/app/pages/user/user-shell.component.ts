import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';

/**
 * Sidebar layout for the signed-in member area (dashboard, account, profile,
 * premium). Projects page content via <ng-content>. Loads the shared entitlement
 * once so every page, the Pro badge, and the *appIfEntitled directive react to it.
 *
 * Gates on currentUser() (not the buggy isAuthenticated() signal).
 */
@Component({
    selector: 'app-user-shell',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, MatButtonModule],
    template: `
        <div class="shell">
            <aside class="sidebar">
                <a routerLink="/" class="brand">ArcCMS</a>

                <div class="userbox">
                    <div class="avatar">{{ initial() }}</div>
                    <div class="who">
                        <span class="name">{{ displayName() }}</span>
                        @if (entitlements.isPro()) {
                            <span class="badge pro">{{ entitlements.premiumType() || 'Pro' }}</span>
                        } @else {
                            <span class="badge free">Free</span>
                        }
                    </div>
                </div>

                <nav class="menu">
                    <a routerLink="/user/dashboard" routerLinkActive="active"><i class="fa-solid fa-gauge"></i> Dashboard</a>
                    <a routerLink="/account" routerLinkActive="active"><i class="fa-solid fa-receipt"></i> Account &amp; Billing</a>
                    <a routerLink="/user/premium" routerLinkActive="active"><i class="fa-solid fa-star"></i> Premium</a>
                    <a routerLink="/user/profile" routerLinkActive="active"><i class="fa-solid fa-user"></i> Profile</a>
                    <a routerLink="/pricing" routerLinkActive="active"><i class="fa-solid fa-tag"></i> Plans</a>
                </nav>

                <div class="foot">
                    <span class="credits"><i class="fa-solid fa-coins me-1"></i>{{ entitlements.creditBalance() }} credits</span>
                    <button mat-stroked-button type="button" (click)="signOut()">Sign out</button>
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

    displayName(): string {
        const u = this.authState.currentUser();
        return u?.name || u?.email || 'Member';
    }

    initial(): string {
        return (this.displayName().trim()[0] || 'M').toUpperCase();
    }

    ngOnInit(): void {
        this.entitlements.load().subscribe();
    }

    signOut(): void {
        this.authState.logout().subscribe(() => this.router.navigate(['/']));
    }
}
