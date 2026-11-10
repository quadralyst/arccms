// src/app/guards/role.guard.ts
import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { from } from 'rxjs';
import { ConstantVariables } from '../../shared/constants';
import { AuthState } from '../pages/(auth)/auth.store';

interface RoleGuardRouteData {
    allowedRoles?: string[];
    [key: string]: any;
}

interface RoleGuardUser {
    role?: string;
    [key: string]: any;
}

export const roleGuard: CanActivateFn | CanMatchFn = (
    // A Route (canMatch) has its own path; a snapshot (canActivate) has it on routeConfig.
    route: { data?: RoleGuardRouteData; path?: string; routeConfig?: { path?: string } | null },
    state: any,
) => {
    const platformId = inject(PLATFORM_ID);
    const authStore = inject(AuthState);
    const router = inject(Router);
    const constantVariables = inject(ConstantVariables);

    // Never render a signed-in page on the server. Nobody is signed in there, so
    // every read the page starts is refused, and a page that does not catch one
    // (the Contacts page's lists, for one) stopped the whole dev server with an
    // unhandled rejection (found in a smoke test, 2026-09-27). The live site
    // never server-renders these pages anyway (it serves __shell.html); the
    // browser renders them, and checks access, after the page loads.
    if (!isPlatformBrowser(platformId)) {
        return false;
    }

    const requiredRoles = route.data?.['allowedRoles'] as string[];

    // A route with roleGuard and no roles lets nobody in: a forgotten data.allowedRoles
    // must never open a page to everyone. The developer reads why in the console; the
    // visitor sees the usual unauthorized page.
    if (!requiredRoles || requiredRoles.length === 0) {
        console.warn(`roleGuard: the route "${route.routeConfig?.path ?? route.path ?? ''}" sets no data.allowedRoles, so nobody may open it. Add the roles that may (docs/app/pages-and-routes.html).`);
        router.navigate(['/admin/unauthorized']);
        return false;
    }

    // The person's record, shared with every other guard (AuthState.recordReady).
    return from(authStore.recordReady()).pipe(
        map((user: any | null) => {
            if (user && user.role) {
                const userRole: string = user.role;
                if (requiredRoles.includes(userRole)) {
                    return true;
                }
            }
            router.navigate(['/admin/unauthorized']);
            return false;
        }),
    );
};
