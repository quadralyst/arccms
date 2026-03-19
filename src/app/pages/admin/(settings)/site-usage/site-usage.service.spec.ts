import { describe, it, expect } from 'vitest';
import { DEFAULT_SITE_USAGE_SETTINGS, ISiteUsageSettings, SITE_USAGE_STORAGE_KEY, getGradientById } from './site-usage.model';
import { GRADIENT_PRESETS } from '../message/global-message.model';

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
