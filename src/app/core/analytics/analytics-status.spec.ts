import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { analyticsTrackingState } from './analytics-status';
import { AnalyticsTrackingStatusComponent } from './analytics-status.component';
import { SiteUsageService } from '../../pages/admin/(settings)/site-usage/site-usage.service';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

describe('analyticsTrackingState (docs/features/analytics.html)', () => {
    const base = { featureOn: true, measurementId: 'G-1', mode: 'always' as const, bannerEnabled: false };

    it('says every visitor is tracked in always mode, whatever the banner', () => {
        expect(analyticsTrackingState(base)).toBe('all-visitors');
        expect(analyticsTrackingState({ ...base, bannerEnabled: true })).toBe('all-visitors');
    });

    it('in required mode: only consenting visitors with the banner on, nobody with it off', () => {
        expect(analyticsTrackingState({ ...base, mode: 'required', bannerEnabled: true })).toBe('consenting-visitors');
        expect(analyticsTrackingState({ ...base, mode: 'required', bannerEnabled: false })).toBe('nobody-banner-off');
    });

    it('says nothing is tracked without a measurement id, and nothing at all with the feature off', () => {
        expect(analyticsTrackingState({ ...base, measurementId: '' })).toBe('no-measurement-id');
        expect(analyticsTrackingState({ ...base, measurementId: undefined })).toBe('no-measurement-id');
        expect(analyticsTrackingState({ ...base, featureOn: false })).toBe('feature-off');
    });
});

describe('AnalyticsTrackingStatusComponent', () => {
    const bannerEnabled = signal(false);
    const settingsLoaded = signal(true);

    beforeEach(() => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [AnalyticsTrackingStatusComponent, translocoTestingModule()],
            providers: [provideRouter([]), { provide: SiteUsageService, useValue: { bannerEnabled, settingsLoaded } }],
        });
    });

    it('shows the state of this install (always, the default) in plain words', () => {
        const fixture = TestBed.createComponent(AnalyticsTrackingStatusComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        // The test build has no measurement id or one, depending on the environment file;
        // either way it is one of the two states a default install can be in.
        const state = el.querySelector('[data-state]')?.getAttribute('data-state');
        expect(['all-visitors', 'no-measurement-id']).toContain(state);
        expect(el.textContent).not.toContain('admin.settings');
    });
});
