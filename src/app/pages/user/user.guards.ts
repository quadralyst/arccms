import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, switchMap, take } from 'rxjs/operators';
import { of } from 'rxjs';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';

/**
 * Requires any signed-in user (regardless of role). Redirects anonymous visitors
 * to /signup. Gates on the resolved `currentUser` from the auth listener — NOT
 * the store's `isAuthenticated` signal, which is false for plain `user` accounts.
 */
export const userGuard: CanActivateFn = (_route, state) => {
    const platformId = inject(PLATFORM_ID);
    if (!isPlatformBrowser(platformId)) return true; // SSR: enforce on the client after hydration

    const authState = inject(AuthState);
    const router = inject(Router);

    return authState.initAuthStateListener().pipe(
        take(1),
        map((user) => (user ? true : router.createUrlTree(['/signup'], { queryParams: { redirect: state.url } }))),
    );
};

/**
 * Requires a paid entitlement (isPro). Anonymous → /signup; signed-in but not a
 * member → /pricing. Loads the entitlement into EntitlementService as a side
 * effect so the destination page has it immediately.
 */
export const entitledGuard: CanActivateFn = (_route, state) => {
    const platformId = inject(PLATFORM_ID);
    if (!isPlatformBrowser(platformId)) return true;

    const authState = inject(AuthState);
    const entitlements = inject(EntitlementService);
    const router = inject(Router);

    return authState.initAuthStateListener().pipe(
        take(1),
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
