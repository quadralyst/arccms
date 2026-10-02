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
