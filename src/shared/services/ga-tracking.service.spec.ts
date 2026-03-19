/**
 * Unit tests for GaTrackingService
 */
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { GaTrackingService } from './ga-tracking.service';
import { Analytics } from '@angular/fire/analytics';

describe('GaTrackingService', () => {
    let service: GaTrackingService;
    let mockAnalytics: any;

    // Mock the external module functions
    vi.mock('@angular/fire/analytics', () => ({
        Analytics: class {},
        logEvent: vi.fn(),
        setUserId: vi.fn(),
        setUserProperties: vi.fn()
    }));

    beforeEach(() => {
        mockAnalytics = {
            app: { name: 'test-app' },
        };

        TestBed.configureTestingModule({
            providers: [
                GaTrackingService,
                { provide: Analytics, useValue: mockAnalytics },
                { provide: PLATFORM_ID, useValue: 'browser' },
            ],
        });

        service = TestBed.inject(GaTrackingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('initializeTracking', () => {
        it('should return early in non-browser environment', async () => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    GaTrackingService,
                    { provide: Analytics, useValue: mockAnalytics },
                    { provide: PLATFORM_ID, useValue: 'server' },
                ],
            });

            const serverService = TestBed.inject(GaTrackingService);
            serverService.initializeTracking();
            // Should complete without errors
            expect(serverService).toBeTruthy();
        });

        it('should only initialize once', () => {
            service.initializeTracking();
            service.initializeTracking();
            // Should not throw
            expect(service).toBeTruthy();
        });
    });

    describe('tracking methods', () => {
        it('trackWaitlistView should not throw', () => {
            expect(() => {
                service.trackWaitlistView('test-waitlist', 'Test Waitlist');
            }).not.toThrow();
        });

        it('trackWaitlistSignupSubmit should not throw', () => {
            expect(() => {
                service.trackWaitlistSignupSubmit('test-waitlist', true);
            }).not.toThrow();
        });

        it('trackWaitlistOtpVerify should not throw', () => {
            expect(() => {
                service.trackWaitlistOtpVerify('test-waitlist', true);
            }).not.toThrow();
        });

        it('trackWaitlistSignupComplete should not throw', () => {
            expect(() => {
                service.trackWaitlistSignupComplete('test-waitlist', 100, 'REF123');
            }).not.toThrow();
        });

        it('trackReferralLinkCopy should not throw', () => {
            expect(() => {
                service.trackReferralLinkCopy('test-waitlist', 'REF123');
            }).not.toThrow();
        });

        it('trackLeaderboardView should not throw', () => {
            expect(() => {
                service.trackLeaderboardView('test-waitlist', 'user-123');
            }).not.toThrow();
        });

        it('trackContentListView should not throw', () => {
            expect(() => {
                service.trackContentListView('articles', 10);
            }).not.toThrow();
        });

        it('trackContentDetailView should not throw', () => {
            expect(() => {
                service.trackContentDetailView('articles', 'test-article', 'Test Article Title');
            }).not.toThrow();
        });

        it('trackPublicPageView should not throw', () => {
            expect(() => {
                service.trackPublicPageView('about');
            }).not.toThrow();
        });

        it('trackShareClick should not throw', () => {
            expect(() => {
                service.trackShareClick('twitter', 'test-article');
            }).not.toThrow();
        });

        it('linkUserAfterSignup should not throw', () => {
            expect(() => {
                service.linkUserAfterSignup('user-123', 'test@example.com', 'test-waitlist');
            }).not.toThrow();
        });
    });
});
