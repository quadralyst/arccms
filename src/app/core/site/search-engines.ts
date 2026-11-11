/**
 * Whether search engines may list the page the app is showing (RF6 6.3,
 * docs/features/seo.html).
 *
 * The app shell (index.html) carries no robots tag: a page whose first HTML says
 * noindex may never be rendered by a search engine, so nothing the app draws could be
 * listed. Instead:
 *
 * - Each move to another page adds `noindex` with JavaScript (keepOutOfSearchOnEachMove).
 *   Search engines that render honour it, so the not-found page and unknown addresses
 *   drop out.
 * - A public page lifts it: a content page once its content has loaded (letIntoSearch),
 *   or any route whose data says `{ searchEngines: 'index' }` (core's /pricing and
 *   /waitlist, and an app's own public pages), when the move ends.
 * - Sign-in, member, admin, checkout and setup addresses also get an
 *   `X-Robots-Tag: noindex` header from Hosting (firebase.json, PRIVATE_PAGES in
 *   scripts/arc-headers.mjs), which works before any script runs.
 *
 * Published pages are files of their own on Hosting and never load the shell, so
 * none of this applies to them: they stay listed as before.
 */
import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, NavigationEnd, NavigationStart, Router } from '@angular/router';

/** What every page the app draws has until it says otherwise. */
export const KEEP_OUT_OF_SEARCH = 'noindex';
/** What a public page sets. */
export const LET_INTO_SEARCH = 'index, follow';

/** Route data that lets search engines list a page: `data: { searchEngines: 'index' }`. */
export interface SearchEnginesRouteData {
    searchEngines?: 'index';
}

export function keepOutOfSearch(meta: Meta): void {
    meta.updateTag({ name: 'robots', content: KEEP_OUT_OF_SEARCH });
}

export function letIntoSearch(meta: Meta): void {
    meta.updateTag({ name: 'robots', content: LET_INTO_SEARCH });
}

/** Whether a route on the way to the page says it may be listed. */
export function routeLetsIntoSearch(snapshot: ActivatedRouteSnapshot | null): boolean {
    for (let route = snapshot; route; route = route.firstChild) {
        if ((route.data as SearchEnginesRouteData | undefined)?.searchEngines === 'index') return true;
    }
    return false;
}

/**
 * Adds noindex as each move to another page starts, so a public page that lifted it
 * does not leave the next page listed, and lifts it when the move ends on a route whose
 * data says `searchEngines: 'index'`. Call it in an injection context, once, from the
 * root component.
 */
export function keepOutOfSearchOnEachMove(): void {
    const meta = inject(Meta);
    const router = inject(Router);
    router.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
        if (event instanceof NavigationStart) keepOutOfSearch(meta);
        else if (event instanceof NavigationEnd && routeLetsIntoSearch(router.routerState.snapshot.root)) letIntoSearch(meta);
    });
}
