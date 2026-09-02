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
 * Spec: docs/multilingual-spec.md — Phase M4.
 */

import { inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
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
