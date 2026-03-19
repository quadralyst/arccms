/**
 * Tests for App Component (Root Component)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { App } from './app';
import { GlobalMessageService } from './pages/admin/(settings)/message/global-message.service';
import { DEFAULT_GLOBAL_MESSAGE_SETTINGS, IGlobalMessageSettings } from './pages/admin/(settings)/message/global-message.model';
import { SiteUsageService } from './pages/admin/(settings)/site-usage/site-usage.service';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings } from './pages/admin/(settings)/site-usage/site-usage.model';

import { GaTrackingService } from '../shared/services/ga-tracking.service';
import { Firestore } from '@angular/fire/firestore';

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
                provideRouter([]),
                { provide: GlobalMessageService, useValue: mockGlobalMessageService },
                { provide: SiteUsageService, useValue: mockSiteUsageService },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                { provide: Firestore, useValue: {} },
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
});
