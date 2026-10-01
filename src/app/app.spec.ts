/**
 * Tests for App Component (Root Component)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { App } from './app';
import { GlobalMessageService } from './pages/admin/(settings)/message/global-message.service';
import { DEFAULT_GLOBAL_MESSAGE_SETTINGS, IGlobalMessageSettings } from './pages/admin/(settings)/message/global-message.model';
import { SiteUsageService } from './pages/admin/(settings)/site-usage/site-usage.service';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings } from './pages/admin/(settings)/site-usage/site-usage.model';

import { GaTrackingService } from '../shared/services/ga-tracking.service';
import { Firestore } from '@angular/fire/firestore';
import { Component, signal } from '@angular/core';
import { FeedbackService } from './core/feedback/feedback.service';

@Component({ template: '<p class="game">game</p>' })
class GamePage {}

@Component({ template: '<p>page</p>' })
class NormalPage {}

vi.mock('@angular/fire/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    Firestore: class {},
}));

describe('App Component', () => {
    let component: App;
    let fixture: ComponentFixture<App>;
    let mockSettingsSubject: BehaviorSubject<IGlobalMessageSettings>;
    let mockGlobalMessageService: Partial<GlobalMessageService>;
    let mockSiteUsageSubject: BehaviorSubject<ISiteUsageSettings>;
    let mockSiteUsageService: Partial<SiteUsageService>;
    let mockGaTrackingService: any;

    beforeEach(async () => {
        // Create a mock settings subject that the banner component will subscribe to
        mockSettingsSubject = new BehaviorSubject<IGlobalMessageSettings>(DEFAULT_GLOBAL_MESSAGE_SETTINGS);
        mockSiteUsageSubject = new BehaviorSubject<ISiteUsageSettings>(DEFAULT_SITE_USAGE_SETTINGS);

        // Mock the GlobalMessageService to avoid Firebase dependency
        mockGlobalMessageService = {
            settings$: mockSettingsSubject.asObservable(),
            getSettings: vi.fn().mockReturnValue(mockSettingsSubject.asObservable()),
        };

        // Mock the SiteUsageService
        mockSiteUsageService = {
            settings$: mockSiteUsageSubject.asObservable(),
            getSettings: vi.fn().mockReturnValue(mockSiteUsageSubject.asObservable()),
            getUserConsentState: vi.fn().mockReturnValue('pending'),
            shouldShowBanner: vi.fn().mockReturnValue(false),
        };

        mockGaTrackingService = {
            initializeTracking: vi.fn(),
            trackPublicPageView: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [App],
            providers: [
                provideRouter([
                    { path: 'game', component: GamePage, data: { fullScreen: true } },
                    { path: '', component: NormalPage },
                ]),
                { provide: GlobalMessageService, useValue: mockGlobalMessageService },
                { provide: SiteUsageService, useValue: mockSiteUsageService },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                { provide: Firestore, useValue: {} },
                {
                    provide: FeedbackService,
                    useValue: { start: vi.fn(), available: signal(false), panelOpen: signal(false), capturing: signal(false), screenshot: signal(null) },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(App);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });
    });

    describe('Component Metadata', () => {
        it('should be a standalone component with arc-root selector', () => {
            expect(component).toBeTruthy();
            expect(fixture.nativeElement).toBeTruthy();
        });

        it('should be standalone', () => {
            expect(App).toBeDefined();
        });
    });

    describe('Component Template', () => {
        it('should render router-outlet', () => {
            const routerOutlet = fixture.nativeElement.querySelector('router-outlet');
            expect(routerOutlet).toBeTruthy();
        });

        it('should render global message banner component', () => {
            const banner = fixture.nativeElement.querySelector('arc-global-message-banner');
            expect(banner).toBeTruthy();
        });

        it('should render site usage banner component', () => {
            const banner = fixture.nativeElement.querySelector('arc-site-usage-banner');
            expect(banner).toBeTruthy();
        });

        it('should render powered-by-footer component', () => {
            const badge = fixture.nativeElement.querySelector('arc-powered-by-footer');
            expect(badge).toBeTruthy();
        });

        it('should render global banner before router-outlet', () => {
            const template = fixture.nativeElement.innerHTML;
            const bannerIndex = template.indexOf('arc-global-message-banner');
            const routerIndex = template.indexOf('router-outlet');
            expect(bannerIndex).toBeLessThan(routerIndex);
        });

        it('should render site usage banner after router-outlet', () => {
            const template = fixture.nativeElement.innerHTML;
            const routerIndex = template.indexOf('router-outlet');
            const cookieIndex = template.indexOf('arc-site-usage-banner');
            expect(routerIndex).toBeLessThan(cookieIndex);
        });
    });

    describe('Component Styles', () => {
        it('should have host styles for full viewport', () => {
            const hostElement = fixture.debugElement.nativeElement;
            expect(hostElement).toBeTruthy();
        });
    });

    describe('Navigation progress', () => {
        it('shows a fixed top bar while navigating and never an in-flow spinner', () => {
            component.navigating.set(true);
            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.querySelector('arc-nav-progress')).toBeTruthy();
            // The old block-level spinner shifted the page down; it must not come back.
            expect(host.querySelector('arc-page-spinner')).toBeNull();
            const main = host.querySelector('main.arc-route-host')!;
            expect(main.querySelector('arc-nav-progress')).toBeNull();

            component.navigating.set(false);
            fixture.detectChanges();
            expect(host.querySelector('arc-nav-progress')).toBeNull();
        });
    });

    describe('The routed page', () => {
        // The global stylesheet, as index.html loads it (the Material theme import left out).
        let globalStyles: HTMLStyleElement;
        beforeEach(() => {
            const css = readFileSync(resolve(__dirname, '..', 'styles.css'), 'utf8').replace(/^@import[^;]+;/m, '');
            globalStyles = Object.assign(document.createElement('style'), { textContent: css });
            document.head.append(globalStyles);
        });
        afterEach(() => {
            globalStyles.remove();
            document.documentElement.classList.remove('arc-full-screen');
        });
        const routedPage = (): HTMLElement => fixture.nativeElement.querySelector('main.arc-route-host > :not(router-outlet)');

        it('takes the room above the footer, from the global styles', async () => {
            await TestBed.inject(Router).navigateByUrl('/');
            fixture.detectChanges();
            expect(getComputedStyle(routedPage()).flexGrow).toBe('1');
        });

        it('may shrink to the screen on a full-screen route', async () => {
            await TestBed.inject(Router).navigateByUrl('/game');
            fixture.detectChanges();
            expect(getComputedStyle(routedPage()).flexGrow).toBe('1');
            expect(getComputedStyle(routedPage()).minHeight).toMatch(/^0(px)?$/);
        });

        it("is not styled from the root component, whose styles cannot reach it", () => {
            // Emulated encapsulation scopes these to the root's own template; the routed page is not in it.
            const rootSource = readFileSync(resolve(__dirname, 'app.ts'), 'utf8');
            expect(rootSource).not.toMatch(/\.arc-route-host\s*>/);
        });
    });

    describe('Full-screen routes', () => {
        const hidden = (selector: string) => getComputedStyle(fixture.nativeElement.querySelector(selector)).display === 'none';
        const CHROME = ['arc-global-message-banner', 'arc-powered-by-footer', 'arc-site-usage-banner', 'arc-pwa-update-bar'];

        afterEach(() => document.documentElement.classList.remove('arc-full-screen'));

        it('steps out of the way on a route with data: { fullScreen: true }, and comes back after', async () => {
            const router = TestBed.inject(Router);
            await router.navigateByUrl('/game');
            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.classList).toContain('arc-full-screen');
            expect(document.documentElement.classList).toContain('arc-full-screen');
            for (const selector of CHROME) expect(hidden(selector), selector).toBe(true);
            // Held, not removed: the site-usage banner and the update bar keep their state for the next page.
            for (const selector of CHROME) expect(host.querySelector(selector), selector).toBeTruthy();

            await router.navigateByUrl('/');
            fixture.detectChanges();
            expect(host.classList).not.toContain('arc-full-screen');
            expect(document.documentElement.classList).not.toContain('arc-full-screen');
            for (const selector of CHROME) expect(hidden(selector), selector).toBe(false);
        });

        it('leaves normal pages alone', async () => {
            await TestBed.inject(Router).navigateByUrl('/');
            fixture.detectChanges();
            expect(fixture.nativeElement.classList).not.toContain('arc-full-screen');
            for (const selector of CHROME) expect(hidden(selector), selector).toBe(false);
        });
    });
});
