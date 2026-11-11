import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthState } from '../(auth)/auth.store';
import { SiteBrandService } from '../../core/brand/site-brand';

/**
 * Lightweight public navigation for the payment screens (pricing, account,
 * checkout landings). It carries the site's own name, as the admin does
 * (site-brand.ts), and its words are member keys (member.public_nav.*).
 * Deliberately gates on `currentUser()`, NOT the store's `isAuthenticated()`
 * signal, which is false for plain `user`-role accounts.
 */
@Component({
    selector: 'app-public-nav',
    standalone: true,
    imports: [RouterLink, RouterLinkActive, MatButtonModule, TranslocoPipe],
    template: `
        <nav class="public-nav" [attr.aria-label]="'member.public_nav.label' | transloco">
            <a routerLink="/" class="brand">{{ brand.name() }}</a>
            <div class="links">
                <a routerLink="/pricing" routerLinkActive="active">{{ 'member.public_nav.pricing' | transloco }}</a>
                <a routerLink="/account" routerLinkActive="active">{{ 'member.public_nav.my_account' | transloco }}</a>
            </div>
            <div class="auth">
                @if (authState.currentUser()) {
                    @if (who(); as shown) {
                        <span class="email" [title]="'member.public_nav.signed_in_as' | transloco: { email: shown }">{{ shown }}</span>
                    }
                    <button mat-stroked-button type="button" (click)="signOut()">{{ 'member.public_nav.sign_out' | transloco }}</button>
                } @else {
                    <button mat-raised-button color="primary" type="button" (click)="signIn()">{{ 'member.public_nav.sign_in' | transloco }}</button>
                }
            </div>
        </nav>
    `,
    styles: [`
        .public-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; padding: 12px 24px; border-bottom: 1px solid #dee2e6; background: #fff; }
        .brand { font-weight: 700; font-size: 1.1rem; color: #212529; text-decoration: none; }
        .links { display: flex; gap: 16px; flex: 1; }
        .links a { color: #495057; text-decoration: none; padding: 4px 2px; border-bottom: 2px solid transparent; }
        .links a.active { color: #0d6efd; border-bottom-color: #0d6efd; }
        .auth { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .email { font-size: 0.85rem; color: #6c757d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `],
})
export class PublicNavComponent {
    authState = inject(AuthState);
    /** The site's name: shown once known, never Arc CMS's in place of a site's own. */
    readonly brand = inject(SiteBrandService);
    private router = inject(Router);

    /** Who is signed in, as they would know it: the email, else the name, else the phone number; nothing when there is none. */
    readonly who = computed(() => {
        const user = this.authState.currentUser() as { email?: string; name?: string; phone?: string } | null;
        return [user?.email, user?.name, user?.phone].map((v) => (v ?? '').trim()).find(Boolean) ?? '';
    });

    constructor() {
        this.brand.load().catch(() => undefined);
    }

    signIn(): void {
        this.router.navigate(['/signup'], { queryParams: { redirect: this.router.url } });
    }

    signOut(): void {
        this.authState.logout().subscribe(() => this.router.navigate(['/']));
    }
}
