import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, switchMap } from 'rxjs/operators';
import { from, of } from 'rxjs';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';
import { lockedAccountLanding, memberPagesOpen } from '../../core/app-accounts/app-account-lock';

/**
 * Requires any signed-in user (regardless of role). Redirects anonymous visitors
 * to /signup. Gates on the person's record (AuthState.recordReady: the device's copy
 * when it has one, so no wait for the server), NOT the store's `isAuthenticated`
 * signal, which is false for plain `user` accounts. A Firebase sign-in with no
 * record counts as signed out.
 */
export const userGuard: CanActivateFn = (_route, state) => {
    const platformId = inject(PLATFORM_ID);
    // Never render a signed-in page on the server (see roleGuard): the browser renders it.
    if (!isPlatformBrowser(platformId)) return false;

    const authState = inject(AuthState);
    const router = inject(Router);

    return from(authState.recordReady()).pipe(
        map((user) => (user ? true : router.createUrlTree(['/signup'], { queryParams: { redirect: state.url } }))),
    );
};

/**
 * Arc CMS's own member pages (/user/..., /account): userGuard, and a locked app account
 * goes to its home page instead when the app keeps it out of them
 * (src/custom/app-accounts.ts, docs/app/app-accounts.html). An app's own pages use
 * userGuard, so a locked account still reaches them.
 */
export const memberPagesGuard: CanActivateFn = (_route, state) => {
    const platformId = inject(PLATFORM_ID);
    if (!isPlatformBrowser(platformId)) return false; // see userGuard

    const authState = inject(AuthState);
    const router = inject(Router);

    return from(authState.recordReady()).pipe(
        map((record) => {
            if (!record) return router.createUrlTree(['/signup'], { queryParams: { redirect: state.url } });
            return memberPagesOpen(record) ? true : router.parseUrl(lockedAccountLanding(record.role));
        }),
    );
};

/**
 * Requires a paid entitlement (isPro). Anonymous → /signup; signed-in but not a
 * member → /pricing. Loads the entitlement into EntitlementService as a side
 * effect so the destination page has it immediately.
 */
export const entitledGuard: CanActivateFn = (_route, state) => {
    const platformId = inject(PLATFORM_ID);
    if (!isPlatformBrowser(platformId)) return false; // see userGuard

    const authState = inject(AuthState);
    const entitlements = inject(EntitlementService);
    const router = inject(Router);

    return from(authState.recordReady()).pipe(
        switchMap((user) => {
            if (!user) {
                return of(router.createUrlTree(['/signup'], { queryParams: { redirect: state.url } }));
            }
            return entitlements.load(user.uid).pipe(
                map((entitlement) => (entitlement?.isPro ? true : router.createUrlTree(['/pricing']))),
            );
        }),
    );
};
