import { HttpClient } from '@angular/common/http';
import { ContentPartialsComponent } from '../../page.parts/content-partials.component';
import { ContentsStore } from '../../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../../admin/contents/content-types/content-types.store';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LeaderboardComponent } from './leaderboard.component';
import { WaitlistService } from '../waitlist.service';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { ChangeDetectorRef, signal } from '@angular/core';

import { GaTrackingService } from '../../../../shared/services/ga-tracking.service';

// Mocks
const mockWaitlistService = {
    getWaitlistBySlug: vi.fn(),
    getWaitlist: vi.fn(),
    fetchLeaderboard: vi.fn(),
    getLeaderboard: vi.fn(),
    getWaitlistedUser: vi.fn(),
    getAllReferralsData: vi.fn(),
    getWaitlists: vi.fn()
};

const mockGaTrackingService = {
    trackLeaderboardView: vi.fn(),
    logEvent: vi.fn()
};

const mockActivatedRoute = {
    paramMap: of({
        get: (key: string) => {
            if (key === 'waitlistId') return 'test-waitlist';
            return null;
        },
        // BaseComponent (reached through the footer's partials) reads `keys`.
        keys: ['waitlistId'],
    }),
    queryParams: of({}),
};

const emptyStore = { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };

describe('LeaderboardComponent', () => {
    let component: LeaderboardComponent;
    let fixture: ComponentFixture<LeaderboardComponent>;
    let waitlistService: typeof mockWaitlistService;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [LeaderboardComponent],
            providers: [
                { provide: WaitlistService, useValue: mockWaitlistService },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                // The site footer embeds <arc-content-partials>, which reaches
                // the content stores (and Firestore) and the router.
                { provide: ContentTypesStore, useValue: emptyStore },
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of('')) } },
                { provide: Router, useValue: { navigate: vi.fn(), events: of(), url: '/' } },
                ChangeDetectorRef
            ]
        })
            .overrideComponent(ContentPartialsComponent, {
                set: { providers: [{ provide: ContentsStore, useValue: emptyStore }] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(LeaderboardComponent);
        component = fixture.componentInstance;
        waitlistService = TestBed.inject(WaitlistService) as any;

        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('loadLeaderboard', () => {
        it('should use getLeaderboard (direct Firestore) when waitlistId is present', async () => {
            // Setup
            component.waitlistData = { id: 'test-id' } as any;
            component.waitlistId = 'test-waitlist';

            const mockResponse = {
                leaderboard: [
                    { id: '1', firstName: 'Test', maskedEmail: 'te***@test.com', totalReferrals: 5, queuePosition: 1 }
                ],
                totalUsers: 1,
                waitlistId: 'test-id'
            };

            waitlistService.getLeaderboard.mockResolvedValue(mockResponse);

            // Act
            await component.loadLeaderboard();

            // Assert
            expect(waitlistService.getLeaderboard).toHaveBeenCalledWith('test-id');
            expect(component.displayLeaderboard.length).toBe(1);
            expect(component.displayLeaderboard[0].maskedEmail).toBe('te***@test.com');
            // Should NOT have called cloud function
            expect(waitlistService.fetchLeaderboard).not.toHaveBeenCalled();
        });

        it('should use fetchLeaderboard (Cloud Function) when waitlistId is NOT present', async () => {
            // Setup: No waitlist data (Simulating overall board or missing data case)
            component.waitlistData = null;

            const mockResponse = {
                displayLeaderboard: [],
                totalUsers: 0,
                currentUserPosition: 0
            };

            waitlistService.fetchLeaderboard.mockResolvedValue(mockResponse);

            // Act
            await component.loadLeaderboard();

            // Assert
            expect(waitlistService.getLeaderboard).not.toHaveBeenCalled();
            expect(waitlistService.fetchLeaderboard).toHaveBeenCalled();
        });
    });
});
