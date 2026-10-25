import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_USER_SETTINGS, AVAILABLE_ROLES, IUserSettings, phoneCountryCode, phoneCountrySettings } from './user-setting.model';

describe('UserSettingModel', () => {
    describe('DEFAULT_USER_SETTINGS', () => {
        it('should have signups enabled by default', () => {
            expect(DEFAULT_USER_SETTINGS.isSignupEnabled).toBe(true);
        });

        it('should have user as default role', () => {
            expect(DEFAULT_USER_SETTINGS.defaultRole).toBe('user');
        });
    });

    describe('AVAILABLE_ROLES', () => {
        it('should have admin and user roles', () => {
            expect(AVAILABLE_ROLES).toHaveLength(2);
            expect(AVAILABLE_ROLES[0].id).toBe('admin');
            expect(AVAILABLE_ROLES[1].id).toBe('user');
        });

        it('should have proper labels for roles', () => {
            expect(AVAILABLE_ROLES[0].label).toBe('Admin');
            expect(AVAILABLE_ROLES[1].label).toBe('User');
        });

        it('should have descriptions for roles', () => {
            expect(AVAILABLE_ROLES[0].description).toBeTruthy();
            expect(AVAILABLE_ROLES[1].description).toBeTruthy();
        });
    });

    describe('IUserSettings interface', () => {
        it('should allow creating valid settings object', () => {
            const settings: IUserSettings = {
                isSignupEnabled: false,
                defaultRole: 'admin',
            };
            expect(settings.isSignupEnabled).toBe(false);
            expect(settings.defaultRole).toBe('admin');
        });

        it('should allow optional id field', () => {
            const settings: IUserSettings = {
                id: 'test-id',
                isSignupEnabled: true,
                defaultRole: 'user',
            };
            expect(settings.id).toBe('test-id');
        });
    });

    describe('phoneCountryCode', () => {
        it('is the copied SMS default, digits only, and 91 without one', () => {
            expect(phoneCountryCode({ phoneCountryCode: '44' })).toBe('44');
            expect(phoneCountryCode({ phoneCountryCode: '+1' })).toBe('1');
            expect(phoneCountryCode({})).toBe('91');
            expect(phoneCountryCode(null)).toBe('91');
        });
    });

    describe('phoneCountrySettings', () => {
        it('is the copied countries, the default among them', () => {
            expect(phoneCountrySettings({ phoneCountry: 'GB', phoneCountryCode: '44', phoneCountries: ['IN', 'GB', 'US'] }))
                .toEqual({ country: 'GB', countries: ['GB', 'IN', 'US'], listed: true });
        });

        it('makes do with a copy from before countries were stored, and says the list is not known', () => {
            expect(phoneCountrySettings({ phoneCountryCode: '44' })).toEqual({ country: 'GB', countries: ['GB'], listed: false });
            expect(phoneCountrySettings(null)).toEqual({ country: 'IN', countries: ['IN'], listed: false });
        });
    });
});

describe('email PIN sign-in and the new-device code: the app\'s choice, else the admin\'s (specs/sign-in-pin-spec.md)', () => {
    it('follows the admin when the app fixed nothing', async () => {
        const { emailPinOn, newDeviceCodeOn } = await import('./user-setting.model');
        const none = { emailSignIn: null, newDeviceCode: null };
        expect(emailPinOn({ emailSignIn: 'pin' }, none)).toBe(true);
        expect(emailPinOn({}, none)).toBe(false);
        expect(emailPinOn(null, none)).toBe(false);
        expect(newDeviceCodeOn({ newDeviceCode: true }, none)).toBe(true);
        expect(newDeviceCodeOn({}, none)).toBe(false);
    });

    it('takes the app\'s choice over the admin\'s', async () => {
        const { emailPinOn, newDeviceCodeOn } = await import('./user-setting.model');
        expect(emailPinOn({ emailSignIn: 'password' }, { emailSignIn: 'pin', newDeviceCode: null })).toBe(true);
        expect(emailPinOn({ emailSignIn: 'pin' }, { emailSignIn: 'password', newDeviceCode: null })).toBe(false);
        expect(newDeviceCodeOn({ newDeviceCode: true }, { emailSignIn: null, newDeviceCode: false })).toBe(false);
    });
});
