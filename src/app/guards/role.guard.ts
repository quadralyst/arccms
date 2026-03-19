// src/app/guards/role.guard.ts
import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { ToastService } from '../../shared/services/toast.service';
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
    route: { data?: RoleGuardRouteData; path?: string },
    state: any,
) => {
    const platformId = inject(PLATFORM_ID);
    const authStore = inject(AuthState);
    const toastService = inject(ToastService);
    const router = inject(Router);
    const constantVariables = inject(ConstantVariables);

    // Skip guard during SSR — Firebase Auth is not available server-side,
    // so the guard would always redirect to /admin/unauthorized and set the
    // wrong page title. Auth will be enforced on the client after hydration.
    if (!isPlatformBrowser(platformId)) {
        return true;
    }

    const requiredRoles = route.data?.['allowedRoles'] as string[];

    if (!requiredRoles || requiredRoles.length === 0) {
        console.warn(`RoleGuard: No allowedRoles defined for route ${route.path}. Access granted.`);
        toastService.openCustomSnackbar(
            `RoleGuard: No allowed roles defined for route ${route.path}. Access granted.`,
            'warning',
            'warning',
        );
        return true;
    }

    return authStore.initAuthStateListener().pipe(
        take(1),
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
