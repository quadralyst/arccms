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
import {
    CanMatchFn,
    NavigationCancel,
    NavigationEnd,
    NavigationError,
    NavigationSkipped,
    Route,
    Router,
    UrlSegment,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { LocalizationService } from '../core/services/localization.service';
import { ILocalizationSettings } from '../../shared/models/localization.model';
import { LANGUAGE_CODE_PATTERN } from '../../shared/constants/languages';

const claimedCache = new WeakMap<Route[], ReadonlySet<string>>();

/**
 * The first segments that a route with a literal path already uses, Arc's own or
 * the app's (`pos`, `pricing`, `learn`), looking inside routes with an empty
 * path such as the (group) folders of the file-based pages. Such a segment is
 * never a language prefix, and the Localization settings page refuses it as a code.
 */
export function claimedFirstSegments(routes: Route[]): ReadonlySet<string> {
    const cached = claimedCache.get(routes);
    if (cached) return cached;
    const claimed = new Set<string>();
    const walk = (list: Route[]) => {
        for (const route of list) {
            if (route.path === undefined) continue;
            const first = route.path.split('/')[0];
            if (first === '' && route.children) walk(route.children);
            else if (first && !first.startsWith(':') && first !== '**') claimed.add(first.toLowerCase());
        }
    };
    walk(routes);
    claimedCache.set(routes, claimed);
    return claimed;
}

/** Whether a first segment could be a language prefix at all, without asking anyone. */
function couldBeLanguage(first: string, routes: Route[]): boolean {
    return LANGUAGE_CODE_PATTERN.test(first) && !claimedFirstSegments(routes).has(first);
}

/**
 * Only *other* languages are prefixed: the default language keeps the
 * unprefixed URLs, so `/en/articles` must not resolve on an en-default site and
 * quietly duplicate every page under a second address.
 */
function isPrefixLanguage(settings: ILocalizationSettings, first: string): boolean {
    return first !== settings.defaultLanguage && settings.enabledLanguages.some((language) => language.code === first);
}

/** One background read at a time, however many routes asked. */
const refreshing = new WeakMap<LocalizationService, Promise<void>>();

/**
 * Reads the list from the server after the guard answered from this browser's
 * copy. If the fresh list changes the answer for the page now open, opens it again.
 */
function refreshInBackground(router: Router, localization: LocalizationService, stale: ILocalizationSettings): void {
    if (refreshing.has(localization)) return;
    refreshing.set(localization, (async () => {
        const fresh = await localization.load();
        if (router.getCurrentNavigation()) {
            await firstValueFrom(router.events.pipe(filter((event) =>
                event instanceof NavigationEnd || event instanceof NavigationCancel
                || event instanceof NavigationError || event instanceof NavigationSkipped)));
        }
        const url = router.url;
        const first = router.parseUrl(url).root.children['primary']?.segments[0]?.path;
        if (!first || !couldBeLanguage(first, router.config)) return;
        if (isPrefixLanguage(stale, first) !== isPrefixLanguage(fresh, first)) {
            await router.navigateByUrl(url, { onSameUrlNavigation: 'reload', replaceUrl: true });
        }
    })().catch(() => undefined).finally(() => refreshing.delete(localization)));
}

/**
 * Never waits for the server when it does not have to (F18): every address
 * passes through these routes on its way to the app's pages, so a read here
 * held up /signup and every app page for the length of the first Firestore
 * request.
 *
 * - A first segment that cannot be a language (`signup`, `admin`), or that a
 *   route with a literal path claims (`pos`), is refused at once.
 * - Any other is checked against the list this browser last saw, and the list
 *   is read again in the background.
 * - Only a first visit with no list kept waits for the server, and only for a
 *   segment that could be a language and no route claims (`/de`).
 */
export const languageRouteGuard = (_route: Route, segments: UrlSegment[]): boolean | Promise<boolean> => {
    const first = segments[0]?.path;
    if (!first) return false;

    // Before any await: inject() works only while the guard starts.
    const router = inject(Router);
    const localization = inject(LocalizationService);
    if (!couldBeLanguage(first, router.config)) return false;

    const known = localization.known();
    if (known) {
        if (!localization.loaded()) refreshInBackground(router, localization, known);
        return isPrefixLanguage(known, first);
    }
    return localization.load().then((settings) => isPrefixLanguage(settings, first));
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
