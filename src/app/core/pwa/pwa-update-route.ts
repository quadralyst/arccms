import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Whether the app shows the "new version" prompt itself on this page
 * (docs/app/pwa.html): any route on the way to it that sets `data: { pwaUpdate: 'app' }`
 * makes it so, and every page below that route inherits it. `'app'` is the only value;
 * anything else is ignored.
 */
export function routeOwnsPwaUpdate(snapshot: ActivatedRouteSnapshot | null): boolean {
    for (let node = snapshot; node; node = node.firstChild) {
        if (node.data?.['pwaUpdate'] === 'app') return true;
    }
    return false;
}

/**
 * True while the current page is one where the app shows the update itself, so Arc's
 * own update bar stays out of the way (the bar reads it).
 */
@Injectable({ providedIn: 'root' })
export class PwaUpdateRouteService {
    private router = inject(Router);

    readonly appOwns = signal(routeOwnsPwaUpdate(this.router.routerState.snapshot.root));

    constructor() {
        this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
            this.appOwns.set(routeOwnsPwaUpdate(this.router.routerState.snapshot.root));
        });
    }
}
