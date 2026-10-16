import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, Injector, OnInit, runInInjectionContext, signal, viewChild, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { filter } from 'rxjs/operators';
import { IMiscSettings, DEFAULT_MISC_SETTINGS } from '../admin/(settings)/misc/misc-settings.model';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { POWERED_BY_NAME, POWERED_BY_URL, poweredByWords } from '../../../shared/constants/powered-by';
import { lastKnownPoweredBy, rememberPoweredBy } from './powered-by-last-known';

/**
 * Powered By Footer Component
 *
 * Displays an unobtrusive "Built with Arc CMS" line at the bottom of all public pages,
 * in the page's language: the `powered_by` and `powered_by_title` keys of the site's
 * strings (src/shared/constants/powered-by.ts). Only "Arc CMS" is a link.
 * The text is always rendered in static HTML (for SSR/crawlers), but with the `hidden`
 * attribute until the setting is known, so a site that turned it off never shows it, not
 * even for a frame. It is known at once when this browser remembers the last read
 * (powered-by-last-known.ts), else when Settings → Misc has been read. When the admin
 * disables it there, the component removes it client-side.
 * Hidden on admin routes.
 *
 * While it shows, its height is on the page as `--arc-powered-by-height`, so a page
 * that fills the screen (the sign-in page) leaves room for it: `calc(100dvh -
 * var(--arc-powered-by-height, 0px))`.
 */
@Component({
    selector: 'arc-powered-by-footer',
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (showBadge()) {
        <div class="arc-powered-by" #badge [hidden]="!settingsKnown()">
            {{ words().before }}<a [href]="url" target="_blank" rel="noopener" [title]="words().title">{{ name }}</a>{{ words().after }}
        </div>
        }
    `,
    styles: [`
        .arc-powered-by {
            text-align: center;
            padding: 8px 16px;
            font-size: 0.75rem;
            color: #6e6e73;
            background: #f5f5f7;
            border-top: 1px solid #e8e8ed;
        }

        .arc-powered-by a {
            color: #0066cc;
            text-decoration: none;
        }

        .arc-powered-by a:hover {
            text-decoration: underline;
        }
    `],
})
export class PoweredByFooterComponent implements OnInit {
    private firestore = inject(Firestore);
    private router = inject(Router);
    private platformId = inject(PLATFORM_ID);
    private injector = inject(Injector);
    private uiStrings = inject(UiStringsService);

    readonly url = POWERED_BY_URL;
    readonly name = POWERED_BY_NAME;
    /** The line in the page's language. */
    readonly words = computed(() => poweredByWords(this.uiStrings.strings()));

    showBadge = signal(true);
    private isAdminRoute = signal(false);
    private settingsLoaded = signal(false);
    /** What this browser last read; `null` before its first read, and on the server. */
    private remembered = isPlatformBrowser(this.platformId) ? lastKnownPoweredBy() : null;
    /**
     * Whether the line may be seen: the setting has been read, or this browser last saw it on.
     * A remembered "off" waits for the read, so a stale "on" is the only thing that can flash.
     */
    readonly settingsKnown = computed(() => this.settingsLoaded() || this.remembered === true);
    private poweredByEnabled = signal(true);
    private badge = viewChild<ElementRef<HTMLElement>>('badge');
    private destroyRef = inject(DestroyRef);

    ngOnInit(): void {
        // Only run in browser for hydration logic
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }


        // Check current route
        this.checkRoute(this.router.url);

        // Subscribe to route changes
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: NavigationEnd) => {
            this.checkRoute(event.urlAfterRedirects);
        });

        // Load settings once
        this.loadSettings();
    }

    constructor() {
        if (isPlatformBrowser(this.platformId)) this.publishHeight();
    }

    /**
     * Keep `--arc-powered-by-height` on the page equal to the badge's height: 0 while
     * it is not drawn, or hidden by a full-screen route (the observer then sees no box).
     */
    private publishHeight(): void {
        const root = document.documentElement;
        const observer = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(([entry]) => root.style.setProperty('--arc-powered-by-height', `${entry.target.getBoundingClientRect().height}px`));
        // After each render that changes the badge, so the height is there as soon as it is drawn.
        afterRenderEffect(() => {
            const element = this.badge()?.nativeElement;
            observer?.disconnect();
            if (element && observer) observer.observe(element);
            else root.style.setProperty('--arc-powered-by-height', '0px');
        });
        this.destroyRef.onDestroy(() => {
            observer?.disconnect();
            root.style.removeProperty('--arc-powered-by-height');
        });
    }

    private checkRoute(url: string): void {
        this.isAdminRoute.set(url.startsWith('/admin'));
        this.updateVisibility();
    }

    private async loadSettings(): Promise<void> {
        try {
            const docRef = runInInjectionContext(this.injector, () => doc(this.firestore, 'Settings', 'misc'));
            const docSnap = await runInInjectionContext(this.injector, () => getDoc(docRef));
            const data = docSnap.exists() ? docSnap.data() as IMiscSettings : null;
            this.poweredByEnabled.set(data?.showPoweredBy ?? DEFAULT_MISC_SETTINGS.showPoweredBy ?? true);
            rememberPoweredBy(this.poweredByEnabled());
        } catch (error) {
            // On error, keep showing (fail-open)
            console.error('PoweredByFooterComponent: Error loading settings:', error);
        } finally {
            this.settingsLoaded.set(true);
            this.updateVisibility();
        }
    }

    private updateVisibility(): void {
        const show = !this.isAdminRoute() && this.poweredByEnabled();
        this.showBadge.set(show);
    }
}
