import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../test/header-test-providers';
import DashboardComponent from './dashboard.page';
import { GlobalService } from '../../../../shared/services/global.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { AnalyticsStore } from './analytics.store';
import { AnalyticsConnectionStatusService } from '../../../../shared/services/analytics-connection-status.service';
import { GoogleOAuthService } from '../../../../shared/services/google-oauth.service';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { DraftContentsService } from '../contents/draft-content-store/draft-contents.service';
import { MediaManagerService } from '../(media)/media-manager.service';
import { WaitlistedUsersService } from '../(waitlists)/waitlisted-users.service';
import { UserService } from '../users/user.service';
import { WaitlistAdminStore } from '../(waitlists)/waitlist.store';
import { Firestore } from '@angular/fire/firestore';

describe('DashboardComponent', () => {
    let component: DashboardComponent;
    let fixture: ComponentFixture<DashboardComponent>;

    const mockGlobal = {
        debugMode: signal(false)
    };
    const mockToast = {
        openCustomSnackbar: vi.fn()
    };
    const mockLocation = {};
    const mockRouter = {
        navigate: vi.fn(),
        createUrlTree: vi.fn().mockReturnValue({ toString: () => '' }),
        serializeUrl: vi.fn().mockReturnValue(''),
        events: of(new NavigationEnd(0, '/', '/'))
    };
    const mockParamMap = {
        get: vi.fn(),
        keys: []
    };
    const mockRoute = { paramMap: of(mockParamMap) };
    const mockSanitizer = {};
    const mockAnalyticsStore = {
        items: signal([]),
        isLoading: signal(false),
        update: vi.fn().mockReturnValue(of({})),
        getAll: vi.fn(),
        unsubscribeStore: vi.fn()
    };
    const mockContentTypesStore = {
        items: signal([]),
        isLoading: signal(false),
        getAll: vi.fn(),
        unsubscribeStore: vi.fn()
    };
    const mockDraftContentsService = {
        getCollectionTotalCount: vi.fn().mockReturnValue(of(0)),
        getAll: vi.fn().mockReturnValue(of({ collectionData: [], totalCount: 0 }))
    };
    const mockMediaService = {
        getCollectionTotalCount: vi.fn().mockReturnValue(of(0))
    };
    const mockWaitlistedUsersService = {
        getCollectionTotalCount: vi.fn().mockReturnValue(of(0)),
        getAll: vi.fn().mockReturnValue(of({ collectionData: [], totalCount: 0 }))
    };
    const mockUserService = {
        getCollectionTotalCount: vi.fn().mockReturnValue(of(0))
    };
    const mockEmailConfigService = {
        isEmailConfigured: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        bannerDismissed: vi.fn().mockReturnValue(false),
        shouldShowBanner: vi.fn().mockReturnValue(true),
        dismissBanner: vi.fn(),
        debugMode: vi.fn().mockReturnValue(false)
    };
    const mockAnalyticsConnectionStatus = {
        isConnected: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        propertyName: vi.fn().mockReturnValue(null),
        propertyId: vi.fn().mockReturnValue(null),
        lastSyncDate: vi.fn().mockReturnValue(null)
    };
    const mockGoogleOAuthService = {
        connectAnalytics: vi.fn(),
        refreshAnalyticsData: vi.fn(),
        disconnectAnalytics: vi.fn(),
        selectProperty: vi.fn(),
        requestAuthorizationCode: vi.fn()
    };
    const mockWaitlistAdminStore = {
        items: signal([]),
        loading: signal(false),
        error: signal(null),
        totalItems: signal(0),
        subscribe: vi.fn(),
        destroy: vi.fn()
    };
    const mockFirestore = {};
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DashboardComponent],
            providers: [
                ...headerTestProviders(),
                { provide: GlobalService, useValue: mockGlobal },
                { provide: ToastService, useValue: mockToast },
                { provide: Location, useValue: mockLocation },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockRoute },
                { provide: DomSanitizer, useValue: mockSanitizer },
                { provide: AnalyticsStore, useValue: mockAnalyticsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: DraftContentsService, useValue: mockDraftContentsService },
                { provide: MediaManagerService, useValue: mockMediaService },
                { provide: WaitlistedUsersService, useValue: mockWaitlistedUsersService },
                { provide: UserService, useValue: mockUserService },
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService },
                { provide: AnalyticsConnectionStatusService, useValue: mockAnalyticsConnectionStatus },
                { provide: GoogleOAuthService, useValue: mockGoogleOAuthService },
                { provide: WaitlistAdminStore, useValue: mockWaitlistAdminStore },
                { provide: Firestore, useValue: mockFirestore }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(DashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should return correct color class for known metric titles', () => {
        expect(component.getMetricColor('Sessions')).toBe('blue');
        expect(component.getMetricColor('Users')).toBe('green');
        expect(component.getMetricColor('Bounce Rate')).toBe('red');
    });

    it('should return default blue class for unknown metric titles', () => {
        expect(component.getMetricColor('Unknown Metric')).toBe('blue');
    });

    it('should return cycling colors for content types', () => {
        expect(component.getContentTypeColor(0)).toBe('blue');
        expect(component.getContentTypeColor(1)).toBe('navy');
        expect(component.getContentTypeColor(6)).toBe('blue'); // cycles back
    });

    it('should return zero counts for unknown content type slug', () => {
        const counts = component.getContentCount('unknown-slug');
        expect(counts.total).toBe(0);
        expect(counts.published).toBe(0);
        expect(counts.draft).toBe(0);
    });

    describe('getTimeAgo', () => {
        it('should return empty string for null date', () => {
            expect(component.getTimeAgo(null)).toBe('');
        });

        it('should return empty string for undefined date', () => {
            expect(component.getTimeAgo(undefined)).toBe('');
        });

        it('should return minutes ago for recent dates', () => {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            expect(component.getTimeAgo(tenMinutesAgo)).toBe('10m ago');
        });

        it('should return hours ago for dates within 24 hours', () => {
            const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
            expect(component.getTimeAgo(fiveHoursAgo)).toBe('5h ago');
        });

        it('should return days ago for dates within a week', () => {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
            expect(component.getTimeAgo(threeDaysAgo)).toBe('3d ago');
        });

        it('should handle Firestore timestamp with seconds property', () => {
            const oneHourAgo = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
            const firestoreTimestamp = { seconds: oneHourAgo };
            expect(component.getTimeAgo(firestoreTimestamp)).toBe('1h ago');
        });
    });

    describe('getStatusBadgeClass', () => {
        it('should return bg-success for published status', () => {
            expect(component.getStatusBadgeClass('publish')).toBe('bg-success');
        });

        it('should return bg-warning for draft status', () => {
            expect(component.getStatusBadgeClass('draft')).toBe('bg-warning text-dark');
        });

        it('should return bg-warning for any non-publish status', () => {
            expect(component.getStatusBadgeClass('pending')).toBe('bg-warning text-dark');
        });
    });

    describe('formatDate', () => {
        it('should return empty string for null date', () => {
            expect(component.formatDate(null)).toBe('');
        });

        it('should format a valid Date object', () => {
            const date = new Date('2025-12-18T14:30:00');
            const formatted = component.formatDate(date);
            expect(formatted).toContain('Dec');
            expect(formatted).toContain('18');
            expect(formatted).toContain('2025');
        });

        it('should handle Firestore timestamp with seconds property', () => {
            const timestamp = { seconds: 1734529800 }; // Dec 18, 2025
            const formatted = component.formatDate(timestamp);
            expect(formatted).toContain('Dec');
        });
    });

    describe('getGa4Url', () => {
        it('should return Firebase Console analytics URL with project ID', () => {
            const url = component.getGa4Url();
            expect(url).toContain('console.firebase.google.com');
            expect(url).toContain('/analytics/');
        });
    });

    describe('formatShortDate', () => {
        it('should return empty string for null', () => {
            expect(component.formatShortDate(null)).toBe('');
        });

        it('should return empty string for undefined', () => {
            expect(component.formatShortDate(undefined)).toBe('');
        });

        it('should format a JS Date object as "Mon d, yyyy"', () => {
            const date = new Date('2026-01-30T00:00:00');
            const formatted = component.formatShortDate(date);
            expect(formatted).toContain('Jan');
            expect(formatted).toContain('30');
            expect(formatted).toContain('2026');
        });

        it('should handle Firestore timestamp with seconds property', () => {
            // Jan 30, 2026 00:00:00 UTC = 1769731200
            const timestamp = { seconds: 1769731200 };
            const formatted = component.formatShortDate(timestamp);
            expect(formatted).toContain('Jan');
            expect(formatted).toContain('2026');
        });

        it('should handle Firestore timestamp with toDate method', () => {
            const fakeTimestamp = {
                toDate: () => new Date('2026-02-27T12:00:00'),
            };
            const formatted = component.formatShortDate(fakeTimestamp);
            expect(formatted).toContain('Feb');
            expect(formatted).toContain('27');
            expect(formatted).toContain('2026');
        });

        it('should return empty string for invalid date', () => {
            expect(component.formatShortDate('not-a-date')).toBe('');
        });

        it('should handle ISO date string', () => {
            const formatted = component.formatShortDate('2026-02-27');
            expect(formatted).toContain('Feb');
            expect(formatted).toContain('2026');
        });
    });

    describe('getMetricColor — all 9 metric titles', () => {
        it('should map Users to green', () => {
            expect(component.getMetricColor('Users')).toBe('green');
        });

        it('should map New Users to teal', () => {
            expect(component.getMetricColor('New Users')).toBe('teal');
        });

        it('should map Sessions to blue', () => {
            expect(component.getMetricColor('Sessions')).toBe('blue');
        });

        it('should map Bounce Rate to red', () => {
            expect(component.getMetricColor('Bounce Rate')).toBe('red');
        });

        it('should map Avg. Duration to navy', () => {
            expect(component.getMetricColor('Avg. Duration')).toBe('navy');
        });

        it('should map Pages/Session to navy', () => {
            expect(component.getMetricColor('Pages/Session')).toBe('navy');
        });

        it('should map Pageviews to orange', () => {
            expect(component.getMetricColor('Pageviews')).toBe('orange');
        });

        it('should map Event Count to blue', () => {
            expect(component.getMetricColor('Event Count')).toBe('blue');
        });

        it('should map Engaged Sessions to green', () => {
            expect(component.getMetricColor('Engaged Sessions')).toBe('green');
        });
    });

    describe('Email Configuration Service', () => {
        it('should have emailConfigService injected', () => {
            expect(component.emailConfigService).toBeTruthy();
        });

        it('should expose shouldShowBanner method via service', () => {
            expect(component.emailConfigService.shouldShowBanner).toBeDefined();
        });

        it('should expose dismissBanner method via service', () => {
            expect(component.emailConfigService.dismissBanner).toBeDefined();
        });
    });
});
