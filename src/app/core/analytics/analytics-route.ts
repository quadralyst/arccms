import type { ActivatedRouteSnapshot } from '@angular/router';

/**
 * Whether a page may be tracked (docs/features/analytics.html): any route on the way
 * to it that sets `data: { analytics: false }` turns tracking off there, and every page
 * below that route inherits it, the same rule as `data: { feedbackButton: false }`.
 */
export function routeAllowsAnalytics(snapshot: ActivatedRouteSnapshot | null): boolean {
    for (let node = snapshot; node; node = node.firstChild) {
        if (node.data?.['analytics'] === false) return false;
    }
    return true;
}
