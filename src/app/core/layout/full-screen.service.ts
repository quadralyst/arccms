import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Whether this page is a full-screen route (docs/app/pages-and-routes.html): the
 * deepest route on the way to it that sets `data.fullScreen` decides, so a child can
 * set `fullScreen: false` under a full-screen parent.
 */
export function routeIsFullScreen(snapshot: ActivatedRouteSnapshot | null): boolean {
    let fullScreen = false;
    for (let node = snapshot; node; node = node.firstChild) {
        const value = node.data?.['fullScreen'];
        if (typeof value === 'boolean') fullScreen = value;
    }
    return fullScreen;
}

/**
 * True while the current page is a full-screen route. The app root reads it to step
 * out of the way: no message banner, powered-by footer or feedback button, the
 * site-usage banner and the update bar held until a normal page, and no shell
 * padding, margins or page scroll (the `arc-full-screen` class on <html>).
 */
@Injectable({ providedIn: 'root' })
export class FullScreenService {
    private router = inject(Router);

    readonly active = signal(routeIsFullScreen(this.router.routerState.snapshot.root));

    constructor() {
        this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
            this.active.set(routeIsFullScreen(this.router.routerState.snapshot.root));
        });
    }
}
