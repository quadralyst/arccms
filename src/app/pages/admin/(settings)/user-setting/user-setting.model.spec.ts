import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_USER_SETTINGS, AVAILABLE_ROLES, IUserSettings } from './user-setting.model';

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
});
