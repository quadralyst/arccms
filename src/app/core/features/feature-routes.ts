/**
 * The URLs each feature owns (specs/feature-flags-spec.md), and the route that
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
    contact: ['admin/messages/**'],
    analytics: ['admin/settings/analytics'],
};

/**
 * Routes whose URL cannot tell their feature (a parameter where a feature's
 * prefix would be): app.routes.ts leaves them out with `whenOn`, and the content
 * pages check `featureGuard`. Listed so the coverage test knows whose they are.
 */
export const FEATURE_PARAM_ROUTES: Readonly<Record<string, FeatureId>> = {
    ':contentTypeSlug': 'content',
    ':contentTypeSlug/:urlSlug': 'content',
    ':lang/:contentTypeSlug': 'content',
    ':lang/:contentTypeSlug/:urlSlug': 'content',
    ':lang/search': 'search',
    'user/:waitlistId/:userId': 'forms',
};

/**
 * Every URL that belongs to no feature: core, always there. A new page must be
 * in this list or a feature's; the coverage test fails on one in neither
 * (src/app/core/features/feature-coverage.spec.ts).
 */
export const CORE_URLS: readonly string[] = [
    '', '**', 'not-found', 'onboarding', 'signup', 'profile', 'auth-checker', ':lang', 'tiptap-test', 'notifications',
    'unsubscribe/**', 'user/dashboard', 'user/profile/**',
    'admin', 'admin/dashboard', 'admin/profile', 'admin/media', 'admin/users/**', 'admin/unauthorized', 'admin/notifications',
    'admin/feedback', 'admin/email', 'admin/email/brand-kit', 'admin/email/composer', 'admin/email-logs',
    'admin/settings', 'admin/settings/about', 'admin/settings/email', 'admin/settings/integrations',
    'admin/settings/user', 'admin/settings/message', 'admin/settings/site-usage',
    'admin/settings/localization', 'admin/settings/automations', 'admin/settings/misc',
    // The file router's second URLs for core pages that have an explicit route.
    'admin/brand-kit', 'admin/email-composer', 'admin/about/**', 'admin/analytics-setting/**', 'admin/email-setting/**',
    'admin/integrations-setting/**', 'admin/localization/**', 'admin/message/**', 'admin/site-usage/**', 'admin/user-setting/**',
];

function matches(pattern: string, path: readonly string[]): boolean {
    const deep = pattern.endsWith('/**');
    const parts = (deep ? pattern.slice(0, -3) : pattern).split('/');
    if (deep ? path.length < parts.length : path.length !== parts.length) return false;
    return parts.every((part, i) => part === path[i]);
}

/** Whether a URL path is one of CORE_URLS. */
export function isCorePath(path: readonly string[]): boolean {
    return CORE_URLS.some((pattern) => {
        if (pattern === '') return path.length === 0; // the home page
        if (pattern === '**') return path.length === 1 && path[0] === '**'; // the not-found catch-all
        return matches(pattern, path);
    });
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
