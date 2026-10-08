/**
 * Signup forms switched off (off: ['forms'] in src/custom/features.ts): the
 * dashboard drops the "Recent Waitlist Signups" table and does not read it,
 * while the audience's own Total Signups card stays (specs/feature-flags-spec.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { of } from 'rxjs';

vi.mock('../../../../custom/features', () => ({ CUSTOM_FEATURES: { off: ['forms'] } }));

import { Firestore } from '@angular/fire/firestore';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { isOn } from '../../../core/features/features';
import DashboardComponent from './dashboard.page';
import { AnalyticsStore } from './analytics.store';
import { AnalyticsConnectionStatusService } from '../../../../shared/services/analytics-connection-status.service';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { GoogleOAuthService } from '../../../../shared/services/google-oauth.service';
import { SiteUsageService } from '../(settings)/site-usage/site-usage.service';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { DraftContentsService } from '../contents/draft-content-store/draft-contents.service';
import { MediaManagerService } from '../(media)/media-manager.service';
import { AudienceService } from '../(audience)/audience.service';
import { UserService } from '../users/user.service';
import { WaitlistAdminStore } from '../(waitlists)/waitlist.store';

describe('dashboard with signup forms off', () => {
    let fixture: ComponentFixture<DashboardComponent>;
    const audience = {
        countContacts: vi.fn().mockResolvedValue(0),
        countContactsSince: vi.fn().mockResolvedValue(0),
        countContactsByConsent: vi.fn().mockResolvedValue(0),
        getRecentContacts: vi.fn().mockReturnValue(of([])),
    };
    const waitlists = { items: signal([]), subscribe: vi.fn() };
    const count = { getCollectionTotalCount: vi.fn().mockReturnValue(of(0)) };

    beforeEach(async () => {
        vi.clearAllMocks();
        await TestBed.configureTestingModule({
            imports: [DashboardComponent],
            providers: [
                ...headerTestProviders(),
                {
                    provide: Router, useValue: {
                        navigate: vi.fn(),
                        createUrlTree: vi.fn().mockReturnValue({ toString: () => '' }),
                        serializeUrl: vi.fn().mockReturnValue(''),
                        events: of(new NavigationEnd(0, '/', '/')),
                    },
                },
                { provide: ActivatedRoute, useValue: { paramMap: of({ get: vi.fn(), keys: [] }) } },
                { provide: AnalyticsStore, useValue: { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() } },
                { provide: ContentTypesStore, useValue: { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() } },
                { provide: DraftContentsService, useValue: count },
                { provide: MediaManagerService, useValue: count },
                { provide: UserService, useValue: count },
                { provide: AudienceService, useValue: audience },
                {
                    provide: EmailConfigStatusService, useValue: {
                        isEmailConfigured: () => false, isLoading: () => false, bannerDismissed: () => false,
                        shouldShowBanner: () => false, dismissBanner: vi.fn(), debugMode: () => false,
                    },
                },
                {
                    provide: AnalyticsConnectionStatusService, useValue: {
                        isConnected: () => false, isLoading: () => false, propertyName: () => null,
                        propertyId: () => null, lastSyncDate: () => null,
                    },
                },
                { provide: SiteUsageService, useValue: { bannerEnabled: signal(false), settingsLoaded: signal(true) } },
                { provide: GoogleOAuthService, useValue: {} },
                { provide: WaitlistAdminStore, useValue: waitlists },
                { provide: Firestore, useValue: {} },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(DashboardComponent);
        fixture.detectChanges();
    });

    it('is off while the audience stays on', () => {
        expect(isOn('forms')).toBe(false);
        expect(isOn('audience')).toBe(true);
    });

    it('hides the recent waitlist signups table and does not read it', () => {
        expect(fixture.nativeElement.querySelector('.activity-table')).toBeNull();
        expect(audience.getRecentContacts).not.toHaveBeenCalled();
        expect(waitlists.subscribe).not.toHaveBeenCalled();
    });

    it('keeps the Total Signups card, which counts the audience', () => {
        expect(audience.countContacts).toHaveBeenCalled();
    });

    it('gives recent activity the full width', () => {
        const activity = fixture.nativeElement.querySelector('.activity-log-card')?.parentElement as HTMLElement;
        expect(activity.classList).toContain('col-12');
    });
});
