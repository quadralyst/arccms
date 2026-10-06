/**
 * The one gate every Google Analytics call goes through (docs/features/analytics.html,
 * specs/app-analytics-consent-spec.md).
 *
 * Firebase Analytics is never imported statically: this service loads it with a dynamic
 * import, so it is a chunk of its own that a visitor downloads only when tracking starts.
 * It then sends Google's page view, the screen views and the user id AngularFire's
 * ScreenTrackingService and UserTrackingService sent before (screen-view.ts), the route
 * opt-out, and Arc CMS's own events.
 *
 * - `always` (the default): it starts as the app starts, without asking.
 * - `required`: nothing of Google Analytics loads until the visitor accepts the site
 *   usage banner. Rejecting later stops collection and deletes Google's cookies.
 *
 * With the `analytics` feature off, or no `measurementId`, nothing is loaded or sent.
 */
import { Injectable, InjectionToken, Injector, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { NavigationCancel, NavigationEnd, NavigationError, Router, RoutesRecognized } from '@angular/router';
import { FirebaseApp } from '@angular/fire/app';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { environment } from '../../../environments/environment';
import { arcConfig, type AnalyticsConsentMode } from '../config/arc-config';
import { isOn } from '../features/features';
import { SiteUsageService } from '../../pages/admin/(settings)/site-usage/site-usage.service';
import { routeAllowsAnalytics } from './analytics-route';
import { SCREEN_VIEW_EVENT, ScreenViewSequence, screenOf } from './screen-view';

type AnalyticsModule = typeof import('firebase/analytics');
type AnalyticsInstance = import('firebase/analytics').Analytics;
type Call = (fns: AnalyticsModule, analytics: AnalyticsInstance) => void;

/** Google's cookies: `_ga` and `_ga_<container>`. */
const GA_COOKIE = /^_ga(_[A-Za-z0-9]+)?$/;

/** Loads Firebase Analytics on demand, so a visitor who is not tracked never downloads it. */
export const loadAnalyticsModule = (): Promise<AnalyticsModule> => import('firebase/analytics');

/** Overrides for tests: the install's mode, the feature, the measurement id and the loader. */
export interface AnalyticsOptions {
    mode: AnalyticsConsentMode;
    featureOn: boolean;
    measurementId: string;
    load: () => Promise<AnalyticsModule>;
}
export const ANALYTICS_OPTIONS = new InjectionToken<Partial<AnalyticsOptions>>('ArcAnalyticsOptions');

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
    private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
    private readonly injector = inject(Injector);
    private readonly router = inject(Router);
    private readonly consent = inject(SiteUsageService);

    private readonly options = inject(ANALYTICS_OPTIONS, { optional: true }) ?? {};
    readonly mode: AnalyticsConsentMode = this.options.mode ?? arcConfig.analyticsConsent;
    readonly featureOn: boolean = this.options.featureOn ?? isOn('analytics');
    readonly measurementId: string = this.options.measurementId
        ?? (environment.firebaseConfig as { measurementId?: string })?.measurementId ?? '';
    private readonly load = this.options.load ?? loadAnalyticsModule;

    private readonly routeOk = signal(true);

    /** True while this visitor may be tracked on this page, right now. */
    readonly allowed = computed(() =>
        this.featureOn && this.browser && !!this.measurementId && this.routeOk()
        && (this.mode === 'always' || (this.consent.bannerEnabled() && this.consent.consent() === 'accepted')));

    private fns: AnalyticsModule | null = null;
    private instance: AnalyticsInstance | null = null;
    private loading: Promise<void> | null = null;
    private queue: Call[] = [];
    private screens = new ScreenViewSequence();
    private wasAllowed = false;

    constructor() {
        if (!this.browser || !this.featureOn) return;

        this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
            // Off as soon as the page is known, before anything is sent for it.
            if (event instanceof RoutesRecognized && !routeAllowsAnalytics(event.state.root)) {
                this.routeOk.set(false);
                // Now, not on the next change detection: Google reads the flag before every hit.
                this.setDisabled(true);
            }
            if (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) {
                this.routeOk.set(routeAllowsAnalytics(this.router.routerState.snapshot.root));
            }
            if (event instanceof NavigationEnd) this.sendScreenView();
        });

        effect(() => {
            const allowed = this.allowed();
            untracked(() => this.apply(allowed));
        });
    }

    /** Log an event. Dropped, not queued, when tracking is not allowed now. */
    log(name: string, params?: Record<string, unknown>): void {
        this.call((fns, analytics) => fns.logEvent(analytics, name, params));
    }

    setUserProperties(properties: Record<string, unknown>): void {
        this.call((fns, analytics) => fns.setUserProperties(analytics, properties));
    }

    setUserId(id: string | null): void {
        this.call((fns, analytics) => fns.setUserId(analytics, id));
    }

    private call(fn: Call): void {
        if (!this.allowed()) return;
        if (this.fns && this.instance) {
            try {
                fn(this.fns, this.instance);
            } catch (error) {
                console.warn('Analytics call failed:', error);
            }
            return;
        }
        this.queue.push(fn);
        void this.ensureLoaded();
    }

    private apply(allowed: boolean): void {
        this.setDisabled(!allowed);
        if (allowed) {
            this.wasAllowed = true;
            void this.ensureLoaded();
            return;
        }
        this.queue = [];
        // Withdrawn consent: also remove what Google stored, so the visitor is not recognised later.
        if (this.mode === 'required' && this.wasAllowed && this.consent.consent() !== 'accepted') this.deleteGaCookies();
    }

    private ensureLoaded(): Promise<void> {
        this.loading ??= this.loadInstance().then(() => this.flush());
        return this.loading;
    }

    private async loadInstance(): Promise<void> {
        try {
            const fns = await this.load();
            if (!(await fns.isSupported())) return;
            const app = this.injector.get(FirebaseApp);
            // Google's own page view for this first page is sent as it starts.
            this.instance = fns.initializeAnalytics(app);
            this.fns = fns;
            this.trackUser();
            // The first page's screen view. Before the first navigation ends, NavigationEnd sends it.
            if (this.router.navigated) this.sendScreenView();
        } catch (error) {
            console.warn('Analytics could not start:', error);
        }
    }

    private flush(): void {
        const pending = this.queue;
        this.queue = [];
        if (!this.allowed()) return;
        for (const fn of pending) this.call(fn);
    }

    /** What AngularFire's UserTrackingService did. */
    private trackUser(): void {
        const auth = this.injector.get(Auth, null);
        if (!auth) return;
        onAuthStateChanged(auth, (user) => {
            if (this.allowed() && this.fns && this.instance) this.fns.setUserId(this.instance, user?.uid ?? null);
        });
    }

    /** What AngularFire's ScreenTrackingService did. */
    private sendScreenView(): void {
        if (!this.allowed() || !this.fns || !this.instance) return;
        const root = this.router.routerState.snapshot.root;
        const path = this.router.parseUrl(this.router.url).root.children['primary']?.toString() ?? '';
        const title = this.injector.get(Title, null)?.getTitle() ?? '';
        const params = this.screens.next(screenOf(root, `/${path}`, title));
        // A plain name: Firebase's typings for 'screen_view' want a narrower parameter shape than AngularFire sends.
        if (params) this.fns.logEvent(this.instance, SCREEN_VIEW_EVENT as string, params);
    }

    /** Google reads this flag before every hit, so it holds even before Analytics loads. */
    private setDisabled(disabled: boolean): void {
        if (!this.browser || !this.measurementId) return;
        (window as unknown as Record<string, boolean>)[`ga-disable-${this.measurementId}`] = disabled;
        if (this.fns && this.instance) {
            try {
                this.fns.setAnalyticsCollectionEnabled(this.instance, !disabled);
            } catch {
                // the flag above already holds
            }
        }
    }

    private deleteGaCookies(): void {
        const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => GA_COOKIE.test(n));
        const parts = location.hostname.split('.');
        // The host and each parent domain, since Google sets them on the widest it can.
        const domains = [''].concat(parts.slice(0, -1).map((_, i) => `; domain=.${parts.slice(i).join('.')}`));
        for (const name of names) {
            for (const domain of domains) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
        }
    }
}
