import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { provideRouter, Router } from '@angular/router';
import { SiteUsageBannerComponent } from './site-usage-banner.component';
import { SiteUsageService } from '../admin/(settings)/site-usage/site-usage.service';
import { ISiteUsageSettings, DEFAULT_SITE_USAGE_SETTINGS } from '../admin/(settings)/site-usage/site-usage.model';

describe('SiteUsageBannerComponent', () => {
    let component: SiteUsageBannerComponent;
    let fixture: ComponentFixture<SiteUsageBannerComponent>;
    let mockSettingsSubject: BehaviorSubject<ISiteUsageSettings>;
    let mockSiteUsageService: any;
    let router: Router;

    const enabledSettings: ISiteUsageSettings = {
        isEnabled: true,
        bannerText: 'We use cookies for a better experience.',
        acceptButtonText: 'Accept All',
        rejectButtonText: 'Reject All',
        privacyPolicyLink: '/p/cookie-policy',
        gradientId: 'ocean-teal',
    };

    beforeEach(async () => {
        mockSettingsSubject = new BehaviorSubject<ISiteUsageSettings>(DEFAULT_SITE_USAGE_SETTINGS);
        mockSiteUsageService = {
            settings$: mockSettingsSubject.asObservable(),
            getUserConsentState: vi.fn().mockReturnValue('pending'),
            setUserConsentState: vi.fn(),
            shouldShowBanner: vi.fn().mockReturnValue(true),
        };

        await TestBed.configureTestingModule({
            imports: [SiteUsageBannerComponent],
            providers: [
                provideRouter([]),
                { provide: SiteUsageService, useValue: mockSiteUsageService },
            ],
        }).compileComponents();

        router = TestBed.inject(Router);
        fixture = TestBed.createComponent(SiteUsageBannerComponent);
        component = fixture.componentInstance;
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });
    });

    describe('Banner Visibility', () => {
        it('should not display banner when disabled', () => {
            mockSiteUsageService.shouldShowBanner.mockReturnValue(false);
            mockSettingsSubject.next({ ...DEFAULT_SITE_USAGE_SETTINGS, isEnabled: false });
            fixture.detectChanges();

            const banner = fixture.nativeElement.querySelector('.arc-site-usage-banner');
            expect(banner).toBeFalsy();
        });

        it('should display banner when enabled and user has not consented', () => {
            mockSiteUsageService.shouldShowBanner.mockReturnValue(true);
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const banner = fixture.nativeElement.querySelector('.arc-site-usage-banner');
            expect(banner).toBeTruthy();
        });

        it('should not display banner when user has already accepted', () => {
            mockSiteUsageService.getUserConsentState.mockReturnValue('accepted');
            mockSiteUsageService.shouldShowBanner.mockReturnValue(false);
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const banner = fixture.nativeElement.querySelector('.arc-site-usage-banner');
            expect(banner).toBeFalsy();
        });
    });

    describe('Banner Content', () => {
        beforeEach(() => {
            mockSiteUsageService.shouldShowBanner.mockReturnValue(true);
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();
        });

        it('should display banner message', () => {
            const message = fixture.nativeElement.querySelector('.arc-site-usage-banner__message');
            expect(message.textContent).toContain('We use cookies');
        });

        it('should display accept button with correct text', () => {
            const button = fixture.nativeElement.querySelector('.arc-site-usage-banner__btn--accept');
            expect(button).toBeTruthy();
            expect(button.textContent.trim()).toBe('Accept All');
        });

        it('should display reject button with correct text', () => {
            const button = fixture.nativeElement.querySelector('.arc-site-usage-banner__btn--reject');
            expect(button).toBeTruthy();
            expect(button.textContent.trim()).toBe('Reject All');
        });

        it('should display privacy link when provided', () => {
            const link = fixture.nativeElement.querySelector('.arc-site-usage-banner__link');
            expect(link).toBeTruthy();
            expect(link.getAttribute('href')).toBe('/p/cookie-policy');
        });
    });

    describe('User Actions', () => {
        beforeEach(() => {
            mockSiteUsageService.shouldShowBanner.mockReturnValue(true);
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();
        });

        it('should call setUserConsentState with accepted when accept is clicked', () => {
            component.acceptCookies();
            expect(mockSiteUsageService.setUserConsentState).toHaveBeenCalledWith('accepted');
        });

        it('should call setUserConsentState with rejected when reject is clicked', () => {
            component.rejectCookies();
            expect(mockSiteUsageService.setUserConsentState).toHaveBeenCalledWith('rejected');
        });

        it('should hide banner after accepting', () => {
            component.acceptCookies();
            expect(component.showBanner()).toBe(false);
        });

        it('should hide banner after rejecting', () => {
            component.rejectCookies();
            expect(component.showBanner()).toBe(false);
        });
    });

    describe('Gradient Styling', () => {
        it('should return correct gradient for getGradient()', () => {
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const gradient = component.getGradient();
            expect(gradient).toContain('linear-gradient');
        });

        it('should return correct text color for getTextColor()', () => {
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const textColor = component.getTextColor();
            expect(textColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
    });

    describe('Route Awareness', () => {
        it('should have method to check admin routes', () => {
            expect(typeof component['checkRoute']).toBe('function');
        });

        it('should have method to update banner visibility', () => {
            expect(typeof component['updateBannerVisibility']).toBe('function');
        });
    });
});
