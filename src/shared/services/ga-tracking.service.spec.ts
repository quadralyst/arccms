/**
 * Unit tests for GaTrackingService: every event goes through AnalyticsService's gate
 * (docs/features/analytics.html), and nothing derived from an email address is sent.
 */
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { GaTrackingService } from './ga-tracking.service';
import { AnalyticsService } from '../../app/core/analytics/analytics.service';

describe('GaTrackingService', () => {
    let service: GaTrackingService;
    const gate = { log: vi.fn(), setUserId: vi.fn(), setUserProperties: vi.fn() };

    function setup(platform = 'browser') {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                GaTrackingService,
                { provide: AnalyticsService, useValue: gate },
                { provide: PLATFORM_ID, useValue: platform },
            ],
        });
        return TestBed.inject(GaTrackingService);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        service = setup();
    });

    it('sends every event through the analytics gate, with a timestamp', () => {
        service.trackContentListView('blog', 3);
        service.trackContentDetailView('blog', 'a', 'A');
        service.trackPublicPageView('about');
        service.trackShareClick('x', 'a');
        service.trackWaitlistView('w');
        service.trackWaitlistFormStart('w');
        service.trackWaitlistSignupSubmit('w', false);
        service.trackWaitlistOtpSend('w');
        service.trackWaitlistOtpVerify('w', true);
        service.trackWaitlistSignupComplete('w', 1);
        service.trackWaitlistExistingUser('w', 1);
        service.trackWaitlistError('w', 'e', 'm');
        service.trackReferralLinkCopy('w', 'r');
        service.trackLeaderboardView('w');
        service.trackUnsubscribeView('w');
        expect(gate.log).toHaveBeenCalledTimes(15);
        for (const [, params] of gate.log.mock.calls) expect(params.timestamp).toEqual(expect.any(Number));
        expect(gate.log).toHaveBeenCalledWith('content_list_view', expect.objectContaining({ content_type: 'blog', item_count: 3 }));
    });

    it('sends nothing on the server', () => {
        const server = setup('server');
        server.initializeTracking();
        server.trackPublicPageView('about');
        expect(gate.log).not.toHaveBeenCalled();
        expect(gate.setUserProperties).not.toHaveBeenCalled();
    });

    it('links the account with the user id and the form only, never the email domain', () => {
        service.linkUserAfterSignup('user-123', 'test-waitlist');
        expect(gate.setUserId).toHaveBeenCalledWith('user-123');
        expect(gate.setUserProperties).toHaveBeenCalledWith({ primary_waitlist: 'test-waitlist' });
        const sent = JSON.stringify([...gate.setUserProperties.mock.calls, ...gate.setUserId.mock.calls]);
        expect(sent).not.toContain('@');
        expect(sent).not.toContain('email');
    });

    it('saves UTM values and the referral code as user properties, once', () => {
        window.history.replaceState({}, '', '/?utm_source=news&ref=abc');
        service.initializeTracking();
        service.initializeTracking();
        expect(gate.setUserProperties).toHaveBeenCalledTimes(1);
        expect(gate.setUserProperties).toHaveBeenCalledWith({ utm_source: 'news', referral_code: 'abc' });
        expect(gate.log).toHaveBeenCalledWith('referral_code_used', expect.objectContaining({ referral_code: 'abc' }));
        window.history.replaceState({}, '', '/');
    });
});
