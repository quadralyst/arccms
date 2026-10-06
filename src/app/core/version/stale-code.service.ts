/**
 * When a screen's code cannot be loaded (specs/app-route-code-spec.md, R-D6 to R-D8).
 *
 * After a deploy the server no longer has the old version's code files, so a page left
 * open cannot open a screen it had not opened before: the router's lazy import fails and,
 * before this, the tap simply did nothing. Now:
 *
 * - on a normal page, Arc CMS loads the address the person asked for, fresh, so the tap
 *   lands on that screen in the new version (a loop guard stops a second try within 10
 *   seconds and shows a short message with a Reload button instead);
 * - on a page that shows updates itself (`data: { pwaUpdate: 'app' }`, docs/app/pwa.html),
 *   Arc CMS never reloads: `stale()` turns true and the app decides when.
 */
import { Injectable, InjectionToken, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationError, Router } from '@angular/router';
import { filter } from 'rxjs';
import { routeOwnsPwaUpdate } from '../pwa/pwa-update-route';

/** What browsers say when a lazy code file is not there (Chrome, Safari, Firefox, Vite, webpack-style). */
const MISSING_CODE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk [\w-]+ failed|ChunkLoadError/i;

/** Whether a navigation failed because a screen's code file could not be loaded. */
export function isMissingCode(error: unknown): boolean {
    const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
    return MISSING_CODE.test(message);
}

/** A second fresh load of the same address within this long means the fresh load did not help. */
export const RETRY_WINDOW_MS = 10_000;
const GUARD_KEY = 'arc-stale-code-load';

/** The page's own controls, swappable in tests. */
export interface StaleCodePage {
    assign(url: string): void;
    reload(): void;
    read(key: string): string | null;
    write(key: string, value: string): void;
    now(): number;
}

export const STALE_CODE_PAGE = new InjectionToken<StaleCodePage>('StaleCodePage', {
    providedIn: 'root',
    factory: () => ({
        assign: (url) => location.assign(url),
        reload: () => location.reload(),
        read: (key) => { try { return sessionStorage.getItem(key); } catch { return null; } },
        write: (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* private mode: no guard, still safe */ } },
        now: () => Date.now(),
    }),
});

@Injectable({ providedIn: 'root' })
export class StaleCodeService {
    private readonly router = inject(Router);
    private readonly page = inject(STALE_CODE_PAGE);
    private readonly flag = signal(false);
    private readonly stuck = signal(false);

    /** This page's code is older than the server's: a screen could not be loaded. Read-only. */
    readonly stale = this.flag.asReadonly();
    /** A fresh load did not help either: Arc CMS's message with a Reload button shows. */
    readonly needsReload = this.stuck.asReadonly();

    constructor() {
        if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
        this.router.events
            .pipe(filter((e): e is NavigationError => e instanceof NavigationError), takeUntilDestroyed())
            .subscribe((event) => this.onNavigationError(event.url, event.error));
    }

    /** Reload this page, which loads the new version. For an app that owns its updates, at a safe point. */
    reload(): void {
        this.page.reload();
    }

    private onNavigationError(url: string, error: unknown): void {
        if (!isMissingCode(error)) return;
        this.flag.set(true);
        // The app shows updates itself here, and must never be reloaded under someone.
        if (routeOwnsPwaUpdate(this.router.routerState.snapshot.root)) return;
        const last = this.lastLoad();
        if (last && last.url === url && this.page.now() - last.at < RETRY_WINDOW_MS) {
            this.stuck.set(true);
            return;
        }
        this.page.write(GUARD_KEY, JSON.stringify({ url, at: this.page.now() }));
        this.page.assign(url);
    }

    private lastLoad(): { url: string; at: number } | null {
        try {
            const value = JSON.parse(this.page.read(GUARD_KEY) ?? 'null');
            return value && typeof value.url === 'string' && typeof value.at === 'number' ? value : null;
        } catch {
            return null;
        }
    }
}
