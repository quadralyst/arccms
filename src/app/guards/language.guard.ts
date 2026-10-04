/**
 * Language-prefix route guard.
 *
 * The public content routes are `/{contentTypeSlug}/{urlSlug}`. Translated
 * pages add a language prefix: `/{lang}/{contentTypeSlug}/{urlSlug}`.
 *
 * A plain `:lang/:contentTypeSlug/:urlSlug` route would swallow any
 * three-segment URL — `/admin/settings/localization` included. `canMatch`
 * avoids that entirely: when the first segment is not a configured language
 * the route does not match at all and the router carries on to the next one,
 * rather than matching and then failing to render.
 *
 * Spec: specs/multilingual-spec.md — Phase M4.
 */

import { inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { LocalizationService } from '../core/services/localization.service';

export const languageRouteGuard: CanMatchFn = async (_route: Route, segments: UrlSegment[]) => {
    const first = segments[0]?.path;
    if (!first) return false;

    const localization = inject(LocalizationService);
    const settings = await localization.load();

    // Only *other* languages are prefixed — the default language keeps the
    // unprefixed URLs, so `/en/articles` must not resolve on an en-default
    // site and quietly duplicate every page under a second address.
    if (first === settings.defaultLanguage) return false;

    return settings.enabledLanguages.some(language => language.code === first);
};

/**
 * /{lang}/{anything else}: an address that exists once, reached with a language
 * prefix it does not have, such as /hi/signup or /hi/learn. Redirects to the
 * address without the prefix, query and fragment kept. The redirect is the
 * guard's answer, since Angular runs `redirectTo` before any guard. Listed after
 * every language route (home, search, content), so it only sees what they did not match.
 */
export const languageRedirectGuard: CanMatchFn = async (route: Route, segments: UrlSegment[]) => {
    // Before any await: inject() works only while the guard starts.
    const router = inject(Router);
    if (!(await languageRouteGuard(route, segments))) return false;
    const current = router.getCurrentNavigation()?.extractedUrl;
    return router.createUrlTree(['/', ...segments.slice(1).map((segment) => segment.path)], {
        queryParams: current?.queryParams,
        fragment: current?.fragment ?? undefined,
    });
};

export const languageRedirect: Route = {
    matcher: (segments) => (segments.length >= 2 ? { consumed: segments } : null),
    canMatch: [languageRedirectGuard],
    // Never reached: the guard either redirects or lets the next route try.
    children: [],
};
