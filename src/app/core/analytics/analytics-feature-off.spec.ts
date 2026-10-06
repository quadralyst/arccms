/**
 * The analytics feature switched off (off: ['analytics'] in src/custom/features.ts):
 * nothing tracks, nothing listens, nothing is shown (specs/feature-flags-spec.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { provideRouter } from '@angular/router';

vi.mock('../../../custom/features', () => ({ CUSTOM_FEATURES: { off: ['analytics'] } }));
const onSnapshot = vi.hoisted(() => vi.fn());
vi.mock('@angular/fire/firestore', () => ({ Firestore: class Firestore {}, doc: vi.fn(() => ({})), onSnapshot }));

import { Firestore } from '@angular/fire/firestore';
import { isOn } from '../features/features';
import { FEATURE_URLS, featureOffMatcher, featureOfPath, isCorePath } from '../features/feature-routes';
import { UrlSegment } from '@angular/router';
import { AnalyticsConnectionStatusService } from '../../../shared/services/analytics-connection-status.service';
import { AnalyticsTrackingStatusComponent } from './analytics-status.component';
import { SiteUsageService } from '../../pages/admin/(settings)/site-usage/site-usage.service';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

describe('analytics feature off', () => {
    beforeEach(() => TestBed.resetTestingModule());

    it('is off, and owns the Analytics settings page', () => {
        expect(isOn('analytics')).toBe(false);
        expect(FEATURE_URLS.analytics).toContain('admin/settings/analytics');
    });

    it('hides the Analytics settings page at both its URLs, the file router\'s second one too', () => {
        const matcher = featureOffMatcher();
        for (const url of ['admin/settings/analytics', 'admin/analytics-setting']) {
            const path = url.split('/');
            expect(featureOfPath(path), url).toBe('analytics');
            expect(isCorePath(path), url).toBe(false);
            const segments = path.map((p) => new UrlSegment(p, {}));
            expect(matcher(segments, null as never, null as never), url).toEqual({ consumed: segments });
            // With the feature on, the page is there as before.
            expect(featureOffMatcher(() => true)(segments, null as never, null as never), url).toBeNull();
        }
    });

    it('does not listen to the analytics connection', () => {
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }, { provide: PLATFORM_ID, useValue: 'browser' }] });
        const status = TestBed.inject(AnalyticsConnectionStatusService);
        expect(onSnapshot).not.toHaveBeenCalled();
        expect(status.isConnected()).toBe(false);
        expect(status.isLoading()).toBe(false);
    });

    it('shows no tracking status', () => {
        TestBed.configureTestingModule({
            imports: [AnalyticsTrackingStatusComponent, translocoTestingModule()],
            providers: [provideRouter([]), { provide: SiteUsageService, useValue: { bannerEnabled: signal(true), settingsLoaded: signal(true) } }],
        });
        const fixture = TestBed.createComponent(AnalyticsTrackingStatusComponent);
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).querySelector('[data-state]')).toBeNull();
    });
});
