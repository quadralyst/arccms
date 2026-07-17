import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings, SITE_USAGE_STORAGE_KEY, getGradientById } from './site-usage.model';
import { GRADIENT_PRESETS } from '../message/global-message.model';

const { mockOnSnapshot, mockUnsubscribe } = vi.hoisted(() => ({
    mockOnSnapshot: vi.fn(),
    mockUnsubscribe: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class Firestore { },
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({})),
    onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
}));

import { Firestore } from '@angular/fire/firestore';
import { SiteUsageService } from './site-usage.service';

describe('Site Usage Model', () => {
    describe('DEFAULT_SITE_USAGE_SETTINGS', () => {
        it('should have consent disabled by default', () => {
            expect(DEFAULT_SITE_USAGE_SETTINGS.isEnabled).toBe(false);
        });

        it('should have info-blue as default gradient', () => {
            expect(DEFAULT_SITE_USAGE_SETTINGS.gradientId).toBe('info-blue');
        });

        it('should have default banner text', () => {
            expect(DEFAULT_SITE_USAGE_SETTINGS.bannerText).toContain('cookies');
        });

        it('should have default accept button text', () => {
            expect(DEFAULT_SITE_USAGE_SETTINGS.acceptButtonText).toBe('Accept All');
        });

        it('should have default reject button text', () => {
            expect(DEFAULT_SITE_USAGE_SETTINGS.rejectButtonText).toBe('Reject All');
        });

        it('should have default privacy policy link', () => {
            expect(DEFAULT_SITE_USAGE_SETTINGS.privacyPolicyLink).toBe('/p/cookie-policy');
        });
    });

    describe('SITE_USAGE_STORAGE_KEY', () => {
        it('should be defined', () => {
            expect(SITE_USAGE_STORAGE_KEY).toBe('arc_site_usage');
        });
    });

    describe('getGradientById', () => {
        it('should return correct gradient for valid ID', () => {
            const gradient = getGradientById('ocean-teal');
            expect(gradient.id).toBe('ocean-teal');
            expect(gradient.gradient).toContain('linear-gradient');
        });

        it('should return first gradient for invalid ID', () => {
            const gradient = getGradientById('invalid-id');
            expect(gradient).toEqual(GRADIENT_PRESETS[0]);
        });

        it('should return first gradient for empty ID', () => {
            const gradient = getGradientById('');
            expect(gradient).toEqual(GRADIENT_PRESETS[0]);
        });
    });

    describe('ISiteUsageSettings interface usage', () => {
        it('should accept valid settings object', () => {
            const settings: ISiteUsageSettings = {
                isEnabled: true,
                bannerText: 'We use cookies',
                acceptButtonText: 'Accept',
                rejectButtonText: 'Reject',
                privacyPolicyLink: '/privacy',
                gradientId: 'ocean-teal',
            };

            expect(settings.isEnabled).toBe(true);
            expect(settings.bannerText).toBe('We use cookies');
            expect(settings.gradientId).toBe('ocean-teal');
        });

        it('should work with optional id field', () => {
            const settings: ISiteUsageSettings = {
                ...DEFAULT_SITE_USAGE_SETTINGS,
                id: 'test-id',
            };

            expect(settings.id).toBe('test-id');
        });
    });
});

describe('SiteUsageService', () => {
    function makeService(platform: 'browser' | 'server'): SiteUsageService {
        TestBed.configureTestingModule({
            providers: [
                { provide: Firestore, useValue: {} },
                { provide: PLATFORM_ID, useValue: platform },
            ],
        });
        return TestBed.inject(SiteUsageService);
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();
        mockOnSnapshot.mockReturnValue(mockUnsubscribe);
    });

    it('does not register a Firestore listener during SSR', () => {
        // The consent banner is rendered from the root App component and injects
        // this service in a field initializer, so the constructor runs on every
        // server render — before the banner's own ngOnInit platform guard. A
        // listener registered there outlives the request injector it captured;
        // the next settings edit then fires @angular/fire's callback against a
        // destroyed injector (NG0205) and kills the process.
        makeService('server');

        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    it('still emits the default settings during SSR', async () => {
        const service = makeService('server');

        const emitted = await new Promise((resolve) => {
            service.settings$.subscribe(resolve);
        });

        expect(emitted).toEqual(DEFAULT_SITE_USAGE_SETTINGS);
    });

    it('registers a listener in the browser', () => {
        makeService('browser');

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    });

    it('drops the listener when the injector is destroyed', () => {
        const service = makeService('browser');

        service.ngOnDestroy();

        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('ngOnDestroy is safe on the server, where no listener was registered', () => {
        const service = makeService('server');

        expect(() => service.ngOnDestroy()).not.toThrow();
        expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
});
