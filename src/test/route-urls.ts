/**
 * Route URLs for the specs that check who owns a page: the feature coverage spec and the
 * admin menu spec. Both read the app's own routes (src/custom/routes.ts) this way.
 */
import type { Route } from '@angular/router';

/** The URL of every explicit route with a page, children joined to their parents. */
export function explicitRouteUrls(list: readonly Route[], prefix = ''): string[] {
    return list.flatMap((route) => {
        if (route.matcher) return [];
        const url = [prefix, route.path].filter(Boolean).join('/');
        return route.children ? explicitRouteUrls(route.children, url) : [url];
    });
}

/**
 * Whether one of these route URLs serves a URL path (its segments, without query or
 * fragment): `:param` stands for any one segment and `**` for the rest of the path.
 */
export function isServedBy(urls: readonly string[], path: readonly string[]): boolean {
    return urls.some((url) => {
        const parts = url.split('/').filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === '**') return true;
            if (i >= path.length || (!parts[i].startsWith(':') && parts[i] !== path[i])) return false;
        }
        return parts.length === path.length;
    });
}

/**
 * What is wrong with the app's admin pages (src/custom/admin-routes.ts), one line each.
 * The shell has no guard of its own, so a page with none on it or above it opens for
 * anyone. A path is below /admin already, so one starting with admin opens at /admin/admin.
 * roleGuard without allowedRoles turns every visitor away, on the route that sets it.
 */
export function adminRouteProblems(list: readonly Route[], prefix = 'admin', guarded = false): string[] {
    return list.flatMap((route) => {
        if (route.redirectTo !== undefined) return [];
        const url = [prefix, route.path].filter(Boolean).join('/');
        const guards = [...(route.canActivate ?? []), ...(route.canActivateChild ?? []), ...(route.canMatch ?? [])];
        const safe = guarded || guards.length > 0;
        const problems: string[] = [];
        if (prefix === 'admin' && /^admin(\/|$)/.test(route.path ?? '')) {
            problems.push(`/${url}: a path here is below /admin already, so write '${(route.path ?? '').replace(/^admin\/?/, '')}'`);
        }
        if (guards.some((guard) => guard.name === 'roleGuard') && !route.data?.['allowedRoles']?.length) {
            problems.push(`/${url}: roleGuard with no data.allowedRoles lets nobody in`);
        }
        if (route.children) return [...problems, ...adminRouteProblems(route.children, url, safe)];
        if (!safe) problems.push(`/${url}: no guard, so anyone can open it. Add roleGuard with data.allowedRoles`);
        return problems;
    });
}
