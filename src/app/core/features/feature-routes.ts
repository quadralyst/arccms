/**
 * The URLs each feature owns (docs/feature-flags-spec.md), and the route that
 * answers them with the not-found page when the feature is off.
 *
 * One route, first in the table, instead of a guard on every page: it also
 * catches the file router's second URL for pages that have an explicit route
 * (`/admin/broadcasts` next to `/admin/email/broadcasts`). Routes with a
 * parameter in the first segments (`/:lang/...`, `/user/:waitlistId/:userId`)
 * cannot be told apart by URL, so app.routes.ts leaves those out instead, and
 * the file-based content pages carry `featureGuard('content')`.
 */
import type { Route, UrlMatcher, UrlSegment } from '@angular/router';
import type { FeatureId } from './feature-registry';
import { isOn } from './features';

/** `a/b` matches that path exactly; `a/**` matches `a` and everything below it. */
export const FEATURE_URLS: Record<FeatureId, readonly string[]> = {
    content: ['admin/contents/**', 'admin/authors/**', 'p/**'],
    search: ['admin/search/**', 'search', 'admin/settings/search'],
    seo: ['admin/settings/discoverability'],
    forms: [
        'waitlist/**', 'leaderboard/**', 'admin/waitlists/**',
        'admin/templates/**', 'admin/joined-users/**', 'admin/tags/**',
    ],
    audience: [
        'admin/contacts/**', 'admin/lists/**', 'admin/list-hub/**', 'admin/contact-tags/**',
        'admin/contact-fields/**', 'admin/app-users/**', 'admin/settings/app-audience',
    ],
    'email-marketing': [
        'admin/email/broadcasts', 'admin/email/drip-campaigns', 'admin/email/announcements',
        'admin/broadcasts/**', 'admin/drips/**', 'admin/announcements/**',
    ],
    sms: ['admin/sms-logs/**', 'admin/settings/sms'],
    payments: [
        'admin/products/**', 'admin/transactions/**', 'admin/settings/payments', 'admin/payments/**',
        'pricing/**', 'account/**', 'user/premium/**', 'user/payments/**',
        'checkout/**', 'checkout-success/**', 'checkout-cancel/**',
    ],
    data: [
        'admin/data/**', 'admin/export-data/**', 'admin/import-data/**',
        'admin/export-files/**', 'admin/import-files/**',
    ],
    pwa: [],
};

function matches(pattern: string, path: readonly string[]): boolean {
    const deep = pattern.endsWith('/**');
    const parts = (deep ? pattern.slice(0, -3) : pattern).split('/');
    if (deep ? path.length < parts.length : path.length !== parts.length) return false;
    return parts.every((part, i) => part === path[i]);
}

/** The feature that owns a URL path (its segments, without query or fragment), if any. */
export function featureOfPath(path: readonly string[]): FeatureId | undefined {
    for (const [id, patterns] of Object.entries(FEATURE_URLS) as [FeatureId, readonly string[]][]) {
        if (patterns.some((pattern) => matches(pattern, path))) return id;
    }
    return undefined;
}

/** Matches every URL of a feature that is off, consuming the whole URL. */
export function featureOffMatcher(on: (id: FeatureId) => boolean = isOn): UrlMatcher {
    return (segments: UrlSegment[]) => {
        const feature = featureOfPath(segments.map((s) => s.path));
        return feature && !on(feature) ? { consumed: segments } : null;
    };
}

/** First in the route table: a feature that is off answers with the not-found page. */
export const FEATURE_OFF_ROUTE: Route = {
    matcher: featureOffMatcher(),
    title: 'Page Not Found | Arc CMS',
    loadComponent: () => import('../../pages/not-found.page').then((m) => m.default),
};

/** Routes that belong to a feature: all of them when it is on, none when it is off. */
export function whenOn(id: FeatureId, routes: Route[], on: (id: FeatureId) => boolean = isOn): Route[] {
    return on(id) ? routes : [];
}
