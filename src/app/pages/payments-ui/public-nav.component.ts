import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthState } from '../(auth)/auth.store';

/**
 * Lightweight public navigation for the payment test screens (pricing, account,
 * checkout landings). Deliberately gates on `currentUser()` — NOT the store's
 * `isAuthenticated()` signal, which is false for plain `user`-role accounts.
 */
@Component({
    selector: 'app-public-nav',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, MatButtonModule],
    template: `
        <nav class="public-nav">
            <a routerLink="/" class="brand">ArcCMS</a>
            <div class="links">
                <a routerLink="/pricing" routerLinkActive="active">Pricing</a>
                <a routerLink="/account" routerLinkActive="active">My Account</a>
            </div>
            <div class="auth">
                @if (authState.currentUser(); as user) {
                    <span class="email" title="Signed in">{{ user.email }}</span>
                    <button mat-stroked-button type="button" (click)="signOut()">Sign out</button>
                } @else {
                    <button mat-raised-button color="primary" type="button" (click)="signIn()">Sign in</button>
                }
            </div>
        </nav>
    `,
    styles: [`
        .public-nav { display: flex; align-items: center; gap: 24px; padding: 12px 24px; border-bottom: 1px solid #dee2e6; background: #fff; }
        .brand { font-weight: 700; font-size: 1.1rem; color: #212529; text-decoration: none; }
        .links { display: flex; gap: 16px; flex: 1; }
        .links a { color: #495057; text-decoration: none; padding: 4px 2px; border-bottom: 2px solid transparent; }
        .links a.active { color: #0d6efd; border-bottom-color: #0d6efd; }
        .auth { display: flex; align-items: center; gap: 12px; }
        .email { font-size: 0.85rem; color: #6c757d; }
    `],
})
export class PublicNavComponent {
    authState = inject(AuthState);
    private router = inject(Router);

    signIn(): void {
        this.router.navigate(['/signup'], { queryParams: { redirect: this.router.url } });
    }

    signOut(): void {
        this.authState.logout().subscribe(() => this.router.navigate(['/']));
    }
}
